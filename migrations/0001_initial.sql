PRAGMA foreign_keys = ON;
CREATE TABLE products(id TEXT PRIMARY KEY,sku TEXT NOT NULL UNIQUE,name TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>0),stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),active INTEGER NOT NULL DEFAULT 0,restock_date TEXT,unit_weight_g INTEGER,count_per_box INTEGER,box_type TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE orders(id TEXT PRIMARY KEY,order_no TEXT NOT NULL UNIQUE,type TEXT NOT NULL CHECK(type IN ('retail','adoption','shipping')),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','shipped','expired','refunded')),phone TEXT NOT NULL,amount INTEGER NOT NULL,remote_fee INTEGER NOT NULL DEFAULT 0,invoice TEXT NOT NULL DEFAULT '{}',invoice_status TEXT NOT NULL DEFAULT 'not_requested',invoice_url TEXT,stripe_session_id TEXT UNIQUE,stripe_payment_intent TEXT UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,paid_at TEXT,plate_name TEXT,pin_hash TEXT,address_json TEXT,shipment_id TEXT,idempotency_key TEXT UNIQUE);
CREATE TABLE order_items(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT NOT NULL REFERENCES products(id),qty INTEGER NOT NULL CHECK(qty>0));
CREATE TABLE adoptions(id INTEGER PRIMARY KEY AUTOINCREMENT,adopt_code TEXT UNIQUE,order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),tier INTEGER NOT NULL,plate_name TEXT NOT NULL,pin_hash TEXT NOT NULL,total_boxes INTEGER NOT NULL,used_boxes INTEGER NOT NULL DEFAULT 0 CHECK(used_boxes>=0 AND used_boxes<=total_boxes),tree_photo_urls TEXT NOT NULL DEFAULT '[]',expires_at TEXT NOT NULL DEFAULT '2026-11-30');
CREATE TABLE shipments(id TEXT PRIMARY KEY,source TEXT NOT NULL CHECK(source IN ('retail','adoption','sponsor')),source_id TEXT NOT NULL,product_id TEXT NOT NULL,qty INTEGER NOT NULL CHECK(qty>0),recipient TEXT NOT NULL,phone TEXT NOT NULL,province_code TEXT NOT NULL,city_code TEXT NOT NULL,district_code TEXT NOT NULL,region_label TEXT NOT NULL,address TEXT NOT NULL,card_message TEXT NOT NULL DEFAULT '',sender TEXT NOT NULL DEFAULT '',expected_date TEXT,carrier TEXT NOT NULL DEFAULT '顺丰',tracking_no TEXT,status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','awaiting_payment','shipped','cancelled')),shipped_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX one_retail_shipment ON shipments(source_id) WHERE source='retail';
CREATE TABLE sponsor_apps(id TEXT PRIMARY KEY,app_no TEXT NOT NULL UNIQUE,org_name TEXT NOT NULL,event_name TEXT NOT NULL,event_date TEXT NOT NULL,headcount INTEGER NOT NULL,contact TEXT NOT NULL,phone TEXT NOT NULL,wechat TEXT,address_json TEXT NOT NULL,reason TEXT NOT NULL,link TEXT,status TEXT NOT NULL DEFAULT 'pending',boxes_granted INTEGER NOT NULL DEFAULT 0,product_id TEXT,photos TEXT NOT NULL DEFAULT '[]',show_on_wall INTEGER NOT NULL DEFAULT 0,photo_consent INTEGER NOT NULL DEFAULT 0,rejection_reason TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE diary_posts(id TEXT PRIMARY KEY,date TEXT NOT NULL,text TEXT NOT NULL,photo_urls TEXT NOT NULL);
CREATE TABLE webhook_events(id TEXT PRIMARY KEY,type TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,adoption_id INTEGER NOT NULL REFERENCES adoptions(id),expires_at TEXT NOT NULL);
CREATE TABLE rate_limits(key TEXT NOT NULL,bucket INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(key,bucket));
CREATE TABLE claims(id TEXT PRIMARY KEY,shipment_id TEXT NOT NULL REFERENCES shipments(id),count INTEGER NOT NULL CHECK(count>0),amount INTEGER NOT NULL,photos TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE notifications(id TEXT PRIMARY KEY,message TEXT NOT NULL,sent_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE regions(adcode TEXT PRIMARY KEY,name TEXT NOT NULL,level INTEGER NOT NULL,parent_adcode TEXT);
CREATE TABLE audit_log(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TRIGGER reserve_product BEFORE INSERT ON order_items BEGIN
 SELECT CASE WHEN (SELECT active FROM products WHERE id=NEW.product_id)!=1 THEN RAISE(ABORT,'商品已下架') END;
 UPDATE products SET stock=stock-NEW.qty WHERE id=NEW.product_id;
END;
CREATE TRIGGER release_stock AFTER UPDATE OF status ON orders WHEN NEW.status IN ('expired','refunded') AND OLD.status NOT IN ('expired','refunded') BEGIN
 UPDATE products SET stock=stock+COALESCE((SELECT qty FROM order_items WHERE order_id=NEW.id AND product_id=products.id),0) WHERE id IN (SELECT product_id FROM order_items WHERE order_id=NEW.id);
END;
CREATE TRIGGER adoption_create AFTER UPDATE OF status ON orders WHEN NEW.type='adoption' AND NEW.status='paid' AND OLD.status='pending' BEGIN
 INSERT INTO adoptions(order_id,tier,plate_name,pin_hash,total_boxes) VALUES(NEW.id,CASE WHEN NEW.amount=88800 THEN 888 ELSE 1888 END,NEW.plate_name,NEW.pin_hash,CASE WHEN NEW.amount=88800 THEN 8 ELSE 18 END);
 UPDATE adoptions SET adopt_code=(CASE WHEN tier=888 THEN 'PA-' ELSE 'FG-' END)||printf('%04d',id) WHERE order_id=NEW.id;
END;
CREATE TRIGGER book_adoption BEFORE INSERT ON shipments WHEN NEW.source='adoption' AND NEW.status!='cancelled' BEGIN
 UPDATE adoptions SET used_boxes=used_boxes+NEW.qty WHERE id=CAST(NEW.source_id AS INTEGER);
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'无效认领') END;
END;
CREATE TRIGGER unbook_adoption AFTER UPDATE OF status ON shipments WHEN NEW.source='adoption' AND NEW.status='cancelled' AND OLD.status!='cancelled' BEGIN
 UPDATE adoptions SET used_boxes=used_boxes-OLD.qty WHERE id=CAST(NEW.source_id AS INTEGER);
END;
CREATE INDEX shipments_map ON shipments(status,city_code);
CREATE INDEX orders_phone ON orders(phone,order_no);
CREATE INDEX orders_expiry ON orders(status,expires_at);
CREATE INDEX sponsor_phone ON sponsor_apps(phone,created_at);
CREATE TABLE order_tokens(token_hash TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),expires_at TEXT NOT NULL);
