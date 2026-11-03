import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { api } from '../src/lib/api';
import { createAdminCoupons } from '../src/lib/coupons';
import { digest } from '../src/lib/security';
import { normalizeCouponCode } from '../src/lib/coupon-format';
import { prepareAdminCoupons, couponListText, readCouponBackup } from '../src/lib/coupon-issuance';
import worker from '../src/worker';

class D1 {
  db = new DatabaseSync(':memory:');
  queue = Promise.resolve();
  constructor() {
    for (const f of readdirSync('migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      this.db.exec(readFileSync('migrations/' + f, 'utf8'));
    this.db.exec(readFileSync('tests/fixtures/orchard-seed.sql', 'utf8'));
    this.db.exec('UPDATE products SET stock=100');
  }
  prepare(sql: string) {
    let args: any[] = [];
    const s: any = {
      bind(...a: any[]) {
        args = a;
        return s;
      },
      first: async () => this.db.prepare(sql).get(...args) || null,
      all: async () => ({ results: this.db.prepare(sql).all(...args), success: true }),
      run: async () => ({
        meta: { changes: Number(this.db.prepare(sql).run(...args).changes) },
        success: true,
      }),
    };
    return s;
  }
  batch(statements: any[]) {
    const run = this.queue.then(async () => {
      this.db.exec('BEGIN');
      try {
        const rows = [];
        for (const statement of statements) rows.push(await statement.run());
        this.db.exec('COMMIT');
        return rows;
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
function setup() {
  const DB = new D1();
  return {
    db: DB.db,
    env: { DB, DEMO_MODE: 'true', APP_ORIGIN: 'http://localhost:4321' } as unknown as Env,
  };
}
async function call(env: Env, path: string, body?: unknown, origin = 'http://localhost:4321') {
  const r = await api(
    new Request('http://localhost:4321/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'cf-access-authenticated-user-email': 'owner@example.com',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: r.status, data: (await r.json()) as any, headers: r.headers };
}
const draft = (pay = 95, count = 3) => ({
  ...prepareAdminCoupons('本地优惠券夹具', pay, count, 7),
  saved: true,
});
const count = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;

test('admin draft generates unique 80-bit codes, downloadable rules and an exact recoverable request', () => {
  const d = draft(95, 200);
  assert.equal(new Set(d.codes).size, 200);
  for (const c of d.codes)
    assert.match(normalizeCouponCode(c), /^TH95[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$/);
  assert.match(couponListText(d), /9.5 折.*200 张/);
  assert.match(couponListText(d), /待启用/);
  const restored = readCouponBackup(JSON.stringify({ format: 'orchard-coupons-v1', draft: d }));
  assert.equal(restored.request_id, d.request_id);
  assert.deepEqual(restored.codes, d.codes);
  for (const bad of [
    {},
    { format: 'orchard-coupons-v1', draft: { ...d, codes: [d.codes[0], d.codes[0]] } },
    { format: 'orchard-coupons-v1', draft: { ...d, pay_percent: 100 } },
  ])
    assert.throws(() => readCouponBackup(JSON.stringify(bad)));
  for (const args of [
    [0, 1, 7],
    [100, 1, 7],
    [95, 0, 7],
    [95, 201, 7],
    [95, 1, 0],
    [95, 1, 366],
  ])
    assert.throws(() => prepareAdminCoupons('本地', ...(args as [number, number, number])));
});

test('creation stores only hashes, starts a seven-day window at D1 time and prices new discounts correctly', async () => {
  const { env, db } = setup();
  const d = draft(95, 23);
  const r = await call(env, '/admin/coupons/create', d);
  assert.equal(r.status, 200);
  assert.equal(r.data.batch.total, 23);
  assert.equal(count(db, 'coupon_batches'), 1);
  assert.equal(count(db, 'coupons'), 23);
  const b = db
    .prepare('SELECT unixepoch(expires_at)-unixepoch(starts_at) seconds FROM coupon_batches')
    .get() as any;
  assert.equal(b.seconds, 604800);
  const records = JSON.stringify(db.prepare('SELECT * FROM coupons').all());
  for (const code of d.codes) {
    assert(!records.includes(code));
    assert(!records.includes(normalizeCouponCode(code)));
    assert(!JSON.stringify(r.data).includes(code));
  }
  assert.equal(
    (db.prepare('SELECT code_hash FROM coupons WHERE id=?').get(r.data.batch.id + ':0') as any)
      .code_hash,
    await digest(normalizeCouponCode(d.codes[0])),
  );
  for (const [sku, amount] of [
    ['FAMILY', 540],
    ['GIFT', 640],
  ] as const) {
    const q = await call(env, '/coupons/quote', { sku, code: d.codes[0] });
    assert.equal(q.status, 200);
    assert.equal(q.data.discount_amount, amount);
  }
  assert.match(couponListText(d, r.data.batch), /已创建；有效期/);
  assert.equal(count(db, 'orders'), 0);
  assert.equal(count(db, 'coupon_reservations'), 0);
  assert.equal((db.prepare('SELECT SUM(stock) n FROM products').get() as any).n, 400);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('x-robots-tag')!, /noindex/);
});

test('same request can be retried after a lost response without new coupons, an extended expiry or duplicate audit', async () => {
  const { env, db } = setup();
  const d = draft();
  const first = await call(env, '/admin/coupons/create', d);
  const before = JSON.stringify(db.prepare('SELECT * FROM coupon_batches').all());
  assert.deepEqual((await call(env, '/admin/coupons/create', d)).data, first.data);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM coupon_batches').all()), before);
  assert.equal(count(db, 'coupons'), 3);
  assert.equal(count(db, 'audit_log'), 1);
  assert.equal((await call(env, '/admin/coupons/create', { ...d, valid_days: 8 })).status, 409);
  await assert.rejects(createAdminCoupons(env, 'another-admin', d), /创建请求内容已变化/);
  assert.equal(count(db, 'coupons'), 3);
});

test('a maximum 200-code batch respects D1 bind and query budgets at the supported discount and duration bounds', async () => {
  const { env, db } = setup();
  const original = env.DB.prepare.bind(env.DB);
  let queries = 0;
  env.DB.prepare = ((sql: string) => {
    queries++;
    assert((sql.match(/\?/g) || []).length <= 100);
    return original(sql);
  }) as typeof env.DB.prepare;
  const result = await call(env, '/admin/coupons/create', { ...draft(99, 200), valid_days: 365 });
  assert.equal(result.status, 200);
  assert.equal(count(db, 'coupons'), 200);
  assert(queries < 50);
  assert.equal(
    (
      db
        .prepare('SELECT unixepoch(expires_at)-unixepoch(starts_at) seconds FROM coupon_batches')
        .get() as any
    ).seconds,
    365 * 86400,
  );
});

test('concurrent retries issue once; conflicting payloads with the same request ID cannot mix batches', async () => {
  const { env, db } = setup();
  const d = draft();
  const results = await Promise.all([
    call(env, '/admin/coupons/create', d),
    call(env, '/admin/coupons/create', d),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.equal(count(db, 'coupons'), 3);
  assert.equal(count(db, 'audit_log'), 1);
  const conflict = draft(88, 2);
  const r = await Promise.all([
    call(env, '/admin/coupons/create', conflict),
    call(env, '/admin/coupons/create', { ...conflict, name: '另一份名称' }),
  ]);
  assert.deepEqual(r.map((r) => r.status).sort(), [200, 409]);
  assert.equal(count(db, 'coupons'), 5);
  assert.equal(count(db, 'coupon_batches'), 2);
});

test('invalid rates, sizes, validity, confirmation and malformed or duplicate codes cannot issue coupons', async () => {
  const { env, db } = setup();
  const d = draft();
  const invalid = [
    { pay_percent: 0 },
    { pay_percent: 100 },
    { pay_percent: 9 },
    { pay_percent: 88.5 },
    { valid_days: 0 },
    { valid_days: 366 },
    { valid_days: 1.5 },
    { name: '一' },
    { saved: false },
    { request_id: 'bad' },
    { codes: [] },
    { codes: Array(201).fill(d.codes[0]) },
    { codes: ['not-a-coupon'] },
    { codes: [d.codes[0], d.codes[0]] },
    { codes: d.codes.map((c) => c.replace('TH95', 'TH88')) },
  ];
  for (const item of invalid)
    assert.equal((await call(env, '/admin/coupons/create', { ...d, ...item })).status, 400);
  assert.equal(count(db, 'coupon_batches'), 0);
  assert.equal(count(db, 'coupons'), 0);
});

test('a cross-batch code collision rolls back the whole second batch instead of issuing partial coupons', async () => {
  const { env, db } = setup();
  const d = draft();
  assert.equal((await call(env, '/admin/coupons/create', d)).status, 200);
  const other = { ...draft(), codes: [draft().codes[0], d.codes[0]] };
  assert.equal((await call(env, '/admin/coupons/create', other)).status, 409);
  assert.equal(count(db, 'coupon_batches'), 1);
  assert.equal(count(db, 'coupons'), 3);
  assert.equal(count(db, 'audit_log'), 1);
});

test('an unexpected database failure rolls back issuance and the original saved draft remains safe to retry', async () => {
  const { env, db } = setup();
  const d = draft();
  db.exec(
    "CREATE TRIGGER fail_coupon BEFORE INSERT ON coupons BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
  );
  assert.equal((await call(env, '/admin/coupons/create', d)).status, 500);
  assert.equal(count(db, 'coupon_batches'), 0);
  assert.equal(count(db, 'audit_log'), 0);
  db.exec('DROP TRIGGER fail_coupon');
  assert.equal((await call(env, '/admin/coupons/create', d)).status, 200);
  assert.equal(count(db, 'coupons'), 3);
});

test('discount, status and literal search combine with server pagination beyond the former 1000-code cap', async () => {
  const { env, db } = setup();
  const d = draft(95, 21);
  const b = (await call(env, '/admin/coupons/create', d)).data.batch;
  await call(env, '/admin/coupons/create', draft(88, 2));
  await call(env, '/admin/coupons/create', draft(80, 2));
  await call(env, '/admin/coupons/disable', { id: b.id + ':0', disabled: true });
  assert.equal(
    (await call(env, '/admin/coupons/search', { percent_off: 5, status: 'available' })).data.total,
    20,
  );
  assert.equal(
    (await call(env, '/admin/coupons/search', { percent_off: 5, status: 'disabled' })).data.total,
    1,
  );
  for (const search of ['%', '_', "' OR 1=1 --"])
    assert.equal((await call(env, '/admin/coupons/search', { search })).data.total, 0);
  assert.equal((await call(env, '/admin/coupons/search', { search: '本地优惠' })).data.total, 25);
  const insert = db.prepare(
    'INSERT INTO coupons(id,batch_id,code_hash,code_hint,percent_off) VALUES(?,?,?,?,5)',
  );
  for (let i = 0; i < 1100; i++)
    insert.run(
      'older-' + i,
      b.id,
      'local-hash-' + i,
      'TH95-****-****-****-' + String(i).padStart(4, '0'),
    );
  const page = await call(env, '/admin/coupons/search', { percent_off: 5, page: 57 });
  assert.equal(page.data.total, 1121);
  assert.equal(page.data.codes.length, 1);
  assert.deepEqual(
    page.data.discounts.map((x: any) => x.percent_off),
    [5, 12, 20],
  );
  assert(!JSON.stringify(page.data).includes('code_hash'));
  assert(!JSON.stringify(page.data).includes('issuance_fingerprint'));
  assert.equal((await call(env, '/admin/coupons/search', { percent_off: 91 })).status, 400);
});

test('issuance is throttled for new requests while a successful saved request remains retriable', async () => {
  const { env, db } = setup();
  const first = draft(99, 1);
  assert.equal((await call(env, '/admin/coupons/create', first)).status, 200);
  for (let i = 0; i < 9; i++)
    assert.equal((await call(env, '/admin/coupons/create', draft(10, 1))).status, 200);
  assert.equal((await call(env, '/admin/coupons/create', draft(10, 1))).status, 429);
  assert.equal((await call(env, '/admin/coupons/create', first)).status, 200);
  assert.equal(count(db, 'coupon_batches'), 10);
});

test('new coupon routes reject impersonation and cross-origin requests before data access', async () => {
  const { env } = setup();
  const locked = {
    ...env,
    DEMO_MODE: 'false',
    ACCESS_TEAM_DOMAIN: 'coupon-access-test.cloudflareaccess.com',
    ACCESS_AUD: 'fixture',
    ADMIN_EMAIL: 'owner@example.com',
    DB: {
      prepare() {
        throw Error('must not read');
      },
    },
  } as unknown as Env;
  for (const path of ['/admin/coupons/search', '/admin/coupons/create']) {
    assert.equal((await call(locked, path, {})).status, 401);
    assert.equal((await call(env, path, {}, 'https://evil.example')).status, 403);
  }
});

test('admin paths, management APIs and private PDFs deny anonymous readers with no-store and noindex', async () => {
  const env = {
    APP_ORIGIN: 'https://shop.example.com',
    DEMO_MODE: 'false',
    ASSETS: {
      async fetch() {
        throw Error('private paths cannot use public assets');
      },
    },
    MEDIA: {
      async get() {
        throw Error('private PDFs cannot be read anonymously');
      },
    },
  } as unknown as Env;
  const ctx = { waitUntil() {} } as unknown as ExecutionContext;
  for (const path of [
    '/admin',
    '/admin/',
    '/admin/unknown',
    '/api/admin/coupons',
    '/api/admin/coupons/search',
    '/media/apple-2026/aaaaaaaa-aaaa.pdf',
  ]) {
    const response = await worker.fetch(new Request('https://shop.example.com' + path), env, ctx);
    assert([401, 503].includes(response.status), path);
    assert.match(response.headers.get('cache-control')!, /no-store/);
    assert.match(response.headers.get('x-robots-tag')!, /noindex/);
    assert.match(response.headers.get('x-robots-tag')!, /nofollow/);
    assert(!/code_hash|percent_off|coupons|pin_hash/.test(await response.text()));
  }
});
