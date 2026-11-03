import site from '../../config/site.json';
import { checkoutPayload, useCheckoutSubmission } from './checkout-client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, ShieldCheck, Truck } from 'lucide-react';
import {
  AddressForm,
  Button,
  emptyAddress,
  emptyInvoice,
  ErrorBox,
  Field,
  InvoiceForm,
  PaymentGuide,
  placeOrder,
  Quantity,
  Turnstile,
  useConfig,
} from './ui';
import { money, shippingFee } from '../lib/shared';
import { APPLE_UNIT_WEIGHTS, SEASON_PRICES } from '../lib/content';
import ProductPhoto from './ProductPhoto';
import CouponField, { useCoupon } from './CouponField';
import { PaymentOptions, usePaymentEnvironment, WeChatBrowserNotice } from './PaymentOptions';
import { browserPaymentEnvironment } from '../lib/payment-experience';

const offers = {
  FAMILY: {
    name: '家庭装',
    price: SEASON_PRICES.FAMILY,
    detail: '22 个 · 约 5.5kg / 箱',
  },
  GIFT: {
    name: '礼盒装',
    price: SEASON_PRICES.GIFT,
    detail: '8 个大果 · 约 2.8kg / 盒',
  },
  PA: {
    name: '平安树',
    price: SEASON_PRICES.PA,
    detail: '8 箱 · 每箱 10 斤 · 共 80 斤',
  },
  FG: {
    name: '富贵树',
    price: SEASON_PRICES.FG,
    detail: '15 箱 · 每箱 6 斤 · 共 90 斤',
  },
};
type Sku = keyof typeof offers;

export default function MobileShop({ kind = 'retail' }: { kind?: 'retail' | 'adoption' }) {
  const submission = useCheckoutSubmission();
  const busy = submission.busy;
  const paymentEnvironment = usePaymentEnvironment();
  const [paymentMethod, setPaymentMethod] = useState<'alipay' | 'card'>('alipay');
  const tree = kind === 'adoption';
  const { data: config, error: loadError } = useConfig();
  const [sku, setSku] = useState<Sku>(tree ? 'PA' : 'FAMILY');
  const [qty, setQty] = useState(1);
  const [address, setAddress] = useState(emptyAddress);
  const [invoice, setInvoice] = useState(emptyInvoice);
  const [gift, setGift] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [guide, setGuide] = useState<{ url?: string; order?: string } | null>(null);
  const verification = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('sku');
    if (requested && (tree ? ['PA', 'FG'] : ['FAMILY', 'GIFT']).includes(requested))
      setSku(requested as Sku);
  }, [tree]);
  const product = config?.products.find((p: any) => p.sku === sku);
  const offer = offers[sku];
  const fee =
    !tree && config
      ? shippingFee(
          address.province_code,
          qty,
          config.settings.remote_provinces,
          config.settings.remote_fee,
        )
      : 0;
  const coupon = useCoupon(sku, product?.price ?? offer.price, !tree);
  const total = (product?.price ?? offer.price) * qty + fee - coupon.discount;
  const available = config?.sales_open && product?.active && product.stock >= qty;
  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (browserPaymentEnvironment().wechat) {
      setGuide({});
      return;
    }
    if (busy || !available) return;
    setError('');
    if (coupon.unapplied) {
      setError('请先应用优惠码，或清空优惠码后继续付款');
      return;
    }
    if (!token) {
      setError('请完成下方安全验证后付款');
      verification.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    try {
      const order = await submission.run(() =>
        placeOrder({
          ...checkoutPayload(kind, {
            sku,
            qty,
            phone,
            address,
            invoice,
            gift,
            name,
            pin,
            agreed,
            token,
            paymentMethod,
          }),
          coupon_code: coupon.code,
        }),
      );
      if (order) location.assign(order.url);
    } catch (e) {
      const message = (e as Error).message;
      if (coupon.code && /优惠码/.test(message)) coupon.invalidate(message);
      setError(message);
    }
  }
  return (
    <div className="mobile-shop">
      {paymentEnvironment.wechat && <WeChatBrowserNotice onOpen={() => setGuide({})} />}
      <div className="mobile-shop-intro">
        <div>
          <h1>{tree ? '认领一棵，收获一季' : '一箱好苹果，快递到家'}</h1>
        </div>
        {tree && (
          <a href="/tree/my">
            我的果树 <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        )}
      </div>
      <form
        onSubmit={submit}
        className="mobile-checkout"
        onInvalidCapture={(event) => {
          const details = (event.target as HTMLElement).closest('details');
          if (details) details.open = true;
        }}
      >
        <section className="mobile-shop-section" aria-labelledby="mobile-product-title">
          <h2 id="mobile-product-title">{tree ? '选择果树' : '选择规格'}</h2>
          <div className="mobile-offers">
            {(tree ? (['PA', 'FG'] as const) : (['FAMILY', 'GIFT'] as const)).map((key) => {
              const item = offers[key];
              const live = config?.products.find((p: any) => p.sku === key);
              return (
                <button
                  type="button"
                  key={key}
                  className={'mobile-offer' + (sku === key ? ' selected' : '')}
                  aria-pressed={sku === key}
                  onClick={() => {
                    setSku(key);
                    setQty(1);
                    setError('');
                  }}
                >
                  <ProductPhoto
                    sku={key}
                    sizes="(max-width: 360px) 75px, 92px"
                    audience="mobile"
                    priority
                  />
                  <span className="mobile-offer-copy">
                    <strong>{item.name}</strong>
                    <span>{item.detail}</span>
                    <small className="unit-weight">单果约 {APPLE_UNIT_WEIGHTS[key]}g</small>
                    <span className="mobile-offer-price">
                      ¥{money(live?.price ?? item.price)}
                      <small> / {tree ? '季' : key === 'GIFT' ? '盒' : '箱'}</small>
                    </span>
                  </span>
                  <span className="mobile-offer-check" aria-hidden="true">
                    {sku === key && <Check size={15} />}
                  </span>
                </button>
              );
            })}
          </div>
          {!tree && (
            <div className="mobile-quantity">
              <span>购买数量</span>
              <Quantity
                value={qty}
                onChange={setQty}
                max={Math.max(1, Math.min(20, product?.stock ?? 20))}
              />
            </div>
          )}
          <p className="mobile-availability" role="status">
            {!config
              ? '正在确认库存…'
              : !config.sales_open
                ? '本季暂未开放购买'
                : !product?.active || !product.stock
                  ? '所选规格暂时售罄，请选择其他规格'
                  : `可售 ${product.stock} ${tree ? '棵' : '箱'}${!tree && qty > product.stock ? '，请减少购买数量' : ''}`}
          </p>
          <div className="mobile-service-line">
            <span>
              <Truck size={15} />
              {tree ? '分次预约发货' : '快递配送'}
            </span>
            <span>
              <ShieldCheck size={15} />
              坏果按个赔
            </span>
            <span>{tree ? '本季有效' : '48 小时内发货'}</span>
          </div>
        </section>
        <section className="mobile-shop-section" aria-labelledby="mobile-recipient-title">
          <h2 id="mobile-recipient-title">{tree ? '填写认领信息' : '填写收货信息'}</h2>
          {tree ? (
            <>
              <Field label="认领手机号">
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={11}
                  pattern="1[3-9][0-9]{9}"
                  placeholder="11 位手机号"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </Field>
              <Field label="树牌昵称">
                <input
                  name="plate_name"
                  maxLength={12}
                  placeholder="给你的树起个名字（12 字内）"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </Field>
              <Field label="设置 6 位数字 PIN" hint="以后用手机号和 PIN 预约发货，请妥善记住。">
                <input
                  name="pin"
                  type="password"
                  autoComplete="new-password"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  placeholder="6 位数字"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  required
                />
              </Field>
              <p className="mobile-delivery-note">
                认领后在「我的果树」填写收货地址，可分次寄送、寄往不同地址。
              </p>
            </>
          ) : (
            <AddressForm value={address} onChange={setAddress} />
          )}
          {!tree && (
            <p className="mobile-delivery-note" aria-live="polite">
              {!address.province_code
                ? '大部分地区包邮，选择地区后自动确认运费'
                : fee > 0
                  ? `所选地区补运费 ¥${money(fee)}，已计入合计`
                  : '所选地区包邮'}
              <br />
              付款后 48 小时内发货，{site.season.end} 前发完
            </p>
          )}
          <details className="mobile-extras">
            <summary>
              {tree ? '电子发票' : '心意卡 / 电子发票'}
              <span>
                选填 <ChevronDown size={16} />
              </span>
            </summary>
            {!tree && (
              <>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={gift}
                    onChange={(e) => setGift(e.target.checked)}
                  />
                  <span>附赠心意卡，包裹不放价格单</span>
                </label>
                {gift && (
                  <>
                    <Field label="心意卡内容">
                      <textarea
                        maxLength={60}
                        rows={2}
                        placeholder="想说的话（60 字内）"
                        value={address.card_message}
                        onChange={(e) => setAddress({ ...address, card_message: e.target.value })}
                      />
                    </Field>
                    <Field label="署名（选填）">
                      <input
                        maxLength={30}
                        value={address.sender}
                        onChange={(e) => setAddress({ ...address, sender: e.target.value })}
                      />
                    </Field>
                  </>
                )}
              </>
            )}
            <InvoiceForm value={invoice} onChange={setInvoice} />
          </details>
        </section>
        {!tree && (
          <section className="mobile-shop-section">
            <CouponField coupon={coupon} />
          </section>
        )}
        <section className="mobile-shop-section">
          <PaymentOptions value={paymentMethod} onChange={setPaymentMethod} />
        </section>
        <div className="mobile-checkout-confirm">
          {tree && (
            <details className="mobile-tree-rules">
              <summary>
                本季认领与配送约定 <ChevronDown size={16} />
              </summary>
              <p>
                请在 {site.season.end} 前预约全部箱数，发货日期至少提前两天选择。每次预约可填写不同收货地址；偏远地区按箱补运费差价，当前
                ¥{money(config?.settings.remote_fee ?? 2000)}
                /箱。果树不足量时以同一果园同等级苹果补足。
              </p>
              <p>
                未预约余量于 销售季结束后寄往最近一次收件地址；没有历史地址的，由运营电话联系。本季有效，不自动续费。
              </p>
            </details>
          )}
          <details className="mobile-tree-rules">
            <summary>
              配送与坏果售后 <ChevronDown size={16} />
            </summary>
            <p>
              由快递配送，零售付款后 48
              小时内发货，认领按预约安排。偏远地区按箱补运费差价，金额在付款前显示。
            </p>
            <p>
              收货 48 小时内拍照并联系运营，250g 规格坏果每个赔 ¥5，350g 规格每个赔
              ¥15，认领箱同样适用。退款由运营核实后通过原支付渠道处理。
            </p>
          </details>
          <label className="check-row mobile-consent">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              required
            />
            <span>
              我已阅读{tree ? '认领约定、' : ''}售后说明和
              <a href="/privacy" target="_blank" rel="noopener">
                隐私说明
              </a>
              ，同意处理发货{tree ? '、认领' : ''}所需信息
            </span>
          </label>
          <div ref={verification}>
            <Turnstile demo={config?.demo} siteKey={config?.turnstile_site_key} onToken={setToken} />
          </div>
          <ErrorBox text={error || loadError} />
          {loadError && (
            <button type="button" className="mobile-retry" onClick={() => location.reload()}>
              重新加载商品
            </button>
          )}
        </div>
        <div className="mobile-paybar">
          <div className="mobile-paybar-price" aria-live="polite">
            <small>
              合计{fee > 0 ? '（含运费）' : ''}
              {coupon.discount > 0 && ` · 已优惠 ¥${money(coupon.discount)}`}
            </small>
            <strong>¥{money(total)}</strong>
          </div>
          <Button
            type={paymentEnvironment.wechat ? 'button' : 'submit'}
            onClick={paymentEnvironment.wechat ? () => setGuide({}) : undefined}
            busy={busy}
            disabled={!available || busy}
          >
            {busy
              ? '正在前往收银台…'
              : !config
                ? '加载中…'
                : !config.sales_open
                  ? '暂未开售'
                  : !available
                    ? '暂不可购买'
                    : paymentEnvironment.wechat
                      ? '在浏览器中付款'
                      : tree
                        ? paymentMethod === 'alipay'
                          ? '支付宝认领'
                          : '银行卡认领'
                        : paymentMethod === 'alipay'
                          ? '支付宝付款'
                          : '银行卡付款'}
          </Button>
          <p>{paymentMethod === 'alipay' ? '支付宝跳转付款 · 可选银行卡' : '银行卡安全付款'}</p>
        </div>
      </form>
      {guide && <PaymentGuide {...guide} onClose={() => setGuide(null)} />}
    </div>
  );
}
