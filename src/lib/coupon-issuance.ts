import site from '../../config/site.json';
import { couponLabel, normalizeCouponCode } from './coupon-format';

export type CouponDraft = {
  request_id: string;
  name: string;
  pay_percent: number;
  valid_days: number;
  codes: string[];
};
export type CreatedCouponBatch = {
  id: string;
  name: string;
  starts_at: string;
  expires_at: string;
  total: number;
};
// Full codes stay in the issuing browser/download. Neither draft nor codes are
// stored in browser storage, URLs, analytics or the server's coupon records.
export function prepareAdminCoupons(
  name: string,
  payPercent: number,
  count: number,
  validDays: number,
): CouponDraft {
  if (
    name.trim().length < 2 ||
    name.trim().length > 60 ||
    !Number.isInteger(payPercent) ||
    payPercent < 10 ||
    payPercent > 99 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 200 ||
    !Number.isInteger(validDays) ||
    validDays < 1 ||
    validDays > 365
  )
    throw Error('请检查名称、折扣、张数和有效天数');
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const codes = new Set<string>();
  while (codes.size < count) {
    const token = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((byte) => alphabet[byte & 31])
      .join('');
    codes.add('TH' + payPercent + '-' + token.match(/.{4}/g)!.join('-'));
  }
  return {
    request_id: crypto.randomUUID(),
    name: name.trim(),
    pay_percent: payPercent,
    valid_days: validDays,
    codes: [...codes],
  };
}
export function couponListText(draft: CouponDraft, batch?: CreatedCouponBatch | null) {
  const local = (date: string) =>
    new Date(date.replace(' ', 'T') + 'Z').toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    });
  return [
    site.name + ' · ' + draft.name,
    `${couponLabel(100 - draft.pay_percent)} · ${draft.codes.length} 张 · 每码一次`,
    batch
      ? `已创建；有效期：${local(batch.starts_at)} 至 ${local(batch.expires_at)}（北京时间）；当前使用状态以后台为准。`
      : `待启用；在后台确认创建成功后生效，有效 ${draft.valid_days} 天。`,
    '下单入口：' + site.url + '/buy',
    '每码仅优惠一箱家庭装或礼盒装，多箱其余原价；不叠加、不抵运费，树认领不参与。',
    '已付款或退款后不恢复使用次数。请妥善保管清单，仅将对应券码发给领取人。',
    '创建请求：' + draft.request_id,
    '',
    ...draft.codes,
    '',
  ].join('\n');
}
export const couponHint = (code: string) => {
  const clean = normalizeCouponCode(code);
  return clean.slice(0, 4) + '-****-****-****-' + clean.slice(-4);
};
export function readCouponBackup(text: string): CouponDraft {
  const value = JSON.parse(text);
  const d = value?.draft;
  if (
    value?.format !== 'orchard-coupons-v1' ||
    !d ||
    typeof d.request_id !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(d.request_id) ||
    typeof d.name !== 'string' ||
    d.name.trim().length < 2 ||
    d.name.length > 60 ||
    !Number.isInteger(d.pay_percent) ||
    d.pay_percent < 10 ||
    d.pay_percent > 99 ||
    !Number.isInteger(d.valid_days) ||
    d.valid_days < 1 ||
    d.valid_days > 365 ||
    !Array.isArray(d.codes) ||
    d.codes.length < 1 ||
    d.codes.length > 200 ||
    !d.codes.every(
      (c: unknown) =>
        typeof c === 'string' &&
        c.length <= 30 &&
        new RegExp(`^TH${d.pay_percent}[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$`).test(
          normalizeCouponCode(c),
        ),
    ) ||
    new Set(d.codes.map(normalizeCouponCode)).size !== d.codes.length
  )
    throw Error('备份文件格式无效，请选择本站导出的 JSON 备份');
  return {
    request_id: d.request_id,
    name: d.name.trim(),
    pay_percent: d.pay_percent,
    valid_days: d.valid_days,
    codes: d.codes,
  };
}
