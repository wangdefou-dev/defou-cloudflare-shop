-- New purchases include 15 boxes. Existing paid entitlements remain contractual snapshots.
DROP TRIGGER adoption_create;
CREATE TRIGGER adoption_create AFTER UPDATE OF status ON orders
WHEN NEW.type='adoption' AND NEW.status='paid' AND OLD.status='pending'
BEGIN
 INSERT INTO adoptions(order_id,tier,plate_name,pin_hash,total_boxes)
 VALUES(NEW.id,CASE WHEN NEW.amount=88800 THEN 888 ELSE 1888 END,
 NEW.plate_name,NEW.pin_hash,CASE WHEN NEW.amount=88800 THEN 8 ELSE 15 END);
 UPDATE adoptions SET adopt_code=(CASE WHEN tier=888 THEN 'PA-' ELSE 'FG-' END)||printf('%04d',id)
 WHERE order_id=NEW.id;
END;
