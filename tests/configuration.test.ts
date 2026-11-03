import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LocalD1, environment, call } from './local-d1';
import site from '../config/site.json';

test('changing both adoption prices to the same amount still grants the correct SKU entitlement and purchase-time deadline', async () => {
  const DB = new LocalD1(), env = environment(DB);
  DB.db.exec("UPDATE products SET price=99000 WHERE id IN ('PA','FG')");
  DB.db.prepare("UPDATE settings SET value=? WHERE key='season_end'").run(JSON.stringify('2098-08-30'));
  for (const [sku, tier, boxes] of [['PA',888,8],['FG',1888,15]] as const) {
    const order = await call(env, '/checkout', { type:'adoption', sku, qty:1, phone:'13800000000', plate_name:'本地测试树', pin:'123456', invoice:{type:'none'}, agreed:true });
    assert.equal(order.status,200,JSON.stringify(order.data));
    const saved = DB.db.prepare('SELECT amount FROM orders WHERE id=?').get(order.data.id) as any;
    assert.equal(saved.amount,99000);
    DB.db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(order.data.id);
    const adoption = DB.db.prepare('SELECT tier,total_boxes,expires_at FROM adoptions WHERE order_id=?').get(order.data.id) as any;
    assert.deepEqual({...adoption}, {tier,total_boxes:boxes,expires_at:'2098-08-30'});
  }
  DB.db.prepare("UPDATE settings SET value=? WHERE key='season_end'").run(JSON.stringify('2099-12-31'));
  assert.equal((DB.db.prepare('SELECT COUNT(*) n FROM adoptions WHERE expires_at=?').get('2098-08-30') as any).n,2);
});

test('catalog updates preserve inventory and existing paid order amounts', () => {
  const DB = new LocalD1();
  DB.db.exec("UPDATE products SET stock=7,price=9900 WHERE id='FAMILY'");
  DB.db.exec("INSERT INTO orders(id,order_no,type,status,phone,amount,expires_at) VALUES('historic','DF260101ABCDEF123456','retail','paid','13800000000',9900,'2099-12-31')");
  DB.db.exec(readFileSync('scripts/catalog-update.sql','utf8'));
  const product = DB.db.prepare("SELECT stock,price FROM products WHERE id='FAMILY'").get() as any;
  assert.equal(product.stock,7);
  assert.equal(product.price,site.prices.FAMILY);
  assert.equal((DB.db.prepare("SELECT amount FROM orders WHERE id='historic'").get() as any).amount,9900);
});
