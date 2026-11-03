import type Stripe from 'stripe';
import { stripe } from './payments';
import { assert, HttpError } from './security';

type SessionRow = {
  order_id: string;
  params: string;
  state: string;
  created_at: string;
  attempts: number;
};
const options = { timeout: 12000, maxNetworkRetries: 0 };
export async function expireConfirmedSession(env: Env, orderId: string) {
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status='expired' WHERE id=? AND status='pending'").bind(
      orderId,
    ),
    env.DB.prepare(
      "UPDATE shipments SET status='cancelled' WHERE id=(SELECT shipment_id FROM orders WHERE id=? AND status='expired') AND status='awaiting_payment'",
    ).bind(orderId),
    env.DB.prepare(
      "UPDATE payment_sessions SET state='failed',lease_token=NULL,lease_until=0,updated_at=CURRENT_TIMESTAMP WHERE order_id=?",
    ).bind(orderId),
  ]);
}
async function linkSession(env: Env, row: SessionRow, s: Stripe.Checkout.Session, live: boolean) {
  const params = JSON.parse(row.params) as Stripe.Checkout.SessionCreateParams;
  assert(s.livemode === live && s.id, 502, '支付收银台环境不匹配');
  // Never release stock on an unconfirmed or merely locally timed-out result.
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE orders SET stripe_session_id=? WHERE id=? AND (stripe_session_id IS NULL OR stripe_session_id=?)',
    ).bind(s.id, row.order_id, s.id),
    env.DB.prepare(
      "UPDATE payment_sessions SET state='linked',lease_token=NULL,lease_until=0,updated_at=CURRENT_TIMESTAMP WHERE order_id=?",
    ).bind(row.order_id),
  ]);
  if (s.status === 'expired') {
    await expireConfirmedSession(env, row.order_id);
    throw new HttpError(409, '支付已结束，请再次提交新的订单', 'checkout_closed');
  }
  assert(s.url || s.payment_status === 'paid', 502, '支付收银台暂不可用');
  return {
    url:
      s.payment_status === 'paid'
        ? String(params.success_url).replace('{CHECKOUT_SESSION_ID}', s.id)
        : s.url!,
  };
}
export async function sessionForOrder(
  env: Env,
  orderId: string,
  params?: Stripe.Checkout.SessionCreateParams,
) {
  if (params)
    await env.DB.prepare('INSERT OR IGNORE INTO payment_sessions(order_id,params) VALUES(?,?)')
      .bind(orderId, JSON.stringify(params))
      .run();
  const row = await env.DB.prepare('SELECT * FROM payment_sessions WHERE order_id=?')
    .bind(orderId)
    .first<SessionRow>();
  assert(row, 503, '付款准备信息尚未恢复，请稍后重试');
  const order = await env.DB.prepare('SELECT status,stripe_session_id FROM orders WHERE id=?')
    .bind(orderId)
    .first<{ status: string; stripe_session_id: string | null }>();
  if (!order || ['expired', 'refunded'].includes(order.status))
    throw new HttpError(409, '订单已结束，请重新下单', 'checkout_closed');
  const client = stripe(env),
    live = env.STRIPE_MODE === 'live';
  if (order.stripe_session_id)
    return linkSession(
      env,
      row,
      await client.checkout.sessions.retrieve(order.stripe_session_id, {}, options),
      live,
    );
  const age = Date.now() - Date.parse(row.created_at.replace(' ', 'T') + 'Z');
  assert(age >= 0 && age < 23 * 3600000, 409, '付款准备结果仍待核对，请联系运营，勿重复付款');
  const now = Math.floor(Date.now() / 1000),
    lease = crypto.randomUUID();
  const lock = await env.DB.prepare(
    "UPDATE payment_sessions SET state='submitting',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND state IN ('ready','unknown','submitting') AND lease_until<=? AND EXISTS(SELECT 1 FROM orders o WHERE o.id=payment_sessions.order_id AND o.status='pending') RETURNING order_id",
  )
    .bind(lease, now + 30, orderId, now)
    .first();
  assert(lock, 409, '正在确认原收银台，请稍后重试同一订单');
  let received = false;
  try {
    const s = await client.checkout.sessions.create(JSON.parse(row.params), {
      ...options,
      idempotencyKey: 'checkout-' + orderId,
    });
    received = true;
    return await linkSession(env, row, s, live);
  } catch (e) {
    // An API response followed by a failed D1 write is still an unknown operation.
    const status = (e as { statusCode?: number }).statusCode;
    console.error(
      JSON.stringify({
        event: 'checkout_preparation_failed',
        order_id: orderId,
        received,
        status: status || null,
        kind: e instanceof Error ? e.name : 'unknown',
      }),
    );
    const definitive =
      !received &&
      row.attempts === 0 &&
      !!status &&
      [400, 401, 402, 403, 404, 422].includes(status);
    if (definitive) await expireConfirmedSession(env, orderId);
    else
      await env.DB.prepare(
        "UPDATE payment_sessions SET state='unknown',lease_token=NULL,lease_until=0,next_attempt_at=?,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND state!='failed'",
      )
        .bind(now + 300, orderId)
        .run()
        .catch(() => {});
    if (definitive)
      throw new HttpError(502, '付款准备失败，原订单已关闭，请再次提交', 'checkout_closed');
    if (e instanceof HttpError && e.status === 409) throw e;
    throw new HttpError(503, '付款准备结果待确认，请保留当前页面并重试，系统会恢复原订单');
  }
}
export async function reconcileCheckoutSessions(env: Env) {
  if (!env.STRIPE_SECRET_KEY) return;
  const now = Math.floor(Date.now() / 1000);
  const rows = await env.DB.prepare(
    "SELECT p.order_id,p.created_at FROM payment_sessions p JOIN orders o ON o.id=p.order_id WHERE o.status='pending' AND p.state IN ('unknown','submitting') AND p.lease_until<=? AND p.next_attempt_at<=? ORDER BY p.created_at LIMIT 5",
  )
    .bind(now, now)
    .all<{ order_id: string; created_at: string }>();
  for (const row of rows.results) {
    if (Date.now() - Date.parse(row.created_at.replace(' ', 'T') + 'Z') >= 23 * 3600000) {
      await env.DB.prepare('INSERT OR IGNORE INTO operation_notifications(id,payload) VALUES(?,?)')
        .bind(
          'checkout-unresolved-' + row.order_id,
          JSON.stringify({
            message:
              '有一笔付款准备超过安全重试时限，库存保持占用，请到后台核对。订单参考：' +
              row.order_id,
          }),
        )
        .run();
      await env.DB.prepare('UPDATE payment_sessions SET next_attempt_at=? WHERE order_id=?')
        .bind(now + 86400, row.order_id)
        .run();
      continue;
    }
    try {
      await sessionForOrder(env, row.order_id);
    } catch {
      /* persisted unknown state; next attempt respects backoff */
    }
  }
  // A delayed webhook is reconciled against the original Session. Local time
  // and failed reads never release stock or coupons.
  const linked = await env.DB.prepare(
    "SELECT p.order_id FROM payment_sessions p JOIN orders o ON o.id=p.order_id WHERE o.status='pending' AND o.expires_at<=CURRENT_TIMESTAMP AND p.state='linked' AND p.next_attempt_at<=? ORDER BY o.expires_at LIMIT 5",
  )
    .bind(now)
    .all<{ order_id: string }>();
  for (const row of linked.results) {
    await env.DB.prepare('UPDATE payment_sessions SET next_attempt_at=? WHERE order_id=?')
      .bind(now + 1800, row.order_id)
      .run();
    try {
      await sessionForOrder(env, row.order_id);
    } catch {
      /* wait for confirmed expiry */
    }
  }
}
