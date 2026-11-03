import site from '../../config/site.json';
export const SEASON_START = site.season.start;
export const SEASON_END = site.season.end;
export const SPONSOR_MIN_HEADCOUNT = 6;
export const REMOTE_PROVINCES = site.shipping.remoteProvinces;
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
