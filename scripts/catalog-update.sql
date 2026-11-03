-- Generated catalog changes. Explicitly apply to an existing installation; never resets inventory or paid orders.
UPDATE products SET price=10800 WHERE id='FAMILY';
UPDATE products SET price=12800 WHERE id='GIFT';
UPDATE products SET price=88800 WHERE id='PA';
UPDATE products SET price=188800 WHERE id='FG';
INSERT INTO settings(key,value) VALUES('remote_provinces','["150000","460000","540000","630000","650000"]') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO settings(key,value) VALUES('remote_fee','2000') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO settings(key,value) VALUES('season_end','"2099-12-31"') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
