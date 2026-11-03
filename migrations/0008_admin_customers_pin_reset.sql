-- Add recovery metadata without storing recoverable PINs or changing existing rights.
ALTER TABLE adoptions ADD COLUMN pin_version INTEGER NOT NULL DEFAULT 0 CHECK(pin_version>=0);
ALTER TABLE adoptions ADD COLUMN pin_updated_at TEXT;
CREATE TABLE adoption_pin_resets(
 id TEXT PRIMARY KEY,
 adoption_id INTEGER NOT NULL REFERENCES adoptions(id),
 expected_version INTEGER NOT NULL CHECK(expected_version>=0),
 actor TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(adoption_id,expected_version)
);
-- The first statement of the reset batch checks the revision under the write lock.
-- An overlapping reset or refund aborts the entire batch, including audit and session revocation.
CREATE TRIGGER adoption_pin_reset_guard BEFORE INSERT ON adoption_pin_resets BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM adoptions a JOIN orders o ON o.id=a.order_id
  WHERE a.id=NEW.adoption_id AND a.pin_version=NEW.expected_version
   AND o.status IN ('paid','shipped')
 ) THEN RAISE(ABORT,'pin_reset_conflict') END;
END;
