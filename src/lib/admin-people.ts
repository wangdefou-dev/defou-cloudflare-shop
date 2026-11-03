import { z } from 'zod';
import { assert, pinHash, rateLimit } from './security';
import { maskPhone } from './shared';

export type CustomerRow = {
  id: string;
  phone: string;
  recipient: string | null;
  total_orders: number;
  paid_orders: number;
  paid_amount: number;
  first_order_at: string;
  last_order_at: string;
  adoption_count: number;
};
export type AdoptionRow = {
  id: number;
  order_id: string;
  order_no: string;
  phone: string;
  status: string;
  adopt_code: string;
  plate_name: string;
  tier: number;
  total_boxes: number;
  used_boxes: number;
  expires_at: string;
  pin_version: number;
  pin_updated_at: string | null;
  has_pin: number;
  photo_count: number;
};
export type PeopleResult = {
  rows: (CustomerRow | AdoptionRow)[];
  total: number;
  page: number;
  page_size: number;
};
export type CustomerDetail = {
  customer: CustomerRow;
  orders: {
    id: string;
    order_no: string;
    type: string;
    status: string;
    amount: number;
    created_at: string;
    product_name: string | null;
    qty: number | null;
  }[];
  orders_total: number;
  page: number;
  page_size: number;
  adoptions: AdoptionRow[];
  more_adoptions: boolean;
};
export type AdoptionDetail = AdoptionRow & {
  active_sessions: number;
  resets: {
    id: string;
    actor: string;
    reason: string;
    expected_version: number;
    created_at: string;
  }[];
};
const customerCte = `WITH customers AS (
 SELECT phone,MIN(id) id,COUNT(*) total_orders,
 SUM(CASE WHEN status IN ('paid','shipped') THEN 1 ELSE 0 END) paid_orders,
 COALESCE(SUM(CASE WHEN status IN ('paid','shipped') THEN amount-remote_fee ELSE 0 END),0) paid_amount,
 MIN(created_at) first_order_at,MAX(created_at) last_order_at,
 (SELECT json_extract(r.address_json,'$.recipient') FROM orders r
  WHERE r.phone=o.phone AND json_valid(r.address_json)
   AND COALESCE(json_extract(r.address_json,'$.recipient'),'')!=''
  ORDER BY r.created_at DESC,r.id LIMIT 1) recipient,
 (SELECT COUNT(*) FROM adoptions a JOIN orders x ON x.id=a.order_id
  WHERE x.phone=o.phone AND x.status IN ('paid','shipped')) adoption_count
 FROM orders o WHERE type IN ('retail','adoption') GROUP BY phone
)`;
const adoptionSelect = `SELECT a.id,a.order_id,o.order_no,o.phone,o.status,
 a.adopt_code,a.plate_name,a.tier,a.total_boxes,a.used_boxes,a.expires_at,a.pin_version,a.pin_updated_at,
 CASE WHEN length(a.pin_hash)>0 THEN 1 ELSE 0 END has_pin,
 CASE WHEN json_valid(a.tree_photo_urls) THEN json_array_length(a.tree_photo_urls) ELSE 0 END photo_count
 FROM adoptions a JOIN orders o ON o.id=a.order_id`;
const searchSchema = z.object({
  kind: z.enum(['customers', 'adoptions']),
  query: z.string().trim().max(80).default(''),
  filter: z.enum(['all', 'paid', 'adopters', 'active', 'inactive']).default('all'),
  page: z.number().int().min(1).max(100000).default(1),
  page_size: z.number().int().min(1).max(50).default(20),
});
export async function searchPeople(env: Env, input: unknown): Promise<PeopleResult> {
  const b = searchSchema.parse(input);
  assert(
    (b.kind === 'customers' ? ['all', 'paid', 'adopters'] : ['all', 'active', 'inactive']).includes(
      b.filter,
    ),
    400,
    '筛选条件无效',
  );
  const q = /^[\d\s+-]+$/.test(b.query) ? b.query.replace(/\D/g, '') : b.query;
  const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  let prefix = '',
    where = '';
  let params: unknown[] = [];
  if (b.kind === 'customers') {
    prefix = customerCte;
    where = `(?='' OR c.phone LIKE ? ESCAPE '\\' OR EXISTS(
      SELECT 1 FROM orders x LEFT JOIN adoptions a ON a.order_id=x.id WHERE x.phone=c.phone AND (
       x.order_no LIKE ? ESCAPE '\\' OR x.plate_name LIKE ? ESCAPE '\\' OR
       (CASE WHEN json_valid(x.address_json) THEN json_extract(x.address_json,'$.recipient') END) LIKE ? ESCAPE '\\' OR a.adopt_code LIKE ? ESCAPE '\\')))`;
    if (b.filter === 'paid') where += ' AND c.paid_orders>0';
    if (b.filter === 'adopters') where += ' AND c.adoption_count>0';
    params = [q, ...Array(5).fill(like)];
  } else {
    where = `(?='' OR o.phone LIKE ? ESCAPE '\\' OR o.order_no LIKE ? ESCAPE '\\' OR a.adopt_code LIKE ? ESCAPE '\\' OR a.plate_name LIKE ? ESCAPE '\\')`;
    if (b.filter === 'active') where += " AND o.status IN ('paid','shipped')";
    if (b.filter === 'inactive') where += " AND o.status NOT IN ('paid','shipped')";
    params = [q, ...Array(4).fill(like)];
  }
  const source =
    b.kind === 'customers' ? 'customers c' : 'adoptions a JOIN orders o ON o.id=a.order_id';
  const total = await env.DB.prepare(
    `${prefix} SELECT COUNT(*) total FROM ${source} WHERE ${where}`,
  )
    .bind(...params)
    .first<{ total: number }>();
  const select = b.kind === 'customers' ? `${prefix} SELECT c.* FROM customers c` : adoptionSelect;
  const result = await env.DB.prepare(
    `${select} WHERE ${where} ORDER BY ${b.kind === 'customers' ? 'c.last_order_at DESC,c.id' : 'a.id DESC'} LIMIT ? OFFSET ?`,
  )
    .bind(...params, b.page_size, (b.page - 1) * b.page_size)
    .all<CustomerRow | AdoptionRow>();
  return {
    rows: result.results.map((row) => ({ ...row, phone: maskPhone(row.phone) })),
    total: total?.total || 0,
    page: b.page,
    page_size: b.page_size,
  };
}
export async function customerDetail(env: Env, input: unknown): Promise<CustomerDetail> {
  const b = z
    .object({
      id: z.string().min(1).max(100),
      page: z.number().int().min(1).max(100000).default(1),
    })
    .parse(input);
  const owner = await env.DB.prepare('SELECT phone FROM orders WHERE id=?')
    .bind(b.id)
    .first<{ phone: string }>();
  assert(owner, 404, '客户不存在，请刷新列表');
  const customer = await env.DB.prepare(`${customerCte} SELECT * FROM customers WHERE phone=?`)
    .bind(owner.phone)
    .first<CustomerRow>();
  assert(customer, 404, '客户不存在');
  const [orders, adoptions, count] = await Promise.all([
    env.DB.prepare(
      `SELECT o.id,o.order_no,o.type,o.status,o.amount,o.created_at,p.name product_name,i.qty
     FROM orders o LEFT JOIN order_items i ON i.order_id=o.id LEFT JOIN products p ON p.id=i.product_id
     WHERE o.phone=? ORDER BY o.created_at DESC,o.id LIMIT 20 OFFSET ?`,
    )
      .bind(owner.phone, (b.page - 1) * 20)
      .all<CustomerDetail['orders'][number]>(),
    env.DB.prepare(`${adoptionSelect} WHERE o.phone=? ORDER BY a.id DESC LIMIT 201`)
      .bind(owner.phone)
      .all<AdoptionRow>(),
    env.DB.prepare('SELECT COUNT(*) total FROM orders WHERE phone=?')
      .bind(owner.phone)
      .first<{ total: number }>(),
  ]);
  return {
    customer,
    orders: orders.results,
    orders_total: count?.total || 0,
    page: b.page,
    page_size: 20,
    adoptions: adoptions.results.slice(0, 200),
    more_adoptions: adoptions.results.length > 200,
  };
}
export async function adoptionDetail(env: Env, adoptionId: number): Promise<AdoptionDetail> {
  const row = await env.DB.prepare(`${adoptionSelect} WHERE a.id=?`)
    .bind(adoptionId)
    .first<AdoptionRow>();
  assert(row, 404, '未找到认领记录');
  const [sessions, history] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) total FROM sessions WHERE adoption_id=? AND expires_at>datetime('now')",
    )
      .bind(adoptionId)
      .first<{ total: number }>(),
    env.DB.prepare(
      'SELECT id,actor,reason,expected_version,created_at FROM adoption_pin_resets WHERE adoption_id=? ORDER BY expected_version DESC LIMIT 10',
    )
      .bind(adoptionId)
      .all<AdoptionDetail['resets'][number]>(),
  ]);
  return { ...row, active_sessions: sessions?.total || 0, resets: history.results };
}
export async function resetAdoptionPin(env: Env, actor: string, input: unknown) {
  const b = z
    .object({
      id: z.number().int().positive(),
      version: z.number().int().nonnegative(),
      pin: z.string().regex(/^\d{6}$/, '新 PIN 必须是 6 位数字'),
      confirm_pin: z.string(),
      verified: z.literal(true),
      reason: z
        .string()
        .trim()
        .min(2, '请填写重置原因')
        .max(160)
        .refine((x) => !/\d{6}/.test(x), '原因中请勿填写手机号或 PIN'),
    })
    .refine((x) => x.pin === x.confirm_pin, { message: '两次 PIN 不一致', path: ['confirm_pin'] })
    .parse(input);
  const a = await env.DB.prepare(
    'SELECT a.order_id,a.pin_version,o.status FROM adoptions a JOIN orders o ON o.id=a.order_id WHERE a.id=?',
  )
    .bind(b.id)
    .first<{ order_id: string; pin_version: number; status: string }>();
  assert(a, 404, '认领记录不存在');
  assert(['paid', 'shipped'].includes(a.status), 409, '已退款的认领不能重置 PIN');
  assert(a.pin_version === b.version, 409, 'PIN 记录已更新，请刷新详情后重试');
  await rateLimit(env, 'admin-pin-reset-' + actor, 10, 600);
  const hash = await pinHash(b.pin);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO adoption_pin_resets(id,adoption_id,expected_version,actor,reason) VALUES(?,?,?,?,?)',
    ).bind(crypto.randomUUID(), b.id, b.version, actor, b.reason),
    env.DB.prepare(
      'UPDATE adoptions SET pin_hash=?,pin_version=pin_version+1,pin_updated_at=CURRENT_TIMESTAMP WHERE id=?',
    ).bind(hash, b.id),
    env.DB.prepare('UPDATE orders SET pin_hash=? WHERE id=?').bind(hash, a.order_id),
    env.DB.prepare('DELETE FROM sessions WHERE adoption_id=?').bind(b.id),
    env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)').bind(
      crypto.randomUUID(),
      actor,
      'adoption-pin-reset',
      String(b.id),
    ),
  ]);
  return { ok: true, version: b.version + 1 };
}
export async function renameAdoption(env: Env, actor: string, input: unknown) {
  const b = z
    .object({ id: z.number().int().positive(), plate_name: z.string().trim().min(1).max(12) })
    .parse(input);
  const a = await env.DB.prepare(
    'SELECT a.order_id FROM adoptions a JOIN orders o ON o.id=a.order_id WHERE a.id=?',
  )
    .bind(b.id)
    .first<{ order_id: string }>();
  assert(a, 404, '认领记录不存在');
  await env.DB.batch([
    env.DB.prepare('UPDATE adoptions SET plate_name=? WHERE id=?').bind(b.plate_name, b.id),
    env.DB.prepare('UPDATE orders SET plate_name=? WHERE id=?').bind(b.plate_name, a.order_id),
    env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)').bind(
      crypto.randomUUID(),
      actor,
      'adoption-rename',
      String(b.id),
    ),
  ]);
  return { ok: true };
}
