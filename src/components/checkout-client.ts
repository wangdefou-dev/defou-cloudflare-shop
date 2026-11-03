import { useRef, useState } from 'react';
import { checkoutFingerprint } from '../lib/checkout-format';
type FormState = {
  sku: string;
  qty: number;
  phone: string;
  address: Record<string, unknown>;
  invoice: Record<string, unknown>;
  gift: boolean;
  name: string;
  pin: string;
  agreed: boolean;
  token: string;
  paymentMethod?: string;
};
export function checkoutPayload(kind: 'retail' | 'adoption', s: FormState) {
  const tree = kind === 'adoption';
  return {
    type: kind,
    sku: s.sku,
    qty: tree ? 1 : s.qty,
    phone: tree ? s.phone : String(s.address.phone),
    address: tree
      ? undefined
      : {
          ...s.address,
          card_message: s.gift ? s.address.card_message : '',
          sender: s.gift ? s.address.sender : '',
        },
    plate_name: tree ? s.name : undefined,
    pin: tree ? s.pin : undefined,
    invoice: s.invoice,
    agreed: s.agreed,
    turnstile: s.token,
    payment_method: s.paymentMethod || 'auto',
  };
}
let memory: { id: string; fingerprint: string; order_no?: string } | undefined;
export async function checkoutRequest(body: Record<string, unknown>) {
  const { turnstile: _token, ...intent } = body;
  let saved = memory;
  try {
    saved = JSON.parse(sessionStorage.getItem('checkout-intent-v1') || 'null') || saved;
  } catch {}
  if (!saved || (await checkoutFingerprint(intent, saved.id)) !== saved.fingerprint) {
    const id = crypto.randomUUID();
    saved = { id, fingerprint: await checkoutFingerprint(intent, id) };
  }
  memory = saved;
  try {
    sessionStorage.setItem('checkout-intent-v1', JSON.stringify(saved));
  } catch {}
  return { ...body, request_id: saved.id };
}
export function rememberCheckoutOrder(orderNo: string) {
  if (memory) {
    memory.order_no = orderNo;
    try {
      sessionStorage.setItem('checkout-intent-v1', JSON.stringify(memory));
    } catch {}
  }
}
export function finishCheckoutIntent(orderNo?: string) {
  let saved = memory;
  try {
    saved = JSON.parse(sessionStorage.getItem('checkout-intent-v1') || 'null') || saved;
  } catch {}
  if (orderNo && saved?.order_no !== orderNo) return;
  memory = undefined;
  try {
    sessionStorage.removeItem('checkout-intent-v1');
  } catch {}
}
export function useCheckoutSubmission() {
  const locked = useRef(false),
    [busy, setBusy] = useState(false);
  return {
    busy,
    async run<T>(work: () => Promise<T>): Promise<T | undefined> {
      if (locked.current) return;
      locked.current = true;
      setBusy(true);
      try {
        return await work();
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
  };
}
