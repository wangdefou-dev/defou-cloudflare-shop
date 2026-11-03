-- Private, sanitized query snapshots. Never store provider responses or recipient data.
-- Atomic lease and a persisted cooldown prevent concurrent provider queries.
CREATE TABLE shipment_tracking_cache (
  cache_key TEXT PRIMARY KEY CHECK(length(cache_key)=64),
  snapshot_json TEXT,
  fetched_at INTEGER,
  next_refresh_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_result TEXT NOT NULL DEFAULT 'updating' CHECK(last_result IN ('available','pending','unavailable','updating'))
);
-- Provider frequency is per waybill, even when several local shipments share it.
-- This table contains only a hash, a lease and clocks, never a recipient/snapshot.
CREATE TABLE shipment_tracking_queries (
  waybill_key TEXT PRIMARY KEY CHECK(length(waybill_key)=64),
  next_refresh_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
