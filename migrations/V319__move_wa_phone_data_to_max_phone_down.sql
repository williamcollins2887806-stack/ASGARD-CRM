-- down: reverse move (best-effort)
UPDATE employees
SET
  wa_phone = COALESCE(wa_phone, max_phone),
  wa_phone_checked_at = COALESCE(wa_phone_checked_at, max_phone_checked_at)
WHERE max_phone IS NOT NULL
   OR max_phone_checked_at IS NOT NULL;

UPDATE employees
SET
  max_phone = NULL,
  max_phone_checked_at = NULL
WHERE max_phone IS NOT NULL
   OR max_phone_checked_at IS NOT NULL;
