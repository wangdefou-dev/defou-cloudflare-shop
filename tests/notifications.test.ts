import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import {
  chinaDayBounds,
  dailyReportDate,
  dailyReportMessage,
  enqueueDailyReport,
  flushCommerceNotifications,
  notificationsReady,
} from '../src/lib/notifications';

class MemoryD1 {
  db = new DatabaseSync(':memory:');
  constructor() {
    for (const f of fs
      .readdirSync('migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      this.db.exec(fs.readFileSync('migrations/' + f, 'utf8'));
    this.db.exec(fs.readFileSync('scripts/seed.sql', 'utf8'));
    this.db.exec('UPDATE products SET stock=100');
  }
  prepare(sql: string) {
    let args: any[] = [];
    const statement: any = {
      bind(...values: any[]) {
        args = values;
        return statement;
      },
      first: async () => this.db.prepare(sql).get(...args) || null,
      all: async () => ({ results: this.db.prepare(sql).all(...args) }),
      run: async () => ({ meta: { changes: Number(this.db.prepare(sql).run(...args).changes) } }),
    };
    return statement;
  }
}
function setup() {
  const DB = new MemoryD1();
  const env = {
    DB,
    NOTIFICATIONS_ENABLED: 'true',
    STRIPE_MODE: 'live',
    TELEGRAM_BOT_TOKEN: '123456:local_fixture_token_not_real',
    TELEGRAM_CHAT_ID: '123456789',
  } as unknown as Env;
  return { db: DB.db, env };
}
function order(
  db: DatabaseSync,
  id: string,
  product: string | null = 'FAMILY',
  qty = 1,
  type = 'retail',
  amount = 10800,
) {
  db.prepare(
    `INSERT INTO orders(id,order_no,type,phone,amount,expires_at,plate_name,pin_hash,address_json)
    VALUES(?,?,?,'13812345678',?,'2026-10-23','私密铭牌','秘密PIN','秘密地址')`,
  ).run(id, 'DF-' + id, type, amount);
  if (product)
    db.prepare('INSERT INTO order_items(id,order_id,product_id,qty) VALUES(?,?,?,?)').run(
      'item-' + id,
      id,
      product,
      qty,
    );
}
function application(db: DatabaseSync, id: string, status = 'pending') {
  db.prepare(
    `INSERT INTO sponsor_apps(id,app_no,org_name,event_name,event_date,headcount,contact,phone,wechat,address_json,reason,link,status)
    VALUES(?,?,'私密主办方','活动标题含私密电话13812345678','2026-11-10',12,'私密联系人','13812345678','私密微信','私密收件地址','私密申请理由','https://private.example/contact',?)`,
  ).run(id, 'AP-' + id, status);
}
const paid = (db: DatabaseSync, id: string, at = '2026-10-22 02:00:00') =>
  db
    .prepare("UPDATE orders SET status='paid',paid_at=? WHERE id=? AND status='pending'")
    .run(at, id);
const count = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;
const success = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));

test('paid outbox commits atomically, ignores pending, is idempotent and contains no buyer PII', () => {
  const { db } = setup();
  order(db, 'one', 'FAMILY', 2);
  assert.equal(count(db, 'commerce_notifications'), 0);
  db.exec('BEGIN');
  paid(db, 'one');
  db.exec('ROLLBACK');
  assert.equal(count(db, 'commerce_notifications'), 0);
  assert.equal(
    (db.prepare("SELECT status FROM orders WHERE id='one'").get() as any).status,
    'pending',
  );
  paid(db, 'one');
  paid(db, 'one');
  assert.equal(count(db, 'commerce_notifications'), 1);
  const payload = (db.prepare('SELECT payload FROM commerce_notifications').get() as any).payload;
  assert.doesNotMatch(payload, /13812345678|私密铭牌|秘密PIN|秘密地址|phone|address|pin_hash/);
  assert.equal(JSON.parse(payload).items[0].qty, 2);
});

test('new sponsor application commits with a private-field-free outbox; rollback, duplicate and review do not resend', () => {
  const { db } = setup();
  db.exec('BEGIN');
  application(db, 'rollback');
  db.exec('ROLLBACK');
  assert.equal(count(db, 'sponsor_apps'), 0);
  assert.equal(count(db, 'sponsor_notifications'), 0);
  application(db, 'one');
  db.exec("UPDATE sponsor_apps SET status='approved' WHERE id='one'");
  assert.throws(() => application(db, 'one'), /UNIQUE/);
  application(db, 'already-reviewed', 'rejected');
  assert.equal(count(db, 'sponsor_notifications'), 1);
  const row = db.prepare('SELECT * FROM sponsor_notifications').get() as any;
  assert.equal(row.app_id, 'one');
  assert.deepEqual(Object.keys(JSON.parse(row.payload)).sort(), [
    'app_no',
    'event_date',
    'headcount',
    'submitted_at',
  ]);
  assert.doesNotMatch(
    row.payload,
    /私密|13812345678|private.example|contact|phone|address|reason|wechat/,
  );
  assert.equal(JSON.parse(row.payload).headcount, 12);
});

test('sponsor migration preserves paid delivery history and does not backfill old applications', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of fs
    .readdirSync('migrations')
    .filter((f) => f.endsWith('.sql') && !f.startsWith('0006_'))
    .sort())
    db.exec(fs.readFileSync('migrations/' + f, 'utf8'));
  db.exec(fs.readFileSync('scripts/seed.sql', 'utf8'));
  db.exec('UPDATE products SET stock=100');
  application(db, 'historical');
  order(db, 'already-sent');
  paid(db, 'already-sent');
  db.exec(
    "INSERT INTO notification_deliveries(notification_id,channel,attempts,sent_at) VALUES('paid-already-sent','telegram',1,'2026-10-22 02:05:00')",
  );
  const before = db.prepare('SELECT * FROM notification_deliveries').get();
  db.exec(fs.readFileSync('migrations/0006_sponsor_notifications.sql', 'utf8'));
  assert.equal(count(db, 'sponsor_notifications'), 0);
  assert.equal(count(db, 'commerce_notifications'), 1);
  assert.deepEqual(db.prepare('SELECT * FROM notification_deliveries').get(), before);
  application(db, 'new');
  assert.equal(count(db, 'sponsor_notifications'), 1);
});

test('new FG purchase gets 15 boxes and PA still gets 8; existing paid rights remain intact', () => {
  const { db } = setup();
  order(db, 'fg', 'FG', 1, 'adoption', 188800);
  paid(db, 'fg');
  order(db, 'pa', 'PA', 1, 'adoption', 88800);
  paid(db, 'pa');
  assert.equal(
    (db.prepare("SELECT total_boxes FROM adoptions WHERE order_id='fg'").get() as any).total_boxes,
    15,
  );
  assert.equal(
    (db.prepare("SELECT total_boxes FROM adoptions WHERE order_id='pa'").get() as any).total_boxes,
    8,
  );
  assert.throws(() => db.exec("UPDATE adoptions SET used_boxes=16 WHERE order_id='fg'"), /CHECK/);
  const old = new DatabaseSync(':memory:');
  for (const f of ['0001_initial.sql', '0002_safe_stock_refund.sql', '0003_retail_prices.sql'])
    old.exec(fs.readFileSync('migrations/' + f, 'utf8'));
  old.exec(fs.readFileSync('scripts/seed.sql', 'utf8'));
  old.exec('UPDATE products SET stock=100');
  order(old, 'old', 'FG', 1, 'adoption', 188800);
  paid(old, 'old');
  old.exec(fs.readFileSync('migrations/0004_fg_fifteen_boxes.sql', 'utf8'));
  assert.equal((old.prepare('SELECT total_boxes FROM adoptions').get() as any).total_boxes, 18);
});

test('daily report starts at 00:05 China time, preserves one report per date and rolls across UTC days', async () => {
  assert.equal(dailyReportDate(new Date('2026-10-23T16:00:00Z')), null);
  assert.equal(dailyReportDate(new Date('2026-10-23T16:04:59Z')), null);
  assert.equal(dailyReportDate(new Date('2026-10-23T16:05:00Z')), '2026-10-23');
  assert.equal(dailyReportDate(new Date('2027-01-01T16:05:00Z')), '2027-01-01');
  assert.equal(dailyReportDate(new Date('2026-10-23T01:00:00Z'), '9', '0'), '2026-10-22');
  assert.throws(() => dailyReportDate(new Date(), '24', '5'), /Invalid daily report hour/);
  assert.throws(() => dailyReportDate(new Date(), '0', '60'), /Invalid daily report minute/);
  assert.deepEqual(chinaDayBounds('2026-10-22'), ['2026-10-21 16:00:00', '2026-10-22 16:00:00']);
  assert.throws(() => chinaDayBounds('2026-02-30'), /Invalid report date/);
  const { env, db } = setup();
  await enqueueDailyReport(env, new Date('2026-10-21T16:05:00Z'));
  await enqueueDailyReport(env, new Date('2026-10-22T16:04:59Z'));
  assert.equal(count(db, 'commerce_notifications'), 0);
  await Promise.all([
    enqueueDailyReport(env, new Date('2026-10-22T16:05:00Z')),
    enqueueDailyReport(env, new Date('2026-10-22T16:10:00Z')),
  ]);
  await enqueueDailyReport(env, new Date('2026-10-23T01:00:00Z'));
  assert.equal(count(db, 'commerce_notifications'), 1);
  assert.equal(
    (db.prepare('SELECT id FROM commerce_notifications').get() as any).id,
    'daily-2026-10-22',
  );
  await enqueueDailyReport(env, new Date('2026-10-23T16:05:00Z'));
  assert.equal(count(db, 'commerce_notifications'), 2);
});

test('daily report matches the requested template and accumulates since launch through the previous China day', async () => {
  const { env, db } = setup();
  for (let n = 1; n <= 3; n++) {
    order(db, 'family-' + n);
    paid(db, 'family-' + n, n === 1 ? '2026-10-21 16:00:00' : '2026-10-23 10:00:00');
  }
  for (let n = 1; n <= 2; n++) {
    order(db, 'gift-' + n, 'GIFT', 1, 'retail', 12800);
    paid(db, 'gift-' + n, '2026-10-23 15:59:59');
  }
  order(db, 'tree', 'FG', 1, 'adoption', 188800);
  paid(db, 'tree', '2026-10-22 08:00:00');
  order(db, 'pending', 'FAMILY', 3);
  order(db, 'freight', null, 0, 'shipping', 2000);
  paid(db, 'freight', '2026-10-23 01:00:00');
  order(db, 'refund', 'GIFT', 2, 'retail', 25600);
  paid(db, 'refund', '2026-10-22 08:00:00');
  db.exec("UPDATE orders SET status='refunded' WHERE id='refund'");
  order(db, 'outside', 'GIFT', 1, 'retail', 12800);
  paid(db, 'outside', '2026-10-23 16:00:00');
  order(db, 'before-launch');
  paid(db, 'before-launch', '2026-10-21 15:59:59');
  const message = await dailyReportMessage(env, '2026-10-23', new Date('2026-10-23T16:05:00Z'));
  assert.equal(
    message,
    [
      '「示例果园」上线第2天',
      'https://shop.example.com/',
      '',
      '累计订单量：6 单',
      '累计销售额：¥2,468',
      '',
      '家庭装：3 箱，¥324',
      '礼盒装：2 箱，¥256',
      '平安树：0 棵，¥0',
      '富贵树：1 棵，¥1,888',
    ].join('\n'),
  );
  assert.doesNotMatch(message, /13812345678|秘密|私密铭牌|库存|优惠券让利/);
});

test('report counts multi-box purchases once, uses original receipts over current prices, and excludes freight', async () => {
  const { env, db } = setup();
  order(db, 'family', 'FAMILY', 2, 'retail', 23600);
  db.exec("UPDATE orders SET remote_fee=2000 WHERE id='family'");
  paid(db, 'family');
  db.exec("UPDATE products SET price=99999 WHERE id='FAMILY'");
  const message = await dailyReportMessage(env, '2026-10-22', new Date('2026-10-22T16:05:00Z'));
  assert.match(message, /累计订单量：1 单/);
  assert.match(message, /累计销售额：¥216/);
  assert.match(message, /家庭装：2 箱，¥216/);
  assert.match(message, /平安树：0 棵，¥0/);
});

test('empty first-day report has all four zero rows and partial previews never include future payments', async () => {
  const { env, db } = setup();
  const empty = await dailyReportMessage(env, '2026-10-22', new Date('2026-10-22T16:05:00Z'));
  assert.match(empty, /上线第1天/);
  assert.match(empty, /累计订单量：0 单/);
  for (const name of ['家庭装', '礼盒装', '平安树', '富贵树'])
    assert.match(empty, new RegExp(name + '：0 [箱棵]，¥0'));
  await assert.rejects(dailyReportMessage(env, '2026-10-21'), /before launch/);
  order(db, 'later');
  paid(db, 'later', '2026-10-22 12:00:00');
  const preview = await dailyReportMessage(env, '2026-10-22', new Date('2026-10-22T10:00:00Z'));
  assert.match(preview, /累计订单量：0 单/);
});

test('successful Telegram delivery is not resent by cron; legacy operational queue is not drained', async () => {
  const { env, db } = setup();
  order(db, 'retail', 'FAMILY', 2);
  paid(db, 'retail');
  application(db, 'new-application');
  db.exec("INSERT INTO notifications(id,message) VALUES('legacy','历史运营事项')");
  const sent: string[] = [];
  const sender = (async (url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/api.telegram.org\/bot/);
    const body = JSON.parse(String(init.body));
    assert.equal(body.chat_id, '123456789');
    assert.equal(body.protect_content, true);
    sent.push(body.text);
    return success();
  }) as typeof fetch;
  await flushCommerceNotifications(env, new Date(), sender);
  await flushCommerceNotifications(env, new Date(), sender);
  assert.equal(sent.length, 2);
  assert.ok(sent.some((message) => /家庭装 × 2 箱/.test(message)));
  const sponsor = sent.find((message) => /新活动赞助申请/.test(message))!;
  assert.match(sponsor, /申请编号：AP-new-application/);
  assert.match(sponsor, /活动日期：2026-11-10/);
  assert.match(sponsor, /预计人数：12 人/);
  assert.match(sponsor, /https:\/\/shop.example.com\/admin/);
  assert.doesNotMatch(sent.join('\n'), /历史运营|13812345678|秘密|私密|private.example/);
  assert.ok((db.prepare('SELECT sent_at FROM notification_deliveries').get() as any).sent_at);
  assert.ok((db.prepare('SELECT sent_at FROM sponsor_notifications').get() as any).sent_at);
});

test('sponsor notification retries durable failures with sanitized errors and then sends once', async () => {
  const { env, db } = setup();
  application(db, 'retry');
  const now = new Date();
  let calls = 0;
  const sender = (async () => {
    calls++;
    return calls === 1
      ? new Response(
          JSON.stringify({
            ok: false,
            error_code: 429,
            description: 'secret-token-echo',
            parameters: { retry_after: 700 },
          }),
          { status: 429 },
        )
      : success();
  }) as typeof fetch;
  await flushCommerceNotifications(env, now, sender);
  let row = db.prepare('SELECT * FROM sponsor_notifications').get() as any;
  assert.equal(row.sent_at, null);
  assert.equal(row.last_error, 'telegram_429');
  assert.equal(row.next_attempt_at, Math.floor(now.getTime() / 1000) + 700);
  await flushCommerceNotifications(env, new Date(now.getTime() + 300000), sender);
  assert.equal(calls, 1);
  await flushCommerceNotifications(env, new Date(now.getTime() + 701000), sender);
  await flushCommerceNotifications(env, new Date(now.getTime() + 702000), sender);
  row = db.prepare('SELECT * FROM sponsor_notifications').get() as any;
  assert.equal(calls, 2);
  assert.equal(row.attempts, 2);
  assert.ok(row.sent_at);
  assert.equal(row.last_error, null);
});

test('retry_after and failures are durable, sanitized and never mark messages as sent', async () => {
  const { env, db } = setup();
  order(db, 'retry');
  paid(db, 'retry');
  const now = new Date();
  let calls = 0;
  const fail = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 429,
        description: 'secret-token-echo',
        parameters: { retry_after: 700 },
      }),
      { status: 429 },
    );
  }) as typeof fetch;
  await flushCommerceNotifications(env, now, fail);
  let row = db.prepare('SELECT * FROM notification_deliveries').get() as any;
  assert.equal(row.sent_at, null);
  assert.equal(row.last_error, 'telegram_429');
  assert.equal(row.next_attempt_at, Math.floor(now.getTime() / 1000) + 700);
  await flushCommerceNotifications(env, new Date(now.getTime() + 300000), fail);
  assert.equal(calls, 1);
  await flushCommerceNotifications(env, new Date(now.getTime() + 701000), success as typeof fetch);
  row = db.prepare('SELECT * FROM notification_deliveries').get() as any;
  assert.ok(row.sent_at);
  assert.equal(row.attempts, 2);
  assert.equal(row.last_error, null);
});

test('overlapping webhook/cron delivery leases prevent the same event being sent twice', async () => {
  const { env, db } = setup();
  order(db, 'concurrent');
  paid(db, 'concurrent');
  application(db, 'concurrent');
  let calls = 0;
  await Promise.all([
    flushCommerceNotifications(env, new Date(), (async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return success();
    }) as typeof fetch),
    flushCommerceNotifications(env, new Date(), (async () => {
      calls++;
      return success();
    }) as typeof fetch),
  ]);
  assert.equal(calls, 2);
});

test('sandbox, demo, disabled and incomplete configurations never send or queue daily reports', async () => {
  for (const patch of [
    { STRIPE_MODE: 'sandbox' },
    { DEMO_MODE: 'true' },
    { SANDBOX_CHECKOUT: 'true' },
    { NOTIFICATIONS_ENABLED: 'false' },
    { TELEGRAM_BOT_TOKEN: '' },
    { TELEGRAM_CHAT_ID: '@unverified' },
  ]) {
    const { env, db } = setup();
    Object.assign(env, patch);
    assert.equal(notificationsReady(env), false);
    order(db, 'disabled');
    paid(db, 'disabled');
    application(db, 'disabled');
    await enqueueDailyReport(env, new Date('2026-10-23T01:00:00Z'));
    await flushCommerceNotifications(env, new Date(), (async () => {
      throw Error('must not send');
    }) as typeof fetch);
    assert.equal(count(db, 'notification_deliveries'), 0);
    assert.equal(count(db, 'commerce_notifications'), 1);
    assert.equal(count(db, 'sponsor_notifications'), 1);
    assert.equal(
      (db.prepare('SELECT attempts FROM sponsor_notifications').get() as any).attempts,
      0,
    );
  }
});
