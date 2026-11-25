import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1, environment, call } from './local-d1';
import { STORE } from '../src/lib/store-config';
import { APPLE_FAQS, BRAND_NAME } from '../src/lib/content';
import { PAGE_META, pageDisabled } from '../src/lib/seo';
import { loadSiteContent } from '../src/lib/site-content';

const clone = (v: unknown) => JSON.parse(JSON.stringify(v));

test('publishing site content takes effect immediately and keeps every version', async () => {
  const DB = new LocalD1(),
    env = environment(DB);
  const start = (await call(env, '/admin/studio/site-content')).data;
  assert.equal(start.version, 0);
  assert.equal(start.content.brand.name, '太行深处');
  const content = clone(start.content);
  content.brand.name = '山里小铺';
  // Titles are plain text now; the editor offers to replace the old name everywhere.
  content.seo.pages['/'].title = '山里小铺｜首页';
  content.home.hero.title = ['第一行', '第二行'];
  content.faqs[0][0] = '这是新问题？';
  const saved = await call(env, '/admin/studio/site-content', {
    version: 0,
    content,
    note: '换店名',
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.version, 1);
  // Modules that rendered constants see the new values through live bindings.
  assert.equal(BRAND_NAME, '山里小铺');
  assert.equal(STORE.home.hero.title[1], '第二行');
  assert.equal(APPLE_FAQS[0][0], '这是新问题？');
  assert.match(PAGE_META['/'].title, /山里小铺/);
  const stale = await call(env, '/admin/studio/site-content', { version: 0, content });
  assert.equal(stale.status, 409);
  const state = (await call(env, '/admin/studio/site-content')).data;
  assert.equal(state.version, 1);
  assert.equal(state.history[0].note, '换店名');
  const restored = await call(env, '/admin/studio/site-content/restore', {
    version: 1,
    restore: 1,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.version, 2);
  const audit = DB.db
    .prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE '/api/admin/studio/site-content%'")
    .get() as any;
  assert.equal(audit.n, 2);
});

test('invalid content is rejected without changing the site', async () => {
  const DB = new LocalD1(),
    env = environment(DB);
  const content = clone((await call(env, '/admin/studio/site-content')).data.content);
  for (const broken of [
    (c: any) => (c.features.adoption = 'yes'),
    (c: any) => (c.season.start = '明天'),
    (c: any) => (c.images.hero = { src: 'https://evil.example/x.jpg', width: 1, height: 1 }),
    (c: any) => (c.home.faq.pick = [99]),
  ]) {
    const c = clone(content);
    broken(c);
    const r = await call(env, '/admin/studio/site-content', { version: 0, content: c });
    assert.equal(r.status, 400, JSON.stringify(r.data));
  }
  assert.equal((await call(env, '/admin/studio/site-content')).data.version, 0);
});

test('switching a module off closes its pages and APIs right away', async () => {
  const DB = new LocalD1(),
    env = environment(DB);
  const content = clone((await call(env, '/admin/studio/site-content')).data.content);
  content.features.sponsorship = false;
  content.features.adoption = false;
  assert.equal(
    (await call(env, '/admin/studio/site-content', { version: 0, content })).status,
    200,
  );
  assert.equal(pageDisabled('/treat'), true);
  assert.equal(pageDisabled('/tree/my'), true);
  assert.equal(pageDisabled('/buy'), false);
  assert.equal((await call(env, '/treat/lookup', { app_no: 'x' })).status, 404);
  assert.equal((await call(env, '/tree/me')).status, 404);
  // A fresh database (another deployment) starts from the defaults again.
  await loadSiteContent({ DB: new LocalD1() } as unknown as Env, true);
  assert.equal(pageDisabled('/treat'), false);
});

test('site content admin endpoints stay behind administrator authentication', async () => {
  const DB = new LocalD1(),
    env = { ...environment(DB), DEMO_MODE: 'false' } as Env;
  assert.notEqual((await call(env, '/admin/studio/site-content')).status, 200);
  assert.notEqual(
    (await call(env, '/admin/studio/site-content', { version: 0, content: {} })).status,
    200,
  );
});

test('the media library refuses to delete an image that is still in use', async () => {
  const DB = new LocalD1(),
    env = environment(DB) as any;
  const deleted: string[] = [];
  const used = 'apple-2026/0b9e5c1a-0000-4000-8000-000000000001.webp';
  const free = 'apple-2026/0b9e5c1a-0000-4000-8000-000000000002.webp';
  env.MEDIA = {
    async list() {
      return {
        truncated: false,
        objects: [used, free].map((key) => ({ key, size: 1, uploaded: new Date() })),
      };
    },
    async delete(key: string) {
      deleted.push(key);
    },
  };
  DB.db.prepare("UPDATE products SET image_url=? WHERE id='GIFT'").run('/media/' + used);
  const list = (await call(env, '/admin/studio/media')).data.items;
  assert.deepEqual(list.find((x: any) => x.key === used).uses, ['商品图']);
  assert.equal((await call(env, '/admin/studio/media/delete', { key: used })).status, 409);
  assert.equal((await call(env, '/admin/studio/media/delete', { key: free })).status, 200);
  assert.equal((await call(env, '/admin/studio/media/delete', { key: '../secret' })).status, 400);
  assert.deepEqual(deleted, [free]);
});

test('business rules from the site settings apply to new orders, claims and applications', async () => {
  const DB = new LocalD1(),
    env = environment(DB);
  const content = clone((await call(env, '/admin/studio/site-content')).data.content);
  content.rules.maxQtyPerOrder = 2;
  content.rules.claimPerFruit.FAMILY = 8;
  content.rules.sponsorMinHeadcount = 12;
  assert.equal(
    (await call(env, '/admin/studio/site-content', { version: 0, content })).status,
    200,
  );
  const { retail } = await import('./local-d1');
  const tooMany = await call(env, '/checkout', { ...retail, qty: 3 });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.error, /最多 2/);
  assert.equal((await call(env, '/checkout', { ...retail, qty: 2 })).status, 200);
  const { sponsor } = await import('../src/lib/validation');
  const headcount = sponsor.shape.headcount.safeParse(10);
  assert.equal(headcount.success, false);
  assert.match(headcount.error!.issues[0].message, /至少为 12 人/);
  assert.equal(sponsor.shape.headcount.safeParse(12).success, true);
  const { STORE } = await import('../src/lib/store-config');
  assert.equal(STORE.rules.claimPerFruit.FAMILY, 8);
});
