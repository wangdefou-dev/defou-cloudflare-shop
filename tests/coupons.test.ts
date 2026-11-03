import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import Stripe from 'stripe';
import { api } from '../src/lib/api';
import { confirmedRefundFixture } from './refund-stripe-fixture';
import { digest } from '../src/lib/security';
import { couponDiscount, normalizeCouponCode } from '../src/lib/coupon-format';
import { maintenance } from '../src/lib/database';
import { createSession } from '../src/lib/payments';
import { paidOrderMessage, dailyReportMessage } from '../src/lib/notifications';
import { prepareCouponBatch, COUPON_PLAN } from './fixtures/coupon-batch';

class D1 {
  db = new DatabaseSync(':memory:');
  queue = Promise.resolve();
  constructor() {
    for (const f of readdirSync('migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      this.db.exec(readFileSync('migrations/' + f, 'utf8'));
    for (const f of ['scripts/seed.sql', 'scripts/regions.sql'])
      this.db.exec(readFileSync(f, 'utf8'));
    this.db.exec('UPDATE products SET stock=100');
  }
  prepare(sql: string) {
    let args: any[] = [];
    const s: any = {
      bind(...values: any[]) {
        args = values;
        return s;
      },
      first: async () => this.db.prepare(sql).get(...args) || null,
      all: async () => ({ success: true, results: this.db.prepare(sql).all(...args) }),
      run: async () => ({
        success: true,
        meta: { changes: Number(this.db.prepare(sql).run(...args).changes) },
      }),
    };
    return s;
  }
  batch(statements: any[]) {
    const run = this.queue.then(async () => {
      this.db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.db.exec('COMMIT');
        return results;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    });
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }
}
const code = 'TH88-2345-6789-ABCD-EFGH';
async function setup(percentOff = 12) {
  const DB = new D1();
  DB.db
    .prepare(
      "INSERT INTO coupon_batches(id,name,starts_at,expires_at) VALUES('batch','Local-only coupons',datetime('now','-1 minute'),datetime('now','+7 days'))",
    )
    .run();
  DB.db
    .prepare(
      "INSERT INTO coupons(id,batch_id,code_hash,code_hint,percent_off) VALUES('coupon','batch',?,'TH88-****-****-****-EFGH',?)",
    )
    .run(await digest(normalizeCouponCode(code)), percentOff);
  const env = {
    DB,
    DEMO_MODE: 'true',
    APP_ORIGIN: 'http://localhost:4321',
    CACHE: { put: async () => {}, get: async () => null },
  } as unknown as Env;
  return { env, db: DB.db };
}
async function call(env: Env, path: string, body?: any) {
  const response = await api(
    new Request('http://localhost:4321/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin: 'http://localhost:4321', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return {
    status: response.status,
    data: (await response.json()) as any,
    headers: response.headers,
  };
}
function retail(extra: any = {}) {
  return {
    type: 'retail',
    sku: 'FAMILY',
    qty: 1,
    phone: '13800000000',
    address: {
      recipient: '本地夹具',
      phone: '13800000000',
      province_code: '110000',
      city_code: '110100',
      district_code: '110101',
      province: '北京市',
      city: '北京市',
      district: '东城区',
      address: '本地测试地址001号',
    },
    invoice: { type: 'none' },
    agreed: true,
    coupon_code: code,
    ...extra,
  };
}
const stripe = new Stripe('rk_test_fixture', {
  apiVersion: '2026-09-30.endive',
  httpClient: Stripe.createFetchHttpClient(),
});
async function hook(env: Env, event: any) {
  env.STRIPE_MODE = 'sandbox';
  env.STRIPE_SECRET_KEY = 'rk_test_fixture';
  env.STRIPE_WEBHOOK_SECRET = 'whsec_local_fixture';
  const payload = JSON.stringify({ livemode: false, ...event });
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  const execute = () =>
    api(
      new Request('http://localhost:4321/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': signature },
        body: payload,
      }),
      env,
    );
  const result =
    event.type === 'charge.refunded' && event.data.object.refunded
      ? await confirmedRefundFixture(env, String(event.data.object.payment_intent), execute)
      : await execute();
  return { status: result.status, data: (await result.json()) as any };
}
const session = (order: any, paid = true) => ({
  id: 'cs_' + order.id,
  metadata: { project: 'orchard-shop', order_id: order.id },
  payment_status: paid ? 'paid' : 'unpaid',
  currency: 'cny',
  amount_total: order.amount,
  payment_intent: 'pi_' + order.id.replaceAll('-', ''),
});

test('coupon calculations use cents and discount exactly one box at all six requested rates', () => {
  for (const [price, expected] of [
    [10800, [1296, 2160, 3672, 4320, 5400, 9720]],
    [12800, [1536, 2560, 4352, 5120, 6400, 11520]],
  ] as const) {
    COUPON_PLAN.forEach((plan, index) =>
      assert.equal(couponDiscount(price, 100 - plan.payPercent), expected[index]),
    );
  }
  assert.equal(couponDiscount(109, 50), 55);
  for (const args of [
    [0, 12],
    [10800, 0],
    [10800, 100],
    [1.1, 12],
  ])
    assert.throws(() => couponDiscount(args[0], args[1]));
});

test('issuance prepares exactly 110 unique bearer codes, hashes only in SQL, and exactly seven days validity', () => {
  const now = new Date('2026-10-23T09:15:16+08:00');
  const prepared = prepareCouponBatch(now);
  assert.equal(prepared.codes.length, 110);
  assert.equal(new Set(prepared.codes.map((c) => c.code_hash)).size, 110);
  for (const plan of COUPON_PLAN)
    assert.equal(
      prepared.codes.filter((c) => c.pay_percent === plan.payPercent).length,
      plan.count,
    );
  assert.equal(
    Date.parse(prepared.batch.expires_at.replace(' ', 'T') + 'Z') -
      Date.parse(prepared.batch.starts_at.replace(' ', 'T') + 'Z'),
    7 * 86400000,
  );
  const DB = new D1();
  DB.db.exec(prepared.sql);
  DB.db.exec(prepared.sql);
  assert.equal(
    (
      DB.db
        .prepare('SELECT unixepoch(expires_at)-unixepoch(starts_at) seconds FROM coupon_batches')
        .get() as any
    ).seconds,
    604800,
  );
  assert.equal((DB.db.prepare('SELECT COUNT(*) n FROM coupons').get() as any).n, 110);
  for (const c of prepared.codes) {
    assert(!prepared.sql.includes(c.code));
    assert.equal(normalizeCouponCode(c.code).length, 20);
  }
});

test('coupon quote is private, case/separator tolerant, and does not reserve stock or the coupon', async () => {
  const { env, db } = await setup();
  const quote = await call(env, '/coupons/quote', {
    sku: 'FAMILY',
    code: ' th88 2345 6789 abcd efgh ',
  });
  assert.equal(quote.status, 200);
  assert.equal(quote.headers.get('cache-control'), 'no-store');
  assert.equal(quote.data.discount_amount, 1296);
  assert.equal(quote.data.unit_price, 10800);
  assert(!('id' in quote.data));
  assert(!('code_hash' in quote.data));
  assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_reservations').get() as any).n, 0);
  assert.equal(
    (db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
    100,
  );
});

test('all requested discounts produce the right net order and preserve the original price', async () => {
  for (const plan of COUPON_PLAN) {
    const { env, db } = await setup(100 - plan.payPercent);
    const result = await call(env, '/checkout', retail());
    assert.equal(result.status, 200);
    assert.equal(result.data.amount, 10800 - couponDiscount(10800, 100 - plan.payPercent));
    assert.equal(result.data.original_amount, 10800);
    assert(!('coupon_id' in result.data));
    assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_reservations').get() as any).n, 1);
  }
});

test('multiple boxes and remote surcharge are not multiplied into the coupon benefit', async () => {
  const { env } = await setup(90);
  const body = retail({ sku: 'GIFT', qty: 20 });
  body.address = {
    ...body.address,
    province_code: '650000',
    city_code: '650100',
    district_code: '650102',
    province: '新疆',
    city: '乌鲁木齐市',
    district: '天山区',
  };
  const result = await call(env, '/checkout', body);
  assert.equal(result.status, 200);
  assert.equal(result.data.discount_amount, 11520);
  assert.equal(result.data.original_amount, 12800 * 20 + 2000 * 20);
  assert.equal(result.data.amount, 12800 * 20 + 2000 * 20 - 11520);
  assert.equal(result.data.coupon_percent_off, 90);
});

test('unknown, expired, future, disabled and adoption coupons are rejected without order/stock writes', async () => {
  for (const mutate of [
    (db: DatabaseSync) => db.exec('UPDATE coupons SET disabled=1'),
    (db: DatabaseSync) =>
      db.exec(
        "UPDATE coupon_batches SET expires_at=datetime('now','-1 second'),starts_at=datetime('now','-1 day')",
      ),
    (db: DatabaseSync) => db.exec("UPDATE coupon_batches SET starts_at=datetime('now','+1 hour')"),
    (db: DatabaseSync) => db.exec('UPDATE coupon_batches SET disabled=1'),
  ]) {
    const { env, db } = await setup();
    mutate(db);
    assert.equal((await call(env, '/checkout', retail())).status, 409);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM orders').get() as any).n, 0);
  }
  const { env, db } = await setup();
  assert.equal(
    (await call(env, '/coupons/quote', { sku: 'FAMILY', code: 'TH88-0000-0000-0000-0000' })).status,
    409,
  );
  assert.equal(
    (
      await call(
        env,
        '/checkout',
        retail({ type: 'adoption', sku: 'PA', plate_name: '本地树', pin: '123456' }),
      )
    ).status,
    400,
  );
  assert.equal((db.prepare("SELECT stock FROM products WHERE id='PA'").get() as any).stock, 100);
});

test('duplicate coupon checkout loses atomically and cannot consume extra stock', async () => {
  const { env, db } = await setup();
  const a = await call(env, '/checkout', retail());
  assert.equal(a.status, 200);
  const b = await call(env, '/checkout', retail());
  assert.equal(b.status, 409);
  // This SQL path simulates a quote racing with a reservation after validation.
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(a.data.id) as any;
  db.exec('BEGIN');
  assert.throws(() => {
    db.prepare(
      'INSERT INTO orders(id,order_no,type,phone,amount,remote_fee,expires_at,coupon_id,original_amount,discount_amount,coupon_percent_off,coupon_code_hint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      'race',
      'DF-race',
      'retail',
      '13800000000',
      order.amount,
      0,
      order.expires_at,
      order.coupon_id,
      10800,
      1296,
      12,
      order.coupon_code_hint,
    );
    db.prepare("INSERT INTO order_items VALUES('race-item','race','FAMILY',1)").run();
  }, /coupon_(?:unavailable|reservations)/);
  db.exec('ROLLBACK');
  assert.equal((db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock, 99);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM orders').get() as any).n, 1);
});

test('stale or forged discount financial fields roll back coupon and stock reservations', async () => {
  const { env, db } = await setup();
  const original = db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any;
  const order = await call(
    env,
    '/checkout',
    retail({ discount_amount: 100000, amount: 1, percent_off: 100 }),
  );
  assert.equal(order.data.discount_amount, 1296);
  assert.equal(order.data.amount, 9504);
  assert.throws(
    () => db.prepare('UPDATE orders SET amount=1 WHERE id=?').run(order.data.id),
    /coupon_order_immutable/,
  );
  assert.equal(
    (db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
    original.stock - 1,
  );
  db.prepare("UPDATE orders SET status='expired' WHERE id=?").run(order.data.id);
  db.exec('BEGIN');
  db.prepare(
    "INSERT INTO orders(id,order_no,type,phone,amount,expires_at,coupon_id,original_amount,discount_amount,coupon_percent_off,coupon_code_hint) VALUES('forged','DF-forged','retail','13800000000',1,datetime('now','+30 minutes'),'coupon',10800,10799,12,'TH88-****-****-****-EFGH')",
  ).run();
  assert.throws(
    () => db.exec("INSERT INTO order_items VALUES('forged-item','forged','FAMILY',1)"),
    /coupon_invalid/,
  );
  db.exec('ROLLBACK');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_reservations').get() as any).n, 0);
});

test('unpaid session stays reserved; signed expiry releases once, while a paid/refunded coupon remains consumed', async () => {
  const { env, db } = await setup();
  let a = (await call(env, '/checkout', retail())).data;
  db.prepare(
    "UPDATE orders SET stripe_session_id=?,expires_at=datetime('now','-1 minute') WHERE id=?",
  ).run('cs_' + a.id, a.id);
  await maintenance(env);
  assert.equal((await call(env, '/coupons/quote', { sku: 'FAMILY', code })).status, 409);
  assert.equal(
    (
      await hook(env, {
        id: 'evt-expire',
        type: 'checkout.session.expired',
        data: { object: session(a, false) },
      })
    ).status,
    200,
  );
  assert.equal((await call(env, '/coupons/quote', { sku: 'FAMILY', code })).status, 200);
  a = (await call(env, '/checkout', retail())).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_' + a.id, a.id);
  const unpaid = {
    id: 'evt-unpaid',
    type: 'checkout.session.completed',
    data: { object: session(a, false) },
  };
  assert.equal((await hook(env, unpaid)).status, 200);
  assert.equal(
    (db.prepare("SELECT redeemed_at FROM coupons WHERE id='coupon'").get() as any).redeemed_at,
    null,
  );
  const paid = {
    id: 'evt-paid',
    type: 'checkout.session.async_payment_succeeded',
    data: { object: session(a) },
  };
  assert.equal((await hook(env, paid)).status, 200);
  assert.equal((await hook(env, paid)).status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM shipments').get() as any).n, 1);
  assert.equal(
    (db.prepare("SELECT redeemed_order_id FROM coupons WHERE id='coupon'").get() as any)
      .redeemed_order_id,
    a.id,
  );
  assert.equal(
    (
      await hook(env, {
        id: 'evt-refund',
        type: 'charge.refunded',
        data: {
          object: {
            refunded: true,
            payment_intent: 'pi_' + a.id.replaceAll('-', ''),
            metadata: { project: 'orchard-shop' },
          },
        },
      })
    ).status,
    200,
  );
  assert.equal((await call(env, '/coupons/quote', { sku: 'FAMILY', code })).status, 409);
});

test('orphan checkout creation failure/timeout releases coupons; callbacks must match the discounted amount', async () => {
  const { env, db } = await setup();
  const order = (await call(env, '/checkout', retail())).data;
  db.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE id=?").run(order.id);
  await maintenance(env);
  await maintenance(env);
  assert.equal((await call(env, '/coupons/quote', { sku: 'FAMILY', code })).status, 200);
  const next = (await call(env, '/checkout', retail())).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_' + next.id, next.id);
  const wrong = { ...session(next), amount_total: 10800 };
  assert.equal(
    (
      await hook(env, {
        id: 'evt-wrong',
        type: 'checkout.session.completed',
        data: { object: wrong },
      })
    ).status,
    400,
  );
  assert.equal(
    (db.prepare("SELECT redeemed_at FROM coupons WHERE id='coupon'").get() as any).redeemed_at,
    null,
  );
});

test('coupon order lookup, admin details, paid outbox and daily summaries expose correct original/discount/net without the bearer code', async () => {
  const { env, db } = await setup();
  const order = (await call(env, '/checkout', retail())).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_' + order.id, order.id);
  await hook(env, {
    id: 'evt-record',
    type: 'checkout.session.completed',
    data: { object: session(order) },
  });
  const visible = await call(env, '/order/status', { view_token: order.view_token });
  assert.equal(visible.data.amount, 9504);
  assert.equal(visible.data.discount_amount, 1296);
  assert.equal(visible.data.original_amount, 10800);
  const detail = await call(env, '/admin/order-detail', { id: order.id });
  assert.equal(detail.data.order.discount_amount, 1296);
  const payload = JSON.parse(
    (db.prepare("SELECT payload FROM commerce_notifications WHERE kind='paid_order'").get() as any)
      .payload,
  );
  const message = paidOrderMessage(payload);
  assert.match(message, /优惠前：¥108/);
  assert.match(message, /减 ¥12.96/);
  assert.match(message, /实付：¥95.04/);
  assert(!message.includes(code));
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const daily = await dailyReportMessage(env, date);
  assert.match(daily, /累计销售额：¥95.04/);
  assert.match(daily, /家庭装：1 箱，¥95.04/);
  assert(!daily.includes(code));
});

test('admin coupon list never discloses full codes or hashes, and disabled coupons cannot start new checkouts', async () => {
  const { env } = await setup();
  const list = await call(env, '/admin/coupons');
  assert.equal(list.status, 200);
  assert.equal(list.data.batches[0].available, 1);
  const serialized = JSON.stringify(list.data);
  assert(!serialized.includes(code));
  assert(!serialized.includes('code_hash'));
  assert.equal(
    (await call(env, '/admin/coupons/disable', { id: 'coupon', disabled: true })).status,
    200,
  );
  assert.equal((await call(env, '/checkout', retail())).status, 409);
  assert.equal(
    (await call(env, '/admin/coupons/disable', { id: 'coupon', disabled: false })).status,
    200,
  );
  assert.equal((await call(env, '/coupons/quote', { sku: 'FAMILY', code })).status, 200);
  const unauth = { ...env, DEMO_MODE: 'false' };
  assert.equal((await call(unauth, '/admin/coupons')).status, 503);
});

test('deep-discount compensation is capped at paid amount, including pending prior claims', async () => {
  const { env, db } = await setup(90);
  const order = (await call(env, '/checkout', retail({ sku: 'GIFT' }))).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_' + order.id, order.id);
  await hook(env, {
    id: 'evt-claim-pay',
    type: 'checkout.session.completed',
    data: { object: session(order) },
  });
  const shipment = (db.prepare('SELECT id FROM shipments').get() as any).id;
  db.prepare("UPDATE shipments SET status='shipped' WHERE id=?").run(shipment);
  const claim = await call(env, '/admin/claim', {
    shipment_id: shipment,
    count: 1,
    photos: ['/media/apple-2026/local.webp'],
  });
  assert.equal(claim.status, 200);
  assert.equal((db.prepare('SELECT amount FROM claims').get() as any).amount, 1280);
  assert.equal(
    (
      await call(env, '/admin/claim', {
        shipment_id: shipment,
        count: 1,
        photos: ['/media/apple-2026/local.webp'],
      })
    ).status,
    409,
  );
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO claims(id,shipment_id,count,amount,photos) VALUES('race',?,1,1,'[]')")
        .run(shipment),
    /coupon_refund_limit/,
  );
});

test('Stripe session charges only the validated net amount and describes the one-box benefit without forwarding coupon codes', async () => {
  const { env, db } = await setup(90);
  const order = (await call(env, '/checkout', retail())).data;
  const full = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id) as any;
  const original = globalThis.fetch;
  env.DEMO_MODE = 'false';
  env.STRIPE_MODE = 'sandbox';
  env.STRIPE_SECRET_KEY = 'rk_test_fixture';
  try {
    globalThis.fetch = async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('line_items[0][price_data][unit_amount]'), '1080');
      assert.match(
        body.get('line_items[0][price_data][product_data][description]')!,
        /1 折券仅优惠1箱/,
      );
      assert(!String(init?.body).includes(code));
      assert.equal(body.get('allow_promotion_codes'), null);
      return Response.json({
        id: 'cs_fixture_discount',
        object: 'checkout.session',
        livemode: false,
        url: 'https://checkout.stripe.com/local-fixture',
      });
    };
    const result = await createSession(
      env,
      new Request('http://localhost:4321/api/checkout'),
      full,
      '家庭装 × 1',
    );
    assert(result.url.startsWith('https://checkout.stripe.com/'));
  } finally {
    globalThis.fetch = original;
  }
});

test('Stripe creation failures atomically release the pending coupon and stock without consuming it', async () => {
  const { env, db } = await setup();
  const original = globalThis.fetch;
  env.DEMO_MODE = 'false';
  env.SALES_OPEN = 'true';
  env.STRIPE_MODE = 'sandbox';
  env.STRIPE_SECRET_KEY = 'rk_test_fixture';
  env.STRIPE_WEBHOOK_SECRET = 'whsec_local_fixture';
  env.TURNSTILE_SECRET_KEY = 'local_fixture_secret';
  try {
    globalThis.fetch = async (url) =>
      String(url).includes('/turnstile/')
        ? Response.json({ success: true, hostname: 'localhost' })
        : Response.json(
            { error: { type: 'invalid_request_error', message: 'Local fixture rejection' } },
            { status: 400 },
          );
    const result = await call(env, '/checkout', retail({ turnstile: 'fixture-token' }));
    assert.equal(result.status, 502);
    assert.equal((db.prepare('SELECT status FROM orders').get() as any).status, 'expired');
    assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_reservations').get() as any).n, 0);
    assert.equal(
      (db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
      100,
    );
    assert.equal((db.prepare('SELECT redeemed_at FROM coupons').get() as any).redeemed_at, null);
  } finally {
    globalThis.fetch = original;
  }
});

test('a reserved checkout honors its quoted discount if the campaign later closes or is disabled', async () => {
  const { env, db } = await setup();
  const order = (await call(env, '/checkout', retail())).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_' + order.id, order.id);
  db.exec(
    "UPDATE coupon_batches SET starts_at=datetime('now','-2 days'),expires_at=datetime('now','-1 second'),disabled=1",
  );
  assert.equal((await call(env, '/coupons/quote', { sku: 'FAMILY', code })).status, 409);
  assert.equal(
    (
      await hook(env, {
        id: 'evt-closed-paid',
        type: 'checkout.session.completed',
        data: { object: session(order) },
      })
    ).status,
    200,
  );
  assert.equal(
    (db.prepare('SELECT redeemed_order_id FROM coupons').get() as any).redeemed_order_id,
    order.id,
  );
});

const sharedCode = 'LOCAL88';
async function sharedSetup(limit = 30) {
  const result = await setup();
  result.db
    .prepare('UPDATE coupons SET code_hash=?,code_hint=?,redemption_limit=? WHERE id=?')
    .run(await digest(sharedCode), 'LO-****-88', limit, 'coupon');
  return result;
}

test('a short shared code quotes 8.8-fold prices without reserving or exposing its usage records', async () => {
  const { env, db } = await sharedSetup();
  for (const [sku, price, discount] of [
    ['FAMILY', 10800, 1296],
    ['GIFT', 12800, 1536],
  ] as const) {
    const result = await call(env, '/coupons/quote', { sku, code: ' lo-cal 88 ' });
    assert.equal(result.status, 200);
    assert.equal(result.data.unit_price, price);
    assert.equal(result.data.discount_amount, discount);
    assert(!/coupon_id|code_hash|redemption_limit|used_count/.test(JSON.stringify(result.data)));
    assert(!JSON.stringify(result.data).includes(sharedCode));
  }
  assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_uses').get() as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM orders').get() as any).n, 0);
  assert.equal(
    (await call(env, '/coupons/quote', { sku: 'FAMILY', code: 'UNKNOWN88' })).status,
    409,
  );
});

test('35 concurrent checkouts can allocate only 30 shared uses and a losing transaction does not consume stock', async () => {
  const { env, db } = await sharedSetup();
  const results = await Promise.all(
    Array.from({ length: 35 }, () => call(env, '/checkout', retail({ coupon_code: sharedCode }))),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 30);
  assert.equal(results.filter((r) => r.status === 409).length, 5);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM orders').get() as any).n, 30);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_uses').get() as any).n, 30);
  assert.equal(
    (db.prepare("SELECT stock FROM products WHERE sku='FAMILY'").get() as any).stock,
    70,
  );
  assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_reservations').get() as any).n, 0);
  assert.equal(
    (await call(env, '/coupons/quote', { sku: 'FAMILY', code: sharedCode })).status,
    409,
  );
  const admin = (await call(env, '/admin/coupons')).data;
  assert.equal(admin.codes.length, 1);
  assert.equal(admin.codes[0].redemption_limit, 30);
  assert.equal(admin.codes[0].used_count, 0);
  assert.equal(admin.codes[0].reserved_count, 30);
  assert.equal(admin.codes[0].remaining_uses, 0);
  assert.equal(admin.codes[0].status, 'reserved');
  assert.equal(admin.batches[0].total, 1);
  assert.equal(admin.batches[0].usage_limit, 30);
  assert.equal(admin.batches[0].reserved, 30);
});

test('shared redemption counts once per signed payment, releases only the failed order and never restores a refund', async () => {
  const { env, db } = await sharedSetup(2);
  const first = (await call(env, '/checkout', retail({ coupon_code: sharedCode }))).data;
  const second = (await call(env, '/checkout', retail({ coupon_code: sharedCode }))).data;
  for (const o of [first, second])
    db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_' + o.id, o.id);
  const paid = {
    id: 'evt-shared-paid',
    type: 'checkout.session.completed',
    data: { object: session(first) },
  };
  assert.equal((await hook(env, paid)).status, 200);
  assert.equal((await hook(env, paid)).status, 200);
  assert.equal(
    (
      await hook(env, {
        ...paid,
        id: 'evt-shared-async-paid',
        type: 'checkout.session.async_payment_succeeded',
      })
    ).status,
    200,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) n FROM coupon_uses WHERE redeemed_at IS NOT NULL').get() as any).n,
    1,
  );
  assert.equal(
    (
      await hook(env, {
        id: 'evt-shared-expired',
        type: 'checkout.session.expired',
        data: { object: session(second, false) },
      })
    ).status,
    200,
  );
  assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_uses').get() as any).n, 1);
  assert.equal(
    (await call(env, '/coupons/quote', { sku: 'FAMILY', code: sharedCode })).status,
    200,
  );
  const third = (await call(env, '/checkout', retail({ coupon_code: sharedCode }))).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_' + third.id, third.id);
  assert.equal(
    (
      await hook(env, {
        id: 'evt-shared-refund',
        type: 'charge.refunded',
        data: {
          object: {
            refunded: true,
            payment_intent: 'pi_' + first.id.replaceAll('-', ''),
            metadata: { project: 'orchard-shop' },
          },
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(env, '/coupons/quote', { sku: 'FAMILY', code: sharedCode })).status,
    409,
  );
  assert.equal(
    (
      await hook(env, {
        id: 'evt-shared-failed',
        type: 'checkout.session.async_payment_failed',
        data: { object: session(third, false) },
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(env, '/coupons/quote', { sku: 'FAMILY', code: sharedCode })).status,
    200,
  );
  const fourth = (await call(env, '/checkout', retail({ coupon_code: sharedCode }))).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_' + fourth.id, fourth.id);
  db.exec('UPDATE coupons SET disabled=1');
  assert.equal(
    (
      await hook(env, {
        id: 'evt-shared-last-paid',
        type: 'checkout.session.completed',
        data: { object: session(fourth) },
      })
    ).status,
    200,
  );
  db.exec('UPDATE coupons SET disabled=0');
  assert.equal(
    (await call(env, '/coupons/quote', { sku: 'FAMILY', code: sharedCode })).status,
    409,
  );
  const admin = (await call(env, '/admin/coupons')).data;
  assert.equal(admin.codes.length, 1);
  assert.equal(admin.codes[0].used_count, 2);
  assert.equal(admin.codes[0].reserved_count, 0);
  assert.equal(admin.codes[0].status, 'redeemed');
  assert.equal(admin.batches[0].redeemed, 2);
  assert.equal(admin.batches[0].available, 0);
});

test('shared uses retain single-box pricing and partial-use management without leaking code/hash values', async () => {
  const { env, db } = await sharedSetup(3);
  const a = await call(env, '/checkout', retail({ coupon_code: sharedCode, sku: 'GIFT', qty: 2 }));
  assert.equal(a.status, 200);
  assert.equal(a.data.amount, 24064);
  assert.equal(a.data.discount_amount, 1536);
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_' + a.data.id, a.data.id);
  assert.equal(
    (
      await hook(env, {
        id: 'evt-shared-partial',
        type: 'checkout.session.completed',
        data: { object: session(a.data) },
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(env, '/admin/coupons/disable', { id: 'coupon', disabled: true })).status,
    200,
  );
  assert.equal(
    (await call(env, '/coupons/quote', { sku: 'FAMILY', code: sharedCode })).status,
    409,
  );
  let list = (await call(env, '/admin/coupons/search', { percent_off: 12, status: 'disabled' }))
    .data;
  assert.equal(list.total, 1);
  assert.equal(list.codes[0].used_count, 1);
  assert.equal(list.codes[0].remaining_uses, 0);
  assert(!JSON.stringify(list).includes(sharedCode));
  assert(!JSON.stringify(list).includes('code_hash'));
  assert.equal(
    (await call(env, '/admin/coupons/disable', { id: 'coupon', disabled: false })).status,
    200,
  );
  list = (await call(env, '/admin/coupons/search', { percent_off: 12, status: 'available' })).data;
  assert.equal(list.total, 1);
  assert.equal(list.codes[0].remaining_uses, 2);
  assert.equal(list.batches[0].available, 2);
  assert.equal(
    (
      await call(
        env,
        '/checkout',
        retail({
          type: 'adoption',
          sku: 'PA',
          coupon_code: sharedCode,
          pin: '123456',
          plate_name: 'fixture',
        }),
      )
    ).status,
    400,
  );
});

test('migration preserves old paid/refunded, pending and expired coupons, original validity, stock and notification history', () => {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations')
    .filter((f) => f.endsWith('.sql') && f < '0010')
    .sort())
    db.exec(readFileSync('migrations/' + file, 'utf8'));
  db.exec(readFileSync('scripts/seed.sql', 'utf8'));
  db.exec(
    "UPDATE products SET stock=10; INSERT INTO coupon_batches(id,name,starts_at,expires_at) VALUES('legacy','legacy',datetime('now','-1 day'),datetime('now','+6 days'))",
  );
  for (const suffix of ['paid', 'pending', 'expired']) {
    db.prepare(
      "INSERT INTO coupons(id,batch_id,code_hash,code_hint,percent_off) VALUES(?,'legacy',?,? ,12)",
    ).run(suffix, 'hash-' + suffix, 'hint-' + suffix);
    db.prepare(
      "INSERT INTO orders(id,order_no,type,phone,amount,remote_fee,expires_at,coupon_id,original_amount,discount_amount,coupon_percent_off,coupon_code_hint) VALUES(?,?,'retail','13800000000',9504,0,datetime('now','+30 minutes'),?,10800,1296,12,?)",
    ).run(suffix, 'LEGACY-' + suffix, suffix, 'hint-' + suffix);
    db.prepare("INSERT INTO order_items VALUES(?,?,'FAMILY',1)").run('item-' + suffix, suffix);
  }
  db.exec(
    "UPDATE orders SET status='paid' WHERE id='paid'; UPDATE orders SET status='refunded' WHERE id='paid'; UPDATE orders SET status='expired' WHERE id='expired'; DELETE FROM coupon_reservations WHERE coupon_id='paid'",
  );
  const before = JSON.stringify({
    coupons: db.prepare('SELECT id,redeemed_order_id,redeemed_at FROM coupons ORDER BY id').all(),
    batches: db.prepare('SELECT * FROM coupon_batches').all(),
    products: db.prepare('SELECT sku,stock FROM products ORDER BY sku').all(),
    notifications: db.prepare('SELECT * FROM commerce_notifications').all(),
  });
  db.exec(readFileSync('migrations/0010_shared_coupon_limits.sql', 'utf8'));
  const after = JSON.stringify({
    coupons: db.prepare('SELECT id,redeemed_order_id,redeemed_at FROM coupons ORDER BY id').all(),
    batches: db.prepare('SELECT * FROM coupon_batches').all(),
    products: db.prepare('SELECT sku,stock FROM products ORDER BY sku').all(),
    notifications: db.prepare('SELECT * FROM commerce_notifications').all(),
  });
  assert.equal(after, before);
  assert.equal(
    (db.prepare('SELECT COUNT(*) n FROM coupons WHERE redemption_limit=1').get() as any).n,
    3,
  );
  assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_uses').get() as any).n, 2);
  assert.equal(
    (db.prepare('SELECT COUNT(*) n FROM coupon_uses WHERE redeemed_at IS NOT NULL').get() as any).n,
    1,
  );
  db.exec("UPDATE orders SET status='expired' WHERE id='pending'");
  assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_uses').get() as any).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM coupon_reservations').get() as any).n, 0);
  db.close();
});
