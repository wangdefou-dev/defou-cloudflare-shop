// Synthetic batch fixture. Does not issue coupons or contact any service.
import { randomBytes, randomUUID, createHash } from 'node:crypto';
export const COUPON_PLAN = [
  { payPercent: 88, count: 20 },
  { payPercent: 80, count: 20 },
  { payPercent: 66, count: 20 },
  { payPercent: 60, count: 20 },
  { payPercent: 50, count: 20 },
  { payPercent: 10, count: 10 },
] as const;
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function prepareCouponBatch(now = new Date()) {
  const starts = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const ends = new Date(starts.getTime() + 7 * 86400000);
  const utc = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');
  const batch = {
    id: 'community-' + randomUUID(),
    name: '合成测试优惠券批次',
    starts_at: utc(starts),
    expires_at: utc(ends),
  };
  const codes = COUPON_PLAN.flatMap((plan) =>
    Array.from({ length: plan.count }, () => {
      // 16 independent base32 symbols = 80 bits. Masks reveal only the last 4.
      const token = [...randomBytes(16)].map((byte) => alphabet[byte & 31]).join('');
      const prefix = 'TH' + plan.payPercent;
      const code = prefix + '-' + token.match(/.{4}/g)!.join('-');
      return {
        id: randomUUID(),
        batch_id: batch.id,
        code,
        code_hint: prefix + '-****-****-****-' + token.slice(-4),
        code_hash: createHash('sha256').update(code.replaceAll('-', '')).digest('hex'),
        pay_percent: plan.payPercent,
        percent_off: 100 - plan.payPercent,
      };
    }),
  );
  if (new Set(codes.map((c) => c.code_hash)).size !== 110)
    throw Error('Coupon entropy collision: no output written');
  const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const sql =
    [
      `INSERT INTO coupon_batches(id,name,starts_at,expires_at) VALUES(${[batch.id, batch.name].map(quote).join(',')},datetime('now'),datetime('now','+7 days')) ON CONFLICT(id) DO NOTHING;`,
      ...codes.map(
        (c) =>
          `INSERT INTO coupons(id,batch_id,code_hash,code_hint,percent_off) VALUES(${[c.id, c.batch_id, c.code_hash, c.code_hint].map(quote).join(',')},${c.percent_off}) ON CONFLICT(id) DO NOTHING;`,
      ),
    ].join('\n') + '\n';
  return { batch, codes, sql };
}
