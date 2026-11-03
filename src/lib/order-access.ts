import { assert, isDemo, isSandbox, digest } from './security';
import { isSaleDay, SEASON_START, SEASON_END } from './shared';
export async function validateAddress(env: Env, a: any) {
  const r = await env.DB.prepare(
    'SELECT adcode,name,level,parent_adcode FROM regions WHERE adcode IN (?,?,?)',
  )
    .bind(a.province_code, a.city_code, a.district_code)
    .all<any>();
  const p = r.results.find((x) => x.adcode === a.province_code && x.level === 1),
    c = r.results.find((x) => x.adcode === a.city_code && x.level === 2),
    d = r.results.find((x) => x.adcode === a.district_code && x.level === 3);
  assert(
    p && c && d && c.parent_adcode === p.adcode && d.parent_adcode === c.adcode,
    400,
    '请选择有效的省、市、区',
  );
  a.province = p.name;
  a.city = c.name;
  a.district = d.name;
  return a;
}
export function openSales(env: Env, request: Request) {
  assert(
    isDemo(env, request) || isSandbox(env, request) || (env.SALES_OPEN === 'true' && isSaleDay()),
    409,
    `本季销售时间为 ${SEASON_START} 至 ${SEASON_END}`,
  );
  if (!isDemo(env, request))
    assert(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET, 503, '支付暂未开放');
}
export async function orderToken(env: Env, orderId: string) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare("INSERT INTO order_tokens VALUES(?,?,datetime('now','+1 day'))")
    .bind(await digest(token), orderId)
    .run();
  return token;
}
