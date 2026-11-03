import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import type Stripe from 'stripe';
import {
  enqueueRefundResult,
  flushCommerceNotifications,
  notificationsReady,
  refundResultMessage,
} from '../src/lib/notifications';

// All identifiers, recipient details and notification credentials are inert local fixtures.
class MemoryD1 {
  db = new DatabaseSync(':memory:');
  constructor(beforeRefundMigration = false) {
    for (const file of readdirSync('migrations')
      .filter((f) => f.endsWith('.sql') && (!beforeRefundMigration || f < '0012'))
      .sort())
      this.db.exec(readFileSync('migrations/' + file, 'utf8'));
    this.db.exec(readFileSync('scripts/seed.sql', 'utf8'));
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
      all: async () => ({ results: this.db.prepare(sql).all(...args), success: true }),
      run: async () => ({
        meta: { changes: Number(this.db.prepare(sql).run(...args).changes) },
        success: true,
      }),
    };
    return statement;
  }
}
const orderId = 'refund-notification-order';
const paymentIntent = 'pi_refund_notification_fixture';
const token = '123456:local_refund_notify_token_not_real';
const privatePattern =
  /13812345678|私密|秘密|private\.example|PRIVATECOUPON|buyer_phone|address_json|pin_hash|metadata|description|failure_reason/;
function environment(DB: MemoryD1) {
  return {
    DB,
    NOTIFICATIONS_ENABLED: 'true',
    STRIPE_MODE: 'live',
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_CHAT_ID: '123456789',
  } as unknown as Env;
}
function seedOrder(db: DatabaseSync, status = 'paid', type = 'retail') {
  db.prepare(
    `INSERT INTO orders(id,order_no,type,status,phone,amount,expires_at,plate_name,pin_hash,address_json,invoice,stripe_payment_intent)
    VALUES(?,'DF-REFUND-NOTIFICATION',?,?,'13812345678',10800,datetime('now','+30 minutes'),'私密铭牌','秘密PIN','私密地址','私密发票邮箱',?)`,
  ).run(orderId, type, status, paymentIntent);
}
function setup() {
  const DB = new MemoryD1();
  seedOrder(DB.db);
  const start = Number(
    (
      DB.db
        .prepare("SELECT value FROM settings WHERE key='refund_notifications_start'")
        .get() as any
    ).value,
  );
  return { env: environment(DB), db: DB.db, start };
}
function refund(
  start: number,
  id = 're_notification_fixture',
  status = 'succeeded',
  created = start + 1,
): Stripe.Refund {
  return {
    id,
    object: 'refund',
    amount: 1296,
    currency: 'cny',
    status,
    created,
    payment_intent: paymentIntent,
    charge: 'ch_refund_notification_fixture',
    metadata: {
      project: 'orchard-shop',
      order_id: orderId,
      buyer_phone: '13812345678',
      note: '私密备注',
      coupon: 'PRIVATECOUPON',
    },
    description: '私密邮箱 private.example',
    failure_reason: '私密失败原文',
  } as unknown as Stripe.Refund;
}
const count = (db: DatabaseSync, table = 'refund_notifications') =>
  (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;
const payload = (db: DatabaseSync) =>
  JSON.parse((db.prepare('SELECT payload FROM refund_notifications').get() as any).payload);
const success = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));

test('verified refund enqueue is idempotent, transaction-safe and copies only the operating-summary whitelist', async () => {
  const { env, db, start } = setup(),
    r = refund(start);
  db.exec('BEGIN');
  await enqueueRefundResult(env, orderId, r, start + 2);
  db.exec('ROLLBACK');
  assert.equal(count(db), 0);
  await Promise.all([
    enqueueRefundResult(env, orderId, r, start + 2),
    enqueueRefundResult(env, orderId, r, start + 2),
  ]);
  assert.equal(count(db), 1);
  const p = payload(db);
  assert.deepEqual(
    Object.keys(p).sort(),
    [
      'order_no',
      'order_type',
      'paid_amount',
      'refund_id',
      'refund_amount',
      'status',
      'confirmed_at',
    ].sort(),
  );
  assert.equal(p.order_no, 'DF-REFUND-NOTIFICATION');
  assert.equal(p.order_type, 'retail');
  assert.equal(p.paid_amount, 10800);
  assert.equal(p.refund_amount, 1296);
  assert.equal(p.refund_id, r.id);
  assert.equal(p.status, 'succeeded');
  assert(p.confirmed_at);
  assert.doesNotMatch(JSON.stringify(p), privatePattern);
  const row = db.prepare('SELECT * FROM refund_notifications').get() as any;
  assert.equal(row.attempts, 0);
  assert.equal(row.sent_at, null);
  assert.equal(row.superseded_at, null);
});

test('old event replay and metadata-only updates on an old terminal refund never backfill; a newly verified terminal transition may notify', async () => {
  const { env, db, start } = setup();
  await enqueueRefundResult(env, orderId, refund(start, 're_before_cutoff'), start - 1);
  await enqueueRefundResult(
    env,
    orderId,
    refund(start, 're_old_terminal', 'succeeded', start - 86400),
    start + 10,
  );
  assert.equal(count(db), 0);
  await enqueueRefundResult(
    env,
    orderId,
    refund(start, 're_old_pending', 'succeeded', start - 86400),
    start + 10,
    true,
  );
  assert.equal(count(db), 1);
  assert.equal(payload(db).refund_id, 're_old_pending');
  assert.equal(
    Number(
      (db.prepare("SELECT value FROM settings WHERE key='refund_notifications_start'").get() as any)
        .value,
    ),
    start,
  );
});

test('nonterminal, unrelated, unpaid and over-amount refunds cannot become operator notifications', async () => {
  const { env, db, start } = setup();
  for (const status of ['pending', 'requires_action'])
    await enqueueRefundResult(env, orderId, refund(start, 're_' + status, status), start + 2);
  await enqueueRefundResult(env, 'missing-order', refund(start, 're_missing'), start + 2);
  await enqueueRefundResult(
    env,
    orderId,
    { ...refund(start, 're_other_payment'), payment_intent: 'pi_unrelated' } as Stripe.Refund,
    start + 2,
  );
  await enqueueRefundResult(
    env,
    orderId,
    { ...refund(start, 're_too_much'), amount: 10801 } as Stripe.Refund,
    start + 2,
  );
  db.prepare("UPDATE orders SET status='pending' WHERE id=?").run(orderId);
  await enqueueRefundResult(env, orderId, refund(start, 're_unpaid'), start + 2);
  assert.equal(count(db), 0);
});

test('refund notification migration keeps previous delivery history and creates no messages for old refund receipts', () => {
  const DB = new MemoryD1(true),
    db = DB.db;
  seedOrder(db, 'pending');
  db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(orderId);
  db.exec(
    "INSERT INTO notification_deliveries(notification_id,channel,attempts,sent_at,last_error) VALUES('paid-refund-notification-order','telegram',2,'2026-10-25 00:05:00',NULL); INSERT INTO notifications(id,message) VALUES('legacy-ops','旧运营队列保持'); INSERT INTO sponsor_apps(id,app_no,org_name,event_name,event_date,headcount,contact,phone,address_json,reason) VALUES('legacy-sponsor','AP-LEGACY','私密主办方','私密活动','2026-11-10',12,'私密联系人','13812345678','秘密地址','私密理由'); INSERT INTO admin_refund_requests(request_id,order_id,actor,amount,reason,status,stripe_refund_id) VALUES('history-refund','refund-notification-order','fixture-owner',1000,'requested_by_customer','succeeded','re_historical_receipt')",
  );
  const old = {
    deliveries: db.prepare('SELECT * FROM notification_deliveries').all(),
    commerce: db.prepare('SELECT * FROM commerce_notifications').all(),
    sponsors: db.prepare('SELECT * FROM sponsor_notifications').all(),
    legacy: db.prepare('SELECT * FROM notifications').all(),
    refunds: db.prepare('SELECT * FROM admin_refund_requests').all(),
  };
  db.exec(readFileSync('migrations/0012_refund_notifications.sql', 'utf8'));
  assert.equal(count(db), 0);
  assert.deepEqual(
    {
      deliveries: db.prepare('SELECT * FROM notification_deliveries').all(),
      commerce: db.prepare('SELECT * FROM commerce_notifications').all(),
      sponsors: db.prepare('SELECT * FROM sponsor_notifications').all(),
      legacy: db.prepare('SELECT * FROM notifications').all(),
      refunds: db.prepare('SELECT * FROM admin_refund_requests').all(),
    },
    old,
  );
  const start = Number(
    (db.prepare("SELECT value FROM settings WHERE key='refund_notifications_start'").get() as any)
      .value,
  );
  assert(Number.isSafeInteger(start) && Math.abs(Math.floor(Date.now() / 1000) - start) < 5);
});

test('failure supersedes an unsent success atomically and a later old-success replay cannot revive it', async () => {
  const { env, db, start } = setup(),
    r = refund(start);
  await enqueueRefundResult(env, orderId, r, start + 2);
  db.exec('BEGIN');
  await enqueueRefundResult(
    env,
    orderId,
    { ...r, status: 'failed' } as Stripe.Refund,
    start + 3,
    true,
  );
  db.exec('ROLLBACK');
  assert.equal(count(db), 1);
  assert.equal(
    (db.prepare('SELECT superseded_at FROM refund_notifications').get() as any).superseded_at,
    null,
  );
  await enqueueRefundResult(
    env,
    orderId,
    { ...r, status: 'failed' } as Stripe.Refund,
    start + 3,
    true,
  );
  await enqueueRefundResult(env, orderId, r, start + 2);
  assert.equal(count(db), 2);
  assert(
    (
      db
        .prepare("SELECT superseded_at FROM refund_notifications WHERE status='succeeded'")
        .get() as any
    ).superseded_at,
  );
  const sent: string[] = [];
  await flushCommerceNotifications(env, new Date(), (async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)).text);
    return success();
  }) as typeof fetch);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /退款失败/);
  assert.doesNotMatch(sent[0], /退款成功/);
  assert.equal(
    (db.prepare("SELECT sent_at FROM refund_notifications WHERE status='succeeded'").get() as any)
      .sent_at,
    null,
  );
});

test('an already failed or canceled refund blocks an out-of-order success notification', async () => {
  for (const status of ['failed', 'canceled']) {
    const { env, db, start } = setup(),
      r = refund(start);
    await enqueueRefundResult(env, orderId, { ...r, status } as Stripe.Refund, start + 3);
    await enqueueRefundResult(env, orderId, r, start + 2);
    await enqueueRefundResult(env, orderId, { ...r, status } as Stripe.Refund, start + 3);
    assert.equal(count(db), 1);
    assert.equal(payload(db).status, status);
  }
});

test('a failure after a delivered success emits one new failure while preserving the sent history', async () => {
  const { env, db, start } = setup(),
    r = refund(start),
    sent: string[] = [];
  const sender = (async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)).text);
    return success();
  }) as typeof fetch;
  await enqueueRefundResult(env, orderId, r, start + 2);
  await flushCommerceNotifications(env, new Date(), sender);
  const original = db
    .prepare("SELECT * FROM refund_notifications WHERE status='succeeded'")
    .get() as any;
  await enqueueRefundResult(
    env,
    orderId,
    { ...r, status: 'failed' } as Stripe.Refund,
    start + 3,
    true,
  );
  await flushCommerceNotifications(env, new Date(), sender);
  await flushCommerceNotifications(env, new Date(), sender);
  assert.equal(sent.length, 2);
  assert.match(sent[0], /退款成功/);
  assert.match(sent[1], /退款失败/);
  assert.deepEqual(
    db.prepare("SELECT * FROM refund_notifications WHERE status='succeeded'").get(),
    original,
  );
});

test('a refund failure arriving during the successful notification HTTP call preserves the real sent receipt and delivers the failure separately', async () => {
  const { env, db, start } = setup(),
    r = refund(start),
    sent: string[] = [];
  await enqueueRefundResult(env, orderId, r, start + 2);
  const sender = (async (_url, init) => {
    const text = JSON.parse(String(init?.body)).text;
    sent.push(text);
    if (sent.length === 1) {
      assert.match(text, /退款成功/);
      await enqueueRefundResult(
        env,
        orderId,
        { ...r, status: 'failed' } as Stripe.Refund,
        start + 3,
        true,
      );
      const inFlight = db
        .prepare("SELECT * FROM refund_notifications WHERE status='succeeded'")
        .get() as any;
      assert(inFlight.superseded_at);
      assert(inFlight.lease_token);
      assert.equal(inFlight.sent_at, null);
    }
    return success();
  }) as typeof fetch;
  await flushCommerceNotifications(env, new Date(), sender);
  const delivered = db
    .prepare("SELECT * FROM refund_notifications WHERE status='succeeded'")
    .get() as any;
  assert(delivered.superseded_at);
  assert(
    delivered.sent_at,
    'An HTTP request that already succeeded must retain its delivery receipt',
  );
  assert.equal(delivered.attempts, 1);
  assert.equal(delivered.lease_token, null);
  assert.equal(delivered.lease_until, 0);
  assert.equal(
    (db.prepare("SELECT sent_at FROM refund_notifications WHERE status='failed'").get() as any)
      .sent_at,
    null,
  );
  await flushCommerceNotifications(env, new Date(), sender);
  await flushCommerceNotifications(env, new Date(), sender);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /退款失败/);
  assert(
    (db.prepare("SELECT sent_at FROM refund_notifications WHERE status='failed'").get() as any)
      .sent_at,
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM refund_notifications WHERE status='succeeded'").get(),
    delivered,
  );
});

test('refund messages are plain operating summaries with China confirmation time and a fixed private-backend link', () => {
  for (const [status, title] of [
    ['succeeded', '退款成功'],
    ['failed', '退款失败'],
    ['canceled', '退款已取消'],
  ] as const) {
    const p = {
      order_no: 'DF-REFUND-NOTIFICATION',
      order_type: 'retail' as const,
      paid_amount: 10800,
      refund_id: 're_message_fixture',
      refund_amount: 1296,
      status,
      confirmed_at: '2026-10-26 16:05:00',
      phone: '13812345678',
      note: '私密原因',
      metadata: { secret: '秘密PIN' },
      description: 'private.example',
    };
    const text = refundResultMessage(p);
    assert(text.startsWith('🍎 示例果园｜' + title));
    assert.match(text, /订单号：DF-REFUND-NOTIFICATION/);
    assert.match(text, /订单类型：苹果零售/);
    assert.match(text, /订单实付：¥108/);
    assert.match(
      text,
      new RegExp((status === 'succeeded' ? '本次退款' : '本次申请') + '：¥12\\.96'),
    );
    assert.match(text, /退款编号：re_message_fixture/);
    assert.match(text, /2026\/10\/27 00:05:00（北京时间）/);
    assert.match(text, /https:\/\/shop\.example\.com\/admin/);
    assert.doesNotMatch(text, privatePattern);
  }
});

test('overlapping refund notification runners acquire one durable lease and deliver exactly once', async () => {
  const { env, db, start } = setup();
  await enqueueRefundResult(env, orderId, refund(start), start + 2);
  let release!: () => void,
    entered!: () => void,
    calls = 0;
  const started = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const first = flushCommerceNotifications(env, new Date(), (async () => {
    calls++;
    entered();
    await gate;
    return success();
  }) as typeof fetch);
  await started;
  try {
    await flushCommerceNotifications(env, new Date(), (async () => {
      calls++;
      return success();
    }) as typeof fetch);
  } finally {
    release();
  }
  await first;
  assert.equal(calls, 1);
  const row = db.prepare('SELECT * FROM refund_notifications').get() as any;
  assert.equal(row.attempts, 1);
  assert(row.sent_at);
  assert.equal(row.lease_token, null);
});

test('refund delivery honors Telegram 429 retry_after and stores sanitized errors without marking failures sent', async () => {
  const { env, db, start } = setup();
  await enqueueRefundResult(env, orderId, refund(start), start + 2);
  const now = new Date();
  let calls = 0;
  const sender = (async (url, init) => {
    calls++;
    assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.chat_id, '123456789');
    assert.equal(body.protect_content, true);
    assert.equal(body.link_preview_options.is_disabled, true);
    assert.doesNotMatch(body.text, privatePattern);
    return calls === 1
      ? new Response(
          JSON.stringify({
            ok: false,
            error_code: 429,
            description: token + ' 私密错误',
            parameters: { retry_after: 700 },
          }),
          { status: 429 },
        )
      : success();
  }) as typeof fetch;
  await flushCommerceNotifications(env, now, sender);
  let row = db.prepare('SELECT * FROM refund_notifications').get() as any;
  assert.equal(row.sent_at, null);
  assert.equal(row.last_error, 'telegram_429');
  assert.equal(row.attempts, 1);
  assert.equal(row.next_attempt_at, Math.floor(now.getTime() / 1000) + 700);
  assert(!JSON.stringify(row).includes(token));
  await flushCommerceNotifications(env, new Date(now.getTime() + 300000), sender);
  assert.equal(calls, 1);
  await flushCommerceNotifications(env, new Date(now.getTime() + 701000), sender);
  await flushCommerceNotifications(env, new Date(now.getTime() + 702000), sender);
  row = db.prepare('SELECT * FROM refund_notifications').get() as any;
  assert.equal(calls, 2);
  assert.equal(row.attempts, 2);
  assert(row.sent_at);
  assert.equal(row.last_error, null);
});

test('provider network errors never copy token-bearing URLs or private error text to the refund queue', async () => {
  const { env, db, start } = setup();
  await enqueueRefundResult(env, orderId, refund(start), start + 2);
  await flushCommerceNotifications(env, new Date(), (async () => {
    throw Error('https://api.telegram.org/bot' + token + '/sendMessage 私密电话13812345678');
  }) as typeof fetch);
  const row = db.prepare('SELECT * FROM refund_notifications').get() as any;
  assert.equal(row.last_error, 'network_or_timeout');
  assert.equal(row.sent_at, null);
  assert(!JSON.stringify(row).includes(token));
  assert.doesNotMatch(row.last_error, privatePattern);
});

test('sandbox, demo, disabled and incomplete credentials never transmit refund messages or consume delivery attempts', async () => {
  for (const patch of [
    { STRIPE_MODE: 'sandbox' },
    { DEMO_MODE: 'true' },
    { SANDBOX_CHECKOUT: 'true' },
    { NOTIFICATIONS_ENABLED: 'false' },
    { TELEGRAM_BOT_TOKEN: '' },
    { TELEGRAM_CHAT_ID: '@unverified' },
  ]) {
    const { env, db, start } = setup();
    await enqueueRefundResult(env, orderId, refund(start), start + 2);
    Object.assign(env, patch);
    assert.equal(notificationsReady(env), false);
    await flushCommerceNotifications(env, new Date(), (async () => {
      throw Error('must not send');
    }) as typeof fetch);
    const row = db.prepare('SELECT * FROM refund_notifications').get() as any;
    assert.equal(row.attempts, 0);
    assert.equal(row.sent_at, null);
  }
});
