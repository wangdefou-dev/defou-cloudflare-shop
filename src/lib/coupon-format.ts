// Integer cents and integer percentages only. One coupon discounts one box.
export function couponDiscount(unitPrice: number, percentOff: number) {
  if (
    !Number.isSafeInteger(unitPrice) ||
    unitPrice <= 0 ||
    !Number.isInteger(percentOff) ||
    percentOff < 1 ||
    percentOff > 90
  )
    throw Error('Invalid coupon calculation');
  return Math.floor((unitPrice * percentOff + 50) / 100);
}
export const couponLabel = (percentOff: number) => `${(100 - percentOff) / 10} 折`;
export const normalizeCouponCode = (code: string) =>
  code.trim().toUpperCase().replace(/[\s-]/g, '');
export type CouponQuote = {
  code_hint: string;
  percent_off: number;
  discount_amount: number;
  unit_price: number;
  sku: string;
  expires_at: string;
};
