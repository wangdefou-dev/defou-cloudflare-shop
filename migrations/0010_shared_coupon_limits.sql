-- Existing issued codes retain one use. Shared codes opt in to a larger limit.
ALTER TABLE coupons ADD COLUMN redemption_limit INTEGER NOT NULL DEFAULT 1
 CHECK(typeof(redemption_limit)='integer' AND redemption_limit BETWEEN 1 AND 10000);

-- An allocated use belongs to one order. Paid/refunded uses remain consumed;
-- only an unpaid order's confirmed expiry releases its own allocation.
CREATE TABLE coupon_uses (
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 coupon_id TEXT NOT NULL REFERENCES coupons(id),
 redeemed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX coupon_uses_coupon ON coupon_uses(coupon_id);
INSERT INTO coupon_uses(order_id,coupon_id,redeemed_at,created_at)
 SELECT r.order_id,r.coupon_id,
 CASE WHEN c.redeemed_order_id=r.order_id THEN c.redeemed_at ELSE NULL END,o.created_at
 FROM coupon_reservations r JOIN coupons c ON c.id=r.coupon_id JOIN orders o ON o.id=r.order_id;
INSERT OR IGNORE INTO coupon_uses(order_id,coupon_id,redeemed_at,created_at)
 SELECT c.redeemed_order_id,c.id,c.redeemed_at,o.created_at
 FROM coupons c JOIN orders o ON o.id=c.redeemed_order_id WHERE c.redeemed_order_id IS NOT NULL;

CREATE TRIGGER coupon_use_capacity BEFORE INSERT ON coupon_uses
BEGIN
 SELECT CASE WHEN NEW.redeemed_at IS NOT NULL OR NOT EXISTS(
  SELECT 1 FROM coupons c JOIN orders o ON o.id=NEW.order_id AND o.coupon_id=c.id
  WHERE c.id=NEW.coupon_id AND o.status='pending'
   AND (SELECT COUNT(*) FROM coupon_uses u WHERE u.coupon_id=c.id)<c.redemption_limit
 ) THEN RAISE(ABORT,'coupon_unavailable') END;
END;

DROP TRIGGER coupon_order_guard;
CREATE TRIGGER coupon_order_guard BEFORE INSERT ON orders
BEGIN
 SELECT CASE WHEN NEW.coupon_id IS NULL AND (NEW.discount_amount!=0 OR NEW.coupon_percent_off IS NOT NULL OR NEW.coupon_code_hint IS NOT NULL)
  THEN RAISE(ABORT,'coupon_invalid') END;
 SELECT CASE WHEN NEW.coupon_id IS NOT NULL AND (
  NEW.type!='retail' OR NEW.status!='pending' OR NEW.original_amount IS NULL OR
  NEW.discount_amount<=0 OR NEW.amount!=NEW.original_amount-NEW.discount_amount OR NEW.amount<=0 OR
  NOT EXISTS(SELECT 1 FROM coupons c JOIN coupon_batches b ON b.id=c.batch_id
   WHERE c.id=NEW.coupon_id AND c.percent_off=NEW.coupon_percent_off AND c.code_hint=NEW.coupon_code_hint
   AND c.disabled=0 AND b.disabled=0
   AND (SELECT COUNT(*) FROM coupon_uses u WHERE u.coupon_id=c.id)<c.redemption_limit
   AND b.starts_at<=datetime('now') AND b.expires_at>datetime('now')))
  THEN RAISE(ABORT,'coupon_unavailable') END;
END;

DROP TRIGGER coupon_order_reserve;
CREATE TRIGGER coupon_order_reserve AFTER INSERT ON orders WHEN NEW.coupon_id IS NOT NULL
BEGIN
 INSERT INTO coupon_uses(coupon_id,order_id) VALUES(NEW.coupon_id,NEW.id);
 -- Retain the original one-use mirror during the rolling Worker deployment.
 INSERT INTO coupon_reservations(coupon_id,order_id)
  SELECT NEW.coupon_id,NEW.id FROM coupons WHERE id=NEW.coupon_id AND redemption_limit=1;
END;

DROP TRIGGER coupon_paid;
CREATE TRIGGER coupon_paid AFTER UPDATE OF status ON orders
WHEN NEW.coupon_id IS NOT NULL AND NEW.status='paid' AND OLD.status='pending'
BEGIN
 UPDATE coupon_uses SET redeemed_at=CURRENT_TIMESTAMP
  WHERE coupon_id=NEW.coupon_id AND order_id=NEW.id AND redeemed_at IS NULL;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'coupon_unavailable') END;
 -- Preserve historical one-use fields; they record the first redemption only.
 UPDATE coupons SET redeemed_order_id=COALESCE(redeemed_order_id,NEW.id),
  redeemed_at=COALESCE(redeemed_at,CURRENT_TIMESTAMP) WHERE id=NEW.coupon_id;
END;

DROP TRIGGER coupon_expired;
CREATE TRIGGER coupon_expired AFTER UPDATE OF status ON orders
WHEN NEW.coupon_id IS NOT NULL AND NEW.status='expired' AND OLD.status='pending'
BEGIN
 DELETE FROM coupon_uses WHERE coupon_id=NEW.coupon_id AND order_id=NEW.id AND redeemed_at IS NULL;
 DELETE FROM coupon_reservations WHERE coupon_id=NEW.coupon_id AND order_id=NEW.id
  AND NOT EXISTS(SELECT 1 FROM coupon_uses WHERE order_id=NEW.id AND redeemed_at IS NOT NULL);
END;
