import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import Stripe from 'stripe';
import { api } from '../src/lib/api';

// Every payment and address below is a local fixture. No test may contact Stripe.
class D1 {
  db = new DatabaseSync(':memory:');
  queue = Promise.resolve();
  constructor() {
    for (const file of readdirSync('migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      this.db.exec(readFileSync('migrations/' + file, 'utf8'));
    this.db.exec(readFileSync('tests/fixtures/orchard-seed.sql', 'utf8'));
    this.db.exec('UPDATE products SET stock=100,active=1');
  }
  prepare(sql: string) {
    let args: any[] = [];
    const statement: any = {
      bind(...values: any[]) {
        args = values;
        return statement;
      },
      first: async (column?: string) => {
        const row = this.db.prepare(sql).get(...args) as any;
        return row ? (column ? row[column] : row) : null;
      },
      all: async () => ({ success: true, results: this.db.prepare(sql).all(...args) }),
      run: async () => ({
        success: true,
        meta: { changes: Number(this.db.prepare(sql).run(...args).changes) },
      }),
    };
    return statement;
  }
  batch(statements: any[]) {
    const result = this.queue.then(async () => {
      this.db.exec('BEGIN');
      try {
        const rows = [];
        for (const statement of statements) rows.push(await statement.run());
        this.db.exec('COMMIT');
        return rows;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}

const orderId = 'refund-order-fixture';
const paymentIntent = 'pi_refund_fixture';
const chargeId = 'ch_refund_fixture';
const fixtureKey = 'rk_test_refund_fixture';
const address = {
  recipient: '本地退款夹具',
  phone: '13800000000',
  province: '北京市',
  city: '北京市',
  district: '东城区',
  province_code: '110000',
  city_code: '110100',
  district_code: '110101',
  address: '仅供本地测试的地址001号',
};
type RefundStatus = 'succeeded' | 'pending' | 'failed' | 'canceled' | 'requires_action';
function testEnv(DB: D1) {
  return {
    DB,
    DEMO_MODE: 'true',
    APP_ORIGIN: 'http://localhost:4321',
    STRIPE_MODE: 'sandbox',
    STRIPE_REFUND_SECRET_KEY: fixtureKey,
    STRIPE_SECRET_KEY: 'rk_test_checkout_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_local_refund_fixture',
    CACHE: { put: async () => {}, get: async () => null },
  } as unknown as Env;
}
function setup(discounted = false) {
  const DB = new D1();
  const amount = discounted ? 9504 : 10800;
  if (discounted) {
    DB.db.exec(
      "INSERT INTO coupon_batches(id,name,starts_at,expires_at) VALUES('refund-coupon-batch','local-only',datetime('now','-1 day'),datetime('now','+6 days')); INSERT INTO coupons(id,batch_id,code_hash,code_hint,percent_off) VALUES('refund-coupon','refund-coupon-batch','local-only-hash','TH88-****-****-****-TEST',12)",
    );
  }
  DB.db
    .prepare(
      `INSERT INTO orders(id,order_no,type,phone,amount,expires_at,original_amount,
    discount_amount,coupon_id,coupon_percent_off,coupon_code_hint,address_json,stripe_payment_intent,stripe_session_id)
    VALUES(?,?,'retail','13800000000',?,datetime('now','+30 minutes'),10800,?,?,?,?,?,?,?)`,
    )
    .run(
      orderId,
      'DF-LOCAL-REFUND',
      amount,
      discounted ? 1296 : 0,
      discounted ? 'refund-coupon' : null,
      discounted ? 12 : null,
      discounted ? 'TH88-****-****-****-TEST' : null,
      JSON.stringify(address),
      paymentIntent,
      'cs_refund_fixture',
    );
  DB.db.prepare("INSERT INTO order_items VALUES('refund-item',?,'FAMILY',1)").run(orderId);
  DB.db
    .prepare("UPDATE orders SET status='paid',paid_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(orderId);
  DB.db
    .prepare(
      `INSERT INTO shipments(id,source,source_id,product_id,qty,recipient,phone,province_code,city_code,
    district_code,region_label,address,status) VALUES('refund-shipment','retail',?,'FAMILY',1,?,?,?,?,?,?,?,'reserved')`,
    )
    .run(
      orderId,
      address.recipient,
      address.phone,
      address.province_code,
      address.city_code,
      address.district_code,
      '北京市 / 北京市 / 东城区',
      address.address,
    );
  const env = testEnv(DB);
  return { env, db: DB.db, amount };
}
function setupShipping() {
  const DB = new D1(),
    db = DB.db,
    amount = 2000;
  db.exec(
    "INSERT INTO orders(id,order_no,type,phone,amount,original_amount,expires_at,plate_name,pin_hash) VALUES('tree-order-fixture','DF-LOCAL-TREE','adoption','13800000000',88800,88800,datetime('now','+30 minutes'),'本地树夹具','local-only-hash'); INSERT INTO order_items VALUES('tree-item-fixture','tree-order-fixture','PA',1); UPDATE orders SET status='paid' WHERE id='tree-order-fixture'",
  );
  const adoption = db
    .prepare("SELECT id FROM adoptions WHERE order_id='tree-order-fixture'")
    .get() as any;
  db.prepare(
    `INSERT INTO shipments(id,source,source_id,product_id,qty,recipient,phone,province_code,city_code,
    district_code,region_label,address,status) VALUES('refund-shipment','adoption',?,'FAMILY',1,?,?,?,?,?,?,?,'awaiting_payment')`,
  ).run(
    String(adoption.id),
    address.recipient,
    address.phone,
    address.province_code,
    address.city_code,
    address.district_code,
    '北京市 / 北京市 / 东城区',
    address.address,
  );
  db.prepare(
    `INSERT INTO orders(id,order_no,type,phone,amount,remote_fee,original_amount,expires_at,
    shipment_id,stripe_payment_intent,stripe_session_id) VALUES(?,?,'shipping','13800000000',?,?,?,datetime('now','+30 minutes'),?,?,?)`,
  ).run(
    orderId,
    'DF-LOCAL-SHIPPING',
    amount,
    amount,
    amount,
    'refund-shipment',
    paymentIntent,
    'cs_refund_fixture',
  );
  db.prepare("UPDATE orders SET status='paid',paid_at=CURRENT_TIMESTAMP WHERE id=?").run(orderId);
  db.exec("UPDATE shipments SET status='reserved' WHERE id='refund-shipment'");
  return { env: testEnv(DB), db, amount, adoptionId: adoption.id as number };
}
async function call(env: Env, route: string, body: unknown, origin = 'http://localhost:4321') {
  const response = await api(
    new Request('http://localhost:4321/api' + route, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'cf-access-authenticated-user-email': 'owner@example.com',
      },
      body: JSON.stringify(body),
    }),
    env,
  );
  return {
    status: response.status,
    data: (await response.json()) as any,
    headers: response.headers,
  };
}
const draft = (amount = 1296) => ({
  order_id: orderId,
  request_id: crypto.randomUUID(),
  amount_cents: amount,
  reason: 'requested_by_customer',
  note: '本地退款夹具',
  confirmed: true,
});
const preview = (env: Env) => call(env, '/admin/refunds/preview', { order_id: orderId });
const create = (env: Env, body: unknown) => call(env, '/admin/refunds/create', body);
const stock = (db: DatabaseSync) =>
  (db.prepare("SELECT stock FROM products WHERE sku='FAMILY'").get() as any).stock;
const orderStatus = (db: DatabaseSync) =>
  (db.prepare('SELECT status FROM orders WHERE id=?').get(orderId) as any).status;
const shipmentStatus = (db: DatabaseSync) =>
  (db.prepare("SELECT status FROM shipments WHERE id='refund-shipment'").get() as any).status;

function stripeMock(amount: number) {
  const state = {
    amount,
    refunded: 0,
    status: 'succeeded' as RefundStatus,
    forbidden: false,
    transportFailure: false,
    reads: 0,
    posts: [] as { amount: number; key: string; body: URLSearchParams }[],
    refunds: [] as any[],
    paymentPatch: {} as Record<string, unknown>,
    chargePatch: {} as Record<string, unknown>,
    beforePost: null as null | (() => Promise<void>),
  };
  const listedRefunds = () =>
    state.refunds.length
      ? state.refunds
      : state.refunded > 0
        ? [
            {
              id: 're_external_completed_fixture',
              object: 'refund',
              amount: state.refunded,
              currency: 'cny',
              payment_intent: paymentIntent,
              charge: chargeId,
              status: 'succeeded',
              metadata: {},
              created: Math.floor(Date.now() / 1000),
            },
          ]
        : [];
  const charge = () => ({
    id: chargeId,
    object: 'charge',
    livemode: false,
    currency: 'cny',
    amount: state.amount,
    amount_captured: state.amount,
    amount_refunded: state.refunded,
    paid: true,
    captured: true,
    refunded: state.refunded === state.amount,
    disputed: false,
    payment_intent: paymentIntent,
    metadata: { project: 'orchard-shop', order_id: orderId },
    refunds: { object: 'list', data: listedRefunds(), has_more: false, url: '/v1/refunds' },
    ...state.chargePatch,
  });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        'content-type': 'application/json',
        'request-id': 'req_local_refund_fixture',
        'stripe-should-retry': 'false',
      },
    });
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init),
      url = new URL(request.url);
    assert.equal(url.hostname, 'api.stripe.com', 'Tests may never contact another service');
    assert.equal(
      request.headers.get('authorization'),
      'Bearer ' + fixtureKey,
      'Refunds must prefer their dedicated key',
    );
    if (state.forbidden)
      return json(
        {
          error: {
            type: 'invalid_request_error',
            code: 'permission_missing',
            message: 'Local fixture permission denied',
          },
        },
        403,
      );
    if (request.method === 'GET') {
      state.reads++;
      if (url.pathname === '/v1/payment_intents/' + paymentIntent)
        return json({
          id: paymentIntent,
          object: 'payment_intent',
          livemode: false,
          status: 'succeeded',
          currency: 'cny',
          amount: state.amount,
          amount_received: state.amount,
          metadata: { project: 'orchard-shop', order_id: orderId },
          latest_charge: charge(),
          ...state.paymentPatch,
        });
      if (url.pathname === '/v1/charges/' + chargeId) return json(charge());
      if (url.pathname === '/v1/refunds')
        return json({ object: 'list', data: listedRefunds(), has_more: false, url: '/v1/refunds' });
      const found = state.refunds.find((r) => url.pathname === '/v1/refunds/' + r.id);
      if (found) return json(found);
      assert.fail('Unexpected Stripe read ' + url.pathname);
    }
    assert.equal(request.method, 'POST');
    assert.equal(url.pathname, '/v1/refunds', 'No payment or live account writes are allowed');
    const body = new URLSearchParams(await request.text()),
      key = request.headers.get('idempotency-key') || '';
    assert(key, 'Every refund write needs a stable idempotency key');
    assert.equal(body.get('payment_intent'), paymentIntent);
    assert.equal(body.get('metadata[project]'), 'orchard-shop');
    assert.equal(body.get('metadata[order_id]'), orderId);
    assert(body.get('metadata[refund_request_id]'));
    const cents = Number(body.get('amount'));
    assert(Number.isSafeInteger(cents) && cents > 0);
    state.posts.push({ amount: cents, key, body });
    if (state.beforePost) await state.beforePost();
    if (state.transportFailure) throw new TypeError('Local fixture transport timeout');
    const reused = state.refunds.find((r) => r._key === key);
    if (reused) return json(reused);
    if (cents > state.amount - state.refunded)
      return json(
        {
          error: {
            type: 'invalid_request_error',
            code: 'charge_already_refunded',
            message: 'Local fixture insufficient refundable amount',
          },
        },
        400,
      );
    const result = {
      id: 're_local_' + (state.refunds.length + 1),
      object: 'refund',
      amount: cents,
      currency: 'cny',
      charge: chargeId,
      payment_intent: paymentIntent,
      reason: body.get('reason'),
      status: state.status,
      created: Math.floor(Date.now() / 1000),
      metadata: {
        project: 'orchard-shop',
        order_id: orderId,
        refund_request_id: body.get('metadata[refund_request_id]'),
      },
      failure_reason: state.status === 'failed' ? 'declined' : null,
      _key: key,
    };
    state.refunds.push(result);
    if (!['failed', 'canceled'].includes(result.status)) state.refunded += cents;
    return json(result);
  };
  return { state, fetcher, charge };
}
async function mocked<T>(amount: number, run: (mock: ReturnType<typeof stripeMock>) => Promise<T>) {
  const mock = stripeMock(amount),
    original = globalThis.fetch;
  globalThis.fetch = mock.fetcher;
  try {
    return await run(mock);
  } finally {
    globalThis.fetch = original;
  }
}
const stripe = new Stripe('rk_test_signing_fixture', {
  apiVersion: '2026-09-30.endive',
  httpClient: Stripe.createFetchHttpClient(),
});
async function hook(env: Env, event: any) {
  const payload = JSON.stringify({
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    ...event,
  });
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: env.STRIPE_WEBHOOK_SECRET!,
  });
  const response = await api(
    new Request('http://localhost:4321/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: payload,
    }),
    env,
  );
  return { status: response.status, data: (await response.json()) as any };
}

test('refund preview uses actual discounted payment and Dashboard refunds without reserving money or exposing customer data', async () => {
  const { env, amount } = setup(true);
  await mocked(amount, async ({ state }) => {
    state.refunded = 1000;
    state.refunds.push({
      id: 're_dashboard',
      object: 'refund',
      amount: 1000,
      currency: 'cny',
      payment_intent: paymentIntent,
      charge: chargeId,
      status: 'succeeded',
      created: Math.floor(Date.now() / 1000),
      metadata: {},
    });
    const r = await preview(env);
    assert.equal(r.status, 200);
    assert.equal(r.data.paid_amount, 9504);
    assert.equal(r.data.refunded_amount, 1000);
    assert.equal(r.data.available_amount, 8504);
    assert.equal(r.data.pending_amount, 0);
    assert.equal(r.data.can_refund, true);
    assert.equal(state.posts.length, 0);
    assert(
      !/13800000000|本地退款夹具|address_json|pin_hash|Bearer|rk_test/.test(JSON.stringify(r.data)),
    );
    assert.match(r.headers.get('cache-control')!, /no-store/);
    assert.match(r.headers.get('x-robots-tag')!, /noindex/);
  });
});

test('refund amount validation rejects fractional cents, zero, unconfirmed submissions and amounts beyond actual remaining payment', async () => {
  const { env, amount } = setup(true);
  await mocked(amount, async ({ state }) => {
    for (const change of [
      { amount_cents: 0 },
      { amount_cents: -1 },
      { amount_cents: 1.5 },
      { amount_cents: '100' },
      { confirmed: false },
      { reason: 'invalid' },
    ])
      assert.equal((await create(env, { ...draft(), ...change })).status, 400);
    assert.equal((await create(env, draft(9505))).status, 409);
    assert.equal(state.posts.length, 0);
  });
});

test('same refund request is idempotent and changing its immutable financial terms is rejected', async () => {
  const { env, amount, db } = setup();
  await mocked(amount, async ({ state }) => {
    const request = draft(1296),
      first = await create(env, request);
    assert.equal(first.status, 200);
    assert.equal(first.data.summary.refunded_amount, 1296);
    assert.equal(first.data.summary.available_amount, 9504);
    const second = await create(env, request);
    assert.equal(second.status, 200);
    assert.equal(state.posts.length, 1);
    assert.equal((await create(env, { ...request, amount_cents: 1297 })).status, 409);
    assert.equal(state.posts.length, 1);
    assert.equal(orderStatus(db), 'paid');
    assert.equal(stock(db), 99);
    assert.equal(shipmentStatus(db), 'reserved');
  });
});

test('different concurrent requests cannot create two refunds while the first result is still in flight', async () => {
  const { env, amount } = setup();
  await mocked(amount, async ({ state }) => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.beforePost = async () => {
      entered();
      await blocked;
    };
    const first = create(env, draft(1000));
    await Promise.race([
      started,
      first.then((r) => assert.fail(`First refund never reached Stripe: ${r.status}`)),
    ]);
    try {
      const second = await create(env, draft(1000));
      assert.equal(second.status, 409);
    } finally {
      release();
    }
    assert.equal((await first).status, 200);
    assert.equal(state.posts.length, 1);
  });
});

test('an unknown network result blocks a new request and only the original UUID can safely recover', async () => {
  const { env, amount, db } = setup();
  await mocked(amount, async ({ state }) => {
    state.transportFailure = true;
    const request = draft(1000),
      first = await create(env, request);
    assert(first.status >= 200);
    assert.equal(state.refunds.length, 0);
    assert.equal((await create(env, draft(1000))).status, 409);
    const writesBefore = state.posts.length;
    state.transportFailure = false;
    assert.equal((await create(env, request)).status, 200);
    assert.equal(state.refunds.length, 1);
    assert.equal(new Set(state.posts.map((p) => p.key)).size, 1);
    assert(state.posts.length > writesBefore);
    assert.equal(orderStatus(db), 'paid');
    assert.equal(stock(db), 99);
  });
});

test('pending refund retains its allocation, failed refund releases it, and sync never creates a refund', async () => {
  const { env, amount } = setup();
  await mocked(amount, async ({ state }) => {
    state.status = 'pending';
    const r = await create(env, draft(1000));
    assert.equal(r.status, 200);
    assert.equal(r.data.summary.pending_amount, 1000);
    assert.equal(r.data.summary.available_amount, 9800);
    assert.equal(r.data.summary.can_refund, false);
    assert.equal((await create(env, draft(1000))).status, 409);
    state.refunds[0].status = 'failed';
    state.refunds[0].failure_reason = 'declined';
    state.refunded = 0;
    const sync = await call(env, '/admin/refunds/sync', { order_id: orderId });
    assert.equal(sync.status, 200);
    assert.equal(sync.data.pending_amount, 0);
    assert.equal(sync.data.available_amount, 10800);
    assert.equal(sync.data.can_refund, true);
    assert.equal(sync.data.refunds[0].status, 'failed');
    assert.equal(state.posts.length, 1);
  });
});

test('a refund accepted by Stripe but not yet stored locally recovers by its original request without issuing money twice', async () => {
  const { env, amount, db } = setup();
  await mocked(amount, async ({ state }) => {
    db.exec(
      "CREATE TRIGGER local_refund_receipt_failure BEFORE UPDATE OF status ON admin_refund_requests WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'local fixture persistence failure'); END",
    );
    const request = draft(1000);
    assert.equal((await create(env, request)).status, 503);
    assert.equal(state.refunds.length, 1);
    assert.equal(state.posts.length, 1);
    assert.equal(orderStatus(db), 'paid');
    assert.equal(stock(db), 99);
    db.exec('DROP TRIGGER local_refund_receipt_failure');
    const recovered = await create(env, request);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.data.summary.refunds[0].status, 'succeeded');
    assert.equal(recovered.data.summary.refunded_amount, 1000);
    assert.equal(state.posts.length, 1);
  });
});

test('an unresolved request older than Stripe idempotency retention is read-only and cannot initiate a second refund', async () => {
  const { env, amount, db } = setup();
  await mocked(amount, async ({ state }) => {
    const request = draft(1000);
    db.prepare(
      `INSERT INTO admin_refund_requests(request_id,order_id,actor,amount,reason,note,status,created_at,updated_at)
      VALUES(?,?,'local-demo',1000,'requested_by_customer',?,'unknown',datetime('now','-2 days'),datetime('now','-2 days'))`,
    ).run(request.request_id, orderId, request.note);
    const result = await create(env, request);
    assert.equal(result.status, 409);
    assert.equal(state.posts.length, 0);
    assert.equal(orderStatus(db), 'paid');
    assert.equal(stock(db), 99);
  });
});

test('an older pending refund webhook retrieves the current status instead of regressing a completed refund', async () => {
  const { env, amount } = setup();
  await mocked(amount, async ({ state }) => {
    state.status = 'pending';
    assert.equal((await create(env, draft(1000))).status, 200);
    const older = { ...state.refunds[0], status: 'pending' };
    state.refunds[0].status = 'succeeded';
    assert.equal(
      (
        await hook(env, {
          id: 'evt_refund_update_fixture',
          type: 'refund.updated',
          data: { object: older },
        })
      ).status,
      200,
    );
    const result = await preview(env);
    assert.equal(result.status, 200);
    assert.equal(result.data.refunds[0].status, 'succeeded');
    assert.equal(result.data.refunded_amount, 1000);
    assert.equal(result.data.pending_amount, 0);
    assert.equal(state.posts.length, 1);
  });
});

test('missing or insufficient Stripe permissions show a blocked state instead of falsely reporting a refund', async () => {
  const { env, amount } = setup();
  await mocked(amount, async ({ state }) => {
    state.forbidden = true;
    const r = await preview(env);
    assert.equal(r.status, 200);
    assert.equal(r.data.can_refund, false);
    assert(r.data.blocked_reason);
    const created = await create(env, draft());
    assert.notEqual(created.status, 200);
    assert.equal(state.posts.length, 0);
  });
});

test('wrong currency, environment, project, captured amount or disputed payment cannot be refunded', async () => {
  for (const patch of [
    { paymentPatch: { currency: 'usd' } },
    { paymentPatch: { livemode: true } },
    { paymentPatch: { metadata: { project: 'another-project', order_id: orderId } } },
    { paymentPatch: { amount_received: 1 } },
    { chargePatch: { disputed: true } },
  ]) {
    const { env, amount } = setup();
    await mocked(amount, async ({ state }) => {
      Object.assign(state, patch);
      const r = await preview(env);
      assert(r.status !== 200 || !r.data.can_refund);
      assert.notEqual((await create(env, draft())).status, 200);
      assert.equal(state.posts.length, 0);
    });
  }
});

test('refund management rejects spoofed identities and cross-origin submissions before Stripe or database access', async () => {
  const { env, amount } = setup();
  await mocked(amount, async ({ state }) => {
    const protectedEnv = {
      ...env,
      DEMO_MODE: 'false',
      ACCESS_TEAM_DOMAIN: 'local-refund-access.cloudflareaccess.com',
      ACCESS_AUD: 'local-only',
      ADMIN_EMAIL: 'owner@example.com',
      DB: {
        prepare() {
          throw Error('must not read');
        },
      },
    } as unknown as Env;
    for (const path of ['/admin/refunds/preview', '/admin/refunds/sync', '/admin/refunds/create']) {
      assert.equal((await call(protectedEnv, path, draft())).status, 401);
      assert.equal((await call(env, path, draft(), 'https://evil.example')).status, 403);
    }
    assert.equal(state.posts.length, 0);
    assert.equal(state.reads, 0);
  });
});

test('refund API success changes no fulfillment until a signed full-refund callback; duplicate callbacks return stock only once', async () => {
  const { env, amount, db } = setup(true);
  await mocked(amount, async (mock) => {
    assert.equal((await create(env, draft(amount))).status, 200);
    assert.equal(orderStatus(db), 'paid');
    assert.equal(stock(db), 99);
    assert.equal(shipmentStatus(db), 'reserved');
    const event = {
      id: 'evt_refund_full_fixture',
      type: 'charge.refunded',
      data: { object: mock.charge() },
    };
    assert.equal((await hook(env, event)).status, 200);
    assert.equal(orderStatus(db), 'refunded');
    assert.equal(stock(db), 100);
    assert.equal(shipmentStatus(db), 'cancelled');
    assert.equal((await hook(env, event)).status, 200);
    assert.equal(
      (await hook(env, { ...event, id: 'evt_refund_full_duplicate_fixture' })).status,
      200,
    );
    assert.equal(stock(db), 100);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM coupon_uses WHERE coupon_id='refund-coupon' AND redeemed_at IS NOT NULL",
          )
          .get() as any
      ).n,
      1,
    );
  });
});

test('partial callbacks retain shipments and city quantities, while a shipped full refund never restores stock or destroys shipping evidence', async () => {
  const { env, amount, db } = setup();
  await mocked(amount, async (mock) => {
    mock.state.refunded = 1000;
    assert.equal(
      (
        await hook(env, {
          id: 'evt_refund_partial_fixture',
          type: 'charge.refunded',
          data: { object: mock.charge() },
        })
      ).status,
      200,
    );
    assert.equal(orderStatus(db), 'paid');
    assert.equal(stock(db), 99);
    assert.equal(shipmentStatus(db), 'reserved');
    db.exec(
      "UPDATE shipments SET status='shipped',tracking_no='SFLOCAL12345678',shipped_at=CURRENT_TIMESTAMP WHERE id='refund-shipment'; UPDATE orders SET status='shipped' WHERE id='refund-order-fixture'",
    );
    mock.state.refunded = amount;
    assert.equal(
      (
        await hook(env, {
          id: 'evt_refund_shipped_fixture',
          type: 'charge.refunded',
          data: { object: mock.charge() },
        })
      ).status,
      200,
    );
    assert.equal(orderStatus(db), 'refunded');
    assert.equal(stock(db), 99);
    assert.equal(shipmentStatus(db), 'shipped');
    assert.equal(
      (db.prepare("SELECT tracking_no FROM shipments WHERE id='refund-shipment'").get() as any)
        .tracking_no,
      'SFLOCAL12345678',
    );
  });
});

test('a successful shipping-refund update cancels its exact unshipped adoption booking and preserves the main adoption payment', async () => {
  const { env, db, amount, adoptionId } = setupShipping();
  await mocked(amount, async ({ state }) => {
    state.status = 'pending';
    const submitted = await create(env, draft(amount));
    assert.equal(submitted.status, 200);
    assert.equal(orderStatus(db), 'paid');
    assert.equal(shipmentStatus(db), 'reserved');
    assert.equal(
      (db.prepare('SELECT used_boxes FROM adoptions WHERE id=?').get(adoptionId) as any).used_boxes,
      1,
    );
    state.refunds[0].status = 'succeeded';
    const event = {
      id: 'evt_shipping_refund_succeeded_fixture',
      type: 'refund.updated',
      data: { object: { ...state.refunds[0] } },
    };
    assert.equal((await hook(env, event)).status, 200);
    assert.equal(orderStatus(db), 'refunded');
    assert.equal(shipmentStatus(db), 'cancelled');
    assert.equal(
      (db.prepare('SELECT used_boxes FROM adoptions WHERE id=?').get(adoptionId) as any).used_boxes,
      0,
    );
    assert.equal(
      (db.prepare("SELECT status FROM orders WHERE id='tree-order-fixture'").get() as any).status,
      'paid',
    );
    assert.equal((db.prepare("SELECT stock FROM products WHERE sku='PA'").get() as any).stock, 99);
    assert.equal(stock(db), 100);
    assert.equal(
      (await hook(env, { ...event, id: 'evt_shipping_refund_duplicate_fixture' })).status,
      200,
    );
    assert.equal(
      (db.prepare('SELECT used_boxes FROM adoptions WHERE id=?').get(adoptionId) as any).used_boxes,
      0,
    );
    assert.equal(state.posts.length, 1);
  });
});

test('a Dashboard refund without a local request leaves pending fulfillment intact and finalizes only when the later refund update succeeds', async () => {
  const { env, db, amount } = setup();
  await mocked(amount, async (mock) => {
    const external = {
      id: 're_dashboard_full_fixture',
      object: 'refund',
      amount,
      currency: 'cny',
      payment_intent: paymentIntent,
      charge: chargeId,
      status: 'pending',
      created: Math.floor(Date.now() / 1000),
      metadata: {},
    };
    mock.state.refunds.push(external);
    mock.state.refunded = amount;
    assert.equal(
      (
        await hook(env, {
          id: 'evt_dashboard_pending_charge_fixture',
          type: 'charge.refunded',
          data: { object: mock.charge() },
        })
      ).status,
      200,
    );
    assert.equal(orderStatus(db), 'paid');
    assert.equal(shipmentStatus(db), 'reserved');
    assert.equal(stock(db), 99);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM admin_refund_requests').get() as any).n, 0);
    external.status = 'succeeded';
    const event = {
      id: 'evt_dashboard_refund_completed_fixture',
      type: 'refund.updated',
      data: { object: { ...external } },
    };
    assert.equal((await hook(env, event)).status, 200);
    assert.equal(orderStatus(db), 'refunded');
    assert.equal(shipmentStatus(db), 'cancelled');
    assert.equal(stock(db), 100);
    assert.equal(
      (await hook(env, { ...event, id: 'evt_dashboard_refund_repeat_fixture' })).status,
      200,
    );
    assert.equal(stock(db), 100);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM admin_refund_requests').get() as any).n, 0);
    assert.equal(mock.state.posts.length, 0);
  });
});

test('a stale successful charge snapshot cannot finalize a refund that currently failed at Stripe', async () => {
  const { env, db, amount } = setup();
  await mocked(amount, async (mock) => {
    mock.state.refunds.push({
      id: 're_dashboard_stale_fixture',
      object: 'refund',
      amount,
      currency: 'cny',
      payment_intent: paymentIntent,
      charge: chargeId,
      status: 'succeeded',
      created: Math.floor(Date.now() / 1000),
      metadata: {},
    });
    mock.state.refunded = amount;
    const staleCharge = JSON.parse(JSON.stringify(mock.charge()));
    mock.state.refunds[0].status = 'failed';
    mock.state.refunds[0].failure_reason = 'declined';
    mock.state.refunded = 0;
    assert.equal(
      (
        await hook(env, {
          id: 'evt_stale_successful_charge_fixture',
          type: 'charge.refunded',
          data: { object: staleCharge },
        })
      ).status,
      200,
    );
    assert(mock.state.reads > 0, 'The current Stripe payment/refunds must be checked');
    assert.equal(orderStatus(db), 'paid');
    assert.equal(shipmentStatus(db), 'reserved');
    assert.equal(stock(db), 99);
    assert.equal(mock.state.posts.length, 0);
  });
});

test('a second admin window cannot mark a parcel shipped while its refund is pending, and a confirmed failure releases that guard', async () => {
  const { env, db, amount } = setup();
  await mocked(amount, async ({ state }) => {
    state.status = 'pending';
    assert.equal((await create(env, draft(1000))).status, 200);
    const shipping = { id: 'refund-shipment', tracking_no: 'SFLOCAL12345678' };
    const blocked = await call(env, '/admin/ship', shipping);
    assert.equal(blocked.status, 409);
    assert.equal(shipmentStatus(db), 'reserved');
    assert.equal(orderStatus(db), 'paid');
    assert.equal(stock(db), 99);
    assert.equal(
      (db.prepare("SELECT tracking_no FROM shipments WHERE id='refund-shipment'").get() as any)
        .tracking_no,
      null,
    );
    state.refunds[0].status = 'failed';
    state.refunded = 0;
    assert.equal((await call(env, '/admin/refunds/sync', { order_id: orderId })).status, 200);
    assert.equal((await call(env, '/admin/ship', shipping)).status, 200);
    assert.equal(shipmentStatus(db), 'shipped');
    assert.equal(orderStatus(db), 'shipped');
    assert.equal(state.posts.length, 1);
  });
});

test('an open adoption shipping checkout blocks a parent refund and database races cannot add fees after reversal starts', async () => {
  const { env, db } = setupShipping(),
    parentId = 'tree-order-fixture';
  db.prepare("UPDATE orders SET status='pending',stripe_payment_intent=NULL WHERE id=?").run(
    orderId,
  );
  db.prepare('UPDATE orders SET stripe_payment_intent=? WHERE id=?').run(paymentIntent, parentId);
  db.exec("UPDATE shipments SET status='awaiting_payment' WHERE id='refund-shipment'");
  await mocked(88800, async ({ state }) => {
    state.paymentPatch = { metadata: { project: 'orchard-shop', order_id: parentId } };
    const checked = await call(env, '/admin/refunds/preview', { order_id: parentId });
    assert.equal(checked.status, 200);
    assert.equal(checked.data.can_refund, false);
    assert.match(checked.data.blocked_reason, /补运费|运费|付款/);
    const request = { ...draft(88800), order_id: parentId };
    assert.equal((await create(env, request)).status, 409);
    const insertRefund =
      db.prepare(`INSERT INTO admin_refund_requests(request_id,order_id,actor,amount,reason,note,status)
      VALUES(?,?,'local-demo',88800,'requested_by_customer','local guard fixture','pending')`);
    assert.throws(() => insertRefund.run(request.request_id, parentId), /refund_shipping_pending/);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM admin_refund_requests').get() as any).n, 0);
    assert.equal(
      (db.prepare('SELECT status FROM orders WHERE id=?').get(parentId) as any).status,
      'paid',
    );
    db.prepare("UPDATE orders SET status='expired' WHERE id=?").run(orderId);
    insertRefund.run(request.request_id, parentId);
    const insertFee =
      db.prepare(`INSERT INTO orders(id,order_no,type,phone,amount,expires_at,shipment_id)
      VALUES(?,?,'shipping','13800000000',2000,datetime('now','+30 minutes'),'refund-shipment')`);
    assert.throws(
      () => insertFee.run('fee-during-refund', 'DF-FEE-REFUND-PENDING'),
      /refund_in_progress/,
    );
    db.prepare("UPDATE admin_refund_requests SET status='failed' WHERE request_id=?").run(
      request.request_id,
    );
    db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(parentId);
    assert.throws(
      () => insertFee.run('fee-after-refund', 'DF-FEE-PARENT-REFUNDED'),
      /refund_in_progress/,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM orders WHERE id IN ('fee-during-refund','fee-after-refund')",
          )
          .get() as any
      ).n,
      0,
    );
    assert.equal(state.posts.length, 0);
  });
});

test('refund result outbox waits for verified callbacks, deduplicates and follows later bank failure', async () => {
  const { env, amount, db } = setup();
  const count = () => (db.prepare('SELECT COUNT(*) n FROM refund_notifications').get() as any).n;
  await mocked(amount, async ({ state }) => {
    assert.equal((await create(env, draft(1000))).status, 200);
    assert.equal((await preview(env)).status, 200);
    assert.equal(count(), 0, 'API receipt and sync are not verified result notifications');
    const event = {
      id: 'evt_notification_fixture',
      type: 'refund.created',
      data: { object: { ...state.refunds[0] } },
    };
    const invalid = await api(
      new Request('http://localhost:4321/api/stripe/webhook', {
        method: 'POST',
        body: JSON.stringify(event),
        headers: { 'stripe-signature': 'invalid' },
      }),
      env,
    );
    assert.equal(invalid.status, 400);
    assert.equal(count(), 0);
    assert.equal((await hook(env, event)).status, 200);
    assert.equal((await hook(env, event)).status, 200);
    assert.equal(
      (await hook(env, { ...event, id: 'evt_notification_duplicate_fixture' })).status,
      200,
    );
    assert.equal(count(), 1);
    const payload = (db.prepare('SELECT payload FROM refund_notifications').get() as any).payload;
    assert.doesNotMatch(
      payload,
      /13800000000|本地退款夹具|001号|note|metadata|pin|address|phone|recipient/,
    );
    state.refunds[0].status = 'failed';
    state.refunded = 0;
    const failed = {
      id: 'evt_notification_failure_fixture',
      type: 'refund.failed',
      data: { object: { ...state.refunds[0] }, previous_attributes: { status: 'succeeded' } },
    };
    assert.equal((await hook(env, failed)).status, 200);
    assert.equal(count(), 2);
    assert.ok(
      (
        db
          .prepare("SELECT superseded_at FROM refund_notifications WHERE status='succeeded'")
          .get() as any
      ).superseded_at,
    );
    assert.equal(
      (await hook(env, { ...event, id: 'evt_notification_old_success_fixture' })).status,
      200,
    );
    assert.equal(count(), 2);
    assert.equal(orderStatus(db), 'paid');
    assert.equal(shipmentStatus(db), 'reserved');
  });
});

test('old terminal metadata edits do not announce historical refunds; a new genuine status transition does', async () => {
  const { env, amount, db } = setup();
  const cutoff = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE settings SET value=? WHERE key='refund_notifications_start'").run(
    String(cutoff),
  );
  await mocked(amount, async ({ state }) => {
    state.refunded = 1000;
    const external = {
      id: 're_historical_notification_fixture',
      object: 'refund',
      amount: 1000,
      currency: 'cny',
      payment_intent: paymentIntent,
      charge: chargeId,
      status: 'succeeded',
      created: cutoff - 100,
      metadata: {},
    };
    state.refunds.push(external);
    const metadataUpdate = {
      id: 'evt_old_metadata_fixture',
      type: 'refund.updated',
      created: cutoff + 1,
      data: { object: external, previous_attributes: { metadata: {} } },
    };
    assert.equal((await hook(env, metadataUpdate)).status, 200);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM refund_notifications').get() as any).n, 0);
    const transition = {
      ...metadataUpdate,
      id: 'evt_new_terminal_transition_fixture',
      data: { object: external, previous_attributes: { status: 'pending' } },
    };
    assert.equal((await hook(env, transition)).status, 200);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM refund_notifications').get() as any).n, 1);
    assert.equal(state.posts.length, 0);
  });
});

test('refund notification persistence failure keeps the webhook retryable without repeating refund or stock release', async () => {
  const { env, amount, db } = setup();
  await mocked(amount, async ({ state }) => {
    assert.equal((await create(env, draft(amount))).status, 200);
    db.exec(
      "CREATE TRIGGER local_notification_failure BEFORE INSERT ON refund_notifications BEGIN SELECT RAISE(ABORT,'local notification persistence failure'); END",
    );
    const event = {
      id: 'evt_retry_notification_fixture',
      type: 'refund.created',
      data: { object: state.refunds[0] },
    };
    assert.ok((await hook(env, event)).status >= 500);
    assert.equal(
      (db.prepare('SELECT COUNT(*) n FROM webhook_events WHERE id=?').get(event.id) as any).n,
      0,
    );
    assert.equal(stock(db), 100);
    db.exec('DROP TRIGGER local_notification_failure');
    assert.equal((await hook(env, event)).status, 200);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM refund_notifications').get() as any).n, 1);
    assert.equal(stock(db), 100);
    assert.equal(state.posts.length, 1);
  });
});

test('refund result notifications reject other project events and a failed refund from the wrong payment environment', async () => {
  const { env, amount, db } = setup();
  await mocked(amount, async ({ state }) => {
    state.status = 'failed';
    assert.equal((await create(env, draft(1000))).status, 200);
    const event = {
      id: 'evt_foreign_refund_notification_fixture',
      type: 'refund.failed',
      data: {
        object: { ...state.refunds[0], metadata: { project: 'another-project' } },
      },
    };
    assert.equal((await hook(env, event)).status, 200);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM refund_notifications').get() as any).n, 0);
    state.paymentPatch = { livemode: true };
    assert.notEqual(
      (
        await hook(env, {
          ...event,
          id: 'evt_wrong_environment_refund_fixture',
          data: { object: state.refunds[0] },
        })
      ).status,
      200,
    );
    assert.equal((db.prepare('SELECT COUNT(*) n FROM refund_notifications').get() as any).n, 0);
    assert.equal(orderStatus(db), 'paid');
  });
});

test('a disputed charge can report a verified refund failure while new refund creation stays blocked', async () => {
  const { env, amount, db } = setup();
  await mocked(amount, async ({ state }) => {
    state.status = 'pending';
    assert.equal((await create(env, draft(1000))).status, 200);
    state.refunds[0].status = 'failed';
    state.refunds[0].failure_reason = 'charge_for_pending_refund_disputed';
    state.refunded = 0;
    state.chargePatch = { disputed: true };
    assert.equal(
      (
        await hook(env, {
          id: 'evt_disputed_failed_refund_fixture',
          type: 'refund.failed',
          data: { object: state.refunds[0] },
        })
      ).status,
      200,
    );
    assert.equal(
      (db.prepare('SELECT status FROM admin_refund_requests').get() as any).status,
      'failed',
    );
    assert.equal(
      (db.prepare('SELECT status FROM refund_notifications').get() as any).status,
      'failed',
    );
    assert.notEqual((await create(env, draft(1000))).status, 200);
    assert.equal(state.posts.length, 1);
    assert.equal(orderStatus(db), 'paid');
    assert.equal(stock(db), 99);
  });
});

test('a Dashboard refund that precedes payment synchronization retries instead of losing its result notification', async () => {
  const { env, amount, db } = setup();
  await mocked(amount, async ({ state }) => {
    assert.equal((await create(env, draft(1000))).status, 200);
    db.prepare('UPDATE orders SET stripe_payment_intent=NULL WHERE id=?').run(orderId);
    const event = {
      id: 'evt_early_dashboard_refund_fixture',
      type: 'refund.created',
      data: { object: { ...state.refunds[0], metadata: {} } },
    };
    assert.equal((await hook(env, event)).status, 409);
    assert.equal(
      (db.prepare('SELECT COUNT(*) n FROM webhook_events WHERE id=?').get(event.id) as any).n,
      0,
    );
    assert.equal((db.prepare('SELECT COUNT(*) n FROM refund_notifications').get() as any).n, 0);
    db.prepare('UPDATE orders SET stripe_payment_intent=? WHERE id=?').run(paymentIntent, orderId);
    assert.equal((await hook(env, event)).status, 200);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM refund_notifications').get() as any).n, 1);
    assert.equal(state.posts.length, 1);
  });
});
