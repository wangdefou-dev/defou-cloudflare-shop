import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1, environment, call, retail } from './local-d1';
import CATALOG from '../src/lib/catalog-snapshot.json';

const product = async (env: Env, sku: string) =>
  (await call(env, '/config')).data.products.find((p: any) => p.sku === sku);
const edit = (p: any, changes: Record<string, unknown>) => ({
  id: p.id,
  content_revision: p.content_revision,
  name: p.name,
  price: p.price,
  unit_weight_g: p.unit_weight_g,
  count_per_box: p.count_per_box,
  tagline: p.tagline,
  description: p.description,
  image_url: p.image_url,
  ...changes,
});

test('admin edits name, price, specs, copy and image; new orders use the new price only', async () => {
  const DB = new LocalD1(),
    env = environment(DB);
  const before = await call(env, '/checkout', retail);
  assert.equal(before.status, 200, JSON.stringify(before.data));
  const family = await product(env, 'FAMILY');
  assert.equal(family.tagline, CATALOG.FAMILY.tagline);
  const image = '/media/apple-2026/0b9e5c1a-0000-4000-8000-000000000001.webp';
  const saved = await call(
    env,
    '/admin/product-content',
    edit(family, {
      name: '家庭分享装',
      price: 11800,
      count_per_box: 20,
      unit_weight_g: 260,
      tagline: '新一季',
      description: '介绍',
      image_url: image,
      reason: '季末调价',
    }),
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const after = await product(env, 'FAMILY');
  assert.equal(after.name, '家庭分享装');
  assert.equal(after.price, 11800);
  assert.equal(after.count_per_box, 20);
  assert.equal(after.image_url, image);
  assert.equal(after.content_revision, family.content_revision + 1);
  // The price change bumps the stock revision too, so an open stock form must refresh.
  assert.equal(after.revision, family.revision + 1);
  const order = await call(env, '/checkout', { ...retail, request_id: undefined });
  assert.equal(order.status, 200, JSON.stringify(order.data));
  assert.equal(order.data.amount, 11800);
  const old = DB.db.prepare('SELECT amount FROM orders WHERE id=?').get(before.data.id) as any;
  assert.equal(old.amount, 10800);
  const log = DB.db.prepare('SELECT * FROM product_changes').all() as any[];
  assert.equal(log.length, 1);
  assert.equal(JSON.parse(log[0].before_json).price, 10800);
  assert.equal(JSON.parse(log[0].after_json).price, 11800);
  assert.equal(log[0].reason, '季末调价');
  const history = await call(env, '/admin/product-changes?id=FAMILY');
  assert.equal(history.status, 200);
  assert.equal(history.data.length, 1);
});

test('product edits reject stale forms, missing price reasons and unsafe input', async () => {
  const DB = new LocalD1(),
    env = environment(DB);
  const gift = await product(env, 'GIFT');
  const noReason = await call(env, '/admin/product-content', edit(gift, { price: 13800 }));
  assert.equal(noReason.status, 400);
  assert.match(noReason.data.error, /原因/);
  assert.equal((await call(env, '/admin/product-content', edit(gift, {}))).status, 400);
  for (const bad of [
    { image_url: 'https://evil.example/x.png' },
    { image_url: '/media/apple-2026/abc.pdf' },
    { price: 50 },
    { name: '' },
    { extra: 1 },
  ])
    assert.equal(
      (await call(env, '/admin/product-content', edit(gift, bad))).status,
      400,
      JSON.stringify(bad),
    );
  assert.equal(
    (await call(env, '/admin/product-content', edit(gift, { tagline: '第一次' }))).status,
    200,
  );
  const stale = await call(env, '/admin/product-content', edit(gift, { tagline: '第二次' }));
  assert.equal(stale.status, 409);
  assert.equal((await product(env, 'GIFT')).tagline, '第一次');
  assert.equal((DB.db.prepare('SELECT COUNT(*) n FROM product_changes').get() as any).n, 1);
});

test('adoption tiers keep their fixed box count', async () => {
  const DB = new LocalD1(),
    env = environment(DB);
  const pa = await product(env, 'PA');
  const saved = await call(
    env,
    '/admin/product-content',
    edit(pa, { name: '平安树（本季）', count_per_box: 99 }),
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const after = await product(env, 'PA');
  assert.equal(after.name, '平安树（本季）');
  assert.equal(after.count_per_box, pa.count_per_box);
});
