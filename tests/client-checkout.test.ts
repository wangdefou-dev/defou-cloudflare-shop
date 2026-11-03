import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOrder } from '../src/components/ui';

test('checkout returns the payment handoff even when browser storage is blocked, and rejects server errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const events = new EventTarget();
  let resets = 0;
  events.addEventListener('turnstile-reset', () => resets++);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      setItem() {
        throw new DOMException('Blocked by browser policy', 'SecurityError');
      },
    },
  });
  const body = { type: 'retail', sku: 'FAMILY', qty: 2, phone: '13800138000', agreed: true };
  const handoff = {
    order_no: 'DF-local-fixture',
    view_token: 'local-fixture-token',
    url: 'https://checkout.stripe.com/local-fixture',
  };
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/checkout');
      assert.equal(init?.method, 'POST');
      const {request_id,...sent}=JSON.parse(String(init?.body));assert.match(request_id,/^[a-f0-9-]{36}$/);assert.deepEqual(sent,body);
      return Response.json(handoff);
    };
    assert.deepEqual(await placeOrder(body), handoff);
    assert.equal(resets, 1);
    globalThis.fetch = async () => Response.json({ error: '所选规格已售罄' }, { status: 409 });
    await assert.rejects(placeOrder(body), /所选规格已售罄/);
    assert.equal(resets, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('read-only coupon quotes preserve the completed Turnstile check', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget();
  let resets = 0;
  events.addEventListener('turnstile-reset', () => resets++);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  try {
    globalThis.fetch = async () => Response.json({ discount_amount: 1296 });
    const { request } = await import('../src/components/ui');
    assert.deepEqual(await request('/coupons/quote', { sku: 'FAMILY', code: 'local-fixture' }), {
      discount_amount: 1296,
    });
    assert.equal(resets, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
