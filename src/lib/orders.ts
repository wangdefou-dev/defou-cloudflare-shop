import { catalogProduct } from './catalog';
import site from '../../config/site.json';
import { checkout } from './validation';
import { assert, HttpError, human, isDemo, jsonBody, pinHash, digest } from './security';
import { settings } from './database';
import { quoteCoupon } from './coupons';
import { assertPaymentBrowser, createSession } from './payments';
import { chinaDate, shippingFee } from './shared';
import { validateAddress, openSales, orderToken } from './order-access';
import { checkoutFingerprint } from './checkout-format';
const id = () => crypto.randomUUID();
const orderNo = () =>
  'DF' +
  chinaDate().replaceAll('-', '').slice(2) +
  crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
export async function checkoutOrder(env: Env, request: Request) {
  const demo = isDemo(env, request);
  openSales(env, request);
  assertPaymentBrowser(request);
  const b = checkout.parse(await jsonBody(request));
  if (b.address) await validateAddress(env, b.address);
  const requestKey = await digest(b.request_id || crypto.randomUUID());
  const { turnstile: _verification, request_id: _nonce, ...payload } = b;
  const fingerprint = await checkoutFingerprint(payload, b.request_id || requestKey);
  const replay = async () => {
    const row = await env.DB.prepare(
      'SELECT r.fingerprint,o.* FROM checkout_requests r JOIN orders o ON o.id=r.order_id WHERE r.request_key=?',
    )
      .bind(requestKey)
      .first<any>();
    if (!row) return null;
    assert(row.fingerprint === fingerprint, 409, '这次下单内容已变更，请重新提交新的订单');
    if (!['pending', 'paid', 'shipped'].includes(row.status))
      throw new HttpError(409, '原订单已结束，请再次提交新的订单', 'checkout_closed');
    const result = demo
      ? { url: '/pay/result?order=' + row.order_no }
      : await createSession(
          env,
          request,
          row,
          site.name + '订单 ' + row.order_no,
          b.payment_method,
        );
    return {
      id: row.id,
      order_no: row.order_no,
      type: row.type,
      amount: row.amount,
      original_amount: row.original_amount,
      discount_amount: row.discount_amount,
      coupon_percent_off: row.coupon_percent_off,
      coupon_code_hint: row.coupon_code_hint,
      expires_at: row.expires_at,
      view_token: await orderToken(env, row.id),
      ...result,
      demo,
    };
  };
  const previous = await replay();
  if (previous) return previous;
  await human(env, request, b.turnstile);
  const config = await settings(env);
  const p = await env.DB.prepare('SELECT * FROM products WHERE sku=? AND active=1')
    .bind(b.sku)
    .first<any>();
  assert(p && p.stock >= b.qty, 409, '本批售罄，请等待下一批');
  assert(p.kind === b.type, 400, '商品类型与下单方式不匹配');
  const configured = catalogProduct(b.sku);
  if (configured) assert(b.qty <= configured.maxPerOrder, 400, '购买数量超过该商品单次限购');
  const remote =
    b.type === 'retail'
      ? shippingFee(b.address!.province_code, b.qty, config.remote_provinces, config.remote_fee)
      : 0;
  const coupon = b.coupon_code ? await quoteCoupon(env, b.coupon_code, b.sku, p.price) : null;
  const originalAmount = p.price * b.qty + remote;
  const order: any = {
    id: id(),
    order_no: orderNo(),
    type: b.type,
    amount: originalAmount - (coupon?.discount_amount || 0),
    original_amount: originalAmount,
    discount_amount: coupon?.discount_amount || 0,
    coupon_id: coupon?.id || null,
    coupon_percent_off: coupon?.percent_off ?? null,
    coupon_code_hint: coupon?.code_hint || null,
  };
  const expires = new Date(Date.now() + 1800000).toISOString().replace('T', ' ').slice(0, 19);
  order.expires_at = expires;
  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO orders(id,order_no,type,phone,amount,remote_fee,invoice,invoice_status,expires_at,plate_name,pin_hash,address_json,coupon_id,original_amount,discount_amount,coupon_percent_off,coupon_code_hint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        order.id,
        order.order_no,
        b.type,
        b.phone,
        order.amount,
        remote,
        JSON.stringify(b.invoice),
        b.invoice.type === 'none' ? 'not_requested' : 'requested',
        expires,
        b.plate_name || null,
        b.pin ? await pinHash(b.pin) : null,
        b.address ? JSON.stringify(b.address) : null,
        order.coupon_id,
        order.original_amount,
        order.discount_amount,
        order.coupon_percent_off,
        order.coupon_code_hint,
      ),
      env.DB.prepare('INSERT INTO order_items VALUES(?,?,?,?)').bind(id(), order.id, p.id, b.qty),
      env.DB.prepare(
        'INSERT INTO checkout_requests(request_key,order_id,fingerprint) VALUES(?,?,?)',
      ).bind(requestKey, order.id, fingerprint),
    ]);
  } catch (e) {
    const winner = await replay();
    if (winner) return winner;
    throw e;
  }
  return {
    ...Object.fromEntries(Object.entries(order).filter(([key]) => key !== 'coupon_id')),
    view_token: await orderToken(env, order.id),
    ...(await createSession(
      env,
      request,
      order,
      `${p.name} × ${b.qty}${remote ? '（含偏远地区运费）' : ''}`,
      b.payment_method,
    )),
    demo,
  };
}
