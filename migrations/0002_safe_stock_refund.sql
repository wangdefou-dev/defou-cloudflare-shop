-- Refunded fruit already sent cannot be sold again as physical stock.
DROP TRIGGER release_stock;
CREATE TRIGGER release_stock AFTER UPDATE OF status ON orders
WHEN (NEW.status='expired' AND OLD.status='pending') OR
(NEW.status='refunded' AND OLD.status='paid' AND NOT EXISTS (
 SELECT 1 FROM shipments s WHERE s.status='shipped' AND
 ((s.source='retail' AND s.source_id=NEW.id) OR
  (s.source='adoption' AND s.source_id=CAST((SELECT id FROM adoptions WHERE order_id=NEW.id) AS TEXT)))
))
BEGIN
 UPDATE products SET stock=stock+COALESCE((SELECT qty FROM order_items WHERE order_id=NEW.id AND product_id=products.id),0) WHERE id IN (SELECT product_id FROM order_items WHERE order_id=NEW.id);
END;
