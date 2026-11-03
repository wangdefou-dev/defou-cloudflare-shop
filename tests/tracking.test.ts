import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { api } from '../src/lib/api';
import { digest } from '../src/lib/security';
import {
  shipmentTracking,
  TRACKING_COOLDOWN_SECONDS,
  type TrackingShipment,
} from '../src/lib/tracking';

class LocalD1 {
  db = new DatabaseSync(':memory:');
  queries: string[] = [];
  constructor() {
    for (const file of readdirSync('migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      this.db.exec(readFileSync('migrations/' + file, 'utf8'));
    this.db.exec(readFileSync('scripts/seed.sql', 'utf8'));
    this.db.exec('UPDATE products SET stock=1000');
  }
  prepare(sql: string) {
    this.queries.push(sql);
    let args: any[] = [];
    const statement: any = {
      bind(...values: any[]) {
        args = values;
        return statement;
      },
      first: async () => this.db.prepare(sql).get(...args) || null,
      all: async () => ({ results: this.db.prepare(sql).all(...args), success: true }),
      run: async () => ({
        meta: { changes: Number(this.db.prepare(sql).run(...args).changes) },
        success: true,
      }),
    };
    return statement;
  }
  async batch(statements: any[]) {
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
  }
}
const origin = 'http://localhost:4321';
async function call(env: any, path: string, body: any, headers: Record<string, string> = {}) {
  const response = await api(
    new Request(origin + '/api' + path, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );
  return {
    status: response.status,
    headers: response.headers,
    data: (await response.json()) as any,
  };
}
const n = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;
const shipment = (db: DatabaseSync, id = 'parcel-family') =>
  db.prepare('SELECT * FROM shipments WHERE id=?').get(id) as TrackingShipment;
async function setup(t: TestContext) {
  const DB = new LocalD1(),
    db = DB.db;
  t.after(() => db.close());
  const map = new Map<string, string>();
  const env: any = {
    DB,
    DEMO_MODE: 'true',
    APP_ORIGIN: origin,
    TRACKING_ENABLED: 'true',
    KUAIDI100_CUSTOMER: 'fixture-customer',
    KUAIDI100_KEY: 'fixture-key',
    CACHE: {
      put: async (key: string, value: string) => {
        map.set(key, value);
      },
      get: async (key: string) => (map.has(key) ? JSON.parse(map.get(key)!) : null),
    },
  };
  function order(id: string, type = 'retail') {
    db.prepare(
      `INSERT INTO orders(id,order_no,type,phone,amount,expires_at,plate_name,pin_hash) VALUES(?,?,?,'13800000001',?,datetime('now','+1 day'),'本地树牌','fixture-pin-hash')`,
    ).run(id, 'DF-' + id, type, type === 'adoption' ? 88800 : 10800);
    if (type !== 'shipping')
      db.prepare('INSERT INTO order_items VALUES(?,?,?,1)').run(
        'item-' + id,
        id,
        type === 'adoption' ? 'PA' : 'FAMILY',
      );
    db.prepare("UPDATE orders SET status='paid',paid_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  }
  function parcel(
    id: string,
    source = 'retail',
    sourceId = 'family',
    status = 'shipped',
    carrier = '顺丰',
  ) {
    db.prepare(
      `INSERT INTO shipments(id,source,source_id,product_id,qty,recipient,phone,province_code,city_code,district_code,region_label,address,sender,status,carrier,tracking_no,shipped_at)
      VALUES(?,?,?,'FAMILY',1,'本地收件人','13800000001','110000','110100','110101','北京市 / 北京市 / 东城区','本地私有地址001号','本地寄件人',?,?,?,CURRENT_TIMESTAMP)`,
    ).run(id, source, sourceId, status, carrier, status === 'shipped' ? 'SF1234567890123' : null);
  }
  for (const id of ['family', 'other']) order(id);
  for (const id of ['tree-a', 'tree-b']) order(id, 'adoption');
  const a = db.prepare("SELECT * FROM adoptions WHERE order_id='tree-a'").get() as any;
  const b = db.prepare("SELECT * FROM adoptions WHERE order_id='tree-b'").get() as any;
  parcel('parcel-family');
  parcel('parcel-other', 'retail', 'other');
  parcel('parcel-tree-a', 'adoption', String(a.id));
  parcel('parcel-tree-a-second', 'adoption', String(a.id));
  parcel('parcel-tree-b', 'adoption', String(b.id));
  order('shipping-a', 'shipping');
  db.prepare("UPDATE orders SET shipment_id='parcel-tree-a' WHERE id='shipping-a'").run();
  async function token(orderId: string, expired = false) {
    const value = crypto.randomUUID() + crypto.randomUUID();
    db.prepare(`INSERT INTO order_tokens VALUES(?,?,datetime('now',?))`).run(
      await digest(value),
      orderId,
      expired ? '-1 hour' : '+1 hour',
    );
    return value;
  }
  const cookie = 'local-tree-cookie';
  db.prepare("INSERT INTO sessions VALUES(?,?,datetime('now','+1 hour'))").run(
    await digest(cookie),
    a.id,
  );
  return { env, DB, db, map, a, b, token, cookie: 'tree_session=' + cookie, order, parcel };
}
function mockFetch(t: TestContext, fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
function trace(number = 'SF1234567890123', carrier = 'shunfeng', extra: any = {}) {
  return {
    status: '200',
    state: '3',
    com: carrier,
    nu: number,
    ischeck: '0',
    message: 'DO NOT RETURN raw provider message',
    data: [
      {
        time: '2026-10-29 12:30:00',
        context: '快件已送达，签收人：本地收件人，联系13800000001，地址本地私有地址001号',
        courierInfo: { phone: '13900000002' },
      },
      { time: '2026-10-28 10:00:00', context: '快件到达转运中心' },
    ],
    courierInfo: { pickupManName: '另一位快递员', pickupManPhone: '13900000002' },
    ...extra,
  };
}
function businessState(db: DatabaseSync) {
  return JSON.stringify(
    [
      'orders',
      'products',
      'adoptions',
      'shipments',
      'notifications',
      'commerce_notifications',
      'notification_deliveries',
      'sponsor_notifications',
      'refund_notifications',
    ].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
  );
}

test('order tracking rejects expired/wrong/foreign tokens and extra provider fields before touching cache or provider', async (t) => {
  const { env, DB, db, token } = await setup(t);
  const own = await token('family'),
    other = await token('other'),
    expired = await token('family', true),
    tree = await token('tree-a');
  let external = 0;
  mockFetch(t, async () => {
    external++;
    throw Error('must not call');
  });
  const before = businessState(db);
  for (const body of [
    { shipment_id: 'parcel-family', view_token: 'x'.repeat(72) },
    { shipment_id: 'parcel-family', view_token: expired },
    { shipment_id: 'parcel-family', view_token: other },
    { shipment_id: 'parcel-tree-a', view_token: tree },
    {
      shipment_id: 'parcel-family',
      view_token: own,
      tracking_no: 'ATTACK123',
      phone: '13900000002',
      carrier: 'yuantong',
    },
  ]) {
    const result = await call(env, '/order/tracking', body);
    assert([400, 401, 404].includes(result.status), JSON.stringify(result));
    assert.doesNotMatch(JSON.stringify(result.data), /SF123|138000|本地私有/);
  }
  assert.equal(external, 0);
  assert.equal(n(db, 'shipment_tracking_cache'), 0);
  assert.equal(
    DB.queries.some((sql) => sql.includes('shipment_tracking_cache')),
    false,
  );
  assert.equal(businessState(db), before);
});

test('tree tracking requires a live session and its exact adoption; admin tracking requires Access before reading cache', async (t) => {
  const { env, DB, db, cookie } = await setup(t);
  let external = 0;
  mockFetch(t, async () => {
    external++;
    throw Error('must not call');
  });
  assert.equal((await call(env, '/tree/tracking', { shipment_id: 'parcel-tree-a' })).status, 401);
  assert.equal(
    (await call(env, '/tree/tracking', { shipment_id: 'parcel-tree-b' }, { cookie })).status,
    404,
  );
  assert.equal(
    (await call(env, '/tree/tracking', { shipment_id: 'parcel-family' }, { cookie })).status,
    404,
  );
  assert.equal(
    (await call(env, '/tree/tracking', { shipment_id: 'parcel-tree-a', carrier: 'jd' }, { cookie }))
      .status,
    400,
  );
  db.exec("UPDATE sessions SET expires_at=datetime('now','-1 hour')");
  assert.equal(
    (await call(env, '/tree/tracking', { shipment_id: 'parcel-tree-a' }, { cookie })).status,
    401,
  );
  const production = {
    ...env,
    DEMO_MODE: 'false',
    ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
    ACCESS_AUD: 'fixture-audience',
    ADMIN_EMAIL: 'operator@example.com',
  };
  assert.equal(
    (
      await call(
        production,
        '/admin/shipment-tracking',
        { shipment_id: 'parcel-family' },
        { 'cf-access-authenticated-user-email': 'operator@example.com' },
      )
    ).status,
    401,
  );
  assert.equal(external, 0);
  assert.equal(n(db, 'shipment_tracking_cache'), 0);
  assert.equal(
    DB.queries.some((sql) => sql.includes('shipment_tracking_cache')),
    false,
  );
});

test('valid retail, exact shipping-payment, tree and admin access return private snapshots without widening shipment ownership', async (t) => {
  const { env, db, cookie, token } = await setup(t);
  env.TRACKING_ENABLED = 'false';
  const family = await token('family'),
    shipping = await token('shipping-a');
  for (const [path, body, headers] of [
    ['/order/tracking', { shipment_id: 'parcel-family', view_token: family }, {}],
    ['/order/tracking', { shipment_id: 'parcel-tree-a', view_token: shipping }, {}],
    ['/tree/tracking', { shipment_id: 'parcel-tree-a' }, { cookie }],
    ['/admin/shipment-tracking', { shipment_id: 'parcel-family' }, {}],
  ] as const) {
    const result = await call(env, path, body, headers);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.shipment_id, body.shipment_id);
    assert.equal(result.data.availability, 'not_configured');
    assert.match(result.headers.get('cache-control')!, /private/);
    assert.match(result.headers.get('cache-control')!, /no-store/);
    assert.match(result.headers.get('x-robots-tag')!, /noindex/);
    assert.doesNotMatch(
      JSON.stringify(result.data),
      /本地收件人|13800000001|本地私有地址|fixture-key|fixture-customer|view_token|token_hash/,
    );
  }
  assert.equal(
    (
      await call(env, '/order/tracking', {
        shipment_id: 'parcel-tree-a-second',
        view_token: shipping,
      })
    ).status,
    404,
  );
  const audit = JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
  assert.match(audit, /parcel-family/);
  assert.doesNotMatch(audit, /SF123|138000|本地收件人|fixture-key/);
  assert.equal(n(db, 'shipment_tracking_cache'), 0);
});

test('unshipped, missing-number, unsupported and disabled configurations never query carrier or create cache rows', async (t) => {
  const { env, db } = await setup(t);
  let external = 0;
  mockFetch(t, async () => {
    external++;
    throw Error('must not call');
  });
  const own = shipment(db);
  for (const status of ['reserved', 'awaiting_payment', 'cancelled']) {
    const result = await shipmentTracking(env, { ...own, status });
    assert.equal(result.availability, 'not_shipped');
    assert.deepEqual(result.events, []);
  }
  assert.equal(
    (await shipmentTracking(env, { ...own, tracking_no: null })).availability,
    'not_shipped',
  );
  const unsupported = await shipmentTracking(env, {
    ...own,
    carrier: 'Unknown courier https://attacker.test',
  });
  assert.equal(unsupported.availability, 'unsupported');
  assert.equal(unsupported.query_url, null);
  assert.equal(
    (await shipmentTracking(env, { ...own, tracking_no: 'INVALID' })).availability,
    'unsupported',
  );
  for (const disabled of [
    { TRACKING_ENABLED: 'false' },
    { KUAIDI100_CUSTOMER: '' },
    { KUAIDI100_KEY: '' },
  ])
    assert.equal(
      (await shipmentTracking({ ...env, ...disabled }, own)).availability,
      'not_configured',
    );
  assert.equal(external, 0);
  assert.equal(n(db, 'shipment_tracking_cache'), 0);
});

test('provider signing and requests send only fixed carrier/waybill and required verification phone; sanitized snapshots omit provider extras', async (t) => {
  const { env, db, token } = await setup(t);
  const own = await token('family');
  const before = businessState(db);
  const requests: any[] = [];
  mockFetch(t, async (input, init) => {
    assert.equal(input, 'https://poll.kuaidi100.com/poll/query.do');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert(init?.signal);
    const form = new URLSearchParams(String(init?.body));
    const paramText = form.get('param')!;
    const param = JSON.parse(paramText);
    assert.equal(form.get('customer'), 'fixture-customer');
    assert.equal(form.get('signType'), 'SHA256');
    assert.equal(
      form.get('sign'),
      createHash('sha256')
        .update(paramText + 'fixture-key' + 'fixture-customer')
        .digest('hex')
        .toUpperCase(),
    );
    assert.deepEqual(Object.keys(param).sort(), ['com', 'lang', 'num', 'order', 'phone', 'show']);
    assert.equal(param.phone, '13800000001');
    assert.equal(param.com, 'shunfeng');
    assert(!param.from && !param.to && !param.needCourierInfo && !param.resultv2);
    requests.push(param);
    return Response.json(trace());
  });
  const result = await call(env, '/order/tracking', {
    shipment_id: 'parcel-family',
    view_token: own,
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.availability, 'available');
  assert.equal(result.data.state, '3');
  assert.equal(result.data.state_label, '已签收');
  assert.equal(result.data.events[0].time, '2026-10-29T04:30:00.000Z');
  assert.equal(result.data.events.length, 2);
  assert.deepEqual(Object.keys(result.data.events[0]).sort(), ['description', 'time']);
  assert.doesNotMatch(
    JSON.stringify(result.data),
    /本地收件人|本地私有地址|13800000001|13900000002|另一位快递员|pickupMan|courierInfo|raw provider|fixture-key|fixture-customer/,
  );
  const cache = JSON.stringify(db.prepare('SELECT * FROM shipment_tracking_cache').all());
  assert.doesNotMatch(cache, /SF1234567890123|13800000001|本地私有|本地收件人|courierInfo/);
  assert.equal(requests.length, 1);
  assert.equal(businessState(db), before);
  const cooldown = (Date.parse(result.data.next_refresh_at) - Date.now()) / 1000;
  assert(cooldown > 1790 && cooldown <= TRACKING_COOLDOWN_SECONDS);
});

test('non-verification carriers omit phone and public fallback URLs contain no shipment data', async (t) => {
  const { env, db } = await setup(t);
  let external = 0;
  mockFetch(t, async (_input, init) => {
    external++;
    const param = JSON.parse(new URLSearchParams(String(init?.body)).get('param')!);
    assert.deepEqual(Object.keys(param).sort(), ['com', 'lang', 'num', 'order', 'show']);
    return Response.json(trace(param.num, param.com));
  });
  const result = await shipmentTracking(env, {
    ...shipment(db),
    carrier: '极兔速递',
    tracking_no: 'JT1234567890',
    phone: '13900000002',
  });
  assert.equal(result.availability, 'available');
  assert.equal(result.carrier, '极兔速递');
  assert.equal(result.query_url, 'https://www.kuaidi100.com/');
  assert.match(result.query_label, /快递100/);
  assert.equal(external, 1);
  assert.equal(new URL(result.query_url!).search, '');
});

test('cache and persistent per-number cooldown deduplicate repeated and concurrent queries without bypass flags', async (t) => {
  const { env, db } = await setup(t);
  const own = shipment(db);
  let external = 0,
    release!: () => void,
    entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetching = new Promise<void>((resolve) => {
    entered = resolve;
  });
  mockFetch(t, async () => {
    external++;
    entered();
    await gate;
    return Response.json(trace());
  });
  const first = shipmentTracking(env, own);
  await fetching;
  const concurrent = await shipmentTracking(env, own);
  assert.equal(concurrent.availability, 'updating');
  const retrySeconds = (Date.parse(concurrent.next_refresh_at!) - Date.now()) / 1000;
  assert(
    retrySeconds > 0 && retrySeconds <= 20,
    'a cache re-read is allowed after the short lease, not after 30 minutes',
  );
  assert.equal(external, 1);
  release();
  const complete = await first;
  assert.equal(complete.availability, 'available');
  const cached = await shipmentTracking(env, own);
  assert.equal(cached.availability, 'available');
  assert.deepEqual(cached.events, complete.events);
  assert.equal(external, 1);
  assert.equal(n(db, 'shipment_tracking_cache'), 1);
  const row = db.prepare('SELECT * FROM shipment_tracking_cache').get() as any;
  assert.equal(row.lease_token, null);
  assert.equal(row.lease_until, 0);
  assert(row.next_refresh_at - row.fetched_at >= 1800);
});

test('the same carrier waybill across shipments or changed verification phones shares one provider budget without sharing recipient snapshots', async (t) => {
  const { env, db } = await setup(t);
  const own = shipment(db);
  let external = 0,
    entered!: () => void,
    release!: () => void;
  const fetching = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockFetch(t, async () => {
    external++;
    entered();
    await gate;
    return Response.json(trace());
  });
  const first = shipmentTracking(env, own);
  await fetching;
  const otherRecord = await shipmentTracking(env, { ...own, id: 'another-local-record' });
  const changedPhone = await shipmentTracking(env, {
    ...own,
    phone: '13900000002',
    recipient: '另一位收件人',
  });
  assert.equal(external, 1);
  for (const waiting of [otherRecord, changedPhone]) {
    assert.equal(waiting.availability, 'pending');
    assert.deepEqual(waiting.events, []);
    assert.equal(waiting.fetched_at, null);
    assert(Date.parse(waiting.next_refresh_at!) > Date.now() + 1790000);
  }
  release();
  assert.equal((await first).availability, 'available');
  const unchanged = await shipmentTracking(env, own);
  assert.equal(unchanged.availability, 'available');
  assert.equal(
    (await shipmentTracking(env, { ...own, phone: '13900000002' })).availability,
    'pending',
  );
  assert.equal(external, 1);
  assert.equal(n(db, 'shipment_tracking_cache'), 3);
  assert.equal(n(db, 'shipment_tracking_queries'), 1);
  const budget = db.prepare('SELECT * FROM shipment_tracking_queries').get() as any;
  assert.equal(budget.lease_token, null);
  assert.equal(budget.lease_until, 0);
  assert(budget.next_refresh_at > Math.floor(Date.now() / 1000) + 1790);
  const stored = JSON.stringify(db.prepare('SELECT * FROM shipment_tracking_queries').all());
  assert.doesNotMatch(stored, /SF123|138000|139000|本地收件人/);
});

test('shipment identity changes cannot reuse old cached traces, and unsupported updates retain no stale carrier result', async (t) => {
  const { env, db } = await setup(t);
  let external = 0;
  mockFetch(t, async (_input, init) => {
    external++;
    const param = JSON.parse(new URLSearchParams(String(init?.body)).get('param')!);
    return Response.json(
      trace(param.num, param.com, {
        data: [
          {
            time: '2026-10-29 12:30:00',
            context: param.num.endsWith('4') ? '第二个包裹的物流' : '第一个包裹的物流',
          },
        ],
      }),
    );
  });
  const own = shipment(db),
    first = await shipmentTracking(env, own);
  const second = await shipmentTracking(env, { ...own, tracking_no: 'SF1234567890124' });
  assert.equal(first.events[0].description, '第一个包裹的物流');
  assert.equal(second.events[0].description, '第二个包裹的物流');
  assert.equal(external, 2);
  assert.equal(n(db, 'shipment_tracking_cache'), 2);
  const unsupported = await shipmentTracking(env, { ...own, carrier: '不存在的快递' });
  assert.deepEqual(unsupported.events, []);
  assert.equal(unsupported.availability, 'unsupported');
  assert.equal(external, 2);
});

test('provider failures keep the last successful snapshot marked stale and preserve cooldown without exposing error text', async (t) => {
  const { env, db } = await setup(t);
  let external = 0;
  mockFetch(t, async () => {
    external++;
    if (external > 1) throw Error('DO NOT LEAK fixture-key 13800000001');
    return Response.json(trace());
  });
  const own = shipment(db),
    first = await shipmentTracking(env, own);
  db.exec(
    'UPDATE shipment_tracking_cache SET next_refresh_at=0; UPDATE shipment_tracking_queries SET next_refresh_at=0',
  );
  const stale = await shipmentTracking(env, own);
  assert.equal(stale.availability, 'unavailable');
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.events, first.events);
  assert.equal(stale.fetched_at, first.fetched_at);
  assert.doesNotMatch(JSON.stringify(stale), /DO NOT LEAK|fixture-key|13800000001/);
  assert.equal((await shipmentTracking(env, own)).availability, 'unavailable');
  assert.equal(external, 2);
  const row = db.prepare('SELECT * FROM shipment_tracking_cache').get() as any;
  assert.equal(row.lease_token, null);
  assert(row.next_refresh_at > Math.floor(Date.now() / 1000) + 1790);
});

test('mismatched carrier/number and malformed/error responses cannot impersonate a real trace', async (t) => {
  const { env, db } = await setup(t);
  let response: any = trace();
  mockFetch(t, async () =>
    typeof response === 'string' ? new Response(response) : Response.json(response),
  );
  const own = shipment(db);
  for (const value of [
    trace('SF9999999999999'),
    trace('SF1234567890123', 'yuantong'),
    { returnCode: '503', message: 'signature error fixture-key' },
    '{broken-json',
    trace('SF1234567890123', 'shunfeng', {
      data: [{ time: '2026-02-30 00:00:00', context: 'bad date' }],
    }),
  ]) {
    db.exec('DELETE FROM shipment_tracking_cache; DELETE FROM shipment_tracking_queries');
    response = value;
    const result = await shipmentTracking(env, own);
    assert(['pending', 'unavailable'].includes(result.availability));
    assert.deepEqual(result.events, []);
    assert.notEqual(result.state, '3');
    assert.doesNotMatch(JSON.stringify(result), /fixture-key|signature error|broken-json/);
  }
  db.exec('DELETE FROM shipment_tracking_cache; DELETE FROM shipment_tracking_queries');
  response = { returnCode: '500', message: 'no result raw vendor message' };
  assert.equal((await shipmentTracking(env, own)).availability, 'pending');
  db.exec('DELETE FROM shipment_tracking_cache; DELETE FROM shipment_tracking_queries');
  response = 'x'.repeat(262145);
  assert.equal((await shipmentTracking(env, own)).availability, 'unavailable');
});

test('trace event whitelist bounds untrusted text and count, strips markup/links/contacts, and sorts latest first', async (t) => {
  const { env, db } = await setup(t);
  const data = Array.from({ length: 120 }, (_, i) => ({
    time: `2026-10-29 12:${String(i % 60).padStart(2, '0')}:00`,
    context: `${i}<script>malicious()</script>派件员：张某，联系13900000002，https://attacker.test/?secret=raw，${'苹果'.repeat(250)}`,
    arbitrary: 'do-not-keep',
  }));
  mockFetch(t, async () => Response.json(trace('SF1234567890123', 'shunfeng', { data })));
  const result = await shipmentTracking(env, shipment(db));
  assert.equal(result.availability, 'available');
  assert(result.events.length <= 100);
  for (const event of result.events) {
    assert(event.description.length <= 500);
    assert.deepEqual(Object.keys(event).sort(), ['description', 'time']);
    assert.doesNotMatch(event.description, /<script>|https:\/\/|13900000002|张某|do-not-keep/);
  }
  assert.deepEqual(
    result.events.map((e) => e.time),
    result.events
      .map((e) => e.time)
      .sort()
      .reverse(),
  );
});

test('multi-carrier shipping stores canonical carrier, preserves SF validation and defaults, and cannot overwrite shipment state', async (t) => {
  const { env, db, order, parcel } = await setup(t);
  order('ready');
  parcel('parcel-ready', 'retail', 'ready', 'reserved');
  assert.equal(
    (
      await call(env, '/admin/ship', {
        id: 'parcel-ready',
        carrier: 'yuantong',
        tracking_no: 'YT1234567890',
      })
    ).status,
    200,
  );
  const saved = shipment(db, 'parcel-ready');
  assert.equal(saved.carrier, '圆通速递');
  assert.equal(saved.tracking_no, 'YT1234567890');
  assert.equal(saved.status, 'shipped');
  assert.equal(
    (
      await call(env, '/admin/ship', {
        id: 'parcel-ready',
        carrier: 'jd',
        tracking_no: 'JD1234567890',
      })
    ).status,
    409,
  );
  assert.equal(shipment(db, 'parcel-ready').tracking_no, 'YT1234567890');
  order('default');
  parcel('parcel-default', 'retail', 'default', 'reserved');
  assert.equal(
    (await call(env, '/admin/ship', { id: 'parcel-default', tracking_no: '1234567890' })).status,
    400,
  );
  assert.equal(
    (
      await call(env, '/admin/ship', {
        id: 'parcel-default',
        carrier: 'unknown',
        tracking_no: '1234567890',
      })
    ).status,
    400,
  );
  assert.equal(
    (await call(env, '/admin/ship', { id: 'parcel-default', tracking_no: 'SF1234567890123' }))
      .status,
    200,
  );
  assert.equal(shipment(db, 'parcel-default').carrier, '顺丰速运');
  order('cancelled');
  parcel('parcel-cancelled', 'retail', 'cancelled', 'cancelled');
  assert.equal(
    (
      await call(env, '/admin/ship', {
        id: 'parcel-cancelled',
        carrier: 'jd',
        tracking_no: 'JD1234567890',
      })
    ).status,
    409,
  );
  order('awaiting');
  parcel('parcel-awaiting', 'retail', 'awaiting', 'awaiting_payment');
  assert.equal(
    (
      await call(env, '/admin/ship', {
        id: 'parcel-awaiting',
        carrier: 'jd',
        tracking_no: 'JD1234567890',
      })
    ).status,
    409,
  );
});

test('multi-carrier shipping retains the refund guard and tracking a truly shipped refunded order does not change fulfillment', async (t) => {
  const { env, db, order, parcel, token } = await setup(t);
  order('locked');
  parcel('parcel-locked', 'retail', 'locked', 'reserved');
  db.prepare(
    "INSERT INTO admin_refund_requests(request_id,order_id,actor,amount,reason,status) VALUES('fixture-request','locked','local-demo',1000,'requested_by_customer','pending')",
  ).run();
  const blocked = await call(env, '/admin/ship', {
    id: 'parcel-locked',
    carrier: 'jtexpress',
    tracking_no: 'JT1234567890',
  });
  assert.equal(blocked.status, 409);
  assert.equal(shipment(db, 'parcel-locked').status, 'reserved');
  assert.equal(shipment(db, 'parcel-locked').tracking_no, null);
  db.exec("UPDATE admin_refund_requests SET status='failed' WHERE request_id='fixture-request'");
  assert.equal(
    (
      await call(env, '/admin/ship', {
        id: 'parcel-locked',
        carrier: 'jtexpress',
        tracking_no: 'JT1234567890',
      })
    ).status,
    200,
  );
  db.exec("UPDATE orders SET status='refunded' WHERE id='family'");
  const own = await token('family'),
    before = businessState(db);
  mockFetch(t, async () => Response.json(trace()));
  const result = await call(env, '/order/tracking', {
    shipment_id: 'parcel-family',
    view_token: own,
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.availability, 'available');
  assert.equal(shipment(db).status, 'shipped');
  assert.equal(businessState(db), before);
});
