import site from '../../config/site.json';
import { chinaDate, money } from './shared';
import { PUBLIC_ORIGIN } from './public-site';
import type Stripe from 'stripe';

const PRODUCTS = {
  FAMILY: { name: '家庭装', unit: '箱' },
  GIFT: { name: '礼盒装', unit: '箱' },
  PA: { name: '平安树', unit: '棵' },
  FG: { name: '富贵树', unit: '棵' },
} as const;
type ProductId = keyof typeof PRODUCTS;
type PaidPayload = {
  order_no: string;
  type: 'retail' | 'adoption' | 'shipping';
  amount: number;
  remote_fee: number;
  original_amount?: number;
  discount_amount?: number;
  coupon_percent_off?: number;
  paid_at: string;
  items: { product_id: ProductId; qty: number }[];
};
type SponsorPayload = {
  app_no: string;
  event_date: string;
  headcount: number;
  submitted_at: string;
};
type Outbox = {
  id: string;
  kind: 'paid_order' | 'daily_report' | 'sponsor_application' | 'refund_result' | 'operation_alert';
  payload: string;
};
type Delivery = Outbox & {
  attempts: number;
  delivery_source: 'commerce' | 'sponsor' | 'refund' | 'operation';
};
type RefundPayload = {
  order_no: string;
  order_type: 'retail' | 'adoption' | 'shipping';
  paid_amount: number;
  refund_id: string;
  refund_amount: number;
  status: 'succeeded' | 'failed' | 'canceled';
  confirmed_at: string;
};
type ProductSummary = {
  id: ProductId;
  qty: number;
  amount: number;
  orders: number;
  total_amount: number;
};

export function notificationsReady(env: Env) {
  return (
    env.NOTIFICATIONS_ENABLED === 'true' &&
    env.STRIPE_MODE === 'live' &&
    env.DEMO_MODE !== 'true' &&
    env.SANDBOX_CHECKOUT !== 'true' &&
    /^\d+:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN || '') &&
    /^-?\d+$/.test(env.TELEGRAM_CHAT_ID || '')
  );
}
const chinaTime = (utc: string) =>
  new Date(utc.replace(' ', 'T') + (utc.endsWith('Z') ? '' : 'Z')).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });

export function paidOrderMessage(p: PaidPayload) {
  const kind =
    p.type === 'shipping'
      ? '补运费已付款'
      : p.type === 'adoption'
        ? '新认领已付款'
        : '新订单已付款';
  const items = p.items.map((i) => {
    const product = PRODUCTS[i.product_id];
    return product ? `${product.name} × ${i.qty} ${product.unit}` : '商品信息待核对';
  });
  return [
    `🍎 ${site.name}｜${kind}`,
    `订单号：${p.order_no}`,
    ...(p.discount_amount
      ? [
          `优惠前：¥${money(p.original_amount ?? p.amount + p.discount_amount)}`,
          `优惠券：${(100 - (p.coupon_percent_off || 0)) / 10} 折，仅优惠一箱，减 ¥${money(p.discount_amount)}`,
        ]
      : []),
    `实付：¥${money(p.amount)}`,
    ...items,
    ...(p.remote_fee > 0 ? [`含偏远运费：¥${money(p.remote_fee)}`] : []),
    `付款时间：${chinaTime(p.paid_at)}（北京时间）`,
    ...(p.type === 'shipping' ? ['仅补运费，不重复计入商品销量'] : []),
    '未包含买家姓名、电话和地址',
  ].join('\n');
}

export function sponsorApplicationMessage(p: SponsorPayload) {
  // Do not forward free-text fields: titles/reasons/links may contain contact
  // details. The reference lets the owner read the full application in Access.
  return [
    `🍎 ${site.name}｜新活动赞助申请`,
    `申请编号：${p.app_no}`,
    `活动日期：${p.event_date}`,
    `预计人数：${p.headcount} 人`,
    `提交时间：${chinaTime(p.submitted_at)}（北京时间）`,
    '状态：待审核',
    `查看并审核：${PUBLIC_ORIGIN}/admin`,
    '后台点击「待审核活动」或「活动审核」',
  ].join('\n');
}

export function refundResultMessage(p: RefundPayload) {
  const status = { succeeded: '退款成功', failed: '退款失败', canceled: '退款已取消' }[p.status];
  const type = { retail: '苹果零售', adoption: '果树认领', shipping: '补运费' }[p.order_type];
  return [
    `🍎 ${site.name}｜${status}`,
    `订单号：${p.order_no}`,
    `订单类型：${type}`,
    `订单实付：¥${money(p.paid_amount)}`,
    `${p.status === 'succeeded' ? '本次退款' : '本次申请'}：¥${money(p.refund_amount)}`,
    `退款编号：${p.refund_id}`,
    `确认时间：${chinaTime(p.confirmed_at)}（北京时间）`,
    p.status === 'succeeded'
      ? '已原路退款，具体到账时间以支付机构为准'
      : '请到后台核对退款与原订单状态，确认后再处理',
    `查看详情：${PUBLIC_ORIGIN}/admin`,
  ].join('\n');
}

// Call only after signature/environment and current Stripe payment ownership
// validation. API receipts and preview/sync must not enqueue financial results.
export async function enqueueRefundResult(
  env: Env,
  orderId: string,
  refund: Stripe.Refund,
  eventCreated: number,
  isNewStatusTransition = false,
) {
  if (!['succeeded', 'failed', 'canceled'].includes(refund.status || '')) return;
  if (
    !/^re_[A-Za-z0-9_]+$/.test(refund.id) ||
    !Number.isSafeInteger(refund.amount) ||
    refund.amount <= 0 ||
    !Number.isSafeInteger(refund.created) ||
    !Number.isSafeInteger(eventCreated)
  )
    throw Error('Invalid verified refund result');
  const pi =
    typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : refund.payment_intent?.id || '';
  // Build the payload from explicit fields; notes, metadata and provider errors
  // may contain private contact details and must never enter this outbox.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO refund_notifications(id,refund_id,order_id,status,payload)
    SELECT ?,?,o.id,?,json_object('order_no',o.order_no,'order_type',o.type,
      'paid_amount',o.amount,'refund_id',?,'refund_amount',?,'status',?,
      'confirmed_at',CURRENT_TIMESTAMP)
    FROM orders o JOIN settings s ON s.key='refund_notifications_start'
    WHERE o.id=? AND o.stripe_payment_intent=? AND o.status IN ('paid','shipped','refunded')
      AND ?<=o.amount AND CAST(s.value AS INTEGER)<=?
      AND (CAST(s.value AS INTEGER)<=? OR ?=1)
      AND (?!='succeeded' OR NOT EXISTS(
        SELECT 1 FROM refund_notifications prior WHERE prior.refund_id=?
        AND prior.status IN ('failed','canceled')))`,
  )
    .bind(
      'refund-' + refund.id + '-' + refund.status,
      refund.id,
      refund.status,
      refund.id,
      refund.amount,
      refund.status,
      orderId,
      pi,
      refund.amount,
      eventCreated,
      refund.created,
      isNewStatusTransition ? 1 : 0,
      refund.status,
      refund.id,
    )
    .run();
}

export function dailyReportDate(now = new Date(), hour = '0', minute = '5') {
  if (!/^(?:[01]?\d|2[0-3])$/.test(hour)) throw Error('Invalid daily report hour');
  if (!/^(?:[0-5]?\d)$/.test(minute)) throw Error('Invalid daily report minute');
  const china = new Date(now.getTime() + 8 * 3600000);
  if (china.getUTCHours() * 60 + china.getUTCMinutes() < Number(hour) * 60 + Number(minute))
    return null;
  return chinaDate(-1, now);
}
export function chinaDayBounds(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid report date');
  const start = Date.parse(date + 'T00:00:00+08:00');
  if (!Number.isFinite(start) || chinaDate(0, new Date(start)) !== date)
    throw Error('Invalid report date');
  return [start, start + 86400000].map((t) =>
    new Date(t).toISOString().slice(0, 19).replace('T', ' '),
  );
}
export async function dailyReportMessage(env: Env, date: string, now = new Date()) {
  const launchDate = env.NOTIFICATION_START_DATE || site.season.start;
  const [start] = chinaDayBounds(launchDate);
  const [, dayEnd] = chinaDayBounds(date);
  const reportDays =
    Math.round(
      (Date.parse(date + 'T00:00:00+08:00') - Date.parse(launchDate + 'T00:00:00+08:00')) /
        86400000,
    ) + 1;
  if (reportDays < 1) throw Error('Report date is before launch');
  const current = now.toISOString().replace('T', ' ').replace('Z', '');
  const end = current < dayEnd ? current : dayEnd;
  // A single read gives totals and product rows the same database snapshot.
  // Current checkout creates exactly one SKU line per goods order. Use actual
  // discounted goods receipts, never today's product price, and exclude freight.
  const summary = await env.DB.prepare(
    `WITH paid_orders AS (
      SELECT id,amount-remote_fee sales_amount FROM orders
      WHERE paid_at>=? AND paid_at<? AND status IN ('paid','shipped')
        AND type IN ('retail','adoption')
    ), totals AS (
      SELECT COUNT(*) orders,COALESCE(SUM(sales_amount),0) total_amount FROM paid_orders
    ), items AS (
      SELECT i.product_id,SUM(i.qty) qty,SUM(o.sales_amount) amount
      FROM order_items i JOIN paid_orders o ON o.id=i.order_id GROUP BY i.product_id
    )
    SELECT p.id,COALESCE(i.qty,0) qty,COALESCE(i.amount,0) amount,t.orders,t.total_amount
    FROM products p LEFT JOIN items i ON i.product_id=p.id CROSS JOIN totals t
    WHERE p.id IN ('FAMILY','GIFT','PA','FG')`,
  )
    .bind(start, end)
    .all<ProductSummary>();
  const totals = summary.results[0];
  return [
    `「${site.name}」上线第${reportDays}天`,
    `${PUBLIC_ORIGIN}/`,
    '',
    `累计订单量：${totals?.orders || 0} 单`,
    `累计销售额：¥${money(totals?.total_amount || 0)}`,
    '',
    ...Object.entries(PRODUCTS).map(([id, product]) => {
      const row = summary.results.find((item) => item.id === id);
      return `${product.name}：${row?.qty || 0} ${product.unit}，¥${money(row?.amount || 0)}`;
    }),
  ].join('\n');
}

export async function enqueueDailyReport(env: Env, now = new Date()) {
  if (!notificationsReady(env)) return;
  const date = dailyReportDate(
    now,
    env.NOTIFICATION_DAILY_HOUR || '0',
    env.NOTIFICATION_DAILY_MINUTE || '5',
  );
  if (!date || date < (env.NOTIFICATION_START_DATE || site.season.start)) return;
  const id = 'daily-' + date;
  if (await env.DB.prepare('SELECT id FROM commerce_notifications WHERE id=?').bind(id).first())
    return;
  const message = await dailyReportMessage(env, date, now);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO commerce_notifications(id,kind,payload) VALUES(?,'daily_report',?)",
  )
    .bind(id, JSON.stringify({ message }))
    .run();
}

class DeliveryError extends Error {
  constructor(
    public code: string,
    public retryAfter = 0,
  ) {
    super(code);
  }
}
// Do not log provider bodies/errors: they can echo the token-bearing request URL.
export async function sendTelegram(env: Env, message: string, sender: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await sender(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message,
        link_preview_options: { is_disabled: true },
        protect_content: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new DeliveryError('network_or_timeout');
  }
  let body: { ok?: boolean; error_code?: number; parameters?: { retry_after?: number } };
  try {
    body = await response.json();
  } catch {
    throw new DeliveryError('invalid_response');
  }
  if (!response.ok || body.ok !== true)
    throw new DeliveryError(
      `telegram_${body.error_code || response.status}`,
      Math.min(86400, Math.max(0, Number(body.parameters?.retry_after) || 0)),
    );
}

export async function flushCommerceNotifications(
  env: Env,
  now = new Date(),
  sender: typeof fetch = fetch,
) {
  if (!notificationsReady(env)) return;
  const epoch = Math.floor(now.getTime() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO notification_deliveries(notification_id,channel)
    SELECT id,'telegram' FROM commerce_notifications`,
  ).run();
  const due = await env.DB.prepare(
    `SELECT n.id,n.kind,n.payload,d.attempts,n.created_at,'commerce' delivery_source FROM commerce_notifications n
    JOIN notification_deliveries d ON d.notification_id=n.id AND d.channel='telegram'
    WHERE d.sent_at IS NULL AND d.next_attempt_at<=? AND d.lease_until<=?
    UNION ALL
    SELECT id,'sponsor_application',payload,attempts,created_at,'sponsor' FROM sponsor_notifications
    WHERE sent_at IS NULL AND next_attempt_at<=? AND lease_until<=?
    UNION ALL
    SELECT id,'refund_result',payload,attempts,created_at,'refund' FROM refund_notifications
    WHERE sent_at IS NULL AND superseded_at IS NULL AND next_attempt_at<=? AND lease_until<=?
    UNION ALL SELECT id,'operation_alert',payload,attempts,created_at,'operation' FROM operation_notifications
    WHERE sent_at IS NULL AND next_attempt_at<=? AND lease_until<=?
    ORDER BY created_at,id LIMIT 10`,
  )
    .bind(epoch, epoch, epoch, epoch, epoch, epoch, epoch, epoch)
    .all<Delivery>();
  // One short lease per delivery prevents simultaneous Webhook/Cron runners from double-sending.
  for (const n of due.results) {
    // All queues use the same lease/retry protocol. Table and key names are
    // fixed here, never derived from application input or notification payloads.
    const target =
      n.delivery_source === 'sponsor'
        ? { table: 'sponsor_notifications', key: 'id=?' }
        : n.delivery_source === 'refund'
          ? { table: 'refund_notifications', key: 'id=?' }
          : n.delivery_source === 'operation'
            ? { table: 'operation_notifications', key: 'id=?' }
            : { table: 'notification_deliveries', key: "notification_id=? AND channel='telegram'" };
    const lease = crypto.randomUUID();
    const lock = await env.DB.prepare(
      `UPDATE ${target.table} SET lease_token=?,lease_until=?
      WHERE ${target.key} ${n.delivery_source === 'refund' ? 'AND superseded_at IS NULL' : ''}
        AND sent_at IS NULL AND lease_until<=? AND next_attempt_at<=?`,
    )
      .bind(lease, Math.floor(Date.now() / 1000) + 120, n.id, epoch, epoch)
      .run();
    if (!lock.meta.changes) continue;
    if (
      n.delivery_source === 'refund' &&
      !(await env.DB.prepare(
        'SELECT id FROM refund_notifications WHERE id=? AND lease_token=? AND superseded_at IS NULL',
      )
        .bind(n.id, lease)
        .first())
    ) {
      await env.DB.prepare(
        'UPDATE refund_notifications SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?',
      )
        .bind(n.id, lease)
        .run();
      continue;
    }
    try {
      const payload = JSON.parse(n.payload);
      const message =
        n.kind === 'paid_order'
          ? paidOrderMessage(payload)
          : n.kind === 'sponsor_application'
            ? sponsorApplicationMessage(payload)
            : n.kind === 'refund_result'
              ? refundResultMessage(payload)
              : n.kind === 'operation_alert'
                ? `🍎 ${site.name}｜运营提醒\n` + payload.message + '\n' + PUBLIC_ORIGIN + '/admin'
                : payload.message;
      await sendTelegram(env, message, sender);
      await env.DB.prepare(
        `UPDATE ${target.table} SET sent_at=CURRENT_TIMESTAMP,attempts=attempts+1,
        lease_token=NULL,lease_until=0,last_error=NULL WHERE ${target.key} AND lease_token=?`,
      )
        .bind(n.id, lease)
        .run();
    } catch (error) {
      const retryAfter = error instanceof DeliveryError ? error.retryAfter : 0;
      const delay = Math.max(retryAfter, Math.min(21600, 300 * 2 ** Math.min(n.attempts, 7)));
      await env.DB.prepare(
        `UPDATE ${target.table} SET attempts=attempts+1,next_attempt_at=?,
        lease_token=NULL,lease_until=0,last_error=? WHERE ${target.key} AND lease_token=?`,
      )
        .bind(
          epoch + delay,
          error instanceof DeliveryError ? error.code : 'invalid_message',
          n.id,
          lease,
        )
        .run();
    }
  }
}
export async function notificationJobs(env: Env, now = new Date()) {
  await enqueueDailyReport(env, now);
  await flushCommerceNotifications(env, now);
}
