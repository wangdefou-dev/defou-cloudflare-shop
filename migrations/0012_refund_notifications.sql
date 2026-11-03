-- Result notifications are queued only from verified refund webhooks. Do not
-- backfill admin refund receipts or reset any existing delivery history.
INSERT OR IGNORE INTO settings(key,value)
 VALUES('refund_notifications_start',strftime('%s','now'));
CREATE TABLE refund_notifications (
 id TEXT PRIMARY KEY,
 refund_id TEXT NOT NULL,
 order_id TEXT NOT NULL REFERENCES orders(id),
 status TEXT NOT NULL CHECK(status IN ('succeeded','failed','canceled')),
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 sent_at TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 superseded_at TEXT,
 UNIQUE(refund_id,status)
);
CREATE INDEX refund_notification_retry
 ON refund_notifications(sent_at,superseded_at,next_attempt_at);
CREATE TRIGGER refund_failure_supersedes_unsent_success
AFTER INSERT ON refund_notifications WHEN NEW.status IN ('failed','canceled')
BEGIN
 UPDATE refund_notifications SET superseded_at=CURRENT_TIMESTAMP
 WHERE refund_id=NEW.refund_id AND status='succeeded' AND sent_at IS NULL;
END;
