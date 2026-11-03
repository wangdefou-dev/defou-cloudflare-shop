import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { api } from '../src/lib/api';
import { pinHash, verifyPin } from '../src/lib/security';

class D1 {
  db = new DatabaseSync(':memory:');
  constructor() {
    for (const f of readdirSync('migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      this.db.exec(readFileSync('migrations/' + f, 'utf8'));
    this.db.exec(readFileSync('tests/fixtures/orchard-seed.sql', 'utf8'));
    this.db.exec('UPDATE products SET stock=1000');
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
  async batch(statements: any[]) {
    this.db.exec('BEGIN');
    try {
      const r = [];
      for (const s of statements) r.push(await s.run());
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
async function call(env: any, path: string, body?: any, headers: Record<string, string> = {}) {
  const r = await api(
    new Request('http://localhost:4321/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin: 'http://localhost:4321', 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: r.status, headers: r.headers, data: (await r.json()) as any };
}
const hash = pinHash('000123');
async function setup() {
  const DB = new D1();
  const db = DB.db;
  function order(id: string, phone = '13800000001', sku = 'FAMILY', status = 'paid', qty = 1) {
    const type = ['PA', 'FG'].includes(sku) ? 'adoption' : 'retail';
    db.prepare(
      `INSERT INTO orders(id,order_no,type,phone,amount,expires_at,plate_name,pin_hash,address_json) VALUES(?,?,?,?,?,'2026-11-30','小山树',?,?)`,
    ).run(
      id,
      'DF-' + id,
      type,
      phone,
      sku === 'FG' ? 188800 : sku === 'PA' ? 88800 : sku === 'GIFT' ? 12800 * qty : 10800 * qty,
      oldHash,
      JSON.stringify({
        recipient: id.includes('other') ? '另一位收件人' : '山里收件人',
        phone,
        address: '仅本地虚构地址',
      }),
    );
    db.prepare('INSERT INTO order_items VALUES(?,?,?,?)').run('item-' + id, id, sku, qty);
    if (status !== 'pending')
      db.prepare("UPDATE orders SET status='paid',paid_at='2026-10-23 01:00:00' WHERE id=?").run(
        id,
      );
    if (status === 'refunded') db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(id);
  }
  const oldHash = await hash;
  order('family', '13800000001', 'FAMILY', 'paid', 2);
  order('tree', '13800000001', 'FG');
  order('pending', '13800000001', 'GIFT', 'pending');
  order('other', '13800000002', 'PA');
  const a = db.prepare("SELECT * FROM adoptions WHERE order_id='tree'").get() as any;
  const other = db.prepare("SELECT * FROM adoptions WHERE order_id='other'").get() as any;
  const env: any = { DB, DEMO_MODE: 'true', APP_ORIGIN: 'http://localhost:4321' };
  return { env, db, a, other, order, oldHash };
}
const reset = (id: number, extra: any = {}) => ({
  id,
  version: 0,
  pin: '001234',
  confirm_pin: '001234',
  reason: '客户忘记，核对后重置',
  verified: true,
  ...extra,
});
const n = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;

test('customer search groups by buyer phone, supports full phone/name/order/adoption and never returns PINs or raw phone lists', async () => {
  const { env, a, oldHash } = await setup();
  const all = await call(env, '/admin/people/search', { kind: 'customers' });
  assert.equal(all.data.total, 2);
  assert.equal(all.data.rows.find((r: any) => r.phone === '138****0001').total_orders, 3);
  assert.equal(all.data.rows.find((r: any) => r.phone === '138****0001').paid_orders, 2);
  assert.equal(all.data.rows.find((r: any) => r.phone === '138****0001').paid_amount, 210400);
  for (const query of ['13800000001', '138 0000 0001', '山里收件人', 'DF-tree', a.adopt_code]) {
    const result = await call(env, '/admin/people/search', { kind: 'customers', query });
    assert.equal(result.status, 200);
    assert.equal(result.data.total, 1);
  }
  for (const query of ["' OR 1=1 --", '%', '_'])
    assert.equal(
      (await call(env, '/admin/people/search', { kind: 'customers', query })).data.total,
      0,
    );
  assert.equal(
    (await call(env, '/admin/people/search', { kind: 'customers', page_size: 1, page: 2 })).data
      .rows.length,
    1,
  );
  assert.doesNotMatch(JSON.stringify(all.data), /13800000001|pin_hash|token_hash|000123/);
  assert(!JSON.stringify(all.data).includes(oldHash));
  assert.equal(all.headers.get('cache-control'), 'no-store');
});

test('customer detail is audited, paginates all associated orders and preserves buyer isolation', async () => {
  const { env, db, order, oldHash } = await setup();
  for (let i = 0; i < 24; i++) order('more-' + i);
  const result = await call(env, '/admin/customer-detail', { id: 'family' });
  assert.equal(result.data.customer.phone, '13800000001');
  assert.equal(result.data.orders_total, 27);
  assert.equal(result.data.orders.length, 20);
  assert.equal(result.data.adoptions.length, 1);
  assert.equal(result.data.adoptions[0].order_id, 'tree');
  assert.equal(
    (await call(env, '/admin/customer-detail', { id: 'family', page: 2 })).data.orders.length,
    7,
  );
  assert(!JSON.stringify(result.data).includes('DF-other'));
  assert(!JSON.stringify(result.data).includes(oldHash));
  assert.doesNotMatch(
    JSON.stringify(result.data),
    /pin_hash|token_hash|idempotency_key|address_json/,
  );
  assert.equal(n(db, 'audit_log'), 2);
  assert.equal((await call(env, '/admin/customer-detail', { id: 'missing' })).status, 404);
});

test('adoption search/detail show settings and rights without credential material; nickname edits preserve entitlements', async () => {
  const { env, db, a, oldHash } = await setup();
  const list = await call(env, '/admin/people/search', {
    kind: 'adoptions',
    query: '13800000001',
    filter: 'active',
  });
  assert.equal(list.data.rows.length, 1);
  assert.equal(list.data.rows[0].phone, '138****0001');
  const detail = await call(env, '/admin/adoption-detail', { id: a.id });
  assert.equal(detail.data.phone, '13800000001');
  assert.equal(detail.data.has_pin, 1);
  assert.equal(detail.data.pin_version, 0);
  assert.deepEqual(detail.data.resets, []);
  assert(!JSON.stringify(detail.data).includes(oldHash));
  assert.doesNotMatch(JSON.stringify(detail.data), /pin_hash|000123|token_hash/);
  assert.equal(
    (await call(env, '/admin/adoption-name', { id: a.id, plate_name: '新的树牌' })).status,
    200,
  );
  const saved = db.prepare('SELECT * FROM adoptions WHERE id=?').get(a.id) as any;
  assert.equal(saved.plate_name, '新的树牌');
  assert.equal(saved.total_boxes, a.total_boxes);
  assert.equal(saved.used_boxes, 0);
  assert.equal(saved.pin_hash, oldHash);
  assert.equal(
    (db.prepare("SELECT plate_name FROM orders WHERE id='tree'").get() as any).plate_name,
    '新的树牌',
  );
});

test('PIN reset hashes leading-zero PINs, revokes only that adoption sessions and keeps an audit without any PIN/hash', async () => {
  const { env, db, a, other, oldHash } = await setup();
  const login = await call(env, '/tree/login', {
    phone: '13800000001',
    code: a.adopt_code,
    pin: '000123',
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  db.prepare("INSERT INTO sessions VALUES('other-session',?,datetime('now','+1 hour'))").run(
    other.id,
  );
  assert.equal((await call(env, '/tree/me', undefined, { cookie })).status, 200);
  assert.equal((await call(env, '/admin/adoption-pin', reset(a.id))).status, 200);
  const saved = db.prepare('SELECT * FROM adoptions WHERE id=?').get(a.id) as any;
  assert.notEqual(saved.pin_hash, oldHash);
  assert(await verifyPin('001234', saved.pin_hash));
  assert(!(await verifyPin('000123', saved.pin_hash)));
  assert.equal(saved.pin_version, 1);
  assert(saved.pin_updated_at);
  assert.equal(saved.total_boxes, a.total_boxes);
  assert.equal(saved.used_boxes, a.used_boxes);
  assert.equal(
    (db.prepare("SELECT pin_hash FROM orders WHERE id='tree'").get() as any).pin_hash,
    saved.pin_hash,
  );
  assert.equal(n(db, 'sessions'), 1);
  assert.equal((await call(env, '/tree/me', undefined, { cookie })).status, 401);
  assert.equal(
    (await call(env, '/tree/login', { phone: '13800000001', code: a.adopt_code, pin: '000123' }))
      .status,
    401,
  );
  assert.equal(
    (await call(env, '/tree/login', { phone: '13800000001', code: a.adopt_code, pin: '001234' }))
      .status,
    200,
  );
  const detail = await call(env, '/admin/adoption-detail', { id: a.id });
  assert.equal(detail.data.resets[0].reason, '客户忘记，核对后重置');
  assert.equal(detail.data.pin_version, 1);
  const records = JSON.stringify({
    detail: detail.data,
    resets: db.prepare('SELECT * FROM adoption_pin_resets').all(),
    audit: db.prepare('SELECT * FROM audit_log').all(),
  });
  assert(!records.includes(saved.pin_hash));
  assert(!records.includes(oldHash));
  assert.doesNotMatch(records, /001234|000123|confirm_pin|pin_hash/);
  assert.equal((await call(env, '/admin/adoption-pin', reset(a.id))).status, 409);
  assert.equal(n(db, 'adoption_pin_resets'), 1);
});

test('PIN reset rejects bad input, unconfirmed identity, refunds and stale revisions without modifying credentials', async () => {
  const { env, db, a, oldHash } = await setup();
  for (const patch of [
    { pin: '12345' },
    { pin: 123456 },
    { confirm_pin: '123456' },
    { verified: false },
    { reason: '新码001234' },
    { reason: '' },
    { version: -1 },
  ])
    assert.equal((await call(env, '/admin/adoption-pin', reset(a.id, patch))).status, 400);
  assert.equal((await call(env, '/admin/adoption-pin', reset(a.id, { version: 1 }))).status, 409);
  assert.equal((await call(env, '/admin/adoption-pin', reset(99999))).status, 404);
  db.prepare("UPDATE orders SET status='refunded' WHERE id='tree'").run();
  assert.equal((await call(env, '/admin/adoption-pin', reset(a.id))).status, 409);
  assert.equal(
    (db.prepare('SELECT pin_hash FROM adoptions WHERE id=?').get(a.id) as any).pin_hash,
    oldHash,
  );
  assert.equal(n(db, 'adoption_pin_resets'), 0);
  assert.equal(
    (await call(env, '/admin/people/search', { kind: 'adoptions', filter: 'inactive' })).data.total,
    1,
  );
});

test('simultaneous reset requests with one revision allow only one change', async () => {
  const { env, db, a } = await setup();
  const responses = await Promise.all([
    call(env, '/admin/adoption-pin', reset(a.id)),
    call(env, '/admin/adoption-pin', reset(a.id, { pin: '002345', confirm_pin: '002345' })),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(n(db, 'adoption_pin_resets'), 1);
  assert.equal(n(db, 'audit_log'), 1);
  assert.equal(
    (db.prepare('SELECT pin_version FROM adoptions WHERE id=?').get(a.id) as any).pin_version,
    1,
  );
});

test('a failed reset rolls back history, both hashes, revision and session revocation', async () => {
  const { env, db, a, oldHash } = await setup();
  db.prepare("INSERT INTO sessions VALUES('keep',?,datetime('now','+1 hour'))").run(a.id);
  db.exec(
    "CREATE TRIGGER fail_pin_revoke BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'local-reset-failure'); END;",
  );
  assert.equal((await call(env, '/admin/adoption-pin', reset(a.id))).status, 500);
  assert.equal(n(db, 'adoption_pin_resets'), 0);
  assert.equal(n(db, 'audit_log'), 0);
  assert.equal(n(db, 'sessions'), 1);
  const saved = db.prepare('SELECT * FROM adoptions WHERE id=?').get(a.id) as any;
  assert.equal(saved.pin_hash, oldHash);
  assert.equal(saved.pin_version, 0);
  assert.equal(
    (db.prepare("SELECT pin_hash FROM orders WHERE id='tree'").get() as any).pin_hash,
    oldHash,
  );
});

test('login verified just before reset cannot create a new session with the old credential', async () => {
  const { env, db, a } = await setup();
  const prepare = env.DB.prepare.bind(env.DB);
  let interrupted = false;
  env.DB.prepare = (sql: string) => {
    if (!sql.includes('INSERT INTO sessions(token_hash')) return prepare(sql);
    return {
      bind(...args: any[]) {
        return {
          run: async () => {
            interrupted = true;
            assert.equal((await call(env, '/admin/adoption-pin', reset(a.id))).status, 200);
            return prepare(sql)
              .bind(...args)
              .run();
          },
        };
      },
    };
  };
  const login = await call(env, '/tree/login', {
    phone: '13800000001',
    code: a.adopt_code,
    pin: '000123',
  });
  assert(interrupted);
  assert.equal(login.status, 409);
  assert.equal(n(db, 'sessions'), 0);
});

test('all new admin endpoints reject unsigned impersonation and cross-origin mutation before accessing customer data', async () => {
  const { env, db, a } = await setup();
  Object.assign(env, {
    DEMO_MODE: 'false',
    ACCESS_TEAM_DOMAIN: 'customers-admin-test.cloudflareaccess.com',
    ACCESS_AUD: 'admin-test',
    ADMIN_EMAIL: 'owner@example.com',
  });
  for (const [path, body] of [
    ['/admin/people/search', { kind: 'customers' }],
    ['/admin/customer-detail', { id: 'family' }],
    ['/admin/adoption-detail', { id: a.id }],
    ['/admin/adoption-pin', reset(a.id)],
    ['/admin/adoption-name', { id: a.id, plate_name: '不得写入' }],
  ] as const) {
    const result = await call(env, path, body, {
      'cf-access-authenticated-user-email': 'owner@example.com',
    });
    assert.equal(result.status, 401);
    assert.doesNotMatch(JSON.stringify(result.data), /13800000001|pin_hash|小山树/);
  }
  assert.equal(
    (await call(env, '/admin/adoption-pin', reset(a.id), { origin: 'https://other.example' }))
      .status,
    403,
  );
  assert.equal(n(db, 'adoption_pin_resets'), 0);
  assert.equal(n(db, 'audit_log'), 0);
});
