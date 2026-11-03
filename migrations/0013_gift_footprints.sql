-- Historical gifts are independent of paid orders, shipments, product stock,
-- sponsorship applications and notifications. Store cities and quantities only.
CREATE TABLE gift_batches (
 id TEXT PRIMARY KEY,
 source_hash TEXT NOT NULL UNIQUE CHECK(length(source_hash)=64),
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 name TEXT NOT NULL,
 row_count INTEGER NOT NULL CHECK(typeof(row_count)='integer' AND row_count BETWEEN 1 AND 500),
 box_count INTEGER NOT NULL CHECK(typeof(box_count)='integer' AND box_count>0),
 shipped_date TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','void')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE gift_deliveries (
 batch_id TEXT NOT NULL REFERENCES gift_batches(id),
 source_row INTEGER NOT NULL CHECK(typeof(source_row)='integer' AND source_row>0),
 province_code TEXT NOT NULL REFERENCES regions(adcode),
 city_code TEXT NOT NULL REFERENCES regions(adcode),
 qty INTEGER NOT NULL CHECK(typeof(qty)='integer' AND qty BETWEEN 1 AND 1000),
 PRIMARY KEY(batch_id,source_row)
);
CREATE INDEX gift_city_totals ON gift_deliveries(city_code,province_code);
CREATE TRIGGER gift_batch_reimport_guard BEFORE INSERT ON gift_batches
WHEN EXISTS(SELECT 1 FROM gift_batches old WHERE
 (old.id=NEW.id AND old.source_hash!=NEW.source_hash) OR
 (old.source_hash=NEW.source_hash AND
  (old.content_hash!=NEW.content_hash OR old.name!=NEW.name OR old.row_count!=NEW.row_count OR
   old.box_count!=NEW.box_count OR old.shipped_date IS NOT NEW.shipped_date)))
BEGIN SELECT RAISE(ABORT,'gift_batch_conflict'); END;
CREATE TRIGGER gift_batch_immutable BEFORE UPDATE OF id,source_hash,content_hash,name,row_count,box_count,shipped_date ON gift_batches
BEGIN SELECT RAISE(ABORT,'gift_batch_immutable'); END;
CREATE TRIGGER gift_delivery_guard BEFORE INSERT ON gift_deliveries
WHEN NOT EXISTS(SELECT 1 FROM gift_batches WHERE id=NEW.batch_id AND status='draft') OR
 NOT EXISTS(SELECT 1 FROM regions p JOIN regions c ON c.adcode=NEW.city_code
 WHERE p.adcode=NEW.province_code AND p.level=1 AND (
  (p.adcode IN ('110000','120000','310000','500000') AND c.adcode=p.adcode) OR
  (p.adcode NOT IN ('110000','120000','310000','500000') AND c.level=2 AND c.parent_adcode=p.adcode)))
BEGIN SELECT RAISE(ABORT,'gift_invalid_city_or_sealed_batch'); END;
CREATE TRIGGER gift_delivery_immutable BEFORE UPDATE ON gift_deliveries
BEGIN SELECT RAISE(ABORT,'gift_delivery_immutable'); END;
CREATE TRIGGER gift_activation_guard BEFORE UPDATE OF status ON gift_batches
WHEN NEW.status='active' AND (
 (SELECT COUNT(*) FROM gift_deliveries WHERE batch_id=NEW.id)!=NEW.row_count OR
 (SELECT COALESCE(SUM(qty),0) FROM gift_deliveries WHERE batch_id=NEW.id)!=NEW.box_count)
BEGIN SELECT RAISE(ABORT,'gift_batch_incomplete'); END;
