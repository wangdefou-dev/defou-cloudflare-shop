export type AdminRefundRecord = {
  request_id: string;
  amount: number;
  status:
    'submitting' | 'unknown' | 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';
  reason: 'requested_by_customer' | 'duplicate' | 'fraudulent';
  note: string;
  stripe_refund_id: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
};
export type AdminRefundSummary = {
  order_id: string;
  order_no: string;
  order_status: string;
  paid_amount: number;
  refunded_amount: number;
  pending_amount: number;
  available_amount: number;
  configured: boolean;
  can_refund: boolean;
  blocked_reason: string;
  warnings: string[];
  refunds: AdminRefundRecord[];
};
