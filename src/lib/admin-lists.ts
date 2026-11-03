import { z } from 'zod';
import { maskPhone } from './shared';
const query = z
  .object({
    kind: z.enum(['orders', 'invoices', 'shipments', 'sponsors', 'claims', 'diary']),
    page: z.number().int().min(1).max(100000).default(1),
    page_size: z.number().int().min(1).max(50).default(20),
    search: z.string().trim().max(80).default(''),
    status: z.string().max(30).default(''),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .or(z.literal(''))
      .default(''),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .or(z.literal(''))
      .default(''),
  })
  .strict();
const orderColumns =
  'o.id,o.order_no,o.type,o.status,o.phone,o.amount,o.remote_fee,o.invoice_status,o.created_at,o.paid_at,o.stripe_payment_intent,p.name product_name,p.box_type,i.qty';
const shipmentColumns =
  's.id,s.source,s.source_id,s.product_id,s.qty,s.recipient,s.phone,s.region_label,s.expected_date,s.carrier,s.tracking_no,s.status,s.shipped_at,s.created_at,p.box_type';
export async function adminList(env: Env, input: unknown) {
  const q = query.parse(input),
    goods = ['orders', 'invoices'].includes(q.kind),
    ship = q.kind === 'shipments';
  const tables = goods
    ? 'orders o LEFT JOIN order_items i ON i.order_id=o.id LEFT JOIN products p ON p.id=i.product_id'
    : ship
      ? 'shipments s JOIN products p ON p.id=s.product_id'
      : q.kind === 'sponsors'
        ? 'sponsor_apps s'
        : q.kind === 'claims'
          ? 'claims s'
          : 'diary_posts s';
  const alias = goods ? 'o' : 's',
    date = q.kind === 'diary' ? 's.date' : alias + '.created_at';
  const columns = goods
    ? orderColumns
    : ship
      ? shipmentColumns
      : q.kind === 'sponsors'
        ? 's.id,s.app_no,s.org_name,s.event_name,s.event_date,s.headcount,s.contact,s.phone,s.wechat,s.reason,s.link,s.status,s.boxes_granted,s.product_id,s.photos,s.show_on_wall,s.photo_consent,s.rejection_reason,s.created_at'
        : q.kind === 'claims'
          ? 's.id,s.shipment_id,s.count,s.amount,s.photos,s.status,s.created_at'
          : 's.id,s.date,s.text,s.photo_urls';
  const search = goods
    ? ['o.order_no', 'o.phone', 'p.name', 'p.box_type']
    : ship
      ? ['s.id', 's.tracking_no', 's.recipient', 's.phone', 's.region_label', 'p.box_type']
      : q.kind === 'sponsors'
        ? ['s.app_no', 's.event_name', 's.org_name']
        : q.kind === 'claims'
          ? ['s.shipment_id']
          : ['s.text'];
  const args: (string | number)[] = [],
    where: string[] = [];
  if (q.kind === 'invoices') where.push("o.invoice_status!='not_requested'");
  if (q.search) {
    where.push('(' + search.map((c) => c + " LIKE ? ESCAPE '\\'").join(' OR ') + ')');
    const term = '%' + q.search.replace(/[\\%_]/g, '\\$&') + '%';
    args.push(...search.map(() => term));
  }
  if (q.status && q.kind !== 'diary') {
    where.push(q.kind === 'invoices' ? 'o.invoice_status=?' : alias + '.status=?');
    args.push(q.status);
  }
  if (q.from) {
    where.push(date + '>=?');
    args.push(q.from);
  }
  if (q.to) {
    where.push('substr(' + date + ',1,10)<=?');
    args.push(q.to);
  }
  const filter = where.length ? ' WHERE ' + where.join(' AND ') : '',
    sort = q.kind === 'sponsors' ? "CASE WHEN s.status='pending' THEN 0 ELSE 1 END," : '';
  // Search and pagination cover the full table, with bound values and bounded results.
  const rows = await env.DB.prepare(
    `SELECT ${columns} FROM ${tables}${filter} ORDER BY ${sort}${date} DESC,${alias}.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...args, q.page_size, (q.page - 1) * q.page_size)
    .all<Record<string, unknown>>();
  const count = await env.DB.prepare(`SELECT COUNT(*) total FROM ${tables}${filter}`)
    .bind(...args)
    .first<{ total: number }>();
  return {
    rows: rows.results.map((r) => ({
      ...r,
      ...(typeof r.phone === 'string' ? { phone: maskPhone(r.phone) } : {}),
    })),
    total: count?.total || 0,
    page: q.page,
    page_size: q.page_size,
  };
}
