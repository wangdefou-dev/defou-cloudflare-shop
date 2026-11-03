// Codes verified against Kuaidi100's official carrier dictionary (2026-10-30).
// Fixed landing pages only: never put waybills, phones or access tokens in URLs.
export const CARRIERS = [
  {
    code: 'shunfeng',
    name: '顺丰速运',
    query_url: 'https://www.sf-express.com/chn/sc/waybill/list',
  },
  { code: 'zhongtong', name: '中通快递', query_url: 'https://www.kuaidi100.com/' },
  { code: 'yuantong', name: '圆通速递', query_url: 'https://www.kuaidi100.com/' },
  { code: 'shentong', name: '申通快递', query_url: 'https://www.kuaidi100.com/' },
  { code: 'yunda', name: '韵达快递', query_url: 'https://www.kuaidi100.com/' },
  { code: 'jtexpress', name: '极兔速递', query_url: 'https://www.kuaidi100.com/' },
  { code: 'jd', name: '京东物流', query_url: 'https://www.kuaidi100.com/' },
  { code: 'ems', name: 'EMS', query_url: 'https://www.kuaidi100.com/' },
  { code: 'youzhengguonei', name: '邮政快递包裹', query_url: 'https://www.kuaidi100.com/' },
  { code: 'debangwuliu', name: '德邦物流', query_url: 'https://www.kuaidi100.com/' },
] as const;
export type Carrier = (typeof CARRIERS)[number];
const aliases: Record<string, Carrier['code']> = {
  顺丰: 'shunfeng',
  sf: 'shunfeng',
  中通: 'zhongtong',
  圆通: 'yuantong',
  申通: 'shentong',
  韵达: 'yunda',
  极兔: 'jtexpress',
  京东: 'jd',
  邮政: 'youzhengguonei',
  德邦: 'debangwuliu',
};
export function resolveCarrier(value: string): Carrier | undefined {
  const key = value.trim().toLowerCase();
  return CARRIERS.find(
    (c) => c.code === key || c.name.toLowerCase() === key || c.code === aliases[key],
  );
}
export function carrierQueryLabel(carrier: Carrier) {
  return carrier.code === 'shunfeng' ? '前往顺丰官网查询' : '前往快递100查询';
}
export type TrackingSnapshot = {
  shipment_id: string;
  carrier: string;
  tracking_no: string | null;
  shipped_at: string | null;
  availability:
    | 'available'
    | 'pending'
    | 'not_shipped'
    | 'not_configured'
    | 'unsupported'
    | 'unavailable'
    | 'updating';
  state: string;
  state_label: string;
  events: { time: string; description: string }[];
  fetched_at: string | null;
  next_refresh_at: string | null;
  stale: boolean;
  message: string;
  query_url: string | null;
  query_label: string;
};
