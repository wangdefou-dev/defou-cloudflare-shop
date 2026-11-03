import site from '../../config/site.json';
const PAYMENT_PROJECT = site.paymentProject;
import { sessionForOrder, expireConfirmedSession } from './checkout-sessions';
import Stripe from 'stripe';
import { HttpError, isDemo, assert, boundedBody } from './security';
import { rebuildMap } from './database';
import { couponLabel } from './coupon-format';
import { money } from './shared';
import { paymentEnvironment, type PaymentMethodChoice } from './payment-experience';
const INTEGRATION_IDENTIFIER = site.paymentProject + '-opnqfrst';
const API_VERSION = '2026-09-30.endive';
export function assertPaymentBrowser(request: Request) {
  assert(
    !paymentEnvironment(request.headers.get('user-agent') || '').wechat,
    409,
    '请点击微信右上角「···」，在浏览器打开后付款',
  );
}
function expectsLive(env: Env) {
  const mode = env.STRIPE_MODE || 'sandbox';
  assert(['sandbox', 'live'].includes(mode), 503, '支付环境配置无效');
  return mode === 'live';
}
export function stripe(env: Env) {
  assert(env.STRIPE_SECRET_KEY, 503, '在线支付暂未开放');
  const prefix = expectsLive(env) ? /^(rk|sk)_live_/ : /^(rk|sk)_test_/;
  assert(prefix.test(env.STRIPE_SECRET_KEY), 503, '支付密钥与环境不匹配');
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
}
export function checkoutPaymentOptions(request: Request, choice: PaymentMethodChoice = 'auto') {
  const mobile = paymentEnvironment(
    request.headers.get('user-agent') || '',
    request.headers.get('sec-ch-ua-mobile') || '',
  ).mobile;
  // CNY methods still come from this project's Dashboard configuration. Filter
  // each Session, rather than changing the merchant's other integrations.
  const excluded: Stripe.Checkout.SessionCreateParams.ExcludedPaymentMethodType[] | undefined =
    choice === 'alipay'
      ? ['card', 'wechat_pay']
      : choice === 'card'
        ? ['alipay', 'wechat_pay']
        : mobile
          ? ['wechat_pay']
          : undefined;
  return {
    locale: 'zh' as const,
    ...(excluded ? { excluded_payment_method_types: excluded } : {}),
    ...(!excluded?.includes('wechat_pay')
      ? { payment_method_options: { wechat_pay: { client: 'web' as const } } }
      : {}),
  };
}
export async function createSession(
  env: Env,
  request: Request,
  order: any,
  label: string,
  choice: PaymentMethodChoice = 'auto',
) {
  if (isDemo(env, request)) return { url: '/pay/result?order=' + order.order_no };
  const stored = await env.DB.prepare('SELECT expires_at FROM orders WHERE id=?')
    .bind(order.id)
    .first<{ expires_at: string }>();
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    integration_identifier: INTEGRATION_IDENTIFIER,
    payment_method_configuration: env.STRIPE_PAYMENT_METHOD_CONFIGURATION || undefined,
    ...checkoutPaymentOptions(request, choice),
    // Keep the PRD's CNY total; eligible methods come from the Stripe Dashboard.
    adaptive_pricing: { enabled: false },
    line_items: [
      {
        price_data: {
          currency: 'cny',
          product_data: {
            name: label,
            ...(order.discount_amount > 0
              ? {
                  description: `商品及运费原额 ¥${money(order.original_amount)}；${couponLabel(order.coupon_percent_off)}券仅优惠1箱 −¥${money(order.discount_amount)}；实付 ¥${money(order.amount)}`,
                }
              : {}),
          },
          unit_amount: order.amount,
        },
        quantity: 1,
      },
    ],
    metadata: { project: PAYMENT_PROJECT, order_id: order.id, type: order.type },
    payment_intent_data: {
      metadata: { project: PAYMENT_PROJECT, order_id: order.id, type: order.type },
    },
    client_reference_id: order.id,
    expires_at: Math.max(
      stored ? Math.floor(Date.parse(stored.expires_at.replace(' ', 'T') + 'Z') / 1000) : 0,
      Math.floor(Date.now() / 1000) + 1800,
    ),
    success_url: env.APP_ORIGIN + '/pay/result?order=' + order.order_no,
    cancel_url: env.APP_ORIGIN + '/pay/result?order=' + order.order_no + '&cancelled=1',
  };
  return sessionForOrder(env, order.id, params);
}
export function shipmentStatement(
  env: Env,
  id: string,
  source: string,
  sourceId: string,
  productId: string,
  qty: number,
  a: any,
  date: string | null = null,
  status = 'reserved',
  paidOrderId: string | null = null,
) {
  return env.DB.prepare(
    "INSERT OR IGNORE INTO shipments(id,source,source_id,product_id,qty,recipient,phone,province_code,city_code,district_code,region_label,address,card_message,sender,expected_date,status) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM orders WHERE id=? AND status IN ('paid','shipped'))",
  ).bind(
    id,
    source,
    sourceId,
    productId,
    qty,
    a.recipient,
    a.phone,
    a.province_code,
    a.city_code,
    a.district_code,
    [a.province, a.city, a.district].join(' / '),
    a.address,
    a.card_message || '',
    a.sender || '',
    date,
    status,
    paidOrderId,
    paidOrderId,
  );
}
export async function markPaid(env: Env, order: any, eventId: string, pi: string | null) {
  const statements = [
    env.DB.prepare('INSERT OR IGNORE INTO webhook_events(id,type) VALUES(?,?)').bind(
      eventId,
      'payment',
    ),
    env.DB.prepare(
      "UPDATE orders SET status='paid',paid_at=CURRENT_TIMESTAMP,stripe_payment_intent=COALESCE(?,stripe_payment_intent) WHERE id=? AND status='pending'",
    ).bind(pi, order.id),
  ];
  if (order.type === 'retail') {
    const i = await env.DB.prepare('SELECT * FROM order_items WHERE order_id=?')
      .bind(order.id)
      .first<any>();
    statements.push(
      shipmentStatement(
        env,
        'retail-' + order.id,
        'retail',
        order.id,
        i.product_id,
        i.qty,
        JSON.parse(order.address_json),
        null,
        'reserved',
        order.id,
      ),
    );
  }
  if (order.type === 'shipping')
    statements.push(
      env.DB.prepare(
        "UPDATE shipments SET status='reserved' WHERE id=? AND status='awaiting_payment' AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status IN ('paid','shipped'))",
      ).bind(order.shipment_id, order.id),
    );
  statements.push(
    env.DB.prepare(
      "UPDATE payment_sessions SET state='linked',lease_token=NULL,lease_until=0 WHERE order_id=?",
    ).bind(order.id),
  );
  await env.DB.batch(statements);
  // The paid_order_notification D1 trigger queues the alert in this same transaction.
  await rebuildMap(env);
}
export async function finalizeRefundedOrder(env: Env, o: any) {
  const q = [
    env.DB.prepare(
      "UPDATE orders SET status='refunded' WHERE id=? AND status IN ('paid','shipped')",
    ).bind(o.id),
  ];
  if (o.type === 'retail')
    q.push(
      env.DB.prepare(
        "UPDATE shipments SET status='cancelled' WHERE source='retail' AND source_id=? AND status!='shipped'",
      ).bind(o.id),
    );
  if (o.type === 'adoption') {
    const a = await env.DB.prepare('SELECT id FROM adoptions WHERE order_id=?')
      .bind(o.id)
      .first<{ id: number }>();
    if (a) {
      q.push(
        env.DB.prepare(
          "UPDATE shipments SET status='cancelled' WHERE source='adoption' AND source_id=? AND status!='shipped'",
        ).bind(String(a.id)),
      );
      q.push(env.DB.prepare('DELETE FROM sessions WHERE adoption_id=?').bind(a.id));
    }
  }
  if (o.type === 'shipping')
    q.push(
      env.DB.prepare(
        "UPDATE shipments SET status='cancelled' WHERE id=? AND status!='shipped'",
      ).bind(o.shipment_id),
    );
  // Update the order first: existing stock guards must still see shipped parcels.
  await env.DB.batch(q);
  await rebuildMap(env);
}
async function restoreSessionLink(env: Env, order: any, s: Stripe.Checkout.Session) {
  if (order.stripe_session_id) return;
  const attempt = await env.DB.prepare('SELECT params FROM payment_sessions WHERE order_id=?')
    .bind(order.id)
    .first<{ params: string }>();
  assert(
    attempt &&
      s.client_reference_id === order.id &&
      s.metadata?.type === order.type &&
      s.currency === 'cny' &&
      s.amount_total === order.amount,
    400,
    '支付金额或订单不匹配',
  );
  const expected = JSON.parse(attempt.params);
  assert(
    expected.client_reference_id === order.id &&
      expected.line_items?.[0]?.price_data?.unit_amount === order.amount,
    400,
    '付款准备信息不匹配',
  );
  await env.DB.prepare(
    "UPDATE orders SET stripe_session_id=? WHERE id=? AND stripe_session_id IS NULL AND status='pending'",
  )
    .bind(s.id, order.id)
    .run();
  order.stripe_session_id = s.id;
}
export async function webhook(env: Env, request: Request) {
  assert(env.STRIPE_WEBHOOK_SECRET, 503, 'Webhook 尚未配置');
  let event: Stripe.Event;
  try {
    event = await stripe(env).webhooks.constructEventAsync(
      new TextDecoder().decode(await boundedBody(request, 262144)),
      request.headers.get('stripe-signature') || '',
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    throw new HttpError(400, '签名校验失败');
  }
  assert(event.livemode === expectsLive(env), 400, '支付回调环境不匹配');
  // The merchant account also serves other websites. Acknowledge their events
  // without creating orders, changing stock, or causing repeated deliveries.
  const object = event.data.object as { metadata?: Record<string, string> | null };
  if (
    (event.type.startsWith('checkout.session.') && object.metadata?.project !== PAYMENT_PROJECT) ||
    (event.type === 'charge.refunded' &&
      object.metadata?.project &&
      object.metadata.project !== PAYMENT_PROJECT)
  )
    return { received: true, ignored: true };
  if (await env.DB.prepare('SELECT id FROM webhook_events WHERE id=?').bind(event.id).first())
    return { received: true };
  if (
    ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)
  ) {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.payment_status === 'paid') {
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id=?')
        .bind(s.metadata?.order_id || '')
        .first<any>();
      assert(order, 400, '订单不存在');
      await restoreSessionLink(env, order, s);
      assert(
        s.currency === 'cny' && s.amount_total === order.amount && s.id === order.stripe_session_id,
        400,
        '支付金额或订单不匹配',
      );
      if (order.status === 'pending')
        await markPaid(env, order, event.id, String(s.payment_intent));
    }
  } else if (
    ['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type)
  ) {
    const s = event.data.object as Stripe.Checkout.Session;
    const o =
      (await env.DB.prepare('SELECT * FROM orders WHERE stripe_session_id=?')
        .bind(s.id)
        .first<any>()) ||
      (await env.DB.prepare('SELECT * FROM orders WHERE id=?')
        .bind(s.metadata?.order_id || '')
        .first<any>());
    if (o) {
      await restoreSessionLink(env, o, s);
      assert(o.stripe_session_id === s.id, 400, '支付订单不匹配');
      await expireConfirmedSession(env, o.id);
    }
  } else if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type)) {
    const { applyRefundWebhook } = await import('./refunds');
    await applyRefundWebhook(env, event.data.object as Stripe.Refund, event);
  } else if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    // Partial bad-fruit refunds do not cancel boxes or change the city totals.
    if (charge.refunded) {
      const o = await env.DB.prepare('SELECT * FROM orders WHERE stripe_payment_intent=?')
        .bind(String(charge.payment_intent))
        .first<any>();
      if (o) {
        const { confirmedFullRefund } = await import('./refunds');
        if (await confirmedFullRefund(env, charge, o)) await finalizeRefundedOrder(env, o);
      } else if (charge.metadata?.project === PAYMENT_PROJECT) {
        throw new HttpError(409, '付款订单尚未同步，请重试');
      } else return { received: true, ignored: true };
    }
  }
  await env.DB.prepare('INSERT OR IGNORE INTO webhook_events(id,type) VALUES(?,?)')
    .bind(event.id, event.type)
    .run();
  return { received: true };
}
