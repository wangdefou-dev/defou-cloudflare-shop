import { STORE, onStoreChange } from './store-config';

// Live bindings: the season dates follow the site content edited in the admin.
export let SEASON_START = STORE.season.start;
export let SEASON_END = STORE.season.end;
export let SPONSOR_MIN_HEADCOUNT = STORE.rules.sponsorMinHeadcount;
onStoreChange(() => {
  SEASON_START = STORE.season.start;
  SEASON_END = STORE.season.end;
  SPONSOR_MIN_HEADCOUNT = STORE.rules.sponsorMinHeadcount;
});
/** YYYY-MM-DD plus whole days (calendar arithmetic, no time zone). */
export function addDays(date: string, days: number) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
/** "2026 年 11 月 30 日" */
export const cnDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
};
/** "11 月 30 日" */
export const cnMonthDay = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m} 月 ${d} 日`;
};
/** Latest event date a sponsorship application may ask for. */
export const sponsorLastDate = () => addDays(SEASON_END, STORE.rules.sponsorDaysAfterSeason);
export const maxQtyPerOrder = () => STORE.rules.maxQtyPerOrder;
export const REMOTE_PROVINCES = ['150000', '460000', '540000', '630000', '650000'];
export const statusNames: Record<string, string> = {
  pending: '待支付',
  paid: '待发货',
  shipped: '已发货',
  expired: '已过期',
  refunded: '已退款',
  approved: '已通过',
  rejected: '未通过',
  photo_back: '已返图',
  reserved: '已预约',
  cancelled: '已取消',
  awaiting_payment: '待补运费',
  review: '待审核',
  not_requested: '无需发票',
  requested: '待开票',
  issued: '已开票',
};
export const money = (cents: number) =>
  (cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export function chinaDate(offset = 0, now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
}
export function isSaleDay(date = chinaDate()) {
  return date >= SEASON_START && date <= SEASON_END;
}
export const maskPhone = (s: string) => s.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
export function shippingFee(province: string, qty: number, remote: string[], fee: number) {
  return remote.includes(province) ? qty * fee : 0;
}
export function csvCell(value: unknown) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
/** Approximate box weight in kg, e.g. 22 × 250g → 5.5. */
export const boxKg = (count: number | null | undefined, gram: number | null | undefined) =>
  Math.round(((count || 0) * (gram || 0)) / 100) / 10;
/** Retail spec line such as "22 个 · 约 5.5kg". */
export const retailSpec = (count: number | null | undefined, gram: number | null | undefined) =>
  `${count || 0} ${STORE.words.countUnit} · 约 ${boxKg(count, gram)}kg`;
