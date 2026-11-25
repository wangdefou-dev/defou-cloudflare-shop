-- Product copy, image and spec fields that operators can edit in the admin.
-- Name, price, unit_weight_g and count_per_box already exist; content_revision guards
-- concurrent edits separately from the stock revision, which orders bump all the time.
ALTER TABLE products ADD COLUMN tagline TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN image_url TEXT;
ALTER TABLE products ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN content_updated_at TEXT;
UPDATE products SET tagline='把日子，过得脆甜',
 description='22 个苹果一箱，单果约 250g，总重约 5.5kg。适合日常吃、和家人朋友分享，也适合给冰箱补一点秋天。'
 WHERE id='FAMILY';
UPDATE products SET tagline='认真挑，慢慢送',
 description='8 个苹果一箱，单果约 350g，总重约 2.8kg。适合送给在意的人，可填写朋友的收件地址，并附一段简短寄语。'
 WHERE id='GIFT';
UPDATE products SET tagline='一季十斤一箱，分次寄给在意的人' WHERE id='PA';
UPDATE products SET tagline='一季大果，慢慢分享' WHERE id='FG';
-- Every content edit keeps the full before/after values. Paid orders keep their own amount.
CREATE TABLE product_changes (
 id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),actor TEXT NOT NULL,
 before_json TEXT NOT NULL,after_json TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX product_changes_product ON product_changes(product_id,created_at);
