CREATE TABLE checkout_requests (
 request_key TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
 fingerprint TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE payment_sessions (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), params TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','submitting','unknown','linked','failed')),
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX payment_sessions_due ON payment_sessions(state,next_attempt_at);
ALTER TABLE products ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER product_revision AFTER UPDATE OF stock,active,restock_date,price ON products
WHEN NEW.revision=OLD.revision BEGIN
 UPDATE products SET revision=revision+1 WHERE id=NEW.id;
END;
CREATE TABLE inventory_adjustments (
 id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),actor TEXT NOT NULL,
 delta INTEGER NOT NULL,reason TEXT NOT NULL,revision INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER adoption_booking_payment_guard BEFORE INSERT ON shipments
WHEN NEW.source='adoption' AND NEW.status!='cancelled' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM adoptions a JOIN orders o ON o.id=a.order_id
 WHERE CAST(a.id AS TEXT)=NEW.source_id AND o.status IN ('paid','shipped')
 AND NOT EXISTS(SELECT 1 FROM admin_refund_requests r WHERE r.order_id=o.id
 AND r.status IN ('submitting','unknown','pending','requires_action'))
 AND (SELECT COALESCE(SUM(r.amount),0) FROM admin_refund_requests r WHERE r.order_id=o.id AND r.status='succeeded')<o.amount)
 THEN RAISE(ABORT,'refund_in_progress') END;
END;
CREATE TRIGGER fulfillment_payment_guard BEFORE UPDATE OF status ON shipments
WHEN NEW.status='shipped' AND OLD.status!='shipped' BEGIN
 SELECT CASE WHEN
 (NEW.source='retail' AND NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.source_id AND status IN ('paid','shipped'))) OR
 (NEW.source='adoption' AND NOT EXISTS(SELECT 1 FROM adoptions a JOIN orders o ON o.id=a.order_id
 WHERE CAST(a.id AS TEXT)=NEW.source_id AND o.status IN ('paid','shipped'))) OR
 EXISTS(SELECT 1 FROM orders WHERE type='shipping' AND shipment_id=NEW.id AND status NOT IN ('paid','shipped'))
 THEN RAISE(ABORT,'refund_in_progress') END;
END;
CREATE INDEX shipments_owner ON shipments(source,source_id,status,created_at);
CREATE INDEX orders_created ON orders(created_at,id);
CREATE INDEX shipments_created ON shipments(created_at,id);
CREATE INDEX regions_parent ON regions(parent_adcode,adcode);
CREATE TABLE operation_notifications (
 id TEXT PRIMARY KEY,payload TEXT NOT NULL,sent_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO settings(key,value) VALUES('operation_notifications_start',strftime('%s','now'));
