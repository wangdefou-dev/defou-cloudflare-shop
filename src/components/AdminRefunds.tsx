import { useEffect, useRef, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import type { AdminRefundRecord, AdminRefundSummary } from '../lib/refund-format';
import { money } from '../lib/shared';
import { Button, ErrorBox, Field, request } from './ui';
import '../styles/admin-refunds.css';

type RefundAttempt = {
  order_id: string;
  request_id: string;
  amount_cents: number;
  reason: AdminRefundRecord['reason'];
  note: string;
  confirmed: true;
};
const statuses: Record<AdminRefundRecord['status'], string> = {
  submitting: '正在提交',
  unknown: '结果待确认',
  pending: '退款处理中',
  requires_action: '需要进一步处理',
  succeeded: '退款成功',
  failed: '退款失败',
  canceled: '已取消',
};
const reasons: Record<AdminRefundRecord['reason'], string> = {
  requested_by_customer: '客户申请 / 售后退款',
  duplicate: '重复付款',
  fraudulent: '未经授权的付款',
};
const unresolved = (status: AdminRefundRecord['status']) =>
  status === 'submitting' || status === 'unknown';
function cents(value: string): number | null {
  const clean = value.trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}
function localTime(value: string) {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? '时间暂不可用'
    : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
class RefundRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function createRefund(body: RefundAttempt) {
  const response = await fetch('/api/admin/refunds/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value = (await response.json()) as {
    error?: unknown;
    summary?: AdminRefundSummary;
    ok?: boolean;
    request_id?: string;
  } | null;
  if (!response.ok)
    throw new RefundRequestError(
      typeof value?.error === 'string' ? value.error : '退款请求暂未完成',
      response.status,
    );
  if (!value?.summary) throw Error('退款结果未能完整读取');
  return {
    ok: value.ok !== false,
    request_id: value.request_id || body.request_id,
    summary: value.summary,
  };
}

export default function AdminRefunds({
  orderId,
  onUpdated,
  onBusyChange,
}: {
  orderId: string;
  onUpdated: () => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [summary, setSummary] = useState<AdminRefundSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'remaining' | 'partial'>('remaining');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<AdminRefundRecord['reason']>('requested_by_customer');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [attempt, setAttempt] = useState<RefundAttempt | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(true);
  const saving = useRef(false);
  const generation = useRef(0);
  const readNumber = useRef(0);
  const attemptRef = useRef<RefundAttempt | null>(null);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  function remember(value: RefundAttempt | null) {
    attemptRef.current = value;
    setAttempt(value);
  }
  function acceptSummary(next: AdminRefundSummary) {
    setSummary(next);
    setConfirmed(false);
    const current = attemptRef.current;
    const record = current && next.refunds.find((item) => item.request_id === current.request_id);
    if (record && !unresolved(record.status)) {
      remember(null);
      setExpanded(false);
    } else if (!current) {
      const waiting = next.refunds.find((item) => unresolved(item.status));
      if (waiting)
        remember({
          order_id: next.order_id,
          request_id: waiting.request_id,
          amount_cents: waiting.amount,
          reason: waiting.reason,
          note: waiting.note,
          confirmed: true,
        });
    }
  }
  async function load(sync: boolean) {
    const ownGeneration = generation.current;
    const number = ++readNumber.current;
    setLoading(true);
    setError('');
    try {
      const next: AdminRefundSummary = await request(
        sync ? '/admin/refunds/sync' : '/admin/refunds/preview',
        { order_id: orderId },
      );
      if (active.current && ownGeneration === generation.current && number === readNumber.current)
        acceptSummary(next);
    } catch (e) {
      if (active.current && ownGeneration === generation.current && number === readNumber.current)
        setError((e as Error).message);
    } finally {
      if (active.current && ownGeneration === generation.current && number === readNumber.current)
        setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    generation.current++;
    setSummary(null);
    saving.current = false;
    setBusy(false);
    remember(null);
    setExpanded(false);
    setConfirmed(false);
    setAmount('');
    setNote('');
    setNotice('');
    void load(false);
    return () => {
      active.current = false;
      generation.current++;
    };
  }, [orderId]);

  const refundAmount =
    attempt?.amount_cents ??
    (mode === 'remaining' ? summary?.available_amount || null : cents(amount));
  const amountValid =
    refundAmount !== null && refundAmount > 0 && refundAmount <= (summary?.available_amount || 0);
  const frozen = busy || !!attempt;

  async function submit(event?: React.SyntheticEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (saving.current || !summary) return;
    const retry = attemptRef.current;
    if (!retry && (!confirmed || !amountValid || !summary.can_refund)) return;
    const body: RefundAttempt = retry || {
      order_id: orderId,
      request_id: crypto.randomUUID(),
      amount_cents: refundAmount!,
      reason,
      note: note.trim(),
      confirmed: true,
    };
    const ownGeneration = generation.current;
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    remember(body);
    try {
      const result = await createRefund(body);
      if (!active.current || generation.current !== ownGeneration) return;
      acceptSummary(result.summary);
      const record = result.summary.refunds.find((item) => item.request_id === body.request_id);
      if (record?.status === 'succeeded')
        setNotice(`Stripe 已确认退款 ¥${money(body.amount_cents)}，实际到账以支付渠道为准。`);
      else if (record?.status === 'failed' || record?.status === 'canceled')
        setError(record.failure_message || '本次退款未成功，详情见退款记录。');
      else if (record && !unresolved(record.status))
        setNotice('退款已提交，正在由支付渠道处理。请刷新状态查看结果。');
      else setNotice('退款结果仍待确认，请刷新状态或重试同笔退款。金额与请求已保留。');
      try {
        await onUpdated();
      } catch {
        if (active.current && generation.current === ownGeneration)
          setNotice('退款请求已处理，订单详情暂未刷新，请稍后手动刷新。');
      }
    } catch (e) {
      if (!active.current || generation.current !== ownGeneration) return;
      // Only an initial, definite pre-submit rejection permits a new draft.
      // A retry's auth/rate-limit failure says nothing about the original result.
      if (
        !retry &&
        e instanceof RefundRequestError &&
        [400, 401, 403, 404, 409, 422, 429].includes(e.status)
      ) {
        remember(null);
        setConfirmed(false);
        if (e.status === 409) await load(true);
        if (active.current && generation.current === ownGeneration) setError(e.message);
      } else {
        setError(
          `提交未完成或结果尚待确认：${(e as Error).message}。请刷新状态或重试同笔退款，请勿另建重复请求。`,
        );
      }
    } finally {
      if (generation.current === ownGeneration) {
        saving.current = false;
        if (active.current) setBusy(false);
      }
    }
  }

  return (
    <section className="admin-detail-section admin-refunds" aria-busy={loading || busy}>
      <div className="admin-detail-section-heading">
        <h3>退款与售后</h3>
        <button
          className="small-button"
          type="button"
          disabled={loading || busy}
          onClick={() => void load(true)}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {loading ? '正在核对' : '刷新退款状态'}
        </button>
      </div>
      <ErrorBox text={error} />
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
      {loading && !summary && <p className="fine-print">正在核对支付渠道的可退余额…</p>}
      {summary && (
        <>
          <dl className="admin-refund-amounts">
            <div>
              <dt>实付金额</dt>
              <dd>¥{money(summary.paid_amount)}</dd>
            </div>
            <div>
              <dt>已退款</dt>
              <dd>¥{money(summary.refunded_amount)}</dd>
            </div>
            <div>
              <dt>处理中</dt>
              <dd>¥{money(summary.pending_amount)}</dd>
            </div>
            <div>
              <dt>当前可退</dt>
              <dd className="admin-detail-amount">¥{money(summary.available_amount)}</dd>
            </div>
          </dl>
          {summary.blocked_reason && (
            <p className="admin-refund-info" role="status">
              {summary.blocked_reason}
            </p>
          )}
          {summary.warnings?.length > 0 && (
            <ul className="admin-refund-warnings">
              {summary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {attempt && (
            <div className="admin-refund-recovery" role="status">
              <strong>{busy ? '正在提交这笔退款' : '这笔退款的结果仍待确认'}</strong>
              <p>
                订单 {summary.order_no} · ¥{money(attempt.amount_cents)}
                。原请求与金额已锁定，刷新或重试会继续核对同一笔退款。
              </p>
              <button
                type="button"
                className="small-button"
                disabled={loading || busy || !summary.configured}
                onClick={() => void submit()}
              >
                {busy ? '正在核对同笔退款' : '重试同笔退款'}
              </button>
            </div>
          )}
          {!attempt && !expanded && summary.can_refund && (
            <button
              type="button"
              className="small-button admin-refund-open"
              disabled={loading || busy}
              onClick={() => {
                setExpanded(true);
                setConfirmed(false);
                setError('');
                setNotice('');
              }}
            >
              <RotateCcw size={16} aria-hidden="true" />
              快速退款
            </button>
          )}
          {expanded && !attempt && (
            <form className="admin-refund-form" onSubmit={submit}>
              <fieldset disabled={frozen || loading}>
                <legend>选择本次退款金额</legend>
                <div className="admin-refund-options">
                  <label>
                    <input
                      type="radio"
                      name={'refund-mode-' + orderId}
                      checked={mode === 'remaining'}
                      onChange={() => {
                        setMode('remaining');
                        setConfirmed(false);
                      }}
                    />
                    退回剩余金额 ¥{money(summary.available_amount)}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={'refund-mode-' + orderId}
                      checked={mode === 'partial'}
                      onChange={() => {
                        setMode('partial');
                        setConfirmed(false);
                      }}
                    />
                    部分退款
                  </label>
                </div>
                {mode === 'partial' && (
                  <Field
                    label="退款金额（元）"
                    hint={`最多可退 ¥${money(summary.available_amount)}，最多两位小数`}
                  >
                    <input
                      name="refund_amount"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      maxLength={12}
                      placeholder="例如 12.96"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.currentTarget.value);
                        setConfirmed(false);
                      }}
                      aria-invalid={!!amount && !amountValid}
                      required
                    />
                  </Field>
                )}
                <Field label="退款原因">
                  <select
                    value={reason}
                    onChange={(e) => {
                      setReason(e.currentTarget.value as AdminRefundRecord['reason']);
                      setConfirmed(false);
                    }}
                  >
                    {Object.entries(reasons).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="售后备注（选填）" hint="仅在受保护后台保留，请勿填写银行卡或支付密码">
                  <textarea
                    maxLength={300}
                    rows={2}
                    value={note}
                    onChange={(e) => {
                      setNote(e.currentTarget.value);
                      setConfirmed(false);
                    }}
                  />
                </Field>
                <div className="admin-refund-confirm">
                  <p>
                    订单 <strong>{summary.order_no}</strong>
                  </p>
                  <p>
                    本次原路退回{' '}
                    <strong>{refundAmount ? '¥' + money(refundAmount) : '请填写有效金额'}</strong>
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.currentTarget.checked)}
                    />
                    我已核对订单与金额，确认向原支付方式发起退款
                  </label>
                </div>
                <div className="admin-refund-form-actions">
                  <Button
                    type="submit"
                    busy={busy}
                    disabled={loading || !confirmed || !amountValid || !summary.can_refund}
                  >
                    {refundAmount ? `确认退款 ¥${money(refundAmount)}` : '确认退款'}
                  </Button>
                  <button
                    type="button"
                    className="small-button"
                    disabled={busy}
                    onClick={() => {
                      setExpanded(false);
                      setConfirmed(false);
                    }}
                  >
                    取消
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          {summary.refunds.length > 0 && (
            <details className="admin-refund-history" open>
              <summary>退款记录（{summary.refunds.length} 笔）</summary>
              {summary.refunds.map((item) => (
                <article key={item.request_id} className="admin-refund-record">
                  <div>
                    <strong>¥{money(item.amount)}</strong>
                    <span className={'admin-refund-status ' + item.status}>
                      {statuses[item.status]}
                    </span>
                  </div>
                  <p>
                    {reasons[item.reason]} · {localTime(item.created_at)}
                  </p>
                  {item.note && <p className="admin-refund-note">{item.note}</p>}
                  {item.failure_message && (
                    <p className="admin-refund-failure">{item.failure_message}</p>
                  )}
                </article>
              ))}
            </details>
          )}
          <p className="fine-print admin-refund-footnote">
            退款原路退回，到账时间由支付渠道决定。部分退款不取消发货或认领；全部退回后的订单和履约状态由
            Stripe 回调确认。
          </p>
        </>
      )}
    </section>
  );
}
