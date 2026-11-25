import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker';
import { offlineResponse } from '../src/lib/site-status';
import { readPublicData } from '../src/lib/public-data';
const origin = 'https://shop.example.com';
const req = (path = '/', init?: RequestInit) => new Request(origin + path, init);
const settings = { APP_ORIGIN: origin, SITE_OFFLINE: 'false' };

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
      value: { __shopPublicData: { '/config': Promise.resolve({ live: true }) } },
    });
    assert.deepEqual(await readPublicData('/config', fallback), { live: true });
    assert.equal(calls, 0);
    window.__shopPublicData!['/config'] = Promise.resolve(null);
    assert.deepEqual(await readPublicData('/config', fallback), { live: true });
    assert.equal(calls, 1);
    window.__shopPublicData!['/config'] = Promise.reject(Error('early network failure'));
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

test('the offline switch answers before any asset, page render or database work', async () => {
  const env = {
    SITE_OFFLINE: 'true',
    get DB() {
      throw Error('Offline responses must not read DB');
    },
    ASSETS: {
      async fetch() {
        throw Error('Offline responses must not read assets');
      },
    },
  } as unknown as Env;
  const ctx = {
    waitUntil() {
      throw Error('Offline responses must not enqueue business work');
    },
  } as unknown as ExecutionContext;
  const paused = await worker.fetch(req(), env, ctx);
  assert.equal(paused.status, 503);
});
