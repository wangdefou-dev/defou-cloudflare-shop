-- Financial requests are durable before any outbound refund call. No historical
-- orders, paid amounts, coupon uses, stock or notification queues are rewritten.
CREATE TABLE admin_refund_requests (
 request_id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id),
 actor TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
 reason TEXT NOT NULL CHECK(reason IN ('requested_by_customer','duplicate','fraudulent')),
 note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'submitting' CHECK(status IN ('submitting','unknown','pending','requires_action','succeeded','failed','canceled')),
 stripe_refund_id TEXT UNIQUE,
 failure_message TEXT,
 lease_until TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX one_open_refund_per_order ON admin_refund_requests(order_id)
 WHERE status IN ('submitting','unknown','pending','requires_action');
CREATE INDEX admin_refunds_order ON admin_refund_requests(order_id,created_at);
CREATE TRIGGER admin_refund_identity_immutable
BEFORE UPDATE OF request_id,order_id,actor,amount,reason,note,created_at ON admin_refund_requests
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.order_id IS NOT OLD.order_id OR
 NEW.actor IS NOT OLD.actor OR NEW.amount IS NOT OLD.amount OR NEW.reason IS NOT OLD.reason OR
 NEW.note IS NOT OLD.note OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'refund_request_conflict'); END;

-- Do not hand over a parcel while its payment is being reversed, including the
-- short interval between a successful full refund and its signed webhook.
CREATE TRIGGER refund_shipment_guard BEFORE UPDATE OF status ON shipments
WHEN NEW.status='shipped' AND OLD.status!='shipped' AND EXISTS(
 SELECT 1 FROM orders o WHERE (
  (NEW.source='retail' AND o.id=NEW.source_id) OR
  (NEW.source='adoption' AND o.id=(SELECT order_id FROM adoptions WHERE id=CAST(NEW.source_id AS INTEGER))) OR
  (o.type='shipping' AND o.shipment_id=NEW.id)
 ) AND (EXISTS(SELECT 1 FROM admin_refund_requests r WHERE r.order_id=o.id AND r.status IN ('submitting','unknown','pending','requires_action'))
  OR (SELECT COALESCE(SUM(r.amount),0) FROM admin_refund_requests r WHERE r.order_id=o.id AND r.status='succeeded')>=o.amount)
)
BEGIN SELECT RAISE(ABORT,'refund_in_progress'); END;

-- A still-open shipping Checkout can otherwise be paid after adoption service
-- is cancelled. Do not reverse the parent while that child payment is unresolved.
CREATE TRIGGER refund_adoption_fee_guard BEFORE INSERT ON admin_refund_requests
WHEN EXISTS(SELECT 1 FROM orders fee JOIN shipments s ON s.id=fee.shipment_id
 JOIN adoptions a ON s.source='adoption' AND CAST(a.id AS TEXT)=s.source_id
 WHERE a.order_id=NEW.order_id AND fee.type='shipping' AND fee.status='pending')
BEGIN SELECT RAISE(ABORT,'refund_shipping_pending'); END;

CREATE TRIGGER refunded_adoption_shipping_guard BEFORE INSERT ON orders
WHEN NEW.type='shipping' AND EXISTS(
 SELECT 1 FROM shipments s JOIN adoptions a ON s.source='adoption' AND CAST(a.id AS TEXT)=s.source_id
 JOIN orders parent ON parent.id=a.order_id WHERE s.id=NEW.shipment_id AND (
 parent.status='refunded' OR EXISTS(SELECT 1 FROM admin_refund_requests r WHERE r.order_id=parent.id AND
 r.status IN ('submitting','unknown','pending','requires_action')) OR
 (SELECT COALESCE(SUM(r.amount),0) FROM admin_refund_requests r WHERE r.order_id=parent.id AND r.status='succeeded')>=parent.amount))
BEGIN SELECT RAISE(ABORT,'refund_in_progress'); END;
