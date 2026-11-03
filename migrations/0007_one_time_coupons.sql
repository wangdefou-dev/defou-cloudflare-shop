-- Coupons are private bearer codes; only hashes and masked hints are stored.
CREATE TABLE coupon_batches (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 starts_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(expires_at>starts_at)
);
CREATE TABLE coupons (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES coupon_batches(id),
 code_hash TEXT NOT NULL UNIQUE,
 code_hint TEXT NOT NULL,
 percent_off INTEGER NOT NULL CHECK(percent_off BETWEEN 1 AND 90),
 disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
 redeemed_order_id TEXT UNIQUE REFERENCES orders(id),
 redeemed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((redeemed_order_id IS NULL)=(redeemed_at IS NULL))
);
ALTER TABLE orders ADD COLUMN coupon_id TEXT REFERENCES coupons(id);
ALTER TABLE orders ADD COLUMN original_amount INTEGER;
ALTER TABLE orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0 CHECK(discount_amount>=0);
ALTER TABLE orders ADD COLUMN coupon_percent_off INTEGER;
ALTER TABLE orders ADD COLUMN coupon_code_hint TEXT;
CREATE TABLE coupon_reservations (
 coupon_id TEXT PRIMARY KEY REFERENCES coupons(id),
 order_id TEXT NOT NULL UNIQUE REFERENCES orders(id)
);
CREATE INDEX coupons_batch ON coupons(batch_id,percent_off);

-- Eligibility and the unique reservation commit with the order. A losing
-- concurrent checkout rolls back its entire batch, including the stock lock.
CREATE TRIGGER coupon_order_guard BEFORE INSERT ON orders
BEGIN
 SELECT CASE WHEN NEW.coupon_id IS NULL AND (NEW.discount_amount!=0 OR NEW.coupon_percent_off IS NOT NULL OR NEW.coupon_code_hint IS NOT NULL)
  THEN RAISE(ABORT,'coupon_invalid') END;
 SELECT CASE WHEN NEW.coupon_id IS NOT NULL AND (
  NEW.type!='retail' OR NEW.status!='pending' OR NEW.original_amount IS NULL OR
  NEW.discount_amount<=0 OR NEW.amount!=NEW.original_amount-NEW.discount_amount OR NEW.amount<=0 OR
  NOT EXISTS(SELECT 1 FROM coupons c JOIN coupon_batches b ON b.id=c.batch_id
   WHERE c.id=NEW.coupon_id AND c.percent_off=NEW.coupon_percent_off AND c.code_hint=NEW.coupon_code_hint
   AND c.disabled=0 AND b.disabled=0 AND c.redeemed_order_id IS NULL
   AND b.starts_at<=datetime('now') AND b.expires_at>datetime('now')))
  THEN RAISE(ABORT,'coupon_unavailable') END;
END;
CREATE TRIGGER coupon_order_reserve AFTER INSERT ON orders WHEN NEW.coupon_id IS NOT NULL
BEGIN
 INSERT INTO coupon_reservations(coupon_id,order_id) VALUES(NEW.coupon_id,NEW.id);
END;
CREATE TRIGGER coupon_item_guard AFTER INSERT ON order_items
WHEN (SELECT coupon_id FROM orders WHERE id=NEW.order_id) IS NOT NULL
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM order_items WHERE order_id=NEW.order_id)!=1 OR
  NOT EXISTS(SELECT 1 FROM orders o JOIN products p ON p.id=NEW.product_id
   WHERE o.id=NEW.order_id AND p.sku IN ('FAMILY','GIFT') AND o.type='retail'
   AND o.original_amount=p.price*NEW.qty+o.remote_fee
   AND o.discount_amount=CAST((p.price*o.coupon_percent_off+50)/100 AS INTEGER)
   AND o.amount=o.original_amount-o.discount_amount)
  THEN RAISE(ABORT,'coupon_invalid') END;
END;
CREATE TRIGGER coupon_order_amount_immutable
BEFORE UPDATE OF coupon_id,original_amount,discount_amount,coupon_percent_off,coupon_code_hint,amount,remote_fee ON orders
WHEN (OLD.coupon_id IS NOT NULL OR NEW.coupon_id IS NOT NULL) AND (
 NEW.coupon_id IS NOT OLD.coupon_id OR NEW.original_amount IS NOT OLD.original_amount OR
 NEW.discount_amount IS NOT OLD.discount_amount OR NEW.coupon_percent_off IS NOT OLD.coupon_percent_off OR
 NEW.coupon_code_hint IS NOT OLD.coupon_code_hint OR NEW.amount IS NOT OLD.amount OR NEW.remote_fee IS NOT OLD.remote_fee)
BEGIN
 SELECT RAISE(ABORT,'coupon_order_immutable');
END;
CREATE TRIGGER coupon_paid AFTER UPDATE OF status ON orders
WHEN NEW.coupon_id IS NOT NULL AND NEW.status='paid' AND OLD.status='pending'
BEGIN
 UPDATE coupons SET redeemed_order_id=NEW.id,redeemed_at=CURRENT_TIMESTAMP
 WHERE id=NEW.coupon_id AND redeemed_order_id IS NULL AND EXISTS(
  SELECT 1 FROM coupon_reservations WHERE coupon_id=NEW.coupon_id AND order_id=NEW.id);
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'coupon_unavailable') END;
END;
CREATE TRIGGER coupon_expired AFTER UPDATE OF status ON orders
WHEN NEW.coupon_id IS NOT NULL AND NEW.status='expired' AND OLD.status='pending'
BEGIN
 DELETE FROM coupon_reservations WHERE coupon_id=NEW.coupon_id AND order_id=NEW.id
 AND NOT EXISTS(SELECT 1 FROM coupons WHERE id=NEW.coupon_id AND redeemed_order_id IS NOT NULL);
END;

-- Keep the existing outbox history. Only newly paid orders gain discount fields.
DROP TRIGGER paid_order_notification;
CREATE TRIGGER paid_order_notification AFTER UPDATE OF status ON orders
WHEN NEW.status='paid' AND OLD.status='pending'
BEGIN
 INSERT OR IGNORE INTO commerce_notifications(id,kind,payload)
 VALUES('paid-'||NEW.id,'paid_order',json_object(
  'order_no',NEW.order_no,'type',NEW.type,'amount',NEW.amount,
  'original_amount',COALESCE(NEW.original_amount,NEW.amount),
  'discount_amount',NEW.discount_amount,'coupon_percent_off',NEW.coupon_percent_off,
  'remote_fee',NEW.remote_fee,'paid_at',NEW.paid_at,
  'items',json(COALESCE((SELECT json_group_array(json_object('product_id',product_id,'qty',qty))
   FROM order_items WHERE order_id=NEW.id),'[]'))
 ));
END;

CREATE TRIGGER coupon_claim_limit BEFORE INSERT ON claims
WHEN EXISTS(SELECT 1 FROM shipments s JOIN orders o ON s.source='retail' AND s.source_id=o.id
 WHERE s.id=NEW.shipment_id AND o.discount_amount>0)
BEGIN
 SELECT CASE WHEN NEW.amount<=0 OR NOT EXISTS(
  SELECT 1 FROM shipments s JOIN orders o ON s.source='retail' AND s.source_id=o.id
  WHERE s.id=NEW.shipment_id AND NEW.amount+COALESCE((SELECT SUM(c.amount) FROM claims c
   JOIN shipments old_s ON old_s.id=c.shipment_id WHERE old_s.source='retail' AND old_s.source_id=o.id),0)<=o.amount)
 THEN RAISE(ABORT,'coupon_refund_limit') END;
END;
