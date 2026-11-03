import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsPage,
  analyticsReferrer,
  readAnalyticsChoice,
  ANALYTICS_CHOICE_TTL,
  validGoogleId,
  validCloudflareToken,
} from '../src/lib/analytics';
test('measurement excludes private routes, unknown queries and non-production hosts', () => {
  for (const path of [
    '/order?token=private',
    '/pay/result',
    '/admin',
    '/tree/my',
    '/api/orders',
    '/privacy',
    '/buy?phone=123',
    '/?utm_source=private',
    '/buy#token=private',
  ])
    assert.equal(analyticsPage('https://shop.example.com' + path), null);
  assert.equal(analyticsPage('http://127.0.0.1:4321/'), null);
  assert.equal(analyticsPage('https://orchard-shop-sandbox.example.workers.dev/'), null);
  assert.deepEqual(analyticsPage('https://shop.example.com/buy?sku=FAMILY'), {
    location: 'https://shop.example.com/buy',
    path: '/buy',
    cloudflare: false,
  });
  assert.equal(analyticsPage('https://shop.example.com/')?.cloudflare, true);
});
test('referrers reduce to origins and raw sensitive referrers prevent Cloudflare loading', () => {
  assert.deepEqual(analyticsReferrer('https://shop.example.com/order?token=secret'), {
    origin: 'https://shop.example.com/',
    cloudflare: false,
  });
  assert.deepEqual(analyticsReferrer('https://google.com/'), {
    origin: 'https://google.com/',
    cloudflare: true,
  });
  assert.deepEqual(analyticsReferrer('https://user:secret@example.com/'), {
    origin: '',
    cloudflare: false,
  });
  assert.deepEqual(analyticsReferrer(''), { origin: '', cloudflare: true });
});
test('analytics choices expire and invalid persisted values do not grant consent', () => {
  const now = 10000000000;
  assert.equal(readAnalyticsChoice(JSON.stringify({ choice: 'granted', at: now }), now), 'granted');
  assert.equal(readAnalyticsChoice(JSON.stringify({ choice: 'denied', at: now }), now), 'denied');
  for (const raw of [
    null,
    '{}',
    'bad',
    JSON.stringify({ choice: 'granted', at: now - ANALYTICS_CHOICE_TTL }),
    JSON.stringify({ choice: 'granted', at: now + 1 }),
  ])
    assert.equal(readAnalyticsChoice(raw, now), null);
  assert.equal(validGoogleId('G-DEMO123456'), 'G-DEMO123456');
  assert.equal(validGoogleId('G-<script>'), '');
  assert.equal(validCloudflareToken('0123456789abcdef0123456789abcdef').length, 32);
  assert.equal(validCloudflareToken('bad'), '');
});
