import site from '../../config/site.json';
const PAYMENT_PROJECT = site.paymentProject;
import Stripe from 'stripe';
import { z } from 'zod';
import { assert, HttpError } from './security';
import { stripe, finalizeRefundedOrder } from './payments';
import type { AdminRefundRecord, AdminRefundSummary } from './refund-format';
import { enqueueRefundResult } from './notifications';

type Order = {
  id: string;
  order_no: string;
  type: string;
  status: string;
  amount: number;
  stripe_payment_intent: string | null;
  shipment_id: string | null;
  pending_shipping?: number;
};
type RecordRow = AdminRefundRecord & {
  order_id: string;
  actor: string;
  lease_until: string | null;
};
type Payment = { charge: Stripe.Charge; refunds: Stripe.Refund[] };
const openStatuses = ['submitting', 'unknown', 'pending', 'requires_action'];
const options = { timeout: 12000, maxNetworkRetries: 0 };
const reason = z.enum(['requested_by_customer', 'duplicate', 'fraudulent']);
function client(env: Env) {
  return stripe({
    ...env,
    STRIPE_SECRET_KEY: env.STRIPE_REFUND_SECRET_KEY || env.STRIPE_SECRET_KEY,
  });
}
function refId(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id || '';
}
function live(env: Env) {
  return env.STRIPE_MODE === 'live';
}
async function order(env: Env, id: string) {
  const found = await env.DB.prepare(
    `SELECT o.id,o.order_no,o.type,o.status,o.amount,o.stripe_payment_intent,o.shipment_id,
      (SELECT COUNT(*) FROM orders fee JOIN shipments s ON s.id=fee.shipment_id
       JOIN adoptions a ON s.source='adoption' AND CAST(a.id AS TEXT)=s.source_id
       WHERE a.order_id=o.id AND fee.type='shipping' AND fee.status='pending') pending_shipping
      FROM orders o WHERE o.id=?`,
  )
    .bind(id)
    .first<Order>();
  assert(found, 404, '未找到订单');
  return found;
}
async function records(env: Env, id: string) {
  return (
    await env.DB.prepare(
      'SELECT * FROM admin_refund_requests WHERE order_id=? ORDER BY created_at DESC,request_id DESC',
    )
      .bind(id)
      .all<RecordRow>()
  ).results;
}
function publicRecord(r: RecordRow): AdminRefundRecord {
  const { order_id: _order, actor: _actor, lease_until: _lease, ...safe } = r;
  return safe;
}
function safeFailure(error: unknown) {
  const e = error as { statusCode?: number; code?: string; type?: string };
  if (e.statusCode === 401 || e.statusCode === 403)
    return 'Stripe 退款授权尚未完成，请配置退款及付款只读权限';
  if (e.code === 'balance_insufficient') return 'Stripe 可用余额不足，请在 Stripe 补足余额后处理';
  if (e.code === 'charge_disputed') return '这笔付款存在争议，请先到 Stripe 核实，避免重复赔付';
  if (e.code === 'charge_already_refunded') return '这笔付款已退完，请刷新退款状态';
  if (e instanceof HttpError) return e.message;
  if (e.statusCode && [400, 402, 404, 422].includes(e.statusCode))
    return 'Stripe 未接受本次退款，请刷新余额并核对付款状态后再试';
  return '暂时无法确认 Stripe 的退款状态，请刷新查询；结果未确认前不要另建退款';
}
async function payment(env: Env, o: Order, allowDisputed = false): Promise<Payment> {
  assert(
    o.stripe_payment_intent && /^pi_[A-Za-z0-9_]+$/.test(o.stripe_payment_intent),
    409,
    '订单尚无可退款的实际付款',
  );
  const s = client(env);
  const pi = await s.paymentIntents.retrieve(
    o.stripe_payment_intent,
    { expand: ['latest_charge'] },
    options,
  );
  assert(
    pi.id === o.stripe_payment_intent &&
      pi.livemode === live(env) &&
      pi.currency === 'cny' &&
      pi.status === 'succeeded' &&
      pi.amount_received === o.amount &&
      pi.metadata?.project === PAYMENT_PROJECT &&
      pi.metadata.order_id === o.id,
    409,
    'Stripe 付款的项目、环境或实付金额与订单不匹配',
  );
  const charge =
    typeof pi.latest_charge === 'string'
      ? await s.charges.retrieve(pi.latest_charge, {}, options)
      : pi.latest_charge;
  assert(
    charge &&
      charge.object === 'charge' &&
      charge.paid &&
      charge.captured &&
      charge.currency === 'cny' &&
      charge.livemode === live(env) &&
      refId(charge.payment_intent) === o.stripe_payment_intent &&
      charge.amount_captured === o.amount,
    409,
    '未找到与订单实付一致的已扣款记录',
  );
  assert(
    allowDisputed || !charge.disputed,
    409,
    '这笔付款存在争议，请先到 Stripe 核实，避免重复赔付',
  );
  const refunds: Stripe.Refund[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const list = await s.refunds.list(
      {
        payment_intent: o.stripe_payment_intent,
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      },
      options,
    );
    for (const r of list.data) {
      assert(
        r.currency === 'cny' &&
          refId(r.payment_intent) === o.stripe_payment_intent &&
          refId(r.charge) === charge.id,
        409,
        'Stripe 退款记录与该订单不匹配',
      );
      refunds.push(r);
    }
    if (!list.has_more) return { charge, refunds };
    cursor = list.data.at(-1)?.id;
    assert(cursor, 409, '退款记录未完整读取，请到 Stripe 核实');
  }
  throw new HttpError(409, '退款记录过多，无法完整核对余额，请到 Stripe 处理');
}
function refundStatus(r: Stripe.Refund): AdminRefundRecord['status'] {
  return ['succeeded', 'failed', 'canceled', 'pending', 'requires_action'].includes(r.status || '')
    ? (r.status as AdminRefundRecord['status'])
    : 'unknown';
}
function failureMessage(r: Stripe.Refund) {
  return r.status === 'failed'
    ? 'Stripe 退款失败，请到 Stripe 查看失败原因并核实后重新处理'
    : r.status === 'requires_action'
      ? '退款需要进一步处理，请到 Stripe 查看要求'
      : null;
}
async function persistRefund(env: Env, row: RecordRow, refund: Stripe.Refund) {
  const o = await order(env, row.order_id);
  assert(
    refund.metadata?.project === PAYMENT_PROJECT &&
      refund.metadata.order_id === o.id &&
      refund.metadata.refund_request_id === row.request_id &&
      refund.amount === row.amount &&
      refund.currency === 'cny' &&
      refId(refund.payment_intent) === o.stripe_payment_intent,
    409,
    '退款回执与原申请不匹配，请到 Stripe 核实',
  );
  const status = refundStatus(refund);
  // Latest API retrieval is authoritative; webhook callers retrieve first so an
  // older delayed event cannot regress a succeeded/failed refund to pending.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE admin_refund_requests SET stripe_refund_id=?,status=?,failure_message=?,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE request_id=? AND (stripe_refund_id IS NULL OR stripe_refund_id=?)
      AND NOT(status IN ('failed','canceled') AND status!=?)
      AND NOT(status='succeeded' AND ? IN ('submitting','unknown','pending','requires_action'))`,
    ).bind(refund.id, status, failureMessage(refund), row.request_id, refund.id, status, status),
    env.DB.prepare(
      `INSERT OR IGNORE INTO audit_log(id,actor,action,target)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM admin_refund_requests WHERE request_id=? AND status=?)`,
    ).bind(
      'refund-status-' + row.request_id + '-' + status,
      'stripe',
      'refund-' + status,
      row.order_id,
      row.request_id,
      status,
    ),
  ]);
}
async function reconcile(env: Env, o: Order, p: Payment, rows: RecordRow[]) {
  for (const row of rows) {
    const found = p.refunds.find(
      (r) =>
        r.id === row.stripe_refund_id ||
        (r.metadata?.project === PAYMENT_PROJECT &&
          r.metadata.order_id === o.id &&
          r.metadata.refund_request_id === row.request_id),
    );
    if (found) await persistRefund(env, row, found);
  }
  return records(env, o.id);
}
function summary(
  env: Env,
  o: Order,
  p: Payment | null,
  rows: RecordRow[],
  error = '',
): AdminRefundSummary {
  const stripeIds = new Set(p?.refunds.map((r) => r.id) || []);
  const successful = (p?.refunds || [])
    .filter((r) => r.status === 'succeeded')
    .reduce((n, r) => n + r.amount, 0);
  const stripePending = (p?.refunds || [])
    .filter((r) => !['succeeded', 'failed', 'canceled'].includes(r.status || ''))
    .reduce((n, r) => n + r.amount, 0);
  const unmatched = rows.filter(
    (r) =>
      openStatuses.includes(r.status) &&
      (!r.stripe_refund_id || !stripeIds.has(r.stripe_refund_id)),
  );
  const localPending = unmatched.reduce((n, r) => n + r.amount, 0);
  const localSucceeded = rows
    .filter(
      (r) =>
        r.status === 'succeeded' && (!r.stripe_refund_id || !stripeIds.has(r.stripe_refund_id)),
    )
    .reduce((n, r) => n + r.amount, 0);
  // amount_refunded can already include reserved refunds. Taking the maximum
  // avoids both double-subtraction and offering funds held by pending refunds.
  const committed = p
    ? Math.max(p.charge.amount_refunded, successful + stripePending + localSucceeded) + localPending
    : o.amount;
  const available = p ? Math.max(0, o.amount - committed) : 0;
  const outstanding = rows.some((r) => openStatuses.includes(r.status)) || stripePending > 0;
  const eligible = ['paid', 'shipped'].includes(o.status);
  const configured =
    !!(env.STRIPE_REFUND_SECRET_KEY || env.STRIPE_SECRET_KEY) && !/授权|密钥/.test(error);
  const blocked =
    error ||
    (!eligible
      ? '此订单未支付或已全退，不能发起退款'
      : o.type === 'adoption' && o.pending_shipping
        ? '这份认领还有未结束的补运费付款，请先在 Stripe 关闭其未付收银台并等待状态同步，再退认领订单'
        : outstanding
          ? '有一笔退款正在处理或结果待确认，请先刷新这笔退款的状态'
          : !available
            ? '这笔付款没有剩余可退金额'
            : '');
  const localIds = new Set(rows.map((r) => r.stripe_refund_id).filter(Boolean));
  const external: AdminRefundRecord[] = (p?.refunds || [])
    .filter((r) => !localIds.has(r.id))
    .map((r) => ({
      request_id: 'stripe:' + r.id,
      amount: r.amount,
      status: refundStatus(r),
      reason: reason.safeParse(r.reason).success
        ? (r.reason as AdminRefundRecord['reason'])
        : 'requested_by_customer',
      note: '从 Stripe 发起',
      stripe_refund_id: r.id,
      failure_message: failureMessage(r),
      created_at: new Date(r.created * 1000).toISOString(),
      updated_at: new Date(r.created * 1000).toISOString(),
    }));
  return {
    order_id: o.id,
    order_no: o.order_no,
    order_status: o.status,
    paid_amount: o.amount,
    refunded_amount: successful + localSucceeded,
    pending_amount: stripePending + localPending,
    available_amount: available,
    configured,
    can_refund: !!p && eligible && !blocked,
    blocked_reason: blocked,
    warnings: [
      '退款退回原支付方式，具体到账时间以支付机构为准；退款后优惠券次数不恢复。',
      ...(o.type === 'adoption'
        ? ['认领整单退完后将停止认领服务并取消未发货预约；另付的补运费订单须单独核对退款。']
        : []),
      '部分退款保留原履约；整单退完后的订单与发货状态等待 Stripe 回调确认，已发货记录保留。',
    ],
    refunds: [...rows.map(publicRecord), ...external].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    ),
  };
}
export async function refundPreview(env: Env, orderId: string): Promise<AdminRefundSummary> {
  const o = await order(env, orderId);
  let rows = await records(env, o.id);
  if (!['paid', 'shipped', 'refunded'].includes(o.status) || !o.stripe_payment_intent)
    return summary(env, o, null, rows, '此订单尚无已支付的实际付款，不能退款');
  if (!(env.STRIPE_REFUND_SECRET_KEY || env.STRIPE_SECRET_KEY))
    return summary(env, o, null, rows, 'Stripe 退款授权尚未配置');
  try {
    const p = await payment(env, o);
    rows = await reconcile(env, o, p, rows);
    return summary(env, o, p, rows);
  } catch (e) {
    return summary(env, o, null, rows, safeFailure(e));
  }
}
export const syncAdminRefunds = refundPreview;

export async function confirmedFullRefund(env: Env, charge: Stripe.Charge, o: Order) {
  if (!charge.refunded) return false;
  const p = await payment(env, o, true);
  return (
    p.refunds.filter((r) => r.status === 'succeeded').reduce((n, r) => n + r.amount, 0) === o.amount
  );
}

export async function createAdminRefund(env: Env, actor: string, input: unknown) {
  const b = z
    .object({
      order_id: z.string().min(1).max(100),
      request_id: z.uuid(),
      amount_cents: z.number().int().positive().max(100000000),
      reason: reason,
      note: z.string().trim().max(300).default(''),
      confirmed: z.literal(true),
    })
    .parse(input);
  const o = await order(env, b.order_id);
  let row = await env.DB.prepare('SELECT * FROM admin_refund_requests WHERE request_id=?')
    .bind(b.request_id)
    .first<RecordRow>();
  if (row)
    assert(
      row.order_id === b.order_id &&
        row.actor === actor &&
        row.amount === b.amount_cents &&
        row.reason === b.reason &&
        row.note === b.note,
      409,
      '同一退款请求内容已变化，请保留原申请核对',
    );
  assert(env.STRIPE_REFUND_SECRET_KEY || env.STRIPE_SECRET_KEY, 503, 'Stripe 退款授权尚未配置');
  let p: Payment;
  try {
    p = await payment(env, o);
  } catch (e) {
    throw new HttpError(503, safeFailure(e));
  }
  const current = await reconcile(env, o, p, await records(env, o.id));
  row = current.find((r) => r.request_id === b.request_id) || row;
  if (row?.stripe_refund_id || (row && !openStatuses.includes(row.status)))
    return { ok: true, request_id: b.request_id, summary: summary(env, o, p, current) };
  let fresh = false;
  if (!row) {
    const state = summary(env, o, p, current);
    assert(state.can_refund, 409, state.blocked_reason);
    assert(b.amount_cents <= state.available_amount, 409, '退款金额超过当前可退余额，请刷新后核对');
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO admin_refund_requests(request_id,order_id,actor,amount,reason,note,lease_until)
          VALUES(?,?,?,?,?,?,datetime('now','+30 seconds'))`,
        ).bind(b.request_id, o.id, actor, b.amount_cents, b.reason, b.note),
        env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)').bind(
          'refund-request-' + b.request_id,
          actor,
          'request-refund',
          o.id,
        ),
      ]);
    } catch {
      const existing = await env.DB.prepare(
        'SELECT * FROM admin_refund_requests WHERE request_id=?',
      )
        .bind(b.request_id)
        .first<RecordRow>();
      if (
        existing &&
        existing.order_id === o.id &&
        existing.actor === actor &&
        existing.amount === b.amount_cents &&
        existing.reason === b.reason &&
        existing.note === b.note
      ) {
        // A same-ID concurrent request is already doing the work. It must not
        // launch another request while the first response is outstanding.
        return { ok: true, request_id: b.request_id, summary: await refundPreview(env, o.id) };
      }
      const latest = await order(env, o.id);
      assert(
        !latest.pending_shipping,
        409,
        '这份认领还有未结束的补运费付款，请先关闭其未付收银台并等待同步',
      );
      throw new HttpError(409, '已有退款正在处理，请刷新原申请，勿重复发起');
    }
    fresh = true;
    row = (await env.DB.prepare('SELECT * FROM admin_refund_requests WHERE request_id=?')
      .bind(b.request_id)
      .first<RecordRow>())!;
  } else {
    // Stripe may prune idempotency keys after 24h. Beyond a conservative 23h
    // window, retrieve/reconcile only; never risk a second outbound refund.
    const age = Date.now() - Date.parse(row.created_at.replace(' ', 'T') + 'Z');
    assert(
      age >= 0 && age < 23 * 3600000,
      409,
      '此申请超过安全重试时限，请到 Stripe 核对原退款后处理',
    );
    const lease = await env.DB.prepare(
      `UPDATE admin_refund_requests SET lease_until=datetime('now','+30 seconds')
      WHERE request_id=? AND status IN ('submitting','unknown') AND (lease_until IS NULL OR lease_until<=datetime('now'))`,
    )
      .bind(row.request_id)
      .run();
    if (lease.meta.changes !== 1)
      return { ok: true, request_id: b.request_id, summary: await refundPreview(env, o.id) };
  }
  try {
    const result = await client(env).refunds.create(
      {
        payment_intent: o.stripe_payment_intent!,
        amount: row.amount,
        reason: row.reason,
        metadata: { project: PAYMENT_PROJECT, order_id: o.id, refund_request_id: row.request_id },
      },
      { ...options, idempotencyKey: 'orchard-shop-refund-' + row.request_id },
    );
    await persistRefund(env, row, result);
  } catch (e) {
    const err = e as { statusCode?: number };
    // Only definitive pre-execution 4xx failures release the operation lock.
    // Connection, timeout, 409 idempotency-in-use and 5xx stay unresolved.
    const definitive =
      fresh && !!err.statusCode && [400, 401, 402, 403, 404, 422].includes(err.statusCode);
    await env.DB.prepare(
      `UPDATE admin_refund_requests SET status=?,failure_message=?,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE request_id=? AND stripe_refund_id IS NULL AND status IN ('submitting','unknown')`,
    )
      .bind(definitive ? 'failed' : 'unknown', safeFailure(e), row.request_id)
      .run();
    if (!definitive)
      throw new HttpError(503, '退款结果尚未确认，请刷新或重试同一笔退款，勿另建申请');
  }
  return { ok: true, request_id: b.request_id, summary: await refundPreview(env, o.id) };
}

// Called only after payment webhook signature/environment validation. Retrieve
// the current object rather than applying potentially out-of-order event state.
export async function applyRefundWebhook(
  env: Env,
  eventRefund: Stripe.Refund,
  event: Stripe.Event,
) {
  if (eventRefund.metadata?.project && eventRefund.metadata.project !== PAYMENT_PROJECT) return;
  const row = await env.DB.prepare(
    'SELECT * FROM admin_refund_requests WHERE stripe_refund_id=? OR request_id=? LIMIT 1',
  )
    .bind(eventRefund.id, eventRefund.metadata?.refund_request_id || '')
    .first<RecordRow>();
  const o = row
    ? await order(env, row.order_id)
    : await env.DB.prepare(
        'SELECT id,order_no,type,status,amount,stripe_payment_intent,shipment_id FROM orders WHERE stripe_payment_intent=?',
      )
        .bind(refId(eventRefund.payment_intent))
        .first<Order>();
  if (!o) {
    // A Dashboard refund can arrive before the paid webhook has linked its PI.
    // Retry own events so they are not permanently acknowledged as foreign.
    if (eventRefund.metadata?.project === PAYMENT_PROJECT)
      throw new HttpError(409, '付款订单尚未同步，请重试');
    const intent = refId(eventRefund.payment_intent);
    if (/^pi_[A-Za-z0-9_]+$/.test(intent)) {
      const pi = await client(env).paymentIntents.retrieve(intent, {}, options);
      if (pi.metadata?.project === PAYMENT_PROJECT)
        throw new HttpError(409, '付款订单尚未同步，请重试');
    }
    return;
  }
  const current = await client(env).refunds.retrieve(eventRefund.id, {}, options);
  assert(
    current.id === eventRefund.id &&
      current.currency === 'cny' &&
      refId(current.payment_intent) === o.stripe_payment_intent,
    409,
    '退款回调与该订单不匹配',
  );
  const terminal = ['succeeded', 'failed', 'canceled'].includes(current.status || '');
  // A pending refund can fail because its charge became disputed. Reading a
  // verified outcome must still work; creating another refund remains blocked.
  const p = terminal ? await payment(env, o, true) : null;
  if (p)
    assert(
      refId(current.charge) === p.charge.id &&
        Number.isSafeInteger(current.amount) &&
        current.amount > 0 &&
        current.amount <= o.amount,
      409,
      '退款结果与原付款不匹配',
    );
  if (row) await persistRefund(env, row, current);
  if (current.status === 'succeeded' && p) {
    if (
      p.refunds.filter((r) => r.status === 'succeeded').reduce((n, r) => n + r.amount, 0) ===
      o.amount
    )
      await finalizeRefundedOrder(env, o);
  }
  if (terminal) {
    const previous = (event.data.previous_attributes as { status?: string } | undefined)?.status;
    // Old terminal refunds edited only in metadata are not new results. A real
    // post-launch transition of an older pending refund is still announced.
    const newTransition =
      current.status === eventRefund.status &&
      ((event.type === 'refund.failed' && current.status === 'failed') ||
        (event.type === 'refund.updated' &&
          ['pending', 'requires_action', 'succeeded'].includes(previous || '') &&
          previous !== current.status));
    await enqueueRefundResult(env, o.id, current, event.created, newTransition);
  }
}
