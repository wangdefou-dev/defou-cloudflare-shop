import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker';
import { staticPage } from '../src/lib/static-pages';
import { offlineResponse } from '../src/lib/site-status';
import { readPublicData } from '../src/lib/public-data';
import { PAGE_META, PUBLIC_PATHS } from '../src/lib/seo';
const origin = 'https://shop.example.com';
const req = (path = '/', init?: RequestInit) => new Request(origin + path, init);
const settings = { APP_ORIGIN: origin, SITE_OFFLINE: 'false' };

test('static routing whitelists public HTML and never reads a private route from assets', async () => {
  const seen: Request[] = [];
  const env = {
    ...settings,
    ASSETS: {
      async fetch(r: Request) {
        seen.push(r);
        return new Response('<html>public</html>', { headers: { 'content-type': 'text/html' } });
      },
    } as Fetcher,
  };
  for (const path of [...PUBLIC_PATHS, '/privacy', '/buy/']) {
    assert.equal((await staticPage(req(path), env))?.headers.get('x-page-render'), 'static');
  }
  const before = seen.length;
  for (const path of [
    '/admin',
    '/admin/',
    '/api/config',
    '/order',
    '/pay/result',
    '/tree/my',
    '/media/apple-2026/a.pdf',
    '/unknown',
    '/buy/extra',
    '/index.html',
    '/buy/index.html',
  ])
    assert.equal(await staticPage(req(path), env), undefined, path);
  assert.equal(await staticPage(req('/', { method: 'POST' }), env), undefined);
  assert.equal(seen.length, before);
  assert.deepEqual([...PUBLIC_PATHS].sort(), Object.keys(PAGE_META).sort());
});

test('static responses strip credentials/query before lookup, retain ETags and suppress private-query indexing', async () => {
  let assetRequest: Request | undefined;
  const env = {
    ...settings,
    ASSETS: {
      async fetch(r: Request) {
        assetRequest = r;
        return new Response(r.method === 'HEAD' ? null : '<html>public</html>', {
          headers: { 'content-type': 'text/html', etag: 'build-fingerprint' },
        });
      },
    } as Fetcher,
  };
  const result = await staticPage(
    req('/buy?view_token=private', {
      headers: {
        cookie: 'tree_session=secret',
        authorization: 'Bearer secret',
        range: 'bytes=0-4',
        'if-none-match': 'old',
      },
    }),
    env,
  );
  assert.equal(assetRequest!.url, origin + '/buy');
  assert.equal(assetRequest!.headers.get('cookie'), null);
  assert.equal(assetRequest!.headers.get('authorization'), null);
  assert.equal(assetRequest!.headers.get('range'), null);
  assert.equal(assetRequest!.headers.get('if-none-match'), 'old');
  assert.equal(result!.headers.get('etag'), 'build-fingerprint');
  assert.equal(result!.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.match(result!.headers.get('x-robots-tag')!, /noindex/);
  assert.match(
    (await staticPage(req('/buy?sku=GIFT'), env))!.headers.get('x-robots-tag')!,
    /^index/,
  );
  assert.equal(await (await staticPage(req('/', { method: 'HEAD' }), env))!.text(), '');
  assert.match((await staticPage(req('/privacy'), env))!.headers.get('x-robots-tag')!, /noindex/);
  assert.match(
    (await staticPage(req(), { ...env, APP_ORIGIN: 'http://localhost:4321' }))!.headers.get(
      'x-robots-tag',
    )!,
    /noindex/,
  );
});

test('static lookup never caches missing pages, personalized responses or asset errors; conditional requests retain 304', async () => {
  for (const response of [
    new Response('missing', { status: 404 }),
    new Response('error', { status: 500 }),
    new Response('private', {
      headers: { 'content-type': 'text/html', 'set-cookie': 'private=1' },
    }),
    new Response('not HTML', { headers: { 'content-type': 'application/json' } }),
  ]) {
    const result = await staticPage(req(), {
      ...settings,
      ASSETS: { fetch: async () => response } as unknown as Fetcher,
    });
    assert.equal(result!.status, 503);
    assert.equal(result!.headers.get('cache-control'), 'no-store');
  }
  const result = await staticPage(req(), {
    ...settings,
    ASSETS: {
      fetch: async () => new Response(null, { status: 304, headers: { etag: 'current' } }),
    } as unknown as Fetcher,
  });
  assert.equal(result!.status, 304);
  assert.equal(result!.headers.get('etag'), 'current');
  assert.equal(offlineResponse({ SITE_OFFLINE: 'true' }, req())!.status, 503);
});
test('speculative public data failures retry normally and never mask an error', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let calls = 0;
  const fallback = async () => {
    calls++;
    return { live: true };
  };
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __orchardPublicData: { '/config': Promise.resolve({ live: true }) } },
    });
    assert.deepEqual(await readPublicData('/config', fallback), { live: true });
    assert.equal(calls, 0);
    window.__orchardPublicData!['/config'] = Promise.resolve(null);
    assert.deepEqual(await readPublicData('/config', fallback), { live: true });
    assert.equal(calls, 1);
    window.__orchardPublicData!['/config'] = Promise.reject(Error('early network failure'));
    await assert.rejects(
      readPublicData('/config', async () => {
        throw Error('retry failed');
      }),
      /retry failed/,
    );
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('public Worker reads generated assets without initializing SSR, business DB or notification queues', async () => {
  let reads = 0;
  const env = {
    ...settings,
    get DB() {
      throw Error('Public HTML must not read DB');
    },
    ASSETS: {
      async fetch() {
        reads++;
        return new Response('<html>static</html>', { headers: { 'content-type': 'text/html' } });
      },
    },
  } as unknown as Env;
  const ctx = {
    waitUntil() {
      throw Error('Public HTML must not enqueue business work');
    },
  } as unknown as ExecutionContext;
  const response = await worker.fetch(req(), env, ctx);
  assert.equal(response.headers.get('x-page-render'), 'static');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(await response.text(), '<html>static</html>');
  assert.equal(reads, 1);
  const paused = await worker.fetch(req(), { SITE_OFFLINE: 'true' } as Env, ctx);
  assert.equal(paused.status, 503);
  assert.equal(reads, 1);
});
