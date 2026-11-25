import { z } from 'zod';
import { assert, digest, rateLimit } from './security';
import { couponDiscount, normalizeCouponCode, type CouponQuote } from './coupon-format';
import { couponHint, type CreatedCouponBatch } from './coupon-issuance';

export async function quoteCoupon(
  env: Env,
  code: string,
  sku: string,
  unitPrice: number,
): Promise<CouponQuote & { id: string }> {
  assert(['FAMILY', 'GIFT'].includes(sku), 400, '优惠券仅限家庭装和礼盒装');
  const normalized = normalizeCouponCode(code);
  assert(/^[A-Z0-9]{6,30}$/.test(normalized), 400, '请检查优惠码是否完整');
  const row = await env.DB.prepare(
    `SELECT c.id,c.code_hint,c.percent_off,b.expires_at
    FROM coupons c JOIN coupon_batches b ON b.id=c.batch_id
    WHERE c.code_hash=? AND c.disabled=0 AND b.disabled=0
    AND b.starts_at<=datetime('now') AND b.expires_at>datetime('now')
    AND (SELECT COUNT(*) FROM coupon_uses u WHERE u.coupon_id=c.id)<c.redemption_limit`,
  )
    .bind(await digest(normalized))
    .first<{ id: string; code_hint: string; percent_off: number; expires_at: string }>();
  assert(row, 409, '优惠码不可用：可能次数已用完、已过期或名额正在付款，请检查后重试');
  return {
    ...row,
    unit_price: unitPrice,
    sku,
    discount_amount: couponDiscount(unitPrice, row.percent_off),
  };
}

export type AdminCouponCode = {
  id: string;
  batch_id: string;
  code_hint: string;
  percent_off: number;
  disabled: number;
  redeemed_at: string | null;
  expires_at: string;
  batch_name: string;
  status: string;
  redemption_limit: number;
  used_count: number;
  reserved_count: number;
  remaining_uses: number;
};
export type AdminCouponData = {
  batches: (CreatedCouponBatch & {
    usage_limit: number;
    available: number;
    reserved: number;
    redeemed: number;
  })[];
  codes: AdminCouponCode[];
  discounts: { percent_off: number; total: number }[];
  total: number;
  page: number;
  page_size: number;
};
const couponUseStats = `(SELECT coupon_id,COUNT(*) allocated,COUNT(redeemed_at) redeemed,
  MAX(redeemed_at) last_redeemed_at FROM coupon_uses GROUP BY coupon_id)`;
const couponSource = `FROM coupons c JOIN coupon_batches b ON c.batch_id=b.id
  LEFT JOIN ${couponUseStats} u ON u.coupon_id=c.id`;
const availableSql = `CASE WHEN c.disabled=0 AND b.disabled=0
  AND b.starts_at<=datetime('now') AND b.expires_at>datetime('now')
  THEN MAX(0,c.redemption_limit-COALESCE(u.allocated,0)) ELSE 0 END`;
const statusSql = `CASE WHEN COALESCE(u.redeemed,0)>=c.redemption_limit THEN 'redeemed'
  WHEN COALESCE(u.allocated,0)>=c.redemption_limit THEN 'reserved'
  WHEN c.disabled=1 OR b.disabled=1 THEN 'disabled'
  WHEN b.expires_at<=datetime('now') THEN 'expired'
  WHEN b.starts_at>datetime('now') THEN 'scheduled' ELSE 'available' END`;
export async function adminCoupons(env: Env, input: unknown = {}): Promise<AdminCouponData> {
  const q = z
    .object({
      status: z
        .enum(['', 'available', 'reserved', 'redeemed', 'disabled', 'expired', 'scheduled'])
        .default(''),
      percent_off: z.number().int().min(1).max(90).nullable().default(null),
      search: z.string().trim().max(80).default(''),
      page: z.number().int().min(1).max(100000).default(1),
      page_size: z.number().int().min(1).max(50).default(20),
    })
    .parse(input);
  const like = '%' + q.search.replace(/[\\%_]/g, '\\$&') + '%';
  const where = `WHERE (?='' OR (${statusSql})=?) AND (? IS NULL OR c.percent_off=?)
    AND (?='' OR c.code_hint LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\')`;
  const args = [q.status, q.status, q.percent_off, q.percent_off, q.search, like, like];
  const [batches, codes, total, discounts] = await Promise.all([
    env.DB.prepare(
      `SELECT b.id,b.name,b.starts_at,b.expires_at,COUNT(c.id) total,
      COALESCE(SUM(c.redemption_limit),0) usage_limit,
      COALESCE(SUM(COALESCE(u.redeemed,0)),0) redeemed,
      COALESCE(SUM(COALESCE(u.allocated,0)-COALESCE(u.redeemed,0)),0) reserved,
      COALESCE(SUM(${availableSql}),0) available
      FROM coupon_batches b LEFT JOIN coupons c ON c.batch_id=b.id
      LEFT JOIN ${couponUseStats} u ON u.coupon_id=c.id GROUP BY b.id ORDER BY b.created_at DESC LIMIT 50`,
    ).all(),
    env.DB.prepare(
      `SELECT c.id,c.batch_id,c.code_hint,c.percent_off,c.disabled,u.last_redeemed_at redeemed_at,
      c.redemption_limit,COALESCE(u.redeemed,0) used_count,
      COALESCE(u.allocated,0)-COALESCE(u.redeemed,0) reserved_count,${availableSql} remaining_uses,
      b.expires_at,b.name batch_name,${statusSql} status ${couponSource} ${where}
      ORDER BY c.created_at DESC,c.id LIMIT ? OFFSET ?`,
    )
      .bind(...args, q.page_size, (q.page - 1) * q.page_size)
      .all<AdminCouponCode>(),
    env.DB.prepare(`SELECT COUNT(*) total ${couponSource} ${where}`)
      .bind(...args)
      .first<{ total: number }>(),
    env.DB.prepare(
      'SELECT percent_off,COUNT(*) total FROM coupons GROUP BY percent_off ORDER BY percent_off',
    ).all<{ percent_off: number; total: number }>(),
  ]);
  return {
    batches: batches.results as AdminCouponData['batches'],
    codes: codes.results,
    discounts: discounts.results,
    total: total?.total || 0,
    page: q.page,
    page_size: q.page_size,
  };
}

// The browser retains its downloaded original codes and retries the exact same
// request. D1 only receives/stores hashes; network retries do not re-issue coupons.
export async function createAdminCoupons(env: Env, actor: string, input: unknown) {
  const b = z
    .object({
      request_id: z.uuid(),
      name: z.string().trim().min(2).max(60),
      pay_percent: z.number().int().min(10).max(99),
      valid_days: z.number().int().min(1).max(365),
      codes: z.array(z.string().max(30)).min(1).max(200),
      saved: z.literal(true),
    })
    .parse(input);
  const normalized = b.codes.map(normalizeCouponCode);
  assert(
    normalized.every((code) =>
      new RegExp(`^TH${b.pay_percent}[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$`).test(code),
    ),
    400,
    '券码格式与折扣不匹配，请重新准备清单',
  );
  assert(new Set(normalized).size === normalized.length, 400, '清单中存在重复券码');
  const hashes = await Promise.all(normalized.map(digest));
  const fingerprint = await digest(JSON.stringify([b.name, b.pay_percent, b.valid_days, hashes]));
  const id = 'admin-' + b.request_id;
  const existing = await env.DB.prepare(
    'SELECT issuance_fingerprint,created_by FROM coupon_batches WHERE id=?',
  )
    .bind(id)
    .first<{ issuance_fingerprint: string; created_by: string }>();
  if (existing)
    assert(
      existing.issuance_fingerprint === fingerprint && existing.created_by === actor,
      409,
      '创建请求内容已变化，请使用原清单重试',
    );
  else {
    await rateLimit(env, 'admin-coupon-create-' + actor, 10, 600);
    // Keep each statement within 100 bind variables and the whole invocation
    // within the smaller D1 query allowance, including a 200-code batch.
    const inserts = [];
    for (let start = 0; start < hashes.length; start += 20) {
      const chunk = hashes.slice(start, start + 20);
      inserts.push(
        env.DB.prepare(
          `INSERT INTO coupons(id,batch_id,code_hash,code_hint,percent_off)
        VALUES ${chunk.map(() => '(?,?,?,?,?)').join(',')} ON CONFLICT(id) DO NOTHING`,
        ).bind(
          ...chunk.flatMap((hash, index) => [
            id + ':' + (start + index),
            id,
            hash,
            couponHint(normalized[start + index]),
            100 - b.pay_percent,
          ]),
        ),
      );
    }
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO coupon_batches(id,name,starts_at,expires_at,issuance_fingerprint,created_by)
        VALUES(?,?,datetime('now'),datetime('now',?),?,?) ON CONFLICT(id) DO NOTHING`,
      ).bind(id, b.name, `+${b.valid_days} days`, fingerprint, actor),
      ...inserts,
      env.DB.prepare('INSERT OR IGNORE INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)').bind(
        'coupon-create-' + b.request_id,
        actor,
        'create-coupon-batch',
        id,
      ),
    ]);
  }
  const batch = await env.DB.prepare(
    `SELECT b.id,b.name,b.starts_at,b.expires_at,
    (SELECT COUNT(*) FROM coupons c WHERE c.batch_id=b.id) total FROM coupon_batches b WHERE b.id=?`,
  )
    .bind(id)
    .first<CreatedCouponBatch>();
  assert(batch && batch.total === b.codes.length, 409, '创建结果未完整确认，请保留清单并重试');
  return { ok: true, batch };
}
