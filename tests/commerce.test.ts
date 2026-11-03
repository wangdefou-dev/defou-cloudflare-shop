import { SEASON_END } from '../src/lib/shared';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { api } from '../src/lib/api';
import { confirmedRefundFixture } from './refund-stripe-fixture';
import { maintenance, MAP_CACHE_KEY } from '../src/lib/database';
import { chinaDate, csvCell } from '../src/lib/shared';
import { human, isDemo, isSandbox, verifyPin } from '../src/lib/security';
import { createSession, stripe } from '../src/lib/payments';
class LocalD1 {
  db = new DatabaseSync(':memory:');
  constructor() {
    for (const f of fs
      .readdirSync('migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      this.db.exec(fs.readFileSync('migrations/' + f, 'utf8'));
    this.db.exec(fs.readFileSync('scripts/seed.sql', 'utf8'));
    this.db.exec(fs.readFileSync('scripts/demo-stock.sql', 'utf8'));
    this.db.exec(fs.readFileSync('scripts/regions.sql', 'utf8'));
  }
  prepare(sql: string) {
    const db = this.db;
    let args: any[] = [];
    const result: any = {
      bind(...v: any[]) {
        args = v;
        return result;
      },
      async first() {
        return db.prepare(sql).get(...args) || null;
      },
      async all() {
        return { results: db.prepare(sql).all(...args), success: true };
      },
      async run() {
        const r = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(r.changes) } };
      },
    };
    return result;
  }
  async batch(statements: any[]) {
    this.db.exec('BEGIN');
    try {
      const values = [];
      for (const s of statements) values.push(await s.run());
      this.db.exec('COMMIT');
      return values;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
function setup() {
  const DB = new LocalD1(),
    map = new Map();
  const env: any = {
    DB,
    DEMO_MODE: 'true',
    APP_ORIGIN: 'http://localhost:4321',
    CACHE: {
      put: async (k: string, v: any) => {
        map.set(k, v);
      },
      get: async (k: string) => (map.has(k) ? JSON.parse(map.get(k)) : null),
    },
  };
  return { env, db: DB.db };
}
async function call(env: any, path: string, body?: any, opts: any = {}) {
  const req = new Request((opts.origin || 'http://localhost:4321') + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin: opts.origin || 'http://localhost:4321',
      'content-type': 'application/json',
      ...opts.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await api(req, env);
  return {
    status: response.status,
    headers: response.headers,
    data: (await response.json()) as any,
  };
}
const addr = {
  recipient: '本地测试',
  phone: '13800000000',
  province_code: '110000',
  city_code: '110100',
  district_code: '110101',
  province: '北京市',
  city: '北京市',
  district: '东城区',
  address: '本地测试地址001号',
  card_message: '秋天快乐',
  sender: '测试',
};
const retail = (extra: any = {}) => ({
  type: 'retail',
  sku: 'FAMILY',
  qty: 1,
  phone: addr.phone,
  address: addr,
  invoice: { type: 'none' },
  agreed: true,
  ...extra,
});
test('WeChat checkout is blocked before reserving stock or creating orders and unknown payment methods are rejected', async () => {
  const { env, db } = setup();
  const before = db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get();
  const blocked = await call(env, '/checkout', retail({ payment_method: 'alipay' }), {
    headers: { 'user-agent': 'iPhone Mobile MicroMessenger/8.0' },
  });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /在浏览器打开后付款/);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM orders').get() as any).n, 0);
  assert.deepEqual(db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get(), before);
  assert.equal(
    (await call(env, '/checkout', retail({ payment_method: 'wechat_pay' }))).status,
    400,
  );
  assert.equal((db.prepare('SELECT COUNT(*) n FROM orders').get() as any).n, 0);
});
test('admin order detail reveals pending recipient only after authentication and records an audit without secrets', async () => {
  const { env, db } = setup();
  const created = await call(
    env,
    '/checkout',
    retail({ invoice: { type: 'personal', title: '本地抬头', email: 'fixture@example.com' } }),
  );
  assert.equal(created.status, 200);
  const orderId = created.data.id;
  db.prepare('UPDATE orders SET pin_hash=?,idempotency_key=? WHERE id=?').run(
    'must-never-return-pin-hash',
    'must-never-return-token',
    orderId,
  );
  const summary = (await call(env, '/admin/data')).data.orders[0];
  assert.equal(summary.phone, '138****0000');
  assert.equal('address_json' in summary, false);
  const response = await call(env, '/admin/order-detail', { id: orderId });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const detail = response.data;
  assert.equal(detail.order.phone, addr.phone);
  assert.equal(detail.order.status, 'pending');
  assert.equal(detail.address.recipient, addr.recipient);
  assert.equal(detail.address.address, addr.address);
  assert.equal(detail.address.card_message, addr.card_message);
  assert.equal(detail.invoice.email, 'fixture@example.com');
  assert.equal(detail.items[0].unit_weight_g, 250);
  assert.equal(detail.shipments.length, 0);
  assert.equal(detail.adoption, null);
  const serialized = JSON.stringify(detail);
  assert.equal(/pin_hash|address_json|idempotency_key|must-never-return/.test(serialized), false);
  const audit = db
    .prepare("SELECT * FROM audit_log WHERE action='view-order-detail'")
    .all() as any[];
  assert.equal(audit.length, 1);
  assert.equal(audit[0].target, orderId);
  assert.equal(JSON.stringify(audit).includes(addr.address), false);
  assert.equal((await call(env, '/admin/order-detail', { id: 'missing' })).status, 404);
  assert.equal((await call(env, '/admin/order-detail', { id: '' })).status, 400);
  assert.equal(
    (
      await call(
        env,
        '/admin/order-detail',
        { id: orderId },
        { headers: { origin: 'https://foreign.example' } },
      )
    ).status,
    403,
  );
  assert.equal(
    (await call(env, '/admin/order-detail', { id: orderId }, { origin: 'https://shop.example.com' }))
      .status,
    503,
  );
  const unauthorized = await call(
    {
      ...env,
      ACCESS_TEAM_DOMAIN: 'admin-access-test.cloudflareaccess.com',
      ACCESS_AUD: 'apple-admin-test',
      ADMIN_EMAIL: 'owner@example.com',
    },
    '/admin/order-detail',
    { id: orderId },
    { origin: 'https://shop.example.com' },
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(JSON.stringify(unauthorized.data).includes(addr.phone), false);
});

test('order detail contains only its own retail shipment, and shipping updates tracking exactly once', async () => {
  const { env, db } = setup();
  const one = await call(env, '/checkout', retail());
  const other = await call(
    env,
    '/checkout',
    retail({ address: { ...addr, recipient: '另一位收件人', address: '另一地址不会串单' } }),
  );
  await pay(env, one.data);
  await pay(env, other.data);
  let detail = (await call(env, '/admin/order-detail', { id: one.data.id })).data;
  assert.equal(detail.shipments.length, 1);
  assert.equal(detail.shipments[0].recipient, addr.recipient);
  const sid = detail.shipments[0].id;
  assert.equal(
    (await call(env, '/admin/ship', { id: sid, tracking_no: 'SF1234567890123' })).status,
    200,
  );
  detail = (await call(env, '/admin/order-detail', { id: one.data.id })).data;
  assert.equal(detail.order.status, 'shipped');
  assert.equal(detail.shipments[0].tracking_no, 'SF1234567890123');
  assert.equal(detail.shipments[0].status, 'shipped');
  assert.ok(detail.shipments[0].shipped_at);
  assert.equal(
    (await call(env, '/admin/ship', { id: sid, tracking_no: 'SF9999999999999' })).status,
    409,
  );
  assert.equal(
    (await call(env, '/admin/ship', { id: 'missing', tracking_no: 'SF1234567890123' })).status,
    404,
  );
  assert.equal(
    (db.prepare('SELECT tracking_no FROM shipments WHERE id=?').get(sid) as any).tracking_no,
    'SF1234567890123',
  );
  assert.equal(
    (db.prepare('SELECT status FROM orders WHERE id=?').get(other.data.id) as any).status,
    'paid',
  );
});

test('adoption detail lists all bookings, shipping-fee detail links just its shipment, and cancelled bookings cannot ship', async () => {
  const { env, db } = setup();
  const { o, cookie } = await adopt(env);
  const headers = { cookie };
  await call(
    env,
    '/tree/book',
    { qty: 2, address: addr, expected_date: chinaDate(2) },
    { headers },
  );
  const remote = {
    ...addr,
    recipient: '另一收件人',
    phone: '13900000000',
    province_code: '650000',
    city_code: '650100',
    district_code: '650102',
    address: '另一个本地样例地址',
  };
  const fee = await call(
    env,
    '/tree/book',
    { qty: 1, address: remote, expected_date: chinaDate(3) },
    { headers },
  );
  assert.equal(fee.status, 200);
  const root = (await call(env, '/admin/order-detail', { id: o.id })).data;
  assert.equal(root.address, null);
  assert.equal(root.adoption.total_boxes, 8);
  assert.equal(root.adoption.used_boxes, 3);
  assert.equal(root.shipments.length, 2);
  assert.equal(root.shipments.filter((s: any) => s.recipient === '另一收件人').length, 1);
  const detail = (await call(env, '/admin/order-detail', { id: fee.data.id })).data;
  assert.equal(detail.order.type, 'shipping');
  assert.equal(detail.items.length, 0);
  assert.equal(detail.adoption.order_id, o.id);
  assert.equal(detail.shipments.length, 1);
  assert.equal(detail.shipments[0].phone, '13900000000');
  assert.equal(detail.order.phone, addr.phone);
  const sid = detail.shipments[0].id;
  assert.equal(
    (await call(env, '/admin/ship', { id: sid, tracking_no: 'SF1234567890123' })).status,
    409,
  );
  await call(env, '/tree/cancel', { id: sid }, { headers });
  assert.equal(
    (await call(env, '/admin/ship', { id: sid, tracking_no: 'SF1234567890123' })).status,
    409,
  );
  assert.equal(
    (db.prepare('SELECT status FROM shipments WHERE id=?').get(sid) as any).status,
    'cancelled',
  );
});
async function pay(env: any, o: any) {
  return call(env, '/demo/pay', { phone: addr.phone, order_no: o.order_no });
}
async function adopt(env: any) {
  const o = await call(
    env,
    '/checkout',
    retail({
      type: 'adoption',
      sku: 'PA',
      address: undefined,
      pin: '123456',
      plate_name: '测试的树',
    }),
  );
  assert.equal(o.status, 200);
  const paid = await pay(env, o.data);
  assert.equal(paid.status, 200);
  const login = await call(env, '/tree/login', {
    phone: addr.phone,
    code: paid.data.adoption.adopt_code,
    pin: '123456',
  });
  assert.equal(login.status, 200);
  return { o: o.data, cookie: login.headers.get('set-cookie')!.split(';')[0] };
}
async function hook(env: any, event: any) {
  env.STRIPE_SECRET_KEY = env.STRIPE_MODE === 'live' ? 'rk_live_local' : 'sk_test_local';
  env.STRIPE_WEBHOOK_SECRET = 'whsec_local';
  const raw = JSON.stringify({ livemode: false, ...event }),
    t = Math.floor(Date.now() / 1000),
    key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('whsec_local'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  const sig = [
    ...new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + raw)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  const execute = () =>
    api(
      new Request('https://shop.example.com/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': `t=${t},v1=${sig}` },
        body: raw,
      }),
      env,
    );
  const response =
    event.type === 'charge.refunded' && event.data.object.refunded
      ? await confirmedRefundFixture(env, String(event.data.object.payment_intent), execute)
      : await execute();
  return { status: response.status, data: await response.json() };
}
test('server recomputes price, quantity, remote fee; does not trust submitted totals', async () => {
  const { env } = setup();
  const x = await call(
    env,
    '/checkout',
    retail({
      qty: 2,
      amount: 1,
      address: {
        ...addr,
        province_code: '650000',
        city_code: '650100',
        district_code: '650102',
        province: '伪造',
        city: '伪造',
        district: '伪造',
      },
    }),
  );
  assert.equal(x.status, 200);
  assert.equal(x.data.amount, 25600);
  const fake = await call(env, '/checkout', retail({ qty: 21 }));
  assert.equal(fake.status, 400);
  const invalid = await call(
    env,
    '/checkout',
    retail({ address: { ...addr, city_code: '310100' } }),
  );
  assert.equal(invalid.status, 400);
});
test('pending stock locked atomically, oversell rejected, expiration restores once', async () => {
  const { env, db } = setup();
  db.exec("UPDATE products SET stock=1 WHERE id='FAMILY'");
  const a = await call(env, '/checkout', retail());
  assert.equal(a.status, 200);
  assert.equal((db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock, 0);
  assert.equal((await call(env, '/checkout', retail())).status, 409);
  db.exec("UPDATE orders SET expires_at=datetime('now','-1 hour')");
  await maintenance(env);
  await maintenance(env);
  assert.equal((db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock, 1);
});
test('payment redirect cannot mark paid; duplicate payment cannot create extra shipments', async () => {
  const { env, db } = setup();
  const o = (await call(env, '/checkout', retail())).data;
  const v = await call(env, '/order/status', { view_token: o.view_token });
  assert.equal(v.data.status, 'pending');
  assert.equal((await pay(env, o)).status, 200);
  assert.equal((await pay(env, o)).status, 409);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM shipments').get() as any).n, 1);
  assert.equal((await call(env, '/order/status', { view_token: 'a'.repeat(70) })).status, 401);
});
test('real signed Stripe webhook is idempotent; partial refund preserves map, full refund removes it', async () => {
  const { env, db } = setup();
  const o = (await call(env, '/checkout', retail())).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_local', o.id);
  const event = {
    id: 'evt_local_paid',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_local',
        metadata: { project: 'orchard-shop', order_id: o.id },
        payment_status: 'paid',
        currency: 'cny',
        amount_total: 10800,
        payment_intent: 'pi_local',
      },
    },
  };
  assert.equal((await hook(env, event)).status, 200);
  assert.equal((await hook(env, event)).status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM shipments').get() as any).n, 1);
  await hook(env, {
    id: 'evt_partial',
    type: 'charge.refunded',
    data: { object: { refunded: false, amount_refunded: 500, payment_intent: 'pi_local' } },
  });
  assert.equal((await call(env, '/map')).data.cities[0].boxes, 1);
  await hook(env, {
    id: 'evt_full',
    type: 'charge.refunded',
    data: { object: { refunded: true, payment_intent: 'pi_local' } },
  });
  assert.equal((await call(env, '/map')).data.cities.length, 0);
  assert.equal(
    (db.prepare('SELECT status FROM orders WHERE id=?').get(o.id) as any).status,
    'refunded',
  );
});
test('invalid webhook signature and mismatched amount are rejected', async () => {
  const { env, db } = setup();
  const o = (await call(env, '/checkout', retail())).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_local', o.id);
  assert.equal(
    (
      await hook(env, {
        id: 'evt_wrong_amount',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_local',
            metadata: { project: 'orchard-shop', order_id: o.id },
            payment_status: 'paid',
            currency: 'cny',
            amount_total: 1,
            payment_intent: 'pi_local',
          },
        },
      })
    ).status,
    400,
  );
  const r = await api(
    new Request('https://shop.example.com/api/stripe/webhook', { method: 'POST', body: '{}' }),
    env,
  );
  assert.equal(r.status, 400);
});
test('sandbox rejects live credentials and signed live webhooks before order mutation', async () => {
  const { env, db } = setup();
  env.STRIPE_SECRET_KEY = 'rk_live_fixture';
  assert.throws(() => stripe(env), /支付密钥与环境不匹配/);
  env.STRIPE_MODE = 'live';
  env.STRIPE_SECRET_KEY = 'rk_test_fixture';
  assert.throws(() => stripe(env), /支付密钥与环境不匹配/);
  env.STRIPE_MODE = 'sandbox';
  const o = (await call(env, '/checkout', retail())).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_mixed', o.id);
  const result = await hook(env, {
    id: 'evt_mixed_mode',
    livemode: true,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_mixed',
        metadata: { project: 'orchard-shop', order_id: o.id },
        payment_status: 'paid',
        currency: 'cny',
        amount_total: 10800,
      },
    },
  });
  assert.equal(result.status, 400);
  assert.equal(
    (db.prepare('SELECT status FROM orders WHERE id=?').get(o.id) as any).status,
    'pending',
  );
  assert.equal((db.prepare('SELECT COUNT(*) n FROM shipments').get() as any).n, 0);
});
test('asynchronous Checkout waits for paid status and failed payment releases stock', async () => {
  const { env, db } = setup();
  const o = (await call(env, '/checkout', retail())).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_async', o.id);
  const session = {
    id: 'cs_async',
    metadata: { project: 'orchard-shop', order_id: o.id },
    currency: 'cny',
    amount_total: 10800,
    payment_status: 'unpaid',
    payment_intent: 'pi_async',
  };
  assert.equal(
    (
      await hook(env, {
        id: 'evt_async_pending',
        type: 'checkout.session.completed',
        data: { object: session },
      })
    ).status,
    200,
  );
  assert.equal(
    (db.prepare('SELECT status FROM orders WHERE id=?').get(o.id) as any).status,
    'pending',
  );
  assert.equal((db.prepare('SELECT COUNT(*) n FROM shipments').get() as any).n, 0);
  assert.equal(
    (
      await hook(env, {
        id: 'evt_async_paid',
        type: 'checkout.session.async_payment_succeeded',
        data: { object: { ...session, payment_status: 'paid' } },
      })
    ).status,
    200,
  );
  assert.equal(
    (db.prepare('SELECT status FROM orders WHERE id=?').get(o.id) as any).status,
    'paid',
  );
  assert.equal((db.prepare('SELECT COUNT(*) n FROM shipments').get() as any).n, 1);
  const failed = (await call(env, '/checkout', retail())).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_async_failed', failed.id);
  assert.equal(
    (
      await hook(env, {
        id: 'evt_async_failed',
        type: 'checkout.session.async_payment_failed',
        data: {
          object: {
            id: 'cs_async_failed',
            metadata: { project: 'orchard-shop', order_id: failed.id },
          },
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (db.prepare('SELECT status FROM orders WHERE id=?').get(failed.id) as any).status,
    'expired',
  );
  assert.equal((db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock, 99);
});
test('Checkout uses the configured sandbox, preserves CNY totals and persists the session', async (t) => {
  const { env, db } = setup();
  const order = (await call(env, '/checkout', retail())).data;
  env.DEMO_MODE = 'false';
  env.STRIPE_SECRET_KEY = 'rk_test_fixture';
  env.STRIPE_PAYMENT_METHOD_CONFIGURATION = 'pmc_fixture';
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(request.headers.get('stripe-version'), '2026-09-30.endive');
    assert.equal(request.headers.get('idempotency-key'), 'checkout-' + order.id);
    const body = new URLSearchParams(await request.text());
    assert.equal(body.get('payment_method_configuration'), 'pmc_fixture');
    assert.equal(body.get('line_items[0][price_data][currency]'), 'cny');
    assert.equal(body.get('line_items[0][price_data][unit_amount]'), '10800');
    assert.equal(body.get('adaptive_pricing[enabled]'), 'false');
    assert.equal(
      [...body.keys()].some((k) => k.startsWith('payment_method_types')),
      false,
    );
    assert.equal(body.get('metadata[order_id]'), order.id);
    return Response.json({
      id: 'cs_test_fixture',
      url: 'https://checkout.stripe.com/test',
      livemode: false,
    });
  });
  const result = await createSession(env, new Request(env.APP_ORIGIN), order, '家庭装');
  assert.equal(result.url, 'https://checkout.stripe.com/test');
  assert.equal(
    (db.prepare('SELECT stripe_session_id FROM orders WHERE id=?').get(order.id) as any)
      .stripe_session_id,
    'cs_test_fixture',
  );
});
test('sandbox season override and dummy Turnstile stay confined to the sandbox host and test key', async (t) => {
  const { env } = setup();
  Object.assign(env, {
    DEMO_MODE: 'false',
    SANDBOX_CHECKOUT: 'true',
    STRIPE_MODE: 'sandbox',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    APP_ORIGIN: 'https://orchard-shop-sandbox.example.workers.dev',
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  });
  const request = new Request(env.APP_ORIGIN + '/api/checkout');
  assert.equal(isSandbox(env, request), true);
  assert.equal(isSandbox({ ...env, STRIPE_MODE: 'live' }, request), false);
  assert.equal(isSandbox({ ...env, STRIPE_SECRET_KEY: 'rk_live_fixture' }, request), false);
  assert.equal(
    isSandbox(
      { ...env, APP_ORIGIN: 'https://shop.example.com' },
      new Request('https://shop.example.com/api/checkout'),
    ),
    false,
  );
  assert.equal(isSandbox(env, new Request('https://other.example/api/checkout')), false);
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    return Response.json({ success: true, hostname: 'example.com' });
  });
  await human(env, request, 'dummy-token');
  await assert.rejects(
    human(
      { ...env, APP_ORIGIN: 'https://shop.example.com' },
      new Request('https://shop.example.com/api/checkout'),
      'dummy-token',
    ),
    /正式站点不可使用测试验证密钥/,
  );
});
test('adoption PIN hashed; unauthorized access blocked; booking limit and cancellation restore boxes', async () => {
  const { env, db } = setup(),
    { cookie } = await adopt(env);
  const a = db.prepare('SELECT * FROM adoptions').get() as any;
  assert.notEqual(a.pin_hash, '123456');
  assert.equal(await verifyPin('123456', a.pin_hash), true);
  assert.equal((await call(env, '/tree/me')).status, 401);
  const b = await call(
    env,
    '/tree/book',
    { qty: 6, address: addr, expected_date: chinaDate(2) },
    { headers: { cookie } },
  );
  assert.equal(b.status, 200);
  assert.equal(
    (
      await call(
        env,
        '/tree/book',
        { qty: 3, address: addr, expected_date: chinaDate(2) },
        { headers: { cookie } },
      )
    ).status,
    409,
  );
  const sid = (db.prepare('SELECT id FROM shipments').get() as any).id;
  assert.equal((await call(env, '/tree/cancel', { id: sid }, { headers: { cookie } })).status, 200);
  assert.equal((db.prepare('SELECT used_boxes FROM adoptions').get() as any).used_boxes, 0);
  assert.equal((await call(env, '/tree/cancel', { id: sid }, { headers: { cookie } })).status, 409);
});
test('remote adoption booking waits for fee payment before map inclusion', async () => {
  const { env } = setup(),
    { cookie } = await adopt(env);
  const a = { ...addr, province_code: '650000', city_code: '650100', district_code: '650102' };
  const b = await call(
    env,
    '/tree/book',
    { qty: 2, address: a, expected_date: chinaDate(2) },
    { headers: { cookie } },
  );
  assert.equal(b.status, 200);
  assert.equal(b.data.amount, 4000);
  assert.equal((await call(env, '/map')).data.cities.length, 0);
  assert.equal((await pay(env, b.data)).status, 200);
  assert.equal((await call(env, '/map')).data.cities[0].adopted, 2);
  assert.equal((await call(env, '/map')).data.cities[0].boxes, 0);
});
test('sponsor six-person minimum, 30-day dedup, shipping-only map and photo consent', async () => {
  const { env, db } = setup();
  const input = {
    org_name: '本地测试社区',
    event_name: '本地测试读书会',
    event_date: chinaDate(7),
    headcount: 6,
    contact: '本地测试',
    phone: addr.phone,
    address: addr,
    reason: '这是一条仅用于本地自动化测试的活动申请，验证社区活动赞助流程与授权展示规则。',
    agree_photos: true,
  };
  const tooSmall = await call(env, '/treat/apply', { ...input, headcount: 5 });
  assert.equal(tooSmall.status, 400);
  assert.match(JSON.stringify(tooSmall.data), /预计参加人数至少为 6 人/);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM sponsor_apps').get() as any).count, 0);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM sponsor_notifications').get() as any).count,
    0,
  );
  const s = await call(env, '/treat/apply', input);
  assert.equal(s.status, 200);
  assert.equal((db.prepare('SELECT headcount FROM sponsor_apps').get() as any).headcount, 6);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM sponsor_notifications').get() as any).count,
    1,
  );
  assert.equal((await call(env, '/treat/apply', input)).status, 429);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM sponsor_notifications').get() as any).count,
    1,
  );
  const list = (await call(env, '/admin/data')).data.sponsors;
  assert.equal(
    (
      await call(env, '/admin/sponsor', {
        id: list[0].id,
        action: 'approve',
        qty: 2,
        sku: 'FAMILY',
      })
    ).status,
    200,
  );
  assert.equal((await call(env, '/map')).data.cities.length, 0);
  const shipment = (await call(env, '/admin/data')).data.shipments[0];
  await call(env, '/admin/ship', { id: shipment.id, tracking_no: 'SF1234567890123' });
  assert.equal((await call(env, '/map')).data.cities[0].sponsored, 2);
  assert.equal(
    (
      await call(env, '/admin/sponsor', {
        id: list[0].id,
        action: 'photos',
        photos: ['/media/apple-2026/test.png'],
        show: true,
        consent: false,
      })
    ).status,
    400,
  );
});
test('sponsor review queue keeps older pending applications visible and rejection updates the applicant progress', async () => {
  const { env, db } = setup();
  const insert = db.prepare(
    "INSERT INTO sponsor_apps(id,app_no,org_name,event_name,event_date,headcount,contact,phone,address_json,reason,status,created_at) VALUES(?,?,'本地测试社区','本地活动','2026-11-10',6,'本地测试',?,?,'隔离数据库活动审核回归测试',?,?)",
  );
  insert.run(
    'waiting',
    'AP-WAITING-001',
    addr.phone,
    JSON.stringify(addr),
    'pending',
    '2026-10-01 00:00:00',
  );
  for (let i = 0; i < 301; i++)
    insert.run(
      `done-${i}`,
      `AP-DONE-${i}`,
      addr.phone,
      JSON.stringify(addr),
      'approved',
      '2026-10-22 00:00:00',
    );
  const listed = await call(env, '/admin/data');
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'no-store');
  assert.equal(listed.data.stats.pending_sponsors, 1);
  assert.equal(listed.data.sponsors.length, 20);
  assert.equal(listed.data.sponsors[0].id, 'waiting');
  assert.equal(listed.data.sponsors[0].phone, '138****0000');
  assert.equal('address_json' in listed.data.sponsors[0], false);
  assert.equal(
    (
      await call(env, '/admin/sponsor', {
        id: 'waiting',
        action: 'reject',
        reason: '活动时间无法安排',
      })
    ).status,
    200,
  );
  assert.equal((await call(env, '/admin/data')).data.stats.pending_sponsors, 0);
  const progress = await call(env, '/treat/lookup', {
    phone: addr.phone,
    app_no: 'AP-WAITING-001',
  });
  assert.equal(progress.data.status, 'rejected');
  assert.equal(progress.data.rejection_reason, '活动时间无法安排');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM shipments').get() as any).n, 0);
});
test('public production cannot enable local demo, admin needs verified Access; CSRF blocked', async () => {
  const { env } = setup();
  assert.equal(isDemo(env, new Request('https://shop.example.com')), false);
  assert.equal(
    (await call(env, '/admin/data', undefined, { origin: 'https://shop.example.com' })).status,
    503,
  );
  assert.equal(
    (await call(env, '/demo/pay', {}, { origin: 'https://shop.example.com' })).status,
    404,
  );
  const r = await api(
    new Request('http://localhost:4321/api/checkout', {
      method: 'POST',
      headers: { origin: 'https://other.example' },
      body: '{}',
    }),
    env,
  );
  assert.equal(r.status, 403);
});
test('CSV cells neutralize spreadsheet formula injection', () => {
  assert.equal(csvCell('=CMD(1)'), `"'=CMD(1)"`);
  assert.equal(csvCell('一句"心意"'), '"一句""心意"""');
});

test('different districts aggregate to one city', async () => {
  const { env } = setup();
  for (const district_code of ['110101', '110102']) {
    const o = (await call(env, '/checkout', retail({ address: { ...addr, district_code } }))).data;
    await pay(env, o);
  }
  const map = (await call(env, '/map')).data;
  assert.equal(map.cities.length, 1);
  assert.equal(map.cities[0].boxes, 2);
  assert.equal(map.cities[0].city_code, '110000');
  assert.equal(map.cities[0].region_label, '北京市 / 北京市');
  assert.equal(/东城区|西城区/.test(JSON.stringify(map)), false);
});

test('public map separates paid purchases from effective adoption bookings in the same city', async () => {
  const { env } = setup();
  const purchase = (await call(env, '/checkout', retail({ qty: 3 }))).data;
  await pay(env, purchase);
  const { cookie } = await adopt(env);
  let map = (await call(env, '/map')).data;
  assert.equal(map.cities[0].boxes, 3);
  assert.equal(map.cities[0].adopted, 0);
  const booking = await call(
    env,
    '/tree/book',
    { qty: 2, address: addr, expected_date: chinaDate(2) },
    { headers: { cookie } },
  );
  assert.equal(booking.status, 200);
  map = (await call(env, '/map')).data;
  assert.equal(map.cities.length, 1);
  assert.equal(map.cities[0].boxes, 3);
  assert.equal(map.cities[0].adopted, 2);
  assert.equal(map.cities[0].sponsored, 0);
});

test('map adoption tree total counts paid trees before booking, never booked boxes, and excludes full refunds', async () => {
  const { env, db } = setup();
  const purchase = (await call(env, '/checkout', retail({ qty: 3 }))).data;
  assert.equal((await pay(env, purchase)).status, 200);
  const created = await call(
    env,
    '/checkout',
    retail({
      type: 'adoption',
      sku: 'PA',
      address: undefined,
      pin: '123456',
      plate_name: '测试的树',
    }),
  );
  assert.equal(created.status, 200);
  let map = (await call(env, '/map')).data;
  assert.equal(map.adoption_trees, 0);
  assert.equal(map.cities[0].boxes, 3);

  const paid = await pay(env, created.data);
  assert.equal(paid.status, 200);
  map = (await call(env, '/map')).data;
  assert.equal(map.adoption_trees, 1);
  assert.equal(map.cities[0].adopted, 0);
  const login = await call(env, '/tree/login', {
    phone: addr.phone,
    code: paid.data.adoption.adopt_code,
    pin: '123456',
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const booking = await call(
    env,
    '/tree/book',
    { qty: 2, address: addr, expected_date: chinaDate(2) },
    { headers: { cookie } },
  );
  assert.equal(booking.status, 200);
  map = (await call(env, '/map')).data;
  assert.equal(map.adoption_trees, 1);
  assert.equal(map.cities[0].boxes, 3);
  assert.equal(map.cities[0].adopted, 2);

  db.prepare('UPDATE orders SET stripe_payment_intent=? WHERE id=?').run(
    'pi_map_tree',
    created.data.id,
  );
  assert.equal(
    (
      await hook(env, {
        id: 'evt_map_tree_partial_refund',
        type: 'charge.refunded',
        data: { object: { refunded: false, amount_refunded: 500, payment_intent: 'pi_map_tree' } },
      })
    ).status,
    200,
  );
  assert.equal((await call(env, '/map')).data.adoption_trees, 1);
  assert.equal(
    (
      await hook(env, {
        id: 'evt_map_tree_full_refund',
        type: 'charge.refunded',
        data: { object: { refunded: true, payment_intent: 'pi_map_tree' } },
      })
    ).status,
    200,
  );
  map = (await call(env, '/map')).data;
  assert.equal(map.adoption_trees, 0);
  assert.equal(map.cities[0].boxes, 3);
  assert.equal(map.cities[0].adopted, 0);
});

test('public map removes district labels and private fields, including cached snapshots', async () => {
  const { env, db } = setup();
  const o = (
    await call(
      env,
      '/checkout',
      retail({
        address: { ...addr, province_code: '320000', city_code: '320100', district_code: '320102' },
      }),
    )
  ).data;
  await pay(env, o);
  const stale = { cities: [{ region_label: '旧缓存 / 详细区县', phone: addr.phone }] };
  await env.CACHE.put('map:v1', JSON.stringify(stale));
  const fresh = (await call(env, '/map')).data;
  assert.equal(fresh.cities[0].region_label, '江苏省 / 南京市');
  assert.equal(fresh.recent[0].region_label, '江苏省 / 南京市');
  const internal = db.prepare('SELECT region_label,phone,address FROM shipments').get() as any;
  assert.equal(internal.region_label, '江苏省 / 南京市 / 玄武区');
  assert.equal(internal.address, addr.address);
  assert.equal(internal.phone, addr.phone);
  // A cache must go through the same public field selection as a fresh DB result.
  const cached = structuredClone(fresh);
  Object.assign(cached.cities[0], internal, { district_code: '320102', recipient: addr.recipient });
  Object.assign(cached.recent[0], internal, { source_id: o.id });
  cached.internal_note = '不公开的运营备注';
  await env.CACHE.put(MAP_CACHE_KEY, JSON.stringify(cached));
  const result = (await call(env, '/map')).data;
  assert.deepEqual(result, fresh);
  assert.equal(
    /玄武区|13800000000|本地测试地址|source_id|district_code|internal_note/.test(
      JSON.stringify(result),
    ),
    false,
  );
});

test('season-end creates one remaining-box shipment to latest non-remote address', async () => {
  const { env, db } = setup(),
    { cookie } = await adopt(env);
  await call(
    env,
    '/tree/book',
    { qty: 2, address: addr, expected_date: chinaDate(2) },
    { headers: { cookie } },
  );
  const after = Date.parse(SEASON_END+'T01:00:00+08:00')+86400000;
  const date = chinaDate(0,new Date(after));
  await maintenance(env, new Date(after));
  await maintenance(env, new Date(after+600000));
  assert.equal((db.prepare('SELECT used_boxes FROM adoptions').get() as any).used_boxes, 8);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM shipments').get() as any).n, 2);
  assert.equal(
    (db.prepare('SELECT qty FROM shipments WHERE expected_date=?').get(date) as any).qty,
    6,
  );
});

test('shared-account webhooks acknowledge foreign purchases and refunds without state changes', async () => {
  const { env, db } = setup();
  const order = (await call(env, '/checkout', retail())).data;
  const initialStock = (db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any)
    .stock;
  for (const type of [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.expired',
    'checkout.session.async_payment_failed',
  ]) {
    for (const metadata of [
      { project: 'another-site', order_id: order.id },
      { order_id: order.id },
    ]) {
      const response = await hook(env, {
        id: crypto.randomUUID(),
        type,
        data: {
          object: {
            id: 'cs_foreign',
            metadata,
            payment_status: 'paid',
            amount_total: 10800,
            currency: 'cny',
            payment_intent: 'pi_foreign',
          },
        },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(response.data, { received: true, ignored: true });
    }
  }
  for (const metadata of [{ project: 'another-site' }, {}]) {
    const response = await hook(env, {
      id: crypto.randomUUID(),
      type: 'charge.refunded',
      data: { object: { refunded: true, payment_intent: 'pi_foreign', metadata } },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, { received: true, ignored: true });
  }
  assert.equal(
    (db.prepare('SELECT status FROM orders WHERE id=?').get(order.id) as any).status,
    'pending',
  );
  assert.equal(
    (db.prepare("SELECT stock FROM products WHERE id='FAMILY'").get() as any).stock,
    initialStock,
  );
  assert.equal((db.prepare('SELECT COUNT(*) n FROM shipments').get() as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM webhook_events').get() as any).n, 0);
});

test('own refund arriving before payment synchronization retries instead of being ignored', async () => {
  const { env, db } = setup();
  const response = await hook(env, {
    id: 'evt_early_refund',
    type: 'charge.refunded',
    data: {
      object: {
        refunded: true,
        payment_intent: 'pi_not_synced',
        metadata: { project: 'orchard-shop' },
      },
    },
  });
  assert.equal(response.status, 409);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM webhook_events').get() as any).n, 0);
});

test('production accepts signed live payment and rejects a signed sandbox event', async () => {
  const { env, db } = setup();
  const order = (await call(env, '/checkout', retail())).data;
  db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run('cs_live_fixture', order.id);
  env.STRIPE_MODE = 'live';
  const object = {
    id: 'cs_live_fixture',
    metadata: { project: 'orchard-shop', order_id: order.id },
    payment_status: 'paid',
    currency: 'cny',
    amount_total: 10800,
    payment_intent: 'pi_live_fixture',
  };
  assert.equal(
    (
      await hook(env, {
        id: 'evt_test_on_live',
        livemode: false,
        type: 'checkout.session.completed',
        data: { object },
      })
    ).status,
    400,
  );
  assert.equal(
    (db.prepare('SELECT status FROM orders WHERE id=?').get(order.id) as any).status,
    'pending',
  );
  assert.equal(
    (
      await hook(env, {
        id: 'evt_live_signed',
        livemode: true,
        type: 'checkout.session.completed',
        data: { object },
      })
    ).status,
    200,
  );
  assert.equal(
    (db.prepare('SELECT status FROM orders WHERE id=?').get(order.id) as any).status,
    'paid',
  );
});
