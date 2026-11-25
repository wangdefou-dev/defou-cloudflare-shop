import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { giftBatchStatements, adminGifts } from '../src/lib/gifts';
import { MAP_CACHE_KEY, publicMap, rebuildMap } from '../src/lib/database';
import { cityQuantity, footprintSummary } from '../src/lib/map-geometry';
import { dailyReportMessage } from '../src/lib/notifications';
import { api } from '../src/lib/api';

// Fictional city/box fixtures only. Never read or import the merchant's real spreadsheet.
class MemoryD1 {
  db = new DatabaseSync(':memory:');
  queue = Promise.resolve();
  constructor(beforeGiftMigration = false) {
    for (const file of readdirSync('migrations')
      .filter((f) => f.endsWith('.sql') && (!beforeGiftMigration || f < '0013'))
      .sort())
      this.db.exec(readFileSync('migrations/' + file, 'utf8'));
    this.db.exec(readFileSync('scripts/seed.sql', 'utf8'));
    this.db.exec(readFileSync('scripts/regions.sql', 'utf8'));
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
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.db.exec('COMMIT');
        return results;
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
function setup() {
  const DB = new MemoryD1(),
    cache = new Map<string, string>();
  const env = {
    DB,
    DEMO_MODE: 'true',
    APP_ORIGIN: 'http://localhost:4321',
    CACHE: {
      put: async (key: string, value: string) => {
        cache.set(key, value);
      },
      get: async (key: string) => (cache.has(key) ? JSON.parse(cache.get(key)!) : null),
    },
  } as unknown as Env;
  return { DB, db: DB.db, env, cache };
}
const count = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;
const draft = () => ({
  id: crypto.randomUUID(),
  source_hash: 'a'.repeat(64),
  name: '本地赠送夹具',
  shipped_date: null,
  confirmed_shipped: true,
  entries: [
    { source_row: 2, province_code: '440000', city_code: '440400', qty: 2 },
    { source_row: 3, province_code: '500000', city_code: '500100', qty: 3 },
    { source_row: 4, province_code: '440000', city_code: '440400', qty: 4 },
  ],
});
async function importBatch(env: Env, input: unknown) {
  const statements = await giftBatchStatements(env, input);
  if (statements.length) await env.DB.batch(statements);
}
function seedCommerce(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO orders(id,order_no,type,phone,amount,expires_at,address_json)
    VALUES('gift-paid-retail','DF-GIFT-PAID','retail','13812345678',10800,datetime('now','+30 minutes'),?)`,
  ).run(
    JSON.stringify({
      recipient: '私密姓名',
      phone: '13812345678',
      province: '广东省',
      city: '珠海市',
      district: '私密区县',
      address: '私密门牌',
    }),
  );
  db.exec(
    "INSERT INTO order_items VALUES('gift-paid-item','gift-paid-retail','FAMILY',1); UPDATE orders SET status='paid',paid_at='2026-10-28 00:00:00' WHERE id='gift-paid-retail'; INSERT INTO orders(id,order_no,type,phone,amount,expires_at,plate_name,pin_hash) VALUES('gift-paid-tree','DF-GIFT-TREE','adoption','13812345678',88800,datetime('now','+30 minutes'),'私密铭牌','私密PIN'); INSERT INTO order_items VALUES('gift-tree-item','gift-paid-tree','PA',1); UPDATE orders SET status='paid',paid_at='2026-10-28 00:00:00' WHERE id='gift-paid-tree'",
  );
  db.exec(
    "INSERT INTO shipments(id,source,source_id,product_id,qty,recipient,phone,province_code,city_code,district_code,region_label,address,status) VALUES('gift-paid-shipment','retail','gift-paid-retail','FAMILY',1,'私密姓名','13812345678','440000','440400','440402','广东省 / 珠海市 / 私密区县','私密门牌','reserved'); INSERT INTO sponsor_apps(id,app_no,org_name,event_name,event_date,headcount,contact,phone,address_json,reason) VALUES('gift-existing-sponsor','AP-GIFT-LOCAL','私密公司','私密活动','2026-11-10',12,'私密联系人','13812345678','私密地址','私密理由')",
  );
}
function commerceSnapshot(db: DatabaseSync) {
  const tables = [
    'products',
    'orders',
    'order_items',
    'adoptions',
    'shipments',
    'sponsor_apps',
    'commerce_notifications',
    'notification_deliveries',
    'sponsor_notifications',
    'refund_notifications',
    'notifications',
    'coupon_uses',
  ];
  return Object.fromEntries(
    tables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
  );
}
async function call(env: Env, path: string) {
  const response = await api(new Request('http://localhost:4321/api' + path), env);
  return {
    status: response.status,
    headers: response.headers,
    data: (await response.json()) as any,
  };
}

test('gift migration starts empty and preserves paid commerce, adoption rights, stock and notification history', () => {
  const DB = new MemoryD1(true);
  seedCommerce(DB.db);
  const before = commerceSnapshot(DB.db);
  DB.db.exec(readFileSync('migrations/0013_gift_footprints.sql', 'utf8'));
  assert.equal(count(DB.db, 'gift_batches'), 0);
  assert.equal(count(DB.db, 'gift_deliveries'), 0);
  assert.deepEqual(commerceSnapshot(DB.db), before);
  const columns = (DB.db.prepare('PRAGMA table_info(gift_deliveries)').all() as any[]).map(
    (r) => r.name,
  );
  for (const field of ['recipient', 'phone', 'address', 'district_code', 'sku', 'product_id'])
    assert(!columns.includes(field));
});

test('a confirmed gift batch records only source rows and city box counts; equivalent retries bind to the first source-hash batch', async () => {
  const { env, db } = setup(),
    input = draft();
  await importBatch(env, input);
  await importBatch(env, input);
  await importBatch(env, {
    ...input,
    id: crypto.randomUUID(),
    entries: [...input.entries]
      .reverse()
      .map((e) => (e.province_code === '500000' ? { ...e, city_code: '500200' } : e)),
  });
  assert.equal(count(db, 'gift_batches'), 1);
  assert.equal(count(db, 'gift_deliveries'), 3);
  const batch = db.prepare('SELECT * FROM gift_batches').get() as any;
  assert.equal(batch.id, input.id);
  assert.equal(batch.source_hash, input.source_hash);
  assert.equal(batch.status, 'active');
  assert.equal(batch.row_count, 3);
  assert.equal(batch.box_count, 9);
  assert.equal(batch.shipped_date, null);
  assert.match(batch.content_hash, /^[a-f0-9]{64}$/);
  const city = db.prepare('SELECT city_code FROM gift_deliveries WHERE source_row=3').get() as any;
  assert.equal(city.city_code, '500000');
  const stats = await adminGifts(env);
  assert.deepEqual(
    { ...stats.totals },
    { batches: 1, records: 3, boxes: 9, cities: 2, provinces: 2 },
  );
  assert.equal(stats.batches[0].cities.length, 2);
  assert.equal(stats.batches[0].cities.find((c) => c.city_code === '440400')?.qty, 6);
  assert.equal(stats.batches[0].cities.find((c) => c.city_code === '500000')?.qty, 3);
});

test('simultaneous imports of the same source and content cannot duplicate gifts even when the request UUID differs', async () => {
  const { env, db } = setup(),
    input = draft();
  await Promise.all([
    importBatch(env, input),
    importBatch(env, { ...input, id: crypto.randomUUID() }),
  ]);
  assert.equal(count(db, 'gift_batches'), 1);
  assert.equal(count(db, 'gift_deliveries'), 3);
  assert.equal((db.prepare('SELECT SUM(qty) n FROM gift_deliveries').get() as any).n, 9);
  assert.equal((await adminGifts(env)).totals.boxes, 9);
});

test('a source-hash/content conflict rejects the new batch and preserves the original active footprint', async () => {
  const { env, db } = setup(),
    input = draft();
  await importBatch(env, input);
  const before = {
    batches: db.prepare('SELECT * FROM gift_batches').all(),
    deliveries: db.prepare('SELECT * FROM gift_deliveries ORDER BY source_row').all(),
  };
  await assert.rejects(
    importBatch(env, {
      ...input,
      id: crypto.randomUUID(),
      entries: input.entries.map((e, i) => (i ? e : { ...e, qty: 99 })),
    }),
  );
  assert.deepEqual(
    {
      batches: db.prepare('SELECT * FROM gift_batches').all(),
      deliveries: db.prepare('SELECT * FROM gift_deliveries ORDER BY source_row').all(),
    },
    before,
  );
});

test('unconfirmed shipping, invalid city/province ownership, negative quantities and duplicate source rows cannot import', async () => {
  const { env, db } = setup(),
    input = draft();
  const invalid = [
    { ...input, confirmed_shipped: false },
    { ...input, confirmed_shipped: undefined },
    { ...input, source_hash: 'invalid' },
    { ...input, id: 'invalid' },
    { ...input, name: '' },
    { ...input, entries: [] },
    {
      ...input,
      entries: [{ source_row: 2, province_code: '440000', city_code: '320100', qty: 1 }],
    },
    {
      ...input,
      entries: [{ source_row: 2, province_code: '999999', city_code: '320100', qty: 1 }],
    },
    {
      ...input,
      entries: [{ source_row: 2, province_code: '440000', city_code: '440402', qty: 1 }],
    },
    {
      ...input,
      entries: [{ source_row: 2, province_code: '440000', city_code: '999900', qty: 1 }],
    },
    {
      ...input,
      entries: [{ source_row: 2, province_code: '440000', city_code: '500100', qty: 1 }],
    },
    { ...input, entries: [{ ...input.entries[0], qty: 0 }] },
    { ...input, entries: [{ ...input.entries[0], qty: -1 }] },
    { ...input, entries: [{ ...input.entries[0], qty: 1.5 }] },
    { ...input, entries: [{ ...input.entries[0], source_row: 1.5 }] },
    { ...input, entries: [input.entries[0], { ...input.entries[1], source_row: 2 }] },
  ];
  for (const item of invalid) await assert.rejects(importBatch(env, item));
  assert.equal(count(db, 'gift_batches'), 0);
  assert.equal(count(db, 'gift_deliveries'), 0);
});

test('drafts stay private until complete activation and an interrupted transaction can safely retry the same source', async () => {
  const { env, db } = setup(),
    input = draft(),
    statements = await giftBatchStatements(env, input);
  assert(statements.length >= 3);
  await statements[0].run();
  assert.throws(() =>
    db
      .prepare("UPDATE gift_batches SET status='active' WHERE source_hash=?")
      .run(input.source_hash),
  );
  let map = await rebuildMap(env);
  assert.equal(
    map.cities.reduce((n, c) => n + c.gifted, 0),
    0,
  );
  assert.equal((await adminGifts(env)).totals.boxes, 0);
  await env.DB.batch(statements.slice(1, -1));
  map = await rebuildMap(env);
  assert.equal(
    map.cities.reduce((n, c) => n + c.gifted, 0),
    0,
  );
  await statements.at(-1)!.run();
  assert.equal((await adminGifts(env)).totals.boxes, 9);
  const retry = { ...draft(), source_hash: 'b'.repeat(64) };
  db.exec(
    "CREATE TRIGGER local_gift_insert_failure BEFORE INSERT ON gift_deliveries WHEN NEW.source_row=3 BEGIN SELECT RAISE(ABORT,'local gift import failure'); END",
  );
  await assert.rejects(importBatch(env, retry));
  assert.equal(count(db, 'gift_batches'), 1);
  assert.equal(count(db, 'gift_deliveries'), 3);
  db.exec('DROP TRIGGER local_gift_insert_failure');
  await importBatch(env, retry);
  assert.equal(count(db, 'gift_batches'), 2);
  assert.equal(count(db, 'gift_deliveries'), 6);
});

test('gift footprints merge by real city but never count as sales, paid adoption trees, sponsored boxes, stock or notifications', async () => {
  const { env, db, cache } = setup();
  seedCommerce(db);
  const before = commerceSnapshot(db),
    report = await dailyReportMessage(env, '2026-10-28', new Date('2026-10-28T16:05:00Z'));
  const baseline = await rebuildMap(env);
  assert.equal(baseline.adoption_trees, 1);
  await importBatch(env, draft());
  const map = await rebuildMap(env),
    gd = map.cities.find((c) => c.city_code === '440400')!,
    cq = map.cities.find((c) => c.city_code === '500000')!;
  assert.equal(gd.boxes, 1);
  assert.equal(gd.gifted, 6);
  assert.equal(cq.gifted, 3);
  assert.equal(cq.boxes, 0);
  assert.equal(gd.sponsored, 0);
  assert.equal(cq.sponsored, 0);
  assert.equal(map.adoption_trees, 1);
  assert.equal(footprintSummary(map, 'orders').total, 1);
  assert.equal(footprintSummary(map, 'sponsor').total, 0);
  assert.equal(footprintSummary(map, 'all').total, 10);
  assert.equal(cityQuantity(gd, 'orders'), 1);
  assert.equal(cityQuantity(cq, 'orders'), 0);
  assert.deepEqual(
    map.recent,
    baseline.recent,
    'Unknown gift shipping dates must not be invented as recent activity',
  );
  assert.equal(MAP_CACHE_KEY, 'map:city:v5');
  assert(cache.has(MAP_CACHE_KEY));
  assert.deepEqual(commerceSnapshot(db), before);
  assert.equal(
    await dailyReportMessage(env, '2026-10-28', new Date('2026-10-28T16:05:00Z')),
    report,
  );
  const result = await call(env, '/map');
  assert.equal(result.status, 200);
  assert.equal(result.data.cities.find((c: any) => c.city_code === '440400').gifted, 6);
});

test('public map exposes only city aggregate gift counts and never import hashes, original rows or private shipment fields', async () => {
  const { env, db } = setup(),
    input = draft();
  seedCommerce(db);
  await importBatch(env, input);
  const map = await rebuildMap(env);
  const injected = {
    ...map,
    source_hash: input.source_hash,
    batch_name: input.name,
    cities: map.cities.map((c) => ({
      ...c,
      source_row: 2,
      recipient: '私密姓名',
      phone: '13812345678',
      address: '私密门牌',
      source_hash: input.source_hash,
    })),
    recent: map.recent.map((c) => ({ ...c, source_row: 2, phone: '13812345678' })),
  };
  const safe = publicMap(injected);
  for (const city of safe.cities)
    assert.deepEqual(
      Object.keys(city).sort(),
      [
        'city_code',
        'province_code',
        'region_label',
        'boxes',
        'adopted',
        'sponsored',
        'gifted',
      ].sort(),
    );
  assert(safe.cities.every((c) => !/区县/.test(c.region_label)));
  for (const item of safe.recent)
    assert.deepEqual(Object.keys(item).sort(), ['region_label', 'qty', 'source'].sort());
  const text = JSON.stringify(safe);
  assert.doesNotMatch(
    text,
    /私密|13812345678|source_hash|source_row|recipient|phone|address|batch_name/,
  );
  assert(!text.includes(input.name));
  assert(!text.includes(input.source_hash));
});

test('voiding a gift batch removes only its gifts, without restoring stock or reactivating the batch on a file retry', async () => {
  const { env, db } = setup();
  seedCommerce(db);
  const before = commerceSnapshot(db),
    input = draft();
  await importBatch(env, input);
  db.prepare("UPDATE gift_batches SET status='void' WHERE source_hash=?").run(input.source_hash);
  let map = await rebuildMap(env);
  assert.equal(
    map.cities.reduce((n, c) => n + c.gifted, 0),
    0,
  );
  assert.equal(footprintSummary(map, 'orders').total, 1);
  assert.equal((await adminGifts(env)).totals.boxes, 0);
  try {
    await importBatch(env, { ...input, id: crypto.randomUUID() });
  } catch {
    /* a void batch may also explicitly reject replay */
  }
  assert.equal(
    (
      db
        .prepare('SELECT status FROM gift_batches WHERE source_hash=?')
        .get(input.source_hash) as any
    ).status,
    'void',
  );
  map = await rebuildMap(env);
  assert.equal(
    map.cities.reduce((n, c) => n + c.gifted, 0),
    0,
  );
  assert.deepEqual(commerceSnapshot(db), before);
});

test('gift admin data remains private behind the existing administrator authentication', async () => {
  const { env } = setup();
  await importBatch(env, draft());
  const permitted = await call(env, '/admin/gifts');
  assert.equal(permitted.status, 200);
  assert.equal(permitted.data.totals.boxes, 9);
  assert.match(permitted.headers.get('cache-control')!, /no-store/);
  assert.match(permitted.headers.get('x-robots-tag')!, /noindex/);
  const locked = {
    ...env,
    DEMO_MODE: 'false',
    ACCESS_TEAM_DOMAIN: 'local-gifts-access.cloudflareaccess.com',
    ACCESS_AUD: 'local-fixture',
    ADMIN_EMAIL: 'owner@example.com',
    DB: {
      prepare() {
        throw Error('must not access gift data before authentication');
      },
    },
  } as unknown as Env;
  const rejected = await call(locked, '/admin/gifts');
  assert.equal(rejected.status, 401);
  assert.match(rejected.headers.get('cache-control')!, /no-store/);
  assert.match(rejected.headers.get('x-robots-tag')!, /noindex/);
  assert(!JSON.stringify(rejected.data).includes('gift_batches'));
});
