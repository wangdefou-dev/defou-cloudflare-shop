import { catalogProduct } from './catalog';
export type PaymentMethodChoice = 'auto' | 'alipay' | 'card';

// These signals change payment presentation only; they never authorize an order.
export function paymentEnvironment(
  userAgent = '',
  mobileHint = '',
  platform = '',
  touchPoints = 0,
) {
  const wechat = /MicroMessenger/i.test(userAgent);
  return {
    wechat,
    mobile:
      wechat ||
      mobileHint === '?1' ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
      ((platform === 'MacIntel' || /Macintosh/i.test(userAgent)) && touchPoints > 1),
  };
}

export function browserPaymentEnvironment() {
  return typeof navigator === 'undefined'
    ? { wechat: false, mobile: false }
    : paymentEnvironment(navigator.userAgent, '', '', navigator.maxTouchPoints);
}

// A browser-switch link must not contain phone, address, PIN, coupon or order tokens.
export function publicPaymentLink(href: string) {
  const url = new URL(href);
  const sku = url.searchParams.get('sku');
  url.search = '';
  url.hash = '';
  if (
    sku &&
    (catalogProduct(sku) || ['FAMILY', 'GIFT'].includes(sku)) &&
    ['/', '/buy'].includes(url.pathname)
  )
    url.searchParams.set('sku', sku);
  return url.href;
}
