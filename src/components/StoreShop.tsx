import site from '../../config/site.json';
import { activeCatalog } from '../lib/catalog';
import { useEffect, useState } from 'react';
import {
  AddressForm,
  Button,
  emptyAddress,
  emptyInvoice,
  ErrorBox,
  InvoiceForm,
  placeOrder,
  Turnstile,
  useConfig,
} from './ui';
import CouponField, { useCoupon } from './CouponField';
import { checkoutPayload, useCheckoutSubmission } from './checkout-client';
import { money, shippingFee } from '../lib/shared';
import {
  PaymentOptions,
  PaymentGuide,
  WeChatBrowserNotice,
  usePaymentEnvironment,
} from './PaymentOptions';
import { browserPaymentEnvironment } from '../lib/payment-experience';

const catalog = activeCatalog();
export default function StoreShop() {
  const { data: config, error: loadError } = useConfig();
  const submission = useCheckoutSubmission(),
    browser = usePaymentEnvironment();
  const [sku, setSku] = useState(catalog[0]?.sku || ''),
    [qty, setQty] = useState(1),
    [search, setSearch] = useState('');
  const [address, setAddress] = useState(emptyAddress),
    [invoice, setInvoice] = useState(emptyInvoice);
  const [agreed, setAgreed] = useState(false),
    [token, setToken] = useState(''),
    [error, setError] = useState('');
  const [guide, setGuide] = useState(false),
    [payment, setPayment] = useState<'alipay' | 'card'>('card');
  useEffect(() => {
    const initial = new URLSearchParams(location.search).get('sku');
    if (initial && catalog.some((p) => p.sku === initial)) setSku(initial);
  }, []);
  const item = catalog.find((p) => p.sku === sku),
    live = config?.products.find((p: any) => p.sku === sku);
  const price = live?.price || 0,
    limit = Math.min(item?.maxPerOrder || 20, live?.stock || 20);
  const coupon = useCoupon(sku, price, Boolean(live));
  const freight = config
    ? shippingFee(
        address.province_code,
        qty,
        config.settings.remote_provinces,
        config.settings.remote_fee,
      )
    : 0;
  const total = price * qty + freight - coupon.discount;
  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (browserPaymentEnvironment().wechat) {
      setGuide(true);
      return;
    }
    if (coupon.unapplied) {
      setError('请先应用优惠码，或清空优惠码后继续付款');
      return;
    }
    setError('');
    try {
      const order = await submission.run(() =>
        placeOrder({
          ...checkoutPayload('retail', {
            sku,
            qty,
            address,
            invoice,
            agreed,
            token,
            phone: address.phone,
            gift: false,
            name: '',
            pin: '',
            paymentMethod: payment,
          }),
          coupon_code: coupon.code,
        }),
      );
      if (order) location.href = order.url;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function select(next: string) {
    setSku(next);
    setQty(1);
    setError('');
  }
  if (!catalog.length)
    return (
      <div className="store-shell store-prose">
        <h1>商品正在准备中</h1>
      </div>
    );
  return (
    <div className="store-shell store-buy">
      <div className="store-section-heading">
        <div>
          <p className="store-kicker">CHOOSE YOUR EVERYDAY FAVORITES</p>
          <h1>选一件喜欢的好物</h1>
          <p>选好商品和规格，填写收件信息即可下单。</p>
        </div>
      </div>
      {browser.wechat && <WeChatBrowserNotice onOpen={() => setGuide(true)} />}
      <ErrorBox text={loadError} />
      <form className="store-checkout" onSubmit={submit}>
        <div className="store-form-sections">
          <section className="store-panel">
            <h2>01 · 选择商品</h2>
            <input
              className="store-search"
              aria-label="搜索商品"
              placeholder="搜索名称、分类或规格"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="store-options">
              {catalog
                .filter((p) => (p.name + p.category + p.specification).includes(search))
                .map((p) => {
                  const current = config?.products.find((x: any) => x.sku === p.sku);
                  return (
                    <button
                      type="button"
                      className={'store-option ' + (p.sku === sku ? 'selected' : '')}
                      aria-pressed={p.sku === sku}
                      onClick={() => select(p.sku)}
                      key={p.sku}
                    >
                      <img src={p.image} alt="" width="88" height="76" />
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.specification}</small>
                        <small>
                          {current ? '¥' + money(current.price) + ' / ' + p.unit : '正在读取价格'}
                        </small>
                      </span>
                    </button>
                  );
                })}
            </div>
            <label className="field">
              <span>购买数量（{item?.unit}）</span>
              <input
                aria-label="购买数量"
                type="number"
                min={1}
                max={limit}
                required
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(limit, Number(e.target.value) || 1)))}
              />
            </label>
            <p>
              每单最多 {item?.maxPerOrder} {item?.unit}；
              {live ? `当前库存 ${live.stock} ${item?.unit}` : '正在读取库存'}。
            </p>
          </section>
          <section className="store-panel">
            <h2>02 · 填写收件信息</h2>
            <AddressForm value={address} onChange={setAddress} />
          </section>
          <section className="store-panel">
            <h2>03 · 支付与确认</h2>
            <CouponField coupon={coupon} />
            <InvoiceForm value={invoice} onChange={setInvoice} />
            {!config?.demo && <PaymentOptions value={payment} onChange={setPayment} />}
            <label className="check-line">
              <input
                type="checkbox"
                required
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                我已阅读
                <a href="/guide" target="_blank" rel="noopener noreferrer">
                  配送与售后说明
                </a>
                及
                <a href="/privacy" target="_blank" rel="noopener noreferrer">
                  隐私说明
                </a>
                ，同意为订单履约处理必要信息。
              </span>
            </label>
            {config && (
              <Turnstile
                demo={config.demo}
                siteKey={config.turnstile_site_key}
                onToken={setToken}
              />
            )}
            <ErrorBox text={error} />
          </section>
        </div>
        <aside className="store-summary store-panel">
          <h2>确认这份订单</h2>
          {item && (
            <>
              <img src={item.image} alt={item.name} width="600" height="470" />
              <h3>{item.name}</h3>
              <p>{item.specification}</p>
            </>
          )}
          <dl>
            <div>
              <dt>商品金额</dt>
              <dd>¥{money(price * qty)}</dd>
            </div>
            <div>
              <dt>配送运费</dt>
              <dd>{freight ? '¥' + money(freight) : '免运费'}</dd>
            </div>
            {coupon.discount > 0 && (
              <div>
                <dt>优惠（仅一件）</dt>
                <dd>−¥{money(coupon.discount)}</dd>
              </div>
            )}
            <div className="store-total">
              <dt>合计</dt>
              <dd>¥{money(total)}</dd>
            </div>
          </dl>
          <Button
            busy={submission.busy}
            disabled={!config?.sales_open || !live?.active || live.stock < qty || !token}
          >
            {!config
              ? '读取商品中'
              : !config.sales_open
                ? '暂未开放购买'
                : !live?.stock
                  ? '暂时售罄'
                  : '确认订单，去支付 ↗'}
          </Button>
          <p>{site.storefront.shippingNote}</p>
          <p>{site.storefront.afterSalesNote}</p>
        </aside>
      </form>
      {guide && <PaymentGuide onClose={() => setGuide(false)} />}
    </div>
  );
}
