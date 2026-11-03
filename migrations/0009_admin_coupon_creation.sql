-- Existing issued codes and validity remain unchanged. New admin-created batches
-- bind a request ID to its exact payload, so retries cannot duplicate or alter it.
ALTER TABLE coupon_batches ADD COLUMN issuance_fingerprint TEXT;
ALTER TABLE coupon_batches ADD COLUMN created_by TEXT;
CREATE TRIGGER coupon_issuance_retry_guard BEFORE INSERT ON coupon_batches
WHEN EXISTS(
 SELECT 1 FROM coupon_batches b WHERE b.id=NEW.id AND (
  b.issuance_fingerprint IS NOT NEW.issuance_fingerprint OR b.created_by IS NOT NEW.created_by
 )
)
BEGIN
 SELECT RAISE(ABORT,'coupon_issuance_conflict');
END;
