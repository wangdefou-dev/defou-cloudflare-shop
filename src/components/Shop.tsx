import site from '../../config/site.json';
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
import { money, shippingFee } from '../lib/shared';
import { APPLE_UNIT_WEIGHTS, ORIGIN_LABEL } from '../lib/content';
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
      Math.ceil((Date.parse(site.season.end+'T00:00:00+08:00')+86400000 - Date.now()) / 86400000),
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
      {paymentEnvironment.wechat && <WeChatBrowserNotice onOpen={() => setGuide({})} />}
      <PageIntro
        eyebrow={tree ? 'A TREE WITH YOUR NAME' : 'A BOX OF AUTUMN'}
        title={tree ? '让一棵树，记住你的名字' : '挑一箱，刚刚好的秋天'}
      >
        {tree
          ? '在山间果园，认领一季清甜，分几次寄给自己和在意的人。'
          : `来自${ORIGIN_LABEL}。认真挑选打包，把这一季的清甜寄给你。`}
      </PageIntro>
      {tree && (
        <div className="deadline-banner">
          <TreeDeciduous size={20} />
          <span>
            本季预约截止 <strong>{site.season.end}</strong> · 还有 <strong>{days}</strong> 天
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
                      <ProductPhoto sku={s} sizes="(max-width: 1200px) 220px, 270px" priority />

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
                      <h3>
                        {p?.name ||
                          (s === 'PA'
                            ? '平安树'
                            : s === 'FG'
                              ? '富贵树'
                              : s === 'FAMILY'
                                ? '家庭装'
                                : '礼盒装')}
                      </h3>
                      <p>
                        {tree
                          ? premium
                            ? '15 箱 · 每箱 6 斤 · 共 90 斤'
                            : '8 箱 · 每箱 10 斤 · 共 80 斤'
                          : premium
                            ? '8 个 · 约 2.8kg'
                            : '22 个 · 约 5.5kg'}
                      </p>
                      <span className="unit-weight">
                        单果约 {APPLE_UNIT_WEIGHTS[s as keyof typeof APPLE_UNIT_WEIGHTS]}g
                      </span>
                      <div className="sku-bottom">
                        <strong>
                          ¥
                          {money(
                            p?.price ||
                              (s === 'PA'
                                ? 88800
                                : s === 'FG'
                                  ? 188800
                                  : s === 'FAMILY'
                                    ? 10800
                                    : 12800),
                          )}
                        </strong>
                        <small>
                          {c
                            ? !c.sales_open
                              ? '暂未开放购买'
                              : p?.stock > 0
                                ? tree
                                  ? `剩余 ${p.stock} 棵`
                                  : `库存 ${p.stock} 箱`
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
                  <a href="/apples/family">家庭装详情 ↗</a>
                  <a href="/apples/gift">礼盒装详情 ↗</a>
                </>
              )}
              <a href="/guide">选购与配送指南 ↗</a>
            </div>
            {!tree && (
              <div className="qty-row">
                <span>
                  带几箱回家？<small>每种规格每单最多 20 箱</small>
                </span>
                <Quantity value={qty} onChange={setQty} max={Math.min(20, product?.stock || 20)} />
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
                        placeholder="有些话，想借一箱苹果告诉你。"
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
                  所有箱数请在 {site.season.end} 前预约，期望发货日期不早于两天后，且不晚于 {site.season.end}。剩余未预约箱数将在 销售季结束后发往最近一次收件地址；没有历史地址的，由运营电话联系。
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
            <Turnstile demo={c?.demo} siteKey={c?.turnstile_site_key} onToken={setToken} />
          </section>
        </div>
        <aside className="order-summary">
          <div className="eyebrow">YOUR LITTLE AUTUMN</div>
          <h2>{tree ? '你的苹安树' : '这一箱秋天'}</h2>
          <div className="summary-picture">
            <ProductPhoto sku={sku} sizes="300px" />
          </div>
          <p className="fine-print">果品及包装以实物为准</p>
          <div className="summary-row">
            <span>{product?.name || '所选规格'}</span>
            <strong>¥{money((product?.price || 0) * qty)}</strong>
          </div>
          <div className="summary-row">
            <span>{tree ? '本季专属树' : '数量'}</span>
            <span>{tree ? '1 棵' : qty + ' 箱'}</span>
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
              <span>优惠券（仅一箱）</span>
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
                ? '暂未开放购买'
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
              {tree ? '认领后 3 天内挂牌，按预约发货' : '付款后 48 小时内发货'}
            </span>
            <span>
              <Package size={16} />
              产地挑选打包，快递送到
            </span>
            <span>
              <ShieldCheck size={16} />
              坏果按个赔，收货 48 小时内拍照
            </span>
          </div>
        </aside>
      </form>
      {guide && <PaymentGuide {...guide} onClose={() => setGuide(null)} />}
    </div>
  );
}
