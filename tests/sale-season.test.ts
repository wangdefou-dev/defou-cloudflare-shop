import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chinaDate, isSaleDay, SEASON_START, SEASON_END } from '../src/lib/shared';
import { APPLE_PRODUCTS } from '../src/lib/content';
import { productSchema } from '../src/lib/seo';

test('sale opens on October 22 in China time and closes after November 30', () => {
  assert.equal(SEASON_START, '2026-10-22');
  assert.equal(SEASON_END, '2026-11-30');
  for (const [instant, expected] of [
    ['2026-10-21T15:59:59Z', false],
    ['2026-10-21T16:00:00Z', true],
    ['2026-10-31T16:00:00Z', true],
    ['2026-11-30T15:59:59Z', true],
    ['2026-11-30T16:00:00Z', false],
  ] as const) {
    assert.equal(isSaleDay(chinaDate(0, new Date(instant))), expected, instant);
  }
});

test('product offers become available on opening day while retaining the November expiry', () => {
  const result = productSchema(
    APPLE_PRODUCTS[0],
    { price: 10800, stock: 500, active: 1 },
    { SALES_OPEN: 'true' },
    new Date('2026-10-22T08:00:00+08:00'),
  );
  assert.equal(result.offers?.availability, 'https://schema.org/InStock');
  assert.equal(result.offers?.priceValidUntil, '2026-11-30');
});
