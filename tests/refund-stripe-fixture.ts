// Existing commerce fixtures now supply the canonical GETs required for a
// signed full refund. No test request is allowed to reach Stripe's network.
export async function confirmedRefundFixture<T>(env: Env, intent: string, run: () => Promise<T>) {
  const o = await env.DB.prepare('SELECT id,amount FROM orders WHERE stripe_payment_intent=?')
    .bind(intent)
    .first<{ id: string; amount: number }>();
  if (!o) return run();
  const original = globalThis.fetch;
  const charge = {
    id: 'ch_' + o.id,
    object: 'charge',
    currency: 'cny',
    amount: o.amount,
    amount_captured: o.amount,
    amount_refunded: o.amount,
    paid: true,
    captured: true,
    refunded: true,
    disputed: false,
    payment_intent: intent,
    livemode: env.STRIPE_MODE === 'live',
  };
  const refund = {
    id: 're_' + o.id,
    object: 'refund',
    currency: 'cny',
    amount: o.amount,
    status: 'succeeded',
    payment_intent: intent,
    charge: charge.id,
    metadata: {},
  };
  globalThis.fetch = async (input: any, init?: any) => {
    const u = new URL(typeof input === 'string' ? input : input.url || String(input));
    if (u.origin !== 'https://api.stripe.com' || (init?.method || 'GET') !== 'GET')
      throw Error('Unexpected fixture network request');
    if (u.pathname === '/v1/payment_intents/' + intent)
      return Response.json({
        id: intent,
        object: 'payment_intent',
        currency: 'cny',
        amount: o.amount,
        amount_received: o.amount,
        status: 'succeeded',
        livemode: env.STRIPE_MODE === 'live',
        metadata: { project: 'orchard-shop', order_id: o.id },
        latest_charge: charge,
      });
    if (u.pathname === '/v1/refunds')
      return Response.json({ object: 'list', data: [refund], has_more: false });
    throw Error('Unexpected fixture Stripe GET');
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}
