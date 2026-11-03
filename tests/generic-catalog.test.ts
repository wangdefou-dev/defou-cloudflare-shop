import { analyticsPage } from '../src/lib/analytics';
import { publicPaymentLink } from '../src/lib/payment-experience';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LocalD1, environment, call, address } from './local-d1';
import { digest } from '../src/lib/security';
import { dailyReportMessage, paidOrderMessage } from '../src/lib/notifications';
import { PUBLIC_PATHS } from '../src/lib/public-site';
import { llmsText } from '../src/lib/seo';
import products from '../config/products.json';
import { OPEN_SOURCE_CREDIT } from '../src/lib/credits';

const checkout = (sku: string, more: Record<string, unknown> = {}) => ({
  type: 'retail',
  sku,
  qty: 1,
  phone: address.phone,
  address,
  invoice: { type: 'none' },
  agreed: true,
  ...more,
});

test('non-fruit products are sold, paid and fulfilled through the same protected order pipeline', async () => {
  const DB = new LocalD1(true),
    env = environment(DB);
  for (const product of products) {
    const before = (DB.db.prepare('SELECT stock FROM products WHERE sku=?').get(product.sku) as any)
      .stock;
    const order = await call(env, '/checkout', checkout(product.sku));
    assert.equal(order.status, 200, JSON.stringify(order.data));
    assert.equal(order.data.amount, product.price);
    const paid = await call(env, '/demo/pay', {
      order_no: order.data.order_no,
      view_token: order.data.view_token,
    });
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(paid.data.status, 'paid');
    assert.equal(paid.data.shipments[0].unit, product.unit);
    assert.equal(
      (DB.db.prepare('SELECT stock FROM products WHERE sku=?').get(product.sku) as any).stock,
      before - 1,
    );
    const saved = DB.db
      .prepare('SELECT product_id FROM shipments WHERE source_id=?')
      .get(order.data.id) as any;
    assert.equal(saved.product_id, product.sku);
  }
});

test('arbitrary catalog SKUs can use coupons while purchase limits, type checks and stock remain enforced', async () => {
  const DB = new LocalD1(true),
    env = environment(DB),
    sku = products[0].sku;
  const code = 'GENERICCOUPON123';
  DB.db.exec(
    "INSERT INTO coupon_batches(id,name,starts_at,expires_at) VALUES('generic','合成测试',datetime('now','-1 day'),datetime('now','+7 days'))",
  );
  DB.db
    .prepare(
      "INSERT INTO coupons(id,batch_id,code_hash,code_hint,percent_off) VALUES('generic-coupon','generic',?,'GENERIC****',20)",
    )
    .run(await digest(code));
  const quote = await call(env, '/coupons/quote', { sku, code });
  assert.equal(quote.status, 200);
  const order = await call(env, '/checkout', checkout(sku, { coupon_code: code, qty: 2 }));
  assert.equal(order.status, 200, JSON.stringify(order.data));
  assert.equal(
    order.data.amount,
    products[0].price * 2 - Math.floor((products[0].price * 20 + 50) / 100),
  );
  const over = await call(
    env,
    '/checkout',
    checkout(products[1].sku, { qty: products[1].maxPerOrder + 1 }),
  );
  assert.equal(over.status, 400);
  DB.db.exec("UPDATE products SET active=1 WHERE id='PA'");
  assert.equal((await call(env, '/checkout', checkout('PA'))).status, 400);
  assert.equal((await call(env, '/checkout', checkout('UNKNOWN'))).status, 409);
});

test('catalog updates add custom SKUs without overwriting stock and retire removed products', () => {
  const DB = new LocalD1(true);
  DB.db.prepare('UPDATE products SET stock=7 WHERE sku=?').run(products[0].sku);
  DB.db.exec(
    "INSERT INTO products(id,sku,name,price,stock,active,box_type) VALUES('OLD','OLD','历史商品',1000,9,1,'旧规格')",
  );
  DB.db.exec(readFileSync('scripts/catalog-update.sql', 'utf8'));
  assert.equal(
    (DB.db.prepare('SELECT stock FROM products WHERE sku=?').get(products[0].sku) as any).stock,
    7,
  );
  assert.equal(
    (DB.db.prepare("SELECT active FROM products WHERE sku='OLD'").get() as any).active,
    0,
  );
  assert.equal(
    (
      DB.db
        .prepare(
          "SELECT COUNT(*) n FROM products WHERE sku IN ('FAMILY','GIFT','PA','FG') AND active=1",
        )
        .get() as any
    ).n,
    0,
  );
});

test('generic storefront indexing and authorship identify real configured products and the open-source author', () => {
  assert(PUBLIC_PATHS.includes('/products/' + products[0].slug));
  assert(!PUBLIC_PATHS.some((p) => p.startsWith('/apples/') || p === '/tree'));
  const facts = llmsText(true);
  for (const p of products) assert(facts.includes(p.name) && facts.includes(p.specification));
  assert(!facts.includes('坏果'));
  assert.equal(analyticsPage('https://shop.example.com/buy?sku=' + products[0].sku)?.path, '/buy');
  assert.equal(analyticsPage('https://shop.example.com/buy?sku=UNCONFIGURED'), null);
  assert.equal(
    analyticsPage('https://shop.example.com/buy?sku=' + products[0].sku + '&phone=13800000000'),
    null,
  );
  assert.equal(
    publicPaymentLink('https://shop.example.com/buy?sku=' + products[0].sku + '&phone=13800000000'),
    'https://shop.example.com/buy?sku=' + products[0].sku,
  );
  assert.equal(OPEN_SOURCE_CREDIT.organization, '得否科技');
  assert.equal(OPEN_SOURCE_CREDIT.author, '得否');
  assert.equal(OPEN_SOURCE_CREDIT.xUrl, 'https://x.com/wangdefou');
  const message = paidOrderMessage({
    order_no: 'DF-GENERIC-FIXTURE',
    type: 'retail',
    amount: products[0].price,
    remote_fee: 0,
    paid_at: '2026-11-03 01:00:00',
    items: [{ product_id: products[0].sku, qty: 1 }],
  });
  assert(message.includes(products[0].name + ' × 1 ' + products[0].unit));
});

test('daily operating reports include all configured product names and units', async () => {
  const DB = new LocalD1(true),
    env = environment(DB);
  const report = await dailyReportMessage(env, '2026-11-03', new Date('2026-11-04T00:00:00+08:00'));
  for (const p of products) assert(report.includes(p.name + '：0 ' + p.unit));
  assert(!report.includes('平安树：'));
});
