BEGIN;

SELECT t.id, t.registry_status, r.is_final, r.analysis_finalized_at,
       r.report_json->>'mode' AS mode, r.analysis_finalized_by_user_id
FROM tenders t
JOIN tender_rp_reviews r ON r.tender_id = t.id
WHERE t.id = 1930;

UPDATE tender_rp_reviews SET
  analysis_finalized_at = NULL,
  analysis_finalized_by_user_id = NULL,
  to_notify_at = NULL,
  is_final = false,
  report_json = (report_json - 'analysis_snapshot') || jsonb_build_object('mode', 'analysis'),
  updated_at = NOW()
WHERE tender_id = 1930;

UPDATE tenders SET
  registry_status = 'рассмотрение',
  updated_at = NOW()
WHERE id = 1930;

INSERT INTO tender_rp_review_log (review_id, tender_id, actor_user_id, action, payload_json)
SELECT id, 1930, 3464, 'reopen_analysis',
       '{"reason":"accidental close — reopen for Elisei","via":"sql"}'::jsonb
FROM tender_rp_reviews WHERE tender_id = 1930;

SELECT t.id, t.registry_status, r.is_final, r.analysis_finalized_at,
       r.report_json->>'mode' AS mode
FROM tenders t
JOIN tender_rp_reviews r ON r.tender_id = t.id
WHERE t.id = 1930;

COMMIT;
