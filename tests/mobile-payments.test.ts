import { LocalD1 } from './local-d1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paymentEnvironment,
  publicPaymentLink,
  type PaymentMethodChoice,
} from '../src/lib/payment-experience';
import { assertPaymentBrowser, checkoutPaymentOptions, createSession } from '../src/lib/payments';

const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const android =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const desktop =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const request = (ua: string, mobileHint = '') =>
  new Request('https://shop.example.com/api/checkout', {
    headers: { 'user-agent': ua, 'sec-ch-ua-mobile': mobileHint },
  });

test('mobile payment detection covers iPhone, Android, client hints, WeChat and iPad desktop mode', () => {
  assert(paymentEnvironment(iphone).mobile);
  assert(paymentEnvironment(android).mobile);
  assert(paymentEnvironment(desktop, '?1').mobile);
  assert(paymentEnvironment(desktop, '', 'MacIntel', 5).mobile);
  assert.deepEqual(paymentEnvironment(desktop), { mobile: false, wechat: false });
  assert.deepEqual(paymentEnvironment(iphone + ' MicroMessenger/8.0'), {
    mobile: true,
    wechat: true,
  });
});

test('mobile sessions exclude QR-only WeChat, while desktop dynamic methods keep it', () => {
  for (const ua of [iphone, android]) {
    const options = checkoutPaymentOptions(request(ua));
    assert.deepEqual(options.excluded_payment_method_types, ['wechat_pay']);
    assert(!('payment_method_options' in options));
  }
  const options = checkoutPaymentOptions(request(desktop));
  assert(!('excluded_payment_method_types' in options));
  assert.deepEqual(options.payment_method_options, { wechat_pay: { client: 'web' } });
  assert.equal(options.locale, 'zh');
});

test('explicit Alipay selection works for iPad desktop UA; card fallback excludes both QR wallets', () => {
  assert.deepEqual(
    checkoutPaymentOptions(request(desktop), 'alipay').excluded_payment_method_types,
    ['card', 'wechat_pay'],
  );
  assert.deepEqual(checkoutPaymentOptions(request(iphone), 'card').excluded_payment_method_types, [
    'alipay',
    'wechat_pay',
  ]);
  assert.deepEqual(checkoutPaymentOptions(request(desktop, '?1')).excluded_payment_method_types, [
    'wechat_pay',
  ]);
});

test('WeChat browser guard rejects before starting checkout, while normal browsers continue', () => {
  assert.throws(
    () => assertPaymentBrowser(request(iphone + ' MicroMessenger/8.0')),
    /在浏览器打开后付款/,
  );
  assert.doesNotThrow(() => assertPaymentBrowser(request(iphone)));
  assert.doesNotThrow(() => assertPaymentBrowser(request(android)));
});

test('browser-switch links retain retail SKU only and never forward private fields or tracking', () => {
  assert.equal(
    publicPaymentLink(
      'https://shop.example.com/buy?sku=GIFT&phone=13800000000&coupon=fixture&view_token=private#address',
    ),
    'https://shop.example.com/buy?sku=GIFT',
  );
  assert.equal(
    publicPaymentLink('https://shop.example.com/tree?pin=123456&sku=FG'),
    'https://shop.example.com/tree',
  );
  assert.equal(
    publicPaymentLink('https://shop.example.com/?sku=unsafe&utm_source=group'),
    'https://shop.example.com/',
  );
});

test('Stripe requests keep the server net CNY amount, project configuration and webhook identity for each mobile choice', async () => {
  const originalFetch = globalThis.fetch;
  const env = {
    STRIPE_MODE: 'sandbox',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    STRIPE_PAYMENT_METHOD_CONFIGURATION: 'pmc_fixture_mobile',
    APP_ORIGIN: 'https://shop.example.com',
    DB: new LocalD1(),
  } as unknown as Env;
  const order = {
    id: 'local-mobile-order',
    order_no: 'DF-local-mobile',
    type: 'retail',
    amount: 1080,
    original_amount: 10800,
    discount_amount: 9720,
    coupon_percent_off: 90,
  };
  try {
    for (const choice of ['alipay', 'card'] as PaymentMethodChoice[]) {
      (env.DB as unknown as LocalD1).db.exec('DELETE FROM payment_sessions;DELETE FROM orders;');
      (env.DB as unknown as LocalD1).db
        .prepare(
          "INSERT INTO orders(id,order_no,type,phone,amount,expires_at) VALUES(?,?,'retail','13800000000',1080,datetime('now','+31 minutes'))",
        )
        .run(order.id, order.order_no);
      globalThis.fetch = async (_url, init) => {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get('line_items[0][price_data][unit_amount]'), '1080');
        assert.equal(body.get('line_items[0][price_data][currency]'), 'cny');
        assert.equal(body.get('adaptive_pricing[enabled]'), 'false');
        assert.equal(body.get('payment_method_configuration'), 'pmc_fixture_mobile');
        assert.equal(body.get('locale'), 'zh');
        assert.equal(body.get('metadata[project]'), 'orchard-shop');
        assert.equal(body.get('payment_intent_data[metadata][order_id]'), order.id);
        assert.equal(body.get('payment_method_options[wechat_pay][client]'), null);
        assert.equal(body.get('payment_method_types[0]'), null);
        assert.equal(body.get('allowed_payment_method_types[0]'), null);
        assert.equal(
          body.get('excluded_payment_method_types[0]'),
          choice === 'alipay' ? 'card' : 'alipay',
        );
        assert.equal(body.get('excluded_payment_method_types[1]'), 'wechat_pay');
        assert.equal(
          body.get('success_url'),
          'https://shop.example.com/pay/result?order=DF-local-mobile',
        );
        return Response.json({
          id: 'cs_fixture_' + choice,
          object: 'checkout.session',
          livemode: false,
          url: 'https://checkout.stripe.com/local-fixture-' + choice,
        });
      };
      const result = await createSession(env, request(iphone), order, '家庭装 × 1', choice);
      assert(result.url.startsWith('https://checkout.stripe.com/'));
    }
    (env.DB as unknown as LocalD1).db.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
