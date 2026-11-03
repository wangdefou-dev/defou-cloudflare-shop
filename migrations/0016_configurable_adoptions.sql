-- Tier values are identifiers, independent of the configured checkout prices.
DROP TRIGGER adoption_create;
CREATE TRIGGER adoption_create AFTER UPDATE OF status ON orders
WHEN NEW.type='adoption' AND NEW.status='paid' AND OLD.status='pending'
BEGIN
 INSERT INTO adoptions(order_id,tier,plate_name,pin_hash,total_boxes,expires_at)
 SELECT NEW.id,CASE WHEN i.product_id='PA' THEN 888 ELSE 1888 END,
 NEW.plate_name,NEW.pin_hash,CASE WHEN i.product_id='PA' THEN 8 ELSE 15 END,
 COALESCE((SELECT json_extract(value,'$') FROM settings WHERE key='season_end'),'2099-12-31')
 FROM order_items i WHERE i.order_id=NEW.id AND i.product_id IN ('PA','FG');
 UPDATE adoptions SET adopt_code=(CASE WHEN tier=888 THEN 'PA-' ELSE 'FG-' END)||printf('%04d',id)
 WHERE order_id=NEW.id;
END;
