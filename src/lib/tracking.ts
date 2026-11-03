import { digest } from './security';
import { carrierQueryLabel, resolveCarrier, type Carrier, type TrackingSnapshot } from './shipping';

// Call only after verifying ownership. No client-supplied carrier/number/phone is accepted.
export type TrackingShipment = {
  id: string;
  carrier: string;
  tracking_no: string | null;
  status: string;
  shipped_at: string | null;
  phone: string;
  recipient?: string;
  address?: string;
  sender?: string;
};
type Payload = Pick<TrackingSnapshot, 'state' | 'state_label' | 'events'>;
type CacheRow = {
  snapshot_json: string | null;
  fetched_at: number | null;
  next_refresh_at: number;
  lease_token: string | null;
  lease_until: number;
  last_result: 'available' | 'pending' | 'unavailable' | 'updating';
};
export const TRACKING_COOLDOWN_SECONDS = 1801;
const PROVIDER_URL = 'https://poll.kuaidi100.com/poll/query.do';
const states: Record<string, string> = {
  '0': '运输中',
  '1': '已揽收',
  '2': '物流异常',
  '3': '已签收',
  '4': '已退签',
  '5': '派送中',
  '6': '退回中',
  '7': '转投中',
  '8': '清关中',
  '10': '待清关',
  '11': '清关中',
  '12': '已清关',
  '13': '清关异常',
  '14': '拒签',
};
const unknown: Payload = { state: 'unknown', state_label: '等待物流更新', events: [] };
const iso = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toISOString() : null);

export function validTrackingNumber(carrier: Carrier, number: string) {
  return carrier.code === 'shunfeng'
    ? /^SF[A-Z0-9]{8,22}$/.test(number)
    : /^[A-Z0-9]{6,32}$/.test(number);
}
function eventTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!m || m[1] < '2000-01-01' || m[1] > '2100-12-31') return null;
  const parsed = new Date(`${m[1]}T${m[2]}+08:00`);
  if (!Number.isFinite(parsed.getTime())) return null;
  // Reject normalized invalid dates (e.g. February 30).
  if (new Date(parsed.getTime() + 8 * 3600000).toISOString().slice(0, 19) !== `${m[1]}T${m[2]}`)
    return null;
  return parsed.toISOString();
}
function cleanDescription(value: string, shipment: TrackingShipment) {
  let text = value
    .slice(0, 2000)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ');
  for (const privateText of [
    shipment.phone,
    shipment.recipient,
    shipment.address,
    shipment.sender,
  ]) {
    if (privateText?.trim()) text = text.replaceAll(privateText.trim(), '〔已隐藏〕');
  }
  return text
    .replace(/https?:\/\/[^\s，。；）)]+/gi, '〔链接已隐藏〕')
    .replace(/(?:\+?86[ -]?)?1[3-9]\d[\d *-]{6,}\d/g, '〔电话已隐藏〕')
    .replace(/(?:0\d{2,3}[ -]?)?\d{7,8}(?:-\d{1,6})?/g, '〔号码已隐藏〕')
    .replace(
      /((?:签收人|收件人|派件员|快递员|业务员)(?:为|是|姓名)?[：:\s]*)[^，。；;、\s【】（）()]+/g,
      '$1〔已隐藏〕',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}
async function boundedJson(response: Response): Promise<any> {
  if (!response.ok || !response.body) throw Error('provider-unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 262144) throw Error('provider-response-too-large');
      chunks.push(next.value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(all));
}
async function providerQuery(
  env: Env,
  carrier: Carrier,
  number: string,
  shipment: TrackingShipment,
): Promise<Payload | null> {
  const needsPhone = carrier.code === 'shunfeng' || carrier.code === 'zhongtong';
  if (needsPhone && !/^1[3-9]\d{9}$/.test(shipment.phone)) throw Error('invalid-phone');
  const param = JSON.stringify({
    com: carrier.code,
    num: number,
    ...(needsPhone ? { phone: shipment.phone } : {}),
    show: '0',
    order: 'desc',
    lang: 'zh',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const sign = (await digest(param + env.KUAIDI100_KEY! + env.KUAIDI100_CUSTOMER!)).toUpperCase();
    const response = await fetch(PROVIDER_URL, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        customer: env.KUAIDI100_CUSTOMER!,
        sign,
        signType: 'SHA256',
        param,
      }),
    });
    const body = await boundedJson(response);
    // Do not return raw provider messages, telephone/contact fields or error bodies.
    if (String(body.returnCode) === '500' && !body.data) return null;
    if (
      String(body.status) !== '200' ||
      body.result === false ||
      body.com !== carrier.code ||
      typeof body.nu !== 'string' ||
      body.nu.trim().toUpperCase() !== number ||
      !Array.isArray(body.data)
    )
      throw Error('invalid-provider-result');
    const events: Payload['events'] = [];
    const seen = new Set<string>();
    for (const raw of body.data.slice(0, 100)) {
      if (!raw || typeof raw.context !== 'string') continue;
      const time = eventTime(raw.ftime || raw.time),
        description = cleanDescription(raw.context, shipment);
      if (!time || !description || seen.has(time + description)) continue;
      seen.add(time + description);
      events.push({ time, description });
    }
    events.sort((a, b) => b.time.localeCompare(a.time));
    if (!events.length) return null;
    const state = String(body.state);
    return {
      state: states[state] ? state : 'unknown',
      state_label: states[state] || '物流已更新',
      events,
    };
  } finally {
    clearTimeout(timer);
  }
}
function cachedPayload(row: CacheRow): Payload | null {
  if (!row.snapshot_json) return null;
  try {
    const value = JSON.parse(row.snapshot_json);
    if (
      typeof value.state !== 'string' ||
      typeof value.state_label !== 'string' ||
      !Array.isArray(value.events)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export async function shipmentTracking(
  env: Env,
  shipment: TrackingShipment,
): Promise<TrackingSnapshot> {
  const carrier = resolveCarrier(shipment.carrier),
    number = shipment.tracking_no?.trim().toUpperCase() || null;
  const base: TrackingSnapshot = {
    shipment_id: shipment.id,
    carrier: carrier?.name || shipment.carrier,
    tracking_no: number,
    shipped_at: shipment.shipped_at,
    availability: 'not_shipped',
    ...unknown,
    fetched_at: null,
    next_refresh_at: null,
    stale: false,
    message: '尚未发货，发货后可查看物流',
    query_url: carrier?.query_url || null,
    query_label: carrier ? carrierQueryLabel(carrier) : '前往查询网站',
  };
  if (shipment.status !== 'shipped' || !number) {
    if (shipment.status === 'cancelled') base.message = '本次预约已取消';
    return base;
  }
  if (!carrier || !validTrackingNumber(carrier, number))
    return {
      ...base,
      availability: 'unsupported',
      message: '当前快递或单号暂不支持站内查询，请联系商家核对或前往查询网站',
    };
  // Opt-in is deliberately separate from credentials, so saving a key cannot start sending data.
  if (env.TRACKING_ENABLED !== 'true' || !env.KUAIDI100_CUSTOMER || !env.KUAIDI100_KEY)
    return {
      ...base,
      availability: 'not_configured',
      message: '物流轨迹暂不可查，可复制单号前往查询网站',
    };

  const now = Math.floor(Date.now() / 1000);
  const fingerprint = await digest(
    JSON.stringify([
      'kuaidi100-v1',
      shipment.id,
      carrier.code,
      number,
      ['shunfeng', 'zhongtong'].includes(carrier.code) ? shipment.phone : '',
    ]),
  );
  await env.DB.prepare(
    'INSERT INTO shipment_tracking_cache(cache_key) VALUES(?) ON CONFLICT DO NOTHING',
  )
    .bind(fingerprint)
    .run();
  // Persist the full cooldown BEFORE calling the provider; timeouts/crashes also consume it.
  const lease = crypto.randomUUID();
  const acquired = await env.DB.prepare(
    "UPDATE shipment_tracking_cache SET lease_token=?,lease_until=?,next_refresh_at=?,last_result='updating' WHERE cache_key=? AND lease_until<=? AND next_refresh_at<=? RETURNING cache_key",
  )
    .bind(lease, now + 20, now + TRACKING_COOLDOWN_SECONDS, fingerprint, now, now)
    .first();
  if (acquired) {
    const waybillKey = await digest(JSON.stringify(['kuaidi100-v1', carrier.code, number]));
    await env.DB.prepare(
      'INSERT INTO shipment_tracking_queries(waybill_key) VALUES(?) ON CONFLICT DO NOTHING',
    )
      .bind(waybillKey)
      .run();
    const providerLease = await env.DB.prepare(
      'UPDATE shipment_tracking_queries SET lease_token=?,lease_until=?,next_refresh_at=? WHERE waybill_key=? AND lease_until<=? AND next_refresh_at<=? RETURNING waybill_key',
    )
      .bind(lease, now + 20, now + TRACKING_COOLDOWN_SECONDS, waybillKey, now, now)
      .first();
    if (!providerLease) {
      const shared = await env.DB.prepare(
        'SELECT next_refresh_at FROM shipment_tracking_queries WHERE waybill_key=?',
      )
        .bind(waybillKey)
        .first<{ next_refresh_at: number }>();
      // Keep recipient-specific snapshots isolated, but never query a shared waybill twice.
      await env.DB.prepare(
        "UPDATE shipment_tracking_cache SET next_refresh_at=?,last_result='pending',lease_token=NULL,lease_until=0 WHERE cache_key=? AND lease_token=?",
      )
        .bind(shared?.next_refresh_at || now + TRACKING_COOLDOWN_SECONDS, fingerprint, lease)
        .run();
    } else {
      try {
        const payload = await providerQuery(env, carrier, number, shipment);
        if (payload) {
          await env.DB.prepare(
            "UPDATE shipment_tracking_cache SET snapshot_json=?,fetched_at=?,last_result='available',lease_token=NULL,lease_until=0 WHERE cache_key=? AND lease_token=?",
          )
            .bind(JSON.stringify(payload), now, fingerprint, lease)
            .run();
        } else {
          await env.DB.prepare(
            "UPDATE shipment_tracking_cache SET last_result='pending',lease_token=NULL,lease_until=0 WHERE cache_key=? AND lease_token=?",
          )
            .bind(fingerprint, lease)
            .run();
        }
      } catch {
        await env.DB.prepare(
          "UPDATE shipment_tracking_cache SET last_result='unavailable',lease_token=NULL,lease_until=0 WHERE cache_key=? AND lease_token=?",
        )
          .bind(fingerprint, lease)
          .run();
      } finally {
        await env.DB.prepare(
          'UPDATE shipment_tracking_queries SET lease_token=NULL,lease_until=0 WHERE waybill_key=? AND lease_token=?',
        )
          .bind(waybillKey, lease)
          .run();
      }
    }
  }
  const row = await env.DB.prepare(
    'SELECT snapshot_json,fetched_at,next_refresh_at,lease_token,lease_until,last_result FROM shipment_tracking_cache WHERE cache_key=?',
  )
    .bind(fingerprint)
    .first<CacheRow>();
  if (!row) return { ...base, availability: 'unavailable', message: '物流暂不可查，请稍后重试' };
  const payload = cachedPayload(row),
    updating = row.lease_until > now && !!row.lease_token;
  const availability = updating
    ? 'updating'
    : row.last_result === 'available' && payload
      ? 'available'
      : row.last_result === 'pending'
        ? 'pending'
        : 'unavailable';
  const messages = {
    available: '',
    updating: '物流正在更新，请稍后查看',
    pending: '物流轨迹暂未更新，请稍后查看',
    unavailable: '物流暂不可查，请稍后重试或前往查询网站',
  };
  return {
    ...base,
    ...(payload || unknown),
    availability,
    fetched_at: iso(row.fetched_at),
    // While another request is running, permit a short manual cache re-read.
    // The provider's persisted 30-minute cooldown remains unchanged.
    next_refresh_at: iso(updating ? row.lease_until : row.next_refresh_at),
    stale: !!payload && availability !== 'available',
    message: messages[availability],
  };
}
