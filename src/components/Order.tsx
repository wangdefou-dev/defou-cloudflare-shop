import { finishCheckoutIntent } from './checkout-client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, ArrowUpRight, Copy, Package } from 'lucide-react';
import { Button, ErrorBox, Field, PageIntro, request, Turnstile, useConfig } from './ui';
import { money, statusNames } from '../lib/shared';
import { PaymentGuide, usePaymentEnvironment, WeChatBrowserNotice } from './PaymentOptions';
import { browserPaymentEnvironment } from '../lib/payment-experience';
import ShipmentTracking from './ShipmentTracking';
export default function Order({ result = false }: { result?: boolean }) {
  const lookupVersion = useRef(0);
  const paymentEnvironment = usePaymentEnvironment();
  const [guide, setGuide] = useState(false);
  const { data: c } = useConfig(),
    [number, setNumber] = useState(''),
    [phone, setPhone] = useState(''),
    [token, setToken] = useState(''),
    [loadedOrder, setLoadedOrder] = useState<{ order: any; viewToken: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false);
  const order = loadedOrder?.order;
  const viewToken = loadedOrder?.viewToken || '';
  useEffect(() => {
    if (order && ['paid', 'shipped', 'expired', 'refunded'].includes(order.status))
      finishCheckoutIntent(order.order_no);
  }, [order?.order_no, order?.status]);
  useEffect(() => {
    const version = ++lookupVersion.current;
    const n = new URLSearchParams(location.search).get('order');
    if (n) {
      setNumber(n);
      try {
        const saved = JSON.parse(sessionStorage.getItem('order:' + n) || '{}');
        if (saved.phone) setPhone(saved.phone);
        if (saved.view_token)
          request('/order/status', { view_token: saved.view_token })
            .then((next) => {
              if (version === lookupVersion.current)
                setLoadedOrder({ order: next, viewToken: saved.view_token });
            })
            .catch(() => {});
      } catch {}
    }
    return () => {
      lookupVersion.current += 1;
    };
  }, []);
  useEffect(() => {
    if (!result || order?.status !== 'pending') return;
    if (!viewToken) return;
    const expectedOrderNo = order.order_no;
    let active = true;
    const timer = setInterval(
      () =>
        request('/order/status', { view_token: viewToken })
          .then((next) => {
            if (active)
              setLoadedOrder((current) =>
                current?.viewToken === viewToken && current.order.order_no === expectedOrderNo
                  ? { order: next, viewToken }
                  : current,
              );
          })
          .catch(() => {}),
      5000,
    );
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [result, order?.status, order?.order_no, viewToken]);
  async function lookup(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const version = ++lookupVersion.current;
    try {
      const o = await request('/order/lookup', { phone, order_no: number, turnstile: token });
      if (version !== lookupVersion.current) return;
      // Keep the authorization and its order together when switching orders.
      setLoadedOrder({ order: o, viewToken: o.view_token || '' });
      setCopied(false);
      if (o.view_token) {
        try {
          sessionStorage.setItem(
            'order:' + number,
            JSON.stringify({ phone, view_token: o.view_token }),
          );
        } catch {
          /* Keep the in-memory token when browser storage is blocked. */
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    if (browserPaymentEnvironment().wechat) {
      setGuide(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      let saved: { view_token?: string } = {};
      try {
        saved = JSON.parse(sessionStorage.getItem('order:' + number) || '{}');
      } catch {}
      const o = await request('/order/resume', {
        phone,
        order_no: number,
        turnstile: token,
        view_token: viewToken || saved.view_token,
      });
      location.href = o.url;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function simulatePayment() {
    setBusy(true);
    setError('');
    try {
      await request('/demo/pay', {order_no:number, phone, view_token:viewToken});
      const next = await request('/order/status', {view_token:viewToken});
      setLoadedOrder({order:next,viewToken});
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="page-wrap">
      {guide && <PaymentGuide order={order?.order_no} onClose={() => setGuide(false)} />}
      <PageIntro
        eyebrow="A LITTLE AUTUMN, ON ITS WAY"
        title={result ? '这一份心意，有了回音' : '你的苹果，走到哪了？'}
      >
        {result
          ? '支付状态以系统确认结果为准。请保存订单号，方便随时查找。'
          : '输入下单手机号和订单号，查看支付、发货和物流状态。'}
      </PageIntro>
      <div className="order-page-layout">
        <section className="form-panel">
          <form onSubmit={lookup}>
            <Field label="下单手机号">
              <input
                required
                inputMode="tel"
                maxLength={11}
                pattern="1[3-9][0-9]{9}"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="11 位手机号"
              />
            </Field>
            <Field label="订单号">
              <input
                required
                value={number}
                onChange={(e) => setNumber(e.target.value.toUpperCase())}
                placeholder="DF 开头的订单号"
              />
            </Field>
            <Turnstile demo={c?.demo} siteKey={c?.turnstile_site_key} onToken={setToken} />
            <ErrorBox text={error} />
            <Button busy={busy} disabled={!c || !token}>
              查询订单 <ArrowUpRight size={17} />
            </Button>
          </form>
          <div className="order-help">
            <h3>有一点小状况？</h3>
            <p>
              坏果请在收货 48 小时内拍照，保留订单号联系运营。250g 规格每个赔 ¥5，350g 规格每个赔
              ¥15。
            </p>
            {c?.contact_wechat ? (
              <p>
                售后微信：<strong>{c.contact_wechat}</strong>
              </p>
            ) : (
              <p className="fine-print">售后联系方式将在正式开售前公布。</p>
            )}
          </div>
        </section>
        <section className={'form-panel order-result ' + (!order ? 'waiting' : '')}>
          {order ? (
            <>
              <div className="result-symbol">
                {['paid', 'shipped'].includes(order.status) ? (
                  <CheckCircle2 size={48} strokeWidth={1} />
                ) : (
                  <Clock size={48} strokeWidth={1} />
                )}
              </div>
              <span className={'status-tag ' + order.status}>{statusNames[order.status]}</span>
              <h2>
                {order.status === 'paid'
                  ? '苹果，准备出发'
                  : order.status === 'shipped'
                    ? '你的秋天，正在路上'
                    : order.status === 'pending'
                      ? '订单已保留，等待支付确认'
                      : statusNames[order.status]}
              </h2>
              <div className="result-order-number">
                <code>{order.order_no}</code>
                <button
                  aria-label="复制订单号"
                  onClick={async () => {
                    await navigator.clipboard.writeText(order.order_no);
                    setCopied(true);
                  }}
                >
                  <Copy size={15} />
                  {copied ? '已复制' : ''}
                </button>
              </div>
              {order.discount_amount > 0 && (
                <>
                  <div className="summary-row">
                    <span>优惠前金额（含运费）</span>
                    <span>¥{money(order.original_amount)}</span>
                  </div>
                  <div className="summary-row">
                    <span>优惠券（仅一箱）</span>
                    <span>−¥{money(order.discount_amount)}</span>
                  </div>
                </>
              )}
              <div className="summary-row">
                <span>{order.discount_amount > 0 ? '折后订单金额' : '订单金额'}</span>
                <strong>¥{money(order.amount)}</strong>
              </div>
              <div className="summary-row">
                <span>下单时间</span>
                <span>
                  {new Date(order.created_at.replace(' ', 'T') + 'Z').toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    hour12: false,
                  })}{' '}
                  北京时间
                </span>
              </div>
              <div className="summary-row">
                <span>发票</span>
                <span>{statusNames[order.invoice_status]}</span>
              </div>
              {order.adoption && (
                <div className="adoption-receipt">
                  <h3>你的认领码</h3>
                  <strong>{order.adoption.adopt_code}</strong>
                  <p>
                    {order.adoption.plate_name} · 本季 {order.adoption.total_boxes} 箱
                  </p>
                  <p>请截图保存认领码，并记住下单时设置的 PIN。</p>
                  <a className="button secondary" href="/tree/my">
                    去我的苹安树 ↗
                  </a>
                </div>
              )}
              {order.shipments.map((s: any) => (
                <div className="shipment-card" key={s.id}>
                  <div>
                    <strong>
                      {s.qty} 箱 · {s.region_label}
                    </strong>
                    <p>{statusNames[s.status]}</p>
                    <ShipmentTracking shipment={s} context="order" viewToken={viewToken} />
                  </div>
                </div>
              ))}
              {c?.demo && order.status === 'pending' && (
                <Button type="button" busy={busy} onClick={simulatePayment}>模拟付款成功（不扣款）</Button>
              )}
              {order.status === 'pending' && (
                <>
                  {paymentEnvironment.wechat && (
                    <WeChatBrowserNotice existingOrder onOpen={() => setGuide(true)} />
                  )}
                  <p className="fine-print">
                    页面跳转不代表支付成功，系统正在等待支付确认。请勿重复下单。
                  </p>
                  <Button type="button" busy={busy} disabled={!token && !viewToken} onClick={pay}>
                    {paymentEnvironment.wechat ? '在浏览器中付款' : '继续支付'}
                    <ArrowUpRight size={17} />
                  </Button>
                </>
              )}
              {c?.official_qr_url && (
                <div className="official-follow">
                  <img src={c.official_qr_url} alt="公众号二维码" />
                  <p>关注公众号，收下果园的下一封来信。</p>
                </div>
              )}
            </>
          ) : (
            <>
              <Package size={70} strokeWidth={0.8} />
              <h2>一箱苹果，一份惦记</h2>
              <p>查到订单后，会在这里显示出发的消息。</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
