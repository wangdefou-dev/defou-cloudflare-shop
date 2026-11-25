-- Specifications only; configure real stock before launch.
INSERT OR IGNORE INTO products(id,sku,name,price,stock,active,restock_date,unit_weight_g,count_per_box,box_type) VALUES('FAMILY','FAMILY','家庭装',10800,0,1,NULL,250,22,'零售家庭装');
INSERT OR IGNORE INTO products(id,sku,name,price,stock,active,restock_date,unit_weight_g,count_per_box,box_type) VALUES('GIFT','GIFT','礼盒装',12800,0,1,NULL,350,8,'零售礼盒');
INSERT OR IGNORE INTO products(id,sku,name,price,stock,active,restock_date,unit_weight_g,count_per_box,box_type) VALUES('PA','PA','平安树',88800,0,1,NULL,250,20,'认领 10 斤箱');
INSERT OR IGNORE INTO products(id,sku,name,price,stock,active,restock_date,unit_weight_g,count_per_box,box_type) VALUES('FG','FG','富贵树',188800,0,1,NULL,350,9,'认领 6 斤箱');
INSERT OR IGNORE INTO settings VALUES('remote_provinces','["150000","460000","540000","630000","650000"]');
INSERT OR IGNORE INTO settings VALUES('remote_fee','2000');
