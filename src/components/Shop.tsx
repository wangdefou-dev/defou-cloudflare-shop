import { STORE } from '../lib/store-config';
import { checkoutPayload, useCheckoutSubmission } from './checkout-client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Package, ShieldCheck, Truck, TreeDeciduous } from 'lucide-react';
import {
  AddressForm,
  Button,
  emptyAddress,
  emptyInvoice,
  ErrorBox,
  Field,
  InvoiceForm,
  PageIntro,
  PaymentGuide,
  Quantity,
  placeOrder,
  Turnstile,
  useConfig,
} from './ui';
import {
  addDays,
  cnMonthDay,
  maxQtyPerOrder,
  money,
  retailSpec,
  SEASON_END,
  shippingFee,
} from '../lib/shared';
import { APPLE_PRODUCTS, APPLE_UNIT_WEIGHTS, ORIGIN_LABEL, SEASON_PRICES } from '../lib/content';
import CATALOG from '../lib/catalog-snapshot.json';
import ProductPhoto from './ProductPhoto';
import CouponField, { useCoupon } from './CouponField';
import { usePaymentEnvironment, WeChatBrowserNotice } from './PaymentOptions';
import { browserPaymentEnvironment } from '../lib/payment-experience';
export default function Shop({ kind }: { kind: 'retail' | 'adoption' }) {
  const submission = useCheckoutSubmission();
  const busy = submission.busy;
  const paymentEnvironment = usePaymentEnvironment();
  const tree = kind === 'adoption';
  const { data: c, error: loadError } = useConfig();
  const [sku, setSku] = useState(tree ? 'PA' : 'FAMILY'),
    [qty, setQty] = useState(1),
    [address, setAddress] = useState(emptyAddress),
    [invoice, setInvoice] = useState(emptyInvoice),
    [gift, setGift] = useState(false),
    [phone, setPhone] = useState(''),
    [name, setName] = useState(''),
    [pin, setPin] = useState(''),
    [agreed, setAgreed] = useState(false),
    [token, setToken] = useState(''),
    [error, setError] = useState(''),
    [guide, setGuide] = useState<any>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('sku');
    if (q && ['FAMILY', 'GIFT'].includes(q) && !tree) setSku(q);
  }, [tree]);
  const coupon = useCoupon(sku, c?.products.find((p: any) => p.sku === sku)?.price || 0, !tree);
  const product = c?.products.find((p: any) => p.sku === sku),
    fee =
      c && !tree
        ? shippingFee(
            address.province_code,
            qty,
            c.settings.remote_provinces,
            c.settings.remote_fee,
          )
        : 0,
    total = (product?.price || 0) * qty + fee - coupon.discount,
    days = Math.max(
      0,
      Math.ceil((Date.parse(addDays(SEASON_END, 1) + 'T00:00:00+08:00') - Date.now()) / 86400000),
    );
  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (browserPaymentEnvironment().wechat) {
      setGuide({});
      return;
    }
    if (coupon.unapplied) {
      setError('请先应用优惠码，或清空优惠码后继续付款');
      return;
    }
    setError('');
    try {
      const o = await submission.run(() =>
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
          }),
          coupon_code: coupon.code,
        }),
      );
      if (o) location.href = o.url;
    } catch (e) {
      const message = (e as Error).message;
      if (coupon.code && /优惠码/.test(message)) coupon.invalidate(message);
      setError(message);
    }
  }
  return (
    <div className="page-wrap">
      {c?.settings?.announcement && (
        <p className="alert shop-announcement" role="status">
          {c.settings.announcement}
        </p>
      )}
      {paymentEnvironment.wechat && <WeChatBrowserNotice onOpen={() => setGuide({})} />}
      <PageIntro
        eyebrow={tree ? 'A TREE WITH YOUR NAME' : STORE.pages.buy.eyebrow}
        title={tree ? '让一棵树，记住你的名字' : STORE.pages.buy.title}
      >
        {tree
          ? '在太行山深处，认领一季清甜，分几次寄给自己和在意的人。'
          : STORE.pages.buy.description.replace('{origin}', ORIGIN_LABEL)}
      </PageIntro>
      {tree && (
        <div className="deadline-banner">
          <TreeDeciduous size={20} />
          <span>
            本季预约截止 <strong>{SEASON_END.replaceAll('-', '.')}</strong> · 还有{' '}
            <strong>{days}</strong> 天
          </span>
          <a href="/tree/my">已有苹安树？预约发货 ↗</a>
        </div>
      )}
      <form className="checkout-layout" onSubmit={submit}>
        <div>
          <section className="form-panel">
            <div className="step-heading">
              <span>01</span>
              <h2>{tree ? '选一棵你的树' : '先选你喜欢的规格'}</h2>
            </div>
            <div className="sku-grid">
              {(tree ? ['PA', 'FG'] : ['FAMILY', 'GIFT']).map((s) => {
                const p = c?.products.find((p: any) => p.sku === s),
                  premium = ['GIFT', 'FG'].includes(s);
                return (
                  <button
                    type="button"
                    aria-pressed={sku === s}
                    key={s}
                    className={'sku-card ' + (sku === s ? 'selected' : '')}
                    onClick={() => {
                      setSku(s);
                      setQty(1);
                    }}
                  >
                    <div className="sku-visual">
                      <ProductPhoto
                        sku={s}
                        src={p?.image_url}
                        sizes="(max-width: 1200px) 220px, 270px"
                        priority
                      />

                      <span className="selection-circle">{sku === s && <Check size={13} />}</span>
                    </div>
                    <div className="sku-copy">
                      <span className="eyebrow">
                        {tree
                          ? premium
                            ? 'FORTUNE TREE'
                            : 'PEACE TREE'
                          : premium
                            ? 'FOR SOMEONE SPECIAL'
                            : 'FOR EVERYDAY'}
                      </span>
                      <h3>{p?.name || CATALOG[s as keyof typeof CATALOG].name}</h3>
                      <p>
                        {tree
                          ? premium
                            ? '15 箱 · 每箱 6 斤 · 共 90 斤'
                            : '8 箱 · 每箱 10 斤 · 共 80 斤'
                          : retailSpec(
                              p?.count_per_box ?? APPLE_PRODUCTS[premium ? 1 : 0].count,
                              p?.unit_weight_g ?? APPLE_PRODUCTS[premium ? 1 : 0].weight,
                            )}
                      </p>
                      <span className="unit-weight">
                        {STORE.words.weightShort}{' '}
                        {p?.unit_weight_g ??
                          APPLE_UNIT_WEIGHTS[s as keyof typeof APPLE_UNIT_WEIGHTS]}
                        g
                      </span>
                      <div className="sku-bottom">
                        <strong>
                          ¥{money(p?.price || SEASON_PRICES[s as keyof typeof SEASON_PRICES])}
                        </strong>
                        <small>
                          {c
                            ? !c.sales_open
                              ? '暂未开放购买'
                              : p?.stock > 0
                                ? tree
                                  ? `剩余 ${p.stock} 棵`
                                  : `库存 ${p.stock} ${STORE.words.pack}`
                                : p?.restock_date
                                  ? `下一批 ${p.restock_date}`
                                  : '本批售罄'
                            : '正在读取库存'}
                        </small>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="detail-links">
              {!tree && (
                <>
                  {['FAMILY', 'GIFT'].map((s, i) => (
                    <a key={s} href={i ? '/apples/gift' : '/apples/family'}>
                      {(c?.products.find((x: any) => x.sku === s)?.name ||
                        CATALOG[s as 'FAMILY'].name) + '详情 ↗'}
                    </a>
                  ))}
                </>
              )}
              <a href="/guide">选购与配送指南 ↗</a>
            </div>
            {!tree && (
              <div className="qty-row">
                <span>
                  {STORE.words.qtyQuestion}
                  <small>{`每种规格每单最多 ${maxQtyPerOrder()} ${STORE.words.pack}`}</small>
                </span>
                <Quantity
                  value={qty}
                  onChange={setQty}
                  max={Math.min(maxQtyPerOrder(), product?.stock || maxQtyPerOrder())}
                />
              </div>
            )}
            {tree && (
              <p className="fine-print">
                专属铭牌 · 真实果树 · 分次预约 · 可寄不同地址 · 本季有效，不自动续费
              </p>
            )}
          </section>
          <section className="form-panel">
            <div className="step-heading">
              <span>02</span>
              <h2>{tree ? '给它起个名字' : '这份心意，寄给谁？'}</h2>
            </div>
            {tree ? (
              <>
                <Field
                  label="专属铭牌名字"
                  hint="建议使用昵称，最多 12 个字；运营会在 3 天内挂牌并上传照片。"
                >
                  <input
                    required
                    maxLength={12}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：王小苹的树"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="认领人手机号">
                    <input
                      required
                      inputMode="tel"
                      maxLength={11}
                      pattern="1[3-9][0-9]{9}"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="用于查询认领与预约"
                    />
                  </Field>
                  <Field label="设置 6 位数字 PIN" hint="请记住 PIN，预约发货时需要。">
                    <input
                      type="password"
                      required
                      pattern="[0-9]{6}"
                      maxLength={6}
                      inputMode="numeric"
                      autoComplete="new-password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="6 位数字"
                    />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <AddressForm value={address} onChange={setAddress} />
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={gift}
                    onChange={(e) => setGift(e.target.checked)}
                  />
                  <span>
                    这是一份礼物 <small>附心意卡，包裹不放价格单</small>
                  </span>
                </label>
                {gift && (
                  <div className="inset-form">
                    <Field label={`想对 TA 说（${address.card_message.length}/60）`}>
                      <textarea
                        value={address.card_message}
                        maxLength={60}
                        rows={3}
                        onChange={(e) => setAddress({ ...address, card_message: e.target.value })}
                        placeholder={STORE.pages.buy.cardMessagePlaceholder}
                      />
                    </Field>
                    <Field label="寄件人署名">
                      <input
                        value={address.sender}
                        maxLength={30}
                        onChange={(e) => setAddress({ ...address, sender: e.target.value })}
                        placeholder="写下你的名字（选填）"
                      />
                    </Field>
                  </div>
                )}
              </>
            )}
          </section>
          <section className="form-panel">
            <div className="step-heading">
              <span>03</span>
              <h2>最后，一点小事</h2>
            </div>
            {!tree && <CouponField coupon={coupon} />}
            <InvoiceForm value={invoice} onChange={setInvoice} />
            {tree && (
              <div className="rules">
                <h3>这一季，约定好这些事</h3>
                <p>
                  {`所有箱数请在 ${cnMonthDay(SEASON_END)}前预约，期望发货日期不早于两天后，且不晚于 ${cnMonthDay(SEASON_END)}。剩余未预约箱数将在 ${cnMonthDay(addDays(SEASON_END, 1))}后发往最近一次收件地址；没有历史地址的，由运营电话联系。`}
                </p>
                <p>
                  认领果树不足量时，以同一果园同等级苹果补足。偏远地区每次预约按箱补运费差价，默认
                  ¥20/箱。
                </p>
              </div>
            )}
            <label className="check-row align-top">
              <input
                required
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                我已阅读{tree ? '认领规则、' : ''}售后说明及{' '}
                <a href="/privacy" target="_blank">
                  隐私说明
                </a>
                ，同意为发货与开票处理必要个人信息。
              </span>
            </label>
            <Turnstile siteKey={c?.turnstile_site_key} onToken={setToken} />
          </section>
        </div>
        <aside className="order-summary">
          <div className="eyebrow">{STORE.words.summaryEyebrow}</div>
          <h2>{tree ? '你的苹安树' : STORE.pages.buy.summaryTitle}</h2>
          <div className="summary-picture">
            <ProductPhoto sku={sku} src={product?.image_url} sizes="300px" />
          </div>
          <p className="fine-print">{STORE.words.productNote}</p>
          <div className="summary-row">
            <span>{product?.name || '所选规格'}</span>
            <strong>¥{money((product?.price || 0) * qty)}</strong>
          </div>
          <div className="summary-row">
            <span>{tree ? '本季专属树' : '数量'}</span>
            <span>{tree ? '1 棵' : qty + ' ' + STORE.words.pack}</span>
          </div>
          <div className="summary-row">
            <span>配送运费</span>
            <span>包邮</span>
          </div>
          {fee > 0 && (
            <div className="summary-row remote">
              <span>偏远地区运费</span>
              <span>+ ¥{money(fee)}</span>
            </div>
          )}
          {coupon.discount > 0 && (
            <div className="summary-row coupon-summary">
              <span>{`优惠券（仅一${STORE.words.pack}）`}</span>
              <strong>− ¥{money(coupon.discount)}</strong>
            </div>
          )}
          <div className="summary-total">
            <span>合计</span>
            <strong>
              <small>¥</small>
              {money(total)}
            </strong>
          </div>
          <ErrorBox text={error || loadError} />
          <Button
            type="submit"
            busy={busy}
            disabled={!c || !c.sales_open || !product?.active || product.stock < qty || !token}
          >
            {!c
              ? '读取商品中'
              : !c.sales_open
                ? c.settings?.sales_paused
                  ? '店铺暂停接单'
                  : '暂未开放购买'
                : !product?.stock
                  ? '本批售罄，等待下一批'
                  : tree
                    ? '认领这棵树'
                    : '去支付'}
            <ArrowUpRight size={17} />
          </Button>
          <div className="payment-methods">
            银行卡 <span>·</span> 支付宝 <span>·</span> 微信支付
          </div>
          <p className="summary-note">
            <ShieldCheck size={14} />
            Stripe 安全托管支付
          </p>
          <div className="summary-promises">
            <span>
              <Truck size={16} />
              {tree ? '认领后 3 天内挂牌，按预约发货' : STORE.pages.buy.summaryPromises[0]}
            </span>
            <span>
              <Package size={16} />
              {STORE.pages.buy.summaryPromises[1]}
            </span>
            <span>
              <ShieldCheck size={16} />
              {STORE.pages.buy.summaryPromises[2]}
            </span>
          </div>
        </aside>
      </form>
      {guide && <PaymentGuide {...guide} onClose={() => setGuide(null)} />}
    </div>
  );
}
