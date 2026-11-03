import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledAsset } from '../src/lib/static-assets';
import { prefix } from '../src/lib/region-assets.json';

test('public asset delivery preserves conditional, HEAD and Range requests', async () => {
  for (const method of ['GET', 'HEAD']) {
    const request = new Request(
      'https://shop.example.com/images/optimized/orchard-1280-123456abcdef.avif',
      {
        method,
        headers: { 'if-none-match': '"approved-image"', range: 'bytes=0-1023' },
      },
    );
    const response = await bundledAsset(request, {
      async fetch(received) {
        assert.equal(received, request);
        assert.equal(received.method, method);
        assert.equal(received.headers.get('if-none-match'), '"approved-image"');
        assert.equal(received.headers.get('range'), 'bytes=0-1023');
        return new Response(null, { status: 304, headers: { etag: '"approved-image"' } });
      },
    });
    assert.equal(response?.status, 304);
    assert.equal(response?.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  }
});

test('only successful public assets get long browser caching', async () => {
  for (const [path, policy] of [
    ['/images/optimized/family-192-123456abcdef.webp', 'public, max-age=31536000, immutable'],
    ['/brand/orchard-v1/icon-32.png', 'public, max-age=31536000, immutable'],
    ['/images/orchard.webp', 'public, max-age=86400'],
    ['/_astro/client.ABCD1234.js', 'public, max-age=31536000, immutable'],
  ]) {
    const response = await bundledAsset(new Request('https://shop.example.com' + path), {
      async fetch() {
        return new Response('asset', {
          headers: { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'image/webp' },
        });
      },
    });
    assert.equal(response?.headers.get('cache-control'), policy, path);
  }
  for (const [status, type, cookie] of [
    [404, 'image/webp', false],
    [200, 'text/html', false],
    [200, 'image/webp', true],
  ] as const) {
    const response = await bundledAsset(
      new Request('https://shop.example.com/images/optimized/absent-123456abcdef.webp'),
      {
        async fetch() {
          return new Response('not public', {
            status,
            headers: { 'content-type': type, ...(cookie ? { 'set-cookie': 'private=1' } : {}) },
          });
        },
      },
    );
    assert.equal(response?.headers.get('cache-control'), 'no-store');
  }
});

test('pages, APIs, private uploads and mutations never enter the public asset cache', async () => {
  const assets = {
    async fetch() {
      throw new Error('Must not fetch a private path as an asset');
    },
  };
  for (const path of [
    '/api/config',
    '/api/admin/orders.jpg',
    '/admin',
    '/order',
    '/tree/my',
    '/media/apple-2026/private.webp',
    '/images/fake.pdf',
    '/images/../api/config',
    '/images/%2fapi%2fconfig.webp',
  ]) {
    assert.equal(
      await bundledAsset(new Request('https://shop.example.com' + path), assets),
      undefined,
      path,
    );
  }
  assert.equal(
    await bundledAsset(
      new Request('https://shop.example.com/images/orchard.webp', { method: 'POST' }),
      assets,
    ),
    undefined,
  );
});
test('fingerprinted static address data is immutable and never caches error pages', async () => {
  for (const [status, type, expected] of [
    [200, 'application/json', 'public, max-age=31536000, immutable'],
    [404, 'text/html', 'no-store'],
  ] as const) {
    const r = await bundledAsset(new Request('https://shop.example.com' + prefix + '110100.json'), {
      async fetch() {
        return new Response('[]', { status, headers: { 'content-type': type } });
      },
    });
    assert.equal(r?.headers.get('cache-control'), expected);
  }
});
