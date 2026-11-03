-- New applications and their Telegram outbox entry commit together. Existing
-- applications and the legacy operational queue are deliberately not backfilled.
-- Keep the paid-order outbox and delivery history unchanged.
CREATE TABLE sponsor_notifications (
 id TEXT PRIMARY KEY,
 app_id TEXT NOT NULL UNIQUE REFERENCES sponsor_apps(id),
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 sent_at TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sponsor_notification_retry ON sponsor_notifications(sent_at,next_attempt_at);
CREATE TRIGGER sponsor_application_notification AFTER INSERT ON sponsor_apps
WHEN NEW.status='pending'
BEGIN
 INSERT INTO sponsor_notifications(id,app_id,payload)
 VALUES('sponsor-'||NEW.id,NEW.id,json_object(
  'app_no',NEW.app_no,'event_date',NEW.event_date,
  'headcount',NEW.headcount,'submitted_at',NEW.created_at
 ));
END;
