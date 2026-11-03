import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineResponse } from '../src/lib/site-status';

test('offline mode blocks pages, APIs, webhooks and static asset paths before routing', async () => {
  for (const [path, method] of [
    ['/', 'GET'],
    ['/tree', 'GET'],
    ['/api/config', 'GET'],
    ['/api/checkout', 'POST'],
    ['/api/stripe/webhook', 'POST'],
    ['/images/orchard.webp', 'GET'],
    ['/images/optimized/orchard-1280-123456abcdef.avif', 'GET'],
    ['/_astro/app.js', 'GET'],
    ['/media/apple-2026/private.jpg', 'GET'],
    ['/admin', 'GET'],
  ]) {
    const r = offlineResponse(
      { SITE_OFFLINE: 'true' },
      new Request('https://shop.example.com' + path, { method }),
    );
    assert(r, path);
    assert.equal(r.status, 503, path);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    if (path.startsWith('/api/'))
      assert.deepEqual(await r.json(), { error: '网站暂未开放，请稍后再来。' });
    else assert.match(await r.text(), /网站暂未开放/);
  }
});

test('offline HEAD has no body and the explicit switch leaves other environments open', async () => {
  const req = new Request('https://shop.example.com/', { method: 'HEAD' });
  const r = offlineResponse({ SITE_OFFLINE: 'true' }, req)!;
  assert.equal(r.status, 503);
  assert.equal(await r.text(), '');
  assert.equal(offlineResponse({}, req), undefined);
  assert.equal(offlineResponse({ SITE_OFFLINE: 'false' }, req), undefined);
});
