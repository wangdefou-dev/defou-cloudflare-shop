import { SEASON_END } from '../src/lib/shared';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { LocalD1, address, retail, environment, call } from './local-d1';
import { finalizeRefundedOrder, markPaid } from '../src/lib/payments';
import { sessionForOrder, reconcileCheckoutSessions } from '../src/lib/checkout-sessions';
import { digest, boundedBody } from '../src/lib/security';
import { chinaDate } from '../src/lib/shared';
import { maintenance, notify } from '../src/lib/database';
import { flushCommerceNotifications } from '../src/lib/notifications';
import { journeyBoxes } from '../src/lib/map-stats';
import { checkoutRequest, finishCheckoutIntent } from '../src/components/checkout-client';

test('unknown Checkout creation keeps stock and a valid signed paid event can recover its missing local Session link', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB);
  Object.assign(env, {
    DEMO_MODE: 'false',
    SALES_OPEN: 'true',
    STRIPE_MODE: 'sandbox',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    TURNSTILE_SECRET_KEY: 'fixture',
  });
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let remote: any;
  globalThis.fetch = async (input, init) => {
    const r = new Request(input, init);
    if (r.url.includes('/turnstile/'))
      return Response.json({ success: true, hostname: 'localhost' });
    assert.equal(r.url, 'https://api.stripe.com/v1/checkout/sessions');
    const p = new URLSearchParams(await r.text());
    remote = {
      id: 'cs_test_recovered',
      object: 'checkout.session',
      livemode: false,
      status: 'open',
      url: 'https://checkout.stripe.com/fixture',
      payment_status: 'paid',
      currency: 'cny',
      amount_total: 10800,
      client_reference_id: p.get('client_reference_id'),
      metadata: { project: 'orchard-shop', type: 'retail', order_id: p.get('metadata[order_id]') },
      payment_intent: 'pi_fixture',
    };
    return Response.json({ ...remote, payment_status: 'unpaid' });
  };
  DB.failLinkWrites = 1;
  const failed = await call(env, '/checkout', {
    ...retail,
    turnstile: 'fixture',
    request_id: crypto.randomUUID(),
  });
  assert.equal(failed.status, 503);
  assert.equal((DB.db.prepare('SELECT status FROM orders').get() as any).status, 'pending');
  assert.equal(
    (DB.db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
    99,
  );
  await maintenance({ ...env, STRIPE_SECRET_KEY: undefined });
  assert.equal((DB.db.prepare('SELECT status FROM orders').get() as any).status, 'pending');
  const event = {
      id: 'evt_recover',
      object: 'event',
      type: 'checkout.session.completed',
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object: remote },
    },
    payload = JSON.stringify(event),
    time = String(event.created);
  const sig = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET!)
    .update(time + '.' + payload)
    .digest('hex');
  const { api } = await import('../src/lib/api');
  const result = await api(
    new Request(env.APP_ORIGIN + '/api/stripe/webhook', {
      method: 'POST',
      body: payload,
      headers: { 'stripe-signature': `t=${time},v1=${sig}` },
    }),
    env,
  );
  assert.equal(result.status, 200);
  assert.equal((DB.db.prepare('SELECT status FROM orders').get() as any).status, 'paid');
  assert.equal((DB.db.prepare('SELECT count(*) n FROM shipments').get() as any).n, 1);
});
test('a stable Checkout request retries one order, rejects altered intent and retains one stock allocation', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB),
    request_id = crypto.randomUUID();
  const first = await call(env, '/checkout', { ...retail, request_id }),
    retry = await call(env, '/checkout', { ...retail, turnstile: 'another-token', request_id });
  assert.equal(first.status, 200);
  assert.equal(retry.data.id, first.data.id);
  assert.equal((DB.db.prepare('SELECT count(*) n FROM orders').get() as any).n, 1);
  assert.equal(
    (DB.db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
    99,
  );
  assert.equal((await call(env, '/checkout', { ...retail, qty: 2, request_id })).status, 409);
});
test('a verified refund between authorization and booking blocks the insertion; old refunded orphan reservations cannot ship', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB),
    o = await call(env, '/checkout', {
      type: 'adoption',
      sku: 'FG',
      qty: 1,
      phone: address.phone,
      plate_name: '本地树牌',
      pin: '123456',
      invoice: { type: 'none' },
      agreed: true,
    });
  DB.db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(o.data.id);
  const a = DB.db.prepare('SELECT * FROM adoptions').get() as any;
  DB.db
    .prepare("INSERT INTO sessions VALUES(?,?,datetime('now','+1 hour'))")
    .run(await digest('local-cookie'), a.id);
  DB.beforeShipment = async () => {
    await finalizeRefundedOrder(
      env,
      DB.db.prepare('SELECT * FROM orders WHERE id=?').get(o.data.id),
    );
  };
  const book = await call(
    env,
    '/tree/book',
    { qty: 1, address, expected_date: chinaDate(2) },
    'tree_session=local-cookie',
  );
  assert.equal(book.status, 409);
  assert.equal((DB.db.prepare('SELECT count(*) n FROM shipments').get() as any).n, 0);
  // Model a legacy pre-fix record, without bypassing the new insertion guard.
  DB.db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(o.data.id);
  DB.beforeShipment = undefined;
  DB.db
    .prepare(
      "INSERT INTO shipments(id,source,source_id,product_id,qty,recipient,phone,province_code,city_code,district_code,region_label,address) VALUES('old','adoption',?,'FG',1,'本地',?,'110000','110100','110101','北京','虚构地址')",
    )
    .run(String(a.id), address.phone);
  DB.db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(o.data.id);
  assert.equal(
    (
      await call(env, '/admin/ship', {
        id: 'old',
        carrier: 'shunfeng',
        tracking_no: 'SF1234567890123',
      })
    ).status,
    409,
  );
});
test('inventory revision rejects a stale form and a confirmed adjustment records its delta and operator', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB),
    p = DB.db.prepare("SELECT * FROM products WHERE id='FAMILY'").get() as any;
  await call(env, '/checkout', retail);
  assert.equal(
    (
      await call(env, '/admin/product', {
        id: p.id,
        stock: p.stock,
        revision: p.revision,
        active: true,
      })
    ).status,
    409,
  );
  const current = DB.db.prepare("SELECT * FROM products WHERE id='FAMILY'").get() as any;
  assert.equal(
    (
      await call(env, '/admin/product', {
        id: p.id,
        stock: 101,
        revision: current.revision,
        active: true,
        reason: '盘点补入',
      })
    ).status,
    200,
  );
  assert.equal((DB.db.prepare('SELECT delta FROM inventory_adjustments').get() as any).delta, 2);
});
test('server-side order filtering reaches older orders beyond 500 and does not preload invoice contacts', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB);
  const s = DB.db.prepare(
    "INSERT INTO orders(id,order_no,type,phone,amount,expires_at,created_at,invoice) VALUES(?,?,'retail',?,10800,'2026-12-01',?,?)",
  );
  for (let n = 0; n < 502; n++)
    s.run(
      'o' + n,
      'DF-LOCAL-' + n,
      address.phone,
      n === 0 ? '2026-10-22' : '2026-11-03',
      JSON.stringify({ email: 'private@example.invalid', tax_no: 'private-tax' }),
    );
  const result = await call(env, '/admin/list', { kind: 'orders', search: 'DF-LOCAL-0' });
  assert.equal(result.data.total, 1);
  assert.equal(result.data.rows[0].id, 'o0');
  assert(!JSON.stringify(result.data).includes('private@'));
  const page = await call(env, '/admin/list', { kind: 'orders', page: 26 });
  assert.equal(page.data.rows.length, 2);
  assert.equal(page.data.total, 502);
  const summary = await call(env, '/admin/data?summary=1');
  assert.equal(summary.data.orders.length, 0);
  assert.equal(summary.data.shipments.length, 0);
  for (const kind of ['invoices', 'shipments', 'sponsors', 'claims', 'diary'])
    assert.equal((await call(env, '/admin/list', { kind })).status, 200, kind);
});
test('new operator reminders use Telegram once while legacy operations are never backfilled', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB);
  DB.db.exec("INSERT INTO notifications(id,message) VALUES('old','不补发')");
  await notify(env, 'old', '不补发');
  await notify(env, 'new', '预约提醒：FG-0001 剩余 3 箱');
  await notify(env, 'new', '重复调用');
  assert.equal((DB.db.prepare('SELECT count(*) n FROM operation_notifications').get() as any).n, 1);
  let messages: string[] = [];
  const configured = {
    ...env,
    DEMO_MODE: 'false',
    STRIPE_MODE: 'live',
    NOTIFICATIONS_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: '123456:' + 'a'.repeat(30),
    TELEGRAM_CHAT_ID: '123456',
  };
  const sender: typeof fetch = async (_input, init) => {
    messages.push(JSON.parse(String(init?.body)).text);
    return Response.json({ ok: true });
  };
  await flushCommerceNotifications(configured, new Date(), sender);
  await flushCommerceNotifications(configured, new Date(), sender);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /预约提醒/);
  assert(!messages[0].includes('不补发'));
});
test('season deadline reminders enter the new outbox at seven, three and one days and remain deduplicated', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB);
  const order = await call(env, '/checkout', {
    type: 'adoption',
    sku: 'PA',
    qty: 1,
    phone: address.phone,
    plate_name: '本地树牌',
    pin: '123456',
    invoice: { type: 'none' },
    agreed: true,
  });
  DB.db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(order.data.id);
  for (const days of [7, 3, 1]) {
    const at = Date.parse(SEASON_END+'T00:00:00+08:00')+(1-days)*86400000;
    await maintenance(env, new Date(at));
    await maintenance(env, new Date(at+60000));
  }
  const rows = DB.db
    .prepare("SELECT id FROM operation_notifications WHERE id LIKE 'remind-%' ORDER BY id")
    .all() as any[];
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.id.split('-').at(-1)).sort(), ['1', '3', '7']);
});
test('public journey totals include paid, adopted, sponsored and gifted boxes', () => {
  assert.equal(journeyBoxes({ boxes: 7, adopted: 2, sponsored: 3, gifted: 75 }), 87);
  assert.equal(journeyBoxes({ boxes: 0, adopted: 0, sponsored: 0 }), 0);
});
test('request body limit also rejects streamed bodies without a Content-Length header', async () => {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(100));
      c.enqueue(new Uint8Array(100));
      c.close();
    },
  });
  await assert.rejects(
    boundedBody(
      new Request('http://localhost', { method: 'POST', body, duplex: 'half' } as any),
      128,
    ),
    /提交内容过大/,
  );
});
test('client intent retains its nonce across verification refresh and changes it when order contents change', async () => {
  finishCheckoutIntent();
  const a = await checkoutRequest({ ...retail, turnstile: 'a' }),
    b = await checkoutRequest({ ...retail, turnstile: 'b' }),
    c = await checkoutRequest({ ...retail, qty: 2 });
  assert.equal(a.request_id, b.request_id);
  assert.notEqual(a.request_id, c.request_id);
  finishCheckoutIntent();
});

test('unknown network result retries identical Stripe parameters and key without allocating another order', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB),
    request_id = crypto.randomUUID();
  Object.assign(env, {
    DEMO_MODE: 'false',
    SALES_OPEN: 'true',
    STRIPE_MODE: 'sandbox',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    TURNSTILE_SECRET_KEY: 'fixture',
  });
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const bodies: string[] = [],
    keys: string[] = [];
  globalThis.fetch = async (input, init) => {
    const r = new Request(input, init);
    if (r.url.includes('/turnstile/'))
      return Response.json({ success: true, hostname: 'localhost' });
    bodies.push(await r.text());
    keys.push(r.headers.get('idempotency-key')!);
    if (bodies.length === 1) throw Error('simulated connection lost after send');
    return Response.json({
      id: 'cs_test_retry',
      livemode: false,
      status: 'open',
      url: 'https://checkout.stripe.com/fixture',
      payment_status: 'unpaid',
    });
  };
  assert.equal(
    (await call(env, '/checkout', { ...retail, turnstile: 'fixture', request_id })).status,
    503,
  );
  const retried = await call(env, '/checkout', { ...retail, turnstile: 'renewed', request_id });
  assert.equal(retried.status, 200, JSON.stringify(retried.data));
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(keys[0], keys[1]);
  assert.equal((DB.db.prepare('SELECT count(*) n FROM orders').get() as any).n, 1);
  assert.equal(
    (DB.db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
    99,
  );
});
test('an interruption before durable Session preparation is recovered using the existing order and current request', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB),
    request_id = crypto.randomUUID();
  const first = await call(env, '/checkout', { ...retail, request_id });
  Object.assign(env, {
    DEMO_MODE: 'false',
    SALES_OPEN: 'true',
    STRIPE_MODE: 'sandbox',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  });
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () =>
    Response.json({
      id: 'cs_test_resume',
      livemode: false,
      status: 'open',
      url: 'https://checkout.stripe.com/fixture',
      payment_status: 'unpaid',
    });
  const retry = await call(env, '/checkout', { ...retail, request_id });
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
  assert.equal(retry.data.id, first.data.id);
  assert.equal((DB.db.prepare('SELECT count(*) n FROM payment_sessions').get() as any).n, 1);
});
test('a 23-hour unknown result is held and alerted once; reconciliation never re-POSTs beyond the retry window', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB);
  const o = await call(env, '/checkout', retail);
  DB.db
    .prepare(
      "INSERT INTO payment_sessions(order_id,params,state,attempts,created_at) VALUES(?,'{}','unknown',1,datetime('now','-24 hours'))",
    )
    .run(o.data.id);
  Object.assign(env, {
    DEMO_MODE: 'false',
    STRIPE_MODE: 'sandbox',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  });
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error('must not call');
  };
  await reconcileCheckoutSessions(env);
  await reconcileCheckoutSessions(env);
  assert.equal(calls, 0);
  assert.equal((DB.db.prepare('SELECT count(*) n FROM operation_notifications').get() as any).n, 1);
  assert.equal((DB.db.prepare('SELECT status FROM orders').get() as any).status, 'pending');
  assert.equal(
    (DB.db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
    99,
  );
});
test('linked Session only releases reservations after Stripe confirms expired, even if the webhook was missed', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB);
  const o = await call(env, '/checkout', retail);
  DB.db
    .prepare(
      "UPDATE orders SET stripe_session_id='cs_test_old',expires_at=datetime('now','-1 hour') WHERE id=?",
    )
    .run(o.data.id);
  DB.db
    .prepare("INSERT INTO payment_sessions(order_id,params,state) VALUES(?,'{}','linked')")
    .run(o.data.id);
  Object.assign(env, {
    DEMO_MODE: 'false',
    STRIPE_MODE: 'sandbox',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  });
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let expired = false;
  globalThis.fetch = async () =>
    Response.json({
      id: 'cs_test_old',
      livemode: false,
      status: expired ? 'expired' : 'open',
      url: expired ? null : 'https://checkout.stripe.com/fixture',
      payment_status: 'unpaid',
    });
  await reconcileCheckoutSessions(env);
  assert.equal((DB.db.prepare('SELECT status FROM orders').get() as any).status, 'pending');
  expired = true;
  DB.db.exec('UPDATE payment_sessions SET next_attempt_at=0');
  await reconcileCheckoutSessions(env);
  assert.equal((DB.db.prepare('SELECT status FROM orders').get() as any).status, 'expired');
  assert.equal(
    (DB.db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
    100,
  );
});
test('a stale paid callback cannot create a fulfillment record after the order closed', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB);
  await call(env, '/checkout', retail);
  const stale = DB.db.prepare('SELECT * FROM orders').get();
  DB.db.exec("UPDATE orders SET status='expired'");
  await markPaid(env, stale, 'evt_stale', null);
  assert.equal((DB.db.prepare('SELECT count(*) n FROM shipments').get() as any).n, 0);
});
test('expiry winning the race with payment preparation prevents any Stripe creation', async (t) => {
  const DB = new LocalD1();
  t.after(() => DB.db.close());
  const env = environment(DB),
    o = await call(env, '/checkout', retail);
  DB.db.prepare("INSERT INTO payment_sessions(order_id,params) VALUES(?,'{}')").run(o.data.id);
  Object.assign(env, {
    DEMO_MODE: 'false',
    STRIPE_MODE: 'sandbox',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
  });
  DB.beforePaymentLease = () => {
    DB.db.exec("UPDATE orders SET status='expired'");
  };
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error('must not create');
  };
  await assert.rejects(sessionForOrder(env, o.data.id), /正在确认/);
  assert.equal(calls, 0);
  assert.equal(
    (DB.db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
    100,
  );
});
test('signed expired and failed callbacks recover an unlinked Session and release its own reservation exactly once', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  for (const type of ['checkout.session.expired', 'checkout.session.async_payment_failed']) {
    const DB = new LocalD1();
    t.after(() => DB.db.close());
    const env = environment(DB);
    const o = await call(env, '/checkout', retail);
    DB.db
      .prepare(
        "INSERT INTO payment_sessions(order_id,params,state,attempts) VALUES(?,?,'unknown',1)",
      )
      .run(
        o.data.id,
        JSON.stringify({
          client_reference_id: o.data.id,
          line_items: [{ price_data: { unit_amount: 10800 } }],
        }),
      );
    Object.assign(env, {
      DEMO_MODE: 'false',
      STRIPE_MODE: 'sandbox',
      STRIPE_SECRET_KEY: 'rk_test_fixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    });
    const event = {
        id: 'evt_' + type,
        type,
        object: 'event',
        livemode: false,
        data: {
          object: {
            id: 'cs_test_closed',
            livemode: false,
            client_reference_id: o.data.id,
            currency: 'cny',
            amount_total: 10800,
            payment_status: 'unpaid',
            metadata: { project: 'orchard-shop', type: 'retail', order_id: o.data.id },
          },
        },
      },
      payload = JSON.stringify(event),
      time = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET!)
      .update(time + '.' + payload)
      .digest('hex');
    const { api } = await import('../src/lib/api');
    for (let n = 0; n < 2; n++)
      assert.equal(
        (
          await api(
            new Request(env.APP_ORIGIN + '/api/stripe/webhook', {
              method: 'POST',
              body: payload,
              headers: { 'stripe-signature': `t=${time},v1=${signature}` },
            }),
            env,
          )
        ).status,
        200,
      );
    assert.equal((DB.db.prepare('SELECT status FROM orders').get() as any).status, 'expired');
    assert.equal(
      (DB.db.prepare('SELECT state FROM payment_sessions').get() as any).state,
      'failed',
    );
    assert.equal(
      (DB.db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
      100,
    );
  }
});
