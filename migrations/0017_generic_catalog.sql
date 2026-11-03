-- Generic physical products share the existing transaction and fulfillment pipeline.
ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'retail' CHECK(kind IN ('retail','adoption'));
ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT '件';
ALTER TABLE products ADD COLUMN specification TEXT NOT NULL DEFAULT '';
UPDATE products SET unit='箱' WHERE id IN ('FAMILY','GIFT');
UPDATE products SET kind='adoption',unit='棵' WHERE id IN ('PA','FG');
DROP TRIGGER coupon_item_guard;
CREATE TRIGGER coupon_item_guard AFTER INSERT ON order_items
WHEN (SELECT coupon_id FROM orders WHERE id=NEW.order_id) IS NOT NULL
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM order_items WHERE order_id=NEW.order_id)!=1 OR
  NOT EXISTS(SELECT 1 FROM orders o JOIN products p ON p.id=NEW.product_id
   WHERE o.id=NEW.order_id AND p.kind='retail' AND o.type='retail'
   AND o.original_amount=p.price*NEW.qty+o.remote_fee
   AND o.discount_amount=CAST((p.price*o.coupon_percent_off+50)/100 AS INTEGER)
   AND o.amount=o.original_amount-o.discount_amount)
  THEN RAISE(ABORT,'coupon_invalid') END;
END;
-- The database also rejects adoption SKUs submitted as retail or vice versa.
CREATE TRIGGER order_product_kind_guard BEFORE INSERT ON order_items
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products p JOIN orders o ON o.id=NEW.order_id
 WHERE p.id=NEW.product_id AND p.kind=o.type)
 THEN RAISE(ABORT,'product_type_mismatch') END;
END;
CREATE TRIGGER legacy_product_defaults AFTER INSERT ON products
WHEN NEW.sku IN ('FAMILY','GIFT','PA','FG')
BEGIN
 UPDATE products SET kind=CASE WHEN NEW.sku IN ('PA','FG') THEN 'adoption' ELSE 'retail' END,
 unit=CASE WHEN NEW.sku IN ('PA','FG') THEN '棵' ELSE '箱' END WHERE id=NEW.id;
END;
