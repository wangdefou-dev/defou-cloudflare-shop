import { useEffect, useId, useRef, useState } from 'react';
import { request } from './ui';
import { money } from '../lib/shared';
import { couponLabel, normalizeCouponCode, type CouponQuote } from '../lib/coupon-format';

export function useCoupon(sku: string, unitPrice: number, enabled: boolean) {
  const ready = enabled && unitPrice > 0;
  const [draft, setDraft] = useState('');
  const [applied, setApplied] = useState<{ code: string; quote: CouponQuote } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef({ sku, unitPrice, draft });
  current.current = { sku, unitPrice, draft };
  const requestNumber = useRef(0);
  const quote =
    enabled &&
    applied?.quote.sku === sku &&
    applied.quote.unit_price === unitPrice &&
    normalizeCouponCode(draft) === applied.code
      ? applied.quote
      : null;
  useEffect(() => {
    if (applied && !quote) {
      setApplied(null);
      setError('商品或价格已变化，请重新应用优惠码');
    }
  }, [sku, unitPrice, enabled]);
  useEffect(() => {
    if (!quote) return;
    const remaining = Date.parse(quote.expires_at.replace(' ', 'T') + 'Z') - Date.now();
    const timer = setTimeout(
      () => {
        setApplied(null);
        setError('优惠码已过期，请移除后继续下单');
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [quote]);
  function edit(value: string) {
    requestNumber.current++;
    setDraft(value);
    setApplied(null);
    setError('');
    setBusy(false);
  }
  async function apply() {
    if (!ready) {
      setError('正在读取商品，请稍后应用优惠码');
      return;
    }
    const code = normalizeCouponCode(draft);
    const selected = { sku, unitPrice };
    const number = ++requestNumber.current;
    setBusy(true);
    setError('');
    setApplied(null);
    try {
      const result: CouponQuote = await request('/coupons/quote', { code, sku });
      if (
        number !== requestNumber.current ||
        current.current.sku !== selected.sku ||
        current.current.unitPrice !== selected.unitPrice
      )
        return;
      if (result.unit_price !== selected.unitPrice)
        throw Error('商品价格已更新，请刷新页面后重新应用');
      setApplied({ code, quote: result });
    } catch (e) {
      if (number === requestNumber.current) setError((e as Error).message);
    } finally {
      if (number === requestNumber.current) setBusy(false);
    }
  }
  return {
    ready,
    draft,
    quote,
    error,
    busy,
    edit,
    apply,
    remove: () => edit(''),
    invalidate: (message: string) => {
      setApplied(null);
      setError(message);
    },
    code: quote ? normalizeCouponCode(draft) : undefined,
    discount: quote?.discount_amount || 0,
    unapplied: enabled && !!draft.trim() && !quote,
  };
}

export default function CouponField({ coupon }: { coupon: ReturnType<typeof useCoupon> }) {
  const id = useId();
  return (
    <div className="coupon-field">
      <label htmlFor={id}>
        优惠码 <span>选填</span>
      </label>
      <div className="coupon-input-row">
        <input
          id={id}
          type="text"
          value={coupon.draft}
          onChange={(e) => coupon.edit(e.currentTarget.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          placeholder="输入社群优惠码"
          aria-invalid={!!coupon.error}
          aria-describedby={id + '-feedback'}
        />
        {coupon.quote ? (
          <button type="button" onClick={coupon.remove}>
            移除
          </button>
        ) : (
          <button
            type="button"
            onClick={coupon.apply}
            disabled={coupon.busy || !coupon.draft.trim() || !coupon.ready}
          >
            {coupon.busy ? '核对中…' : '应用'}
          </button>
        )}
      </div>
      <p
        id={id + '-feedback'}
        role="status"
        className={coupon.error ? 'coupon-error' : 'coupon-feedback'}
      >
        {coupon.error ||
          (coupon.quote
            ? `已应用 ${couponLabel(coupon.quote.percent_off)}券，1 箱优惠 ¥${money(coupon.discount)}`
            : '每单仅优惠一箱，不叠加，运费不参与优惠；可用次数以券规则为准')}
      </p>
      {coupon.quote && (
        <p className="coupon-terms">
          有效期至{' '}
          {new Date(coupon.quote.expires_at.replace(' ', 'T') + 'Z').toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour12: false,
          })}
          （北京时间）。下单后保留 30
          分钟付款；超时未付且券仍有效可重新使用。优惠订单原路退款累计不超过实付金额。
        </p>
      )}
    </div>
  );
}
