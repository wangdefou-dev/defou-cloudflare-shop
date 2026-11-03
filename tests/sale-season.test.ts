import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chinaDate, isSaleDay, SEASON_START, SEASON_END } from '../src/lib/shared';
import { APPLE_PRODUCTS } from '../src/lib/content';
import { productSchema } from '../src/lib/seo';
test('sale boundaries use the configured season in China time', () => {
  const start = Date.parse(SEASON_START+'T00:00:00+08:00');
  const end = Date.parse(SEASON_END+'T00:00:00+08:00')+86400000;
  for (const [time, expected] of [[start-1,false],[start,true],[end-1,true],[end,false]] as const)
    assert.equal(isSaleDay(chinaDate(0,new Date(time))), expected);
});
test('product offer expiry follows the configured season', () => {
  const result = productSchema(APPLE_PRODUCTS[0], {price:10800,stock:500,active:1}, {SALES_OPEN:'true'}, new Date(SEASON_START+'T08:00:00+08:00'));
  assert.equal(result.offers?.availability,'https://schema.org/InStock');
  assert.equal(result.offers?.priceValidUntil,SEASON_END);
});
