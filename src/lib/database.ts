import site from '../../config/site.json';
import { REMOTE_PROVINCES, SEASON_END } from './shared';
import { reconcileCheckoutSessions } from './checkout-sessions';
// Include paid tree count independently of bookings; never reuse older snapshots.
export const MAP_CACHE_KEY = 'map:city:v5';
type MapCity = {
  city_code: string;
  province_code: string;
  region_label: string;
  boxes: number;
  adopted: number;
  sponsored: number;
  gifted: number;
};
type MapRecent = { region_label: string; qty: number; source: string };
type MapSnapshot = {
  cities: MapCity[];
  recent: MapRecent[];
  adoption_trees: number;
  updated_at: string;
};
const cityLabel = (label: string) =>
  label
    .split(/\s*\/\s*/)
    .slice(0, 2)
    .join(' / ');
export function publicMap(snapshot: MapSnapshot): MapSnapshot {
  // Explicit fields protect the public response even if internal queries gain more columns.
  return {
    cities: snapshot.cities.map((c) => ({
      city_code: c.city_code,
      province_code: c.province_code,
      region_label: cityLabel(c.region_label),
      boxes: c.boxes,
      adopted: c.adopted,
      sponsored: c.sponsored,
      gifted: Number(c.gifted || 0),
    })),
    recent: snapshot.recent.map((r) => ({
      region_label: cityLabel(r.region_label),
      qty: r.qty,
      source: r.source,
    })),
    adoption_trees: snapshot.adoption_trees,
    updated_at: snapshot.updated_at,
  };
}
export async function settings(env: Env) {
  const rows = await env.DB.prepare('SELECT key,value FROM settings').all<{
    key: string;
    value: string;
  }>();
  const values = Object.fromEntries(rows.results.map((r) => [r.key, JSON.parse(r.value)]));
  return {
    remote_provinces: values.remote_provinces || REMOTE_PROVINCES,
    remote_fee: values.remote_fee ?? site.shipping.remoteFee,
  };
}
export async function rebuildMap(env: Env) {
  const eligibility = `status IN ('reserved','shipped') AND (source!='sponsor' OR status='shipped')
    AND NOT EXISTS(SELECT 1 FROM orders o WHERE source='retail' AND o.id=source_id AND o.status='refunded')
    AND NOT EXISTS(SELECT 1 FROM adoptions a JOIN orders o ON o.id=a.order_id
      WHERE source='adoption' AND CAST(a.id AS TEXT)=source_id AND o.status='refunded')`;
  const data = await env.DB.prepare(
    `WITH journeys AS (
      SELECT CASE WHEN province_code IN ('110000','120000','310000','500000') THEN province_code ELSE city_code END city_code,
        province_code,region_label,CASE WHEN source='retail' THEN qty ELSE 0 END boxes,
        CASE WHEN source='adoption' THEN qty ELSE 0 END adopted,
        CASE WHEN source='sponsor' THEN qty ELSE 0 END sponsored,0 gifted
      FROM shipments WHERE ${eligibility}
      UNION ALL
      SELECT g.city_code,g.province_code,p.name||' / '||c.name,0,0,0,g.qty
      FROM gift_deliveries g JOIN gift_batches b ON b.id=g.batch_id AND b.status='active'
      JOIN regions p ON p.adcode=g.province_code JOIN regions c ON c.adcode=g.city_code
    ) SELECT city_code,province_code,MIN(region_label) region_label,SUM(boxes) boxes,
      SUM(adopted) adopted,SUM(sponsored) sponsored,SUM(gifted) gifted
      FROM journeys GROUP BY city_code,province_code`,
  ).all<MapCity>();
  const recent = await env.DB.prepare(
    `SELECT region_label,qty,source FROM shipments WHERE ${eligibility} ORDER BY created_at DESC LIMIT 6`,
  ).all<MapRecent>();
  const adoption = await env.DB.prepare(
    "SELECT COUNT(*) trees FROM adoptions a JOIN orders o ON a.order_id=o.id WHERE o.status IN ('paid','shipped')",
  ).first<{ trees: number }>();
  const result = publicMap({
    cities: data.results,
    recent: recent.results,
    adoption_trees: Number(adoption?.trees || 0),
    updated_at: new Date().toISOString(),
  });
  await env.CACHE.put(MAP_CACHE_KEY, JSON.stringify(result));
  return result;
}
export async function notify(env: Env, id: string, message: string) {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO operation_notifications(id,payload) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM notifications WHERE id=?)',
    ).bind(id, JSON.stringify({ message }), id),
    env.DB.prepare('INSERT OR IGNORE INTO notifications(id,message) VALUES(?,?)').bind(id, message),
  ]);
}
export async function maintenance(env: Env, now = new Date()) {
  await env.DB.prepare(
    "UPDATE orders SET status='expired' WHERE status='pending' AND stripe_session_id IS NULL AND expires_at<datetime('now') AND NOT EXISTS(SELECT 1 FROM payment_sessions p WHERE p.order_id=orders.id AND p.state IN ('submitting','unknown','linked'))",
  ).run();
  await reconcileCheckoutSessions(env);
  const shipments = await env.DB.prepare(
    "SELECT shipment_id FROM orders WHERE status='expired' AND type='shipping' AND shipment_id IS NOT NULL",
  ).all<{ shipment_id: string }>();
  for (const s of shipments.results)
    await env.DB.prepare(
      "UPDATE shipments SET status='cancelled' WHERE id=? AND status='awaiting_payment'",
    )
      .bind(s.shipment_id)
      .run();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<datetime('now')"),
    env.DB.prepare("DELETE FROM order_tokens WHERE expires_at<datetime('now')"),
    env.DB.prepare('DELETE FROM rate_limits WHERE bucket<?').bind(
      Math.floor(Date.now() / 600000) - 144,
    ),
  ]);
  const date = new Date(now.getTime() + 28800000).toISOString().slice(0, 10);
  const days = Math.ceil(
    (Date.parse(SEASON_END + 'T00:00:00+08:00') + 86400000 - now.getTime()) / 86400000,
  );
  if ([7, 3, 1].includes(days)) {
    const rows = await env.DB.prepare(
      "SELECT a.*,o.phone FROM adoptions a JOIN orders o ON a.order_id=o.id WHERE a.used_boxes<a.total_boxes AND o.status IN ('paid','shipped')",
    ).all<any>();
    for (const a of rows.results)
      await notify(
        env,
        `remind-${a.id}-${days}`,
        `预约提醒：${a.adopt_code} 距截止 ${days} 天，剩余 ${a.total_boxes - a.used_boxes} 箱，请人工联系认领人。`,
      );
  }
  if (date > SEASON_END) {
    const c = await settings(env);
    const remaining = await env.DB.prepare(
      "SELECT a.* FROM adoptions a JOIN orders o ON a.order_id=o.id WHERE a.used_boxes<a.total_boxes AND o.status IN ('paid','shipped')",
    ).all<any>();
    for (const a of remaining.results) {
      const previous = await env.DB.prepare(
        "SELECT * FROM shipments WHERE source='adoption' AND source_id=? AND status IN ('reserved','shipped') ORDER BY created_at DESC LIMIT 1",
      )
        .bind(String(a.id))
        .first<any>();
      if (!previous) {
        await notify(
          env,
          'no-address-' + a.id,
          `预约已到期：${a.adopt_code} 尚余 ${a.total_boxes - a.used_boxes} 箱，无历史地址，请电话确认。`,
        );
        continue;
      }
      if (c.remote_provinces.includes(previous.province_code)) {
        await notify(
          env,
          'remote-default-' + a.id,
          `预约已到期：${a.adopt_code} 尚余 ${a.total_boxes - a.used_boxes} 箱，最近地址为偏远地区，请联系确认补差运费后安排发货。`,
        );
        continue;
      }
      try {
        const sid = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO shipments(id,source,source_id,product_id,qty,recipient,phone,province_code,city_code,district_code,region_label,address,card_message,expected_date,status) VALUES(?,'adoption',?,?,?,?,?,?,?,?,?,?,'',?,'reserved')",
        )
          .bind(
            sid,
            String(a.id),
            a.tier === 888 ? 'PA' : 'FG',
            a.total_boxes - a.used_boxes,
            previous.recipient,
            previous.phone,
            previous.province_code,
            previous.city_code,
            previous.district_code,
            previous.region_label,
            previous.address,
            date,
          )
          .run();
        await notify(
          env,
          'default-shipment-' + a.id,
          `到期自动发货单：${a.adopt_code} 剩余箱数已安排至最近地址，请运营核对并发货。`,
        );
      } catch (e) {
        if (!(e instanceof Error && /CHECK constraint/.test(e.message))) throw e;
      }
    }
  }
  await rebuildMap(env);
  // Legacy webhooks remain disabled; fresh operations use the Telegram outbox.
}
