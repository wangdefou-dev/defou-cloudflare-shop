-- A paid-order event commits with the payment update, independently of external delivery.
-- No buyer contact/address/PIN or other private fields are copied into the outbox.
CREATE TABLE commerce_notifications (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('paid_order','daily_report')),
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE notification_deliveries (
 notification_id TEXT NOT NULL REFERENCES commerce_notifications(id),
 channel TEXT NOT NULL CHECK(channel='telegram'),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 sent_at TEXT,
 last_error TEXT,
 PRIMARY KEY(notification_id,channel)
);
CREATE INDEX notification_retry ON notification_deliveries(channel,sent_at,next_attempt_at);
CREATE INDEX orders_paid_at ON orders(paid_at) WHERE paid_at IS NOT NULL;
CREATE TRIGGER paid_order_notification AFTER UPDATE OF status ON orders
WHEN NEW.status='paid' AND OLD.status='pending'
BEGIN
 INSERT OR IGNORE INTO commerce_notifications(id,kind,payload)
 VALUES('paid-'||NEW.id,'paid_order',json_object(
  'order_no',NEW.order_no,'type',NEW.type,'amount',NEW.amount,
  'remote_fee',NEW.remote_fee,'paid_at',NEW.paid_at,
  'items',json(COALESCE((SELECT json_group_array(json_object('product_id',product_id,'qty',qty))
   FROM order_items WHERE order_id=NEW.id),'[]'))
 ));
END;
