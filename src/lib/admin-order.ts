import { assert } from './security';

export type AdminRecipient = {
  recipient: string;
  phone: string;
  region_label: string;
  address: string;
  card_message: string;
  sender: string;
};
export type AdminShipment = AdminRecipient & {
  id: string;
  source: string;
  source_id: string;
  product_id: string;
  product_name: string;
  box_type: string;
  qty: number;
  status: string;
  carrier: string;
  tracking_no: string | null;
  expected_date: string | null;
  shipped_at: string | null;
  created_at: string;
};
export type AdminOrderDetail = {
  order: {
    id: string;
    order_no: string;
    type: string;
    status: string;
    phone: string;
    amount: number;
    remote_fee: number;
    original_amount: number | null;
    discount_amount: number;
    coupon_percent_off: number | null;
    coupon_code_hint: string | null;
    invoice_status: string;
    invoice_url: string | null;
    stripe_session_id: string | null;
    stripe_payment_intent: string | null;
    created_at: string;
    paid_at: string | null;
    expires_at: string;
    plate_name: string | null;
  };
  items: {
    product_id: string;
    product_name: string;
    box_type: string;
    unit_weight_g: number;
    qty: number;
  }[];
  address: AdminRecipient | null;
  invoice: { type: string; title: string; tax_no: string; email: string } | null;
  adoption: {
    id: number;
    order_id: string;
    adopt_code: string;
    plate_name: string;
    tier: number;
    total_boxes: number;
    used_boxes: number;
    expires_at: string;
  } | null;
  shipments: AdminShipment[];
};

function object(value: string | null): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
const text = (value: unknown) => (typeof value === 'string' ? value : '');

// Called only after admin authentication. Use explicit columns: never return PIN hashes or tokens.
export async function adminOrderDetail(env: Env, orderId: string): Promise<AdminOrderDetail> {
  const row = await env.DB.prepare(
    `SELECT id,order_no,type,status,phone,amount,remote_fee,original_amount,discount_amount,coupon_percent_off,coupon_code_hint,
    invoice_status,invoice_url,stripe_session_id,stripe_payment_intent,created_at,paid_at,
    expires_at,plate_name,address_json,invoice,shipment_id FROM orders WHERE id=?`,
  )
    .bind(orderId)
    .first<
      AdminOrderDetail['order'] & {
        address_json: string | null;
        invoice: string;
        shipment_id: string | null;
      }
    >();
  assert(row, 404, '未找到该订单');
  const { address_json, invoice: rawInvoice, shipment_id, ...order } = row;
  const adoption = await env.DB.prepare(
    `SELECT id,order_id,adopt_code,plate_name,tier,
    total_boxes,used_boxes,expires_at FROM adoptions WHERE order_id=? OR id=(
      SELECT source_id FROM shipments WHERE id=? AND source='adoption') LIMIT 1`,
  )
    .bind(orderId, shipment_id || '')
    .first<NonNullable<AdminOrderDetail['adoption']>>();
  const [items, shipments] = await Promise.all([
    env.DB.prepare(
      `SELECT i.product_id,i.qty,p.name product_name,p.box_type,p.unit_weight_g
      FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=?`,
    )
      .bind(orderId)
      .all<AdminOrderDetail['items'][number]>(),
    env.DB.prepare(
      `SELECT s.id,s.source,s.source_id,s.product_id,s.qty,s.recipient,s.phone,
      s.region_label,s.address,s.card_message,s.sender,s.expected_date,s.carrier,s.tracking_no,
      s.status,s.shipped_at,s.created_at,p.name product_name,p.box_type
      FROM shipments s JOIN products p ON p.id=s.product_id WHERE
      (s.source='retail' AND s.source_id=?) OR s.id=? OR
      (?='adoption' AND s.source='adoption' AND s.source_id=?)
      ORDER BY s.created_at DESC,s.id`,
    )
      .bind(orderId, shipment_id || '', order.type, String(adoption?.id || ''))
      .all<AdminShipment>(),
  ]);
  const a = object(address_json);
  const invoice = object(rawInvoice);
  return {
    order,
    items: items.results,
    adoption,
    shipments: shipments.results,
    address: a
      ? {
          recipient: text(a.recipient),
          phone: text(a.phone),
          region_label: [a.province, a.city, a.district].map(text).filter(Boolean).join(' / '),
          address: text(a.address),
          card_message: text(a.card_message),
          sender: text(a.sender),
        }
      : null,
    invoice:
      invoice && invoice.type !== 'none'
        ? {
            type: text(invoice.type),
            title: text(invoice.title),
            tax_no: text(invoice.tax_no),
            email: text(invoice.email),
          }
        : null,
  };
}
