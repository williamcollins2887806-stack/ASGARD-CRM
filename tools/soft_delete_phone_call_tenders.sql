-- Soft-delete ошибочных саг, созданных из телефонии в tenders
-- вместо маркетплейса (pre_tender_requests).
-- Запускать на проде после snapshot.

BEGIN;

SELECT id, customer_name, tender_title, source, status, created_at
FROM tenders
WHERE (source = 'phone_call' OR status = 'draft_from_call')
  AND deleted_at IS NULL
ORDER BY id;

UPDATE call_history SET lead_id = NULL
WHERE lead_id IN (
  SELECT id FROM tenders
  WHERE source = 'phone_call' OR status = 'draft_from_call'
);

UPDATE tenders SET deleted_at = NOW(), updated_at = NOW()
WHERE (source = 'phone_call' OR status = 'draft_from_call')
  AND deleted_at IS NULL;

SELECT COUNT(*) AS soft_deleted
FROM tenders
WHERE (source = 'phone_call' OR status = 'draft_from_call')
  AND deleted_at IS NOT NULL;

COMMIT;
