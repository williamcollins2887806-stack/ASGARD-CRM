-- V331: Backfill analysis_finalized_at for reject finals (дыра рейтинга)
-- Ранее finalize_reject писал лог и is_final, но не ставил analysis_finalized_at.

UPDATE tender_rp_reviews rev
SET
  analysis_finalized_at = COALESCE(
    rev.analysis_finalized_at,
    (
      SELECT MIN(l.created_at)
      FROM tender_rp_review_log l
      WHERE l.review_id = rev.id
        AND l.action IN ('finalize_analysis', 'finalize_reject')
    ),
    CASE
      WHEN rev.decision = 'reject' AND COALESCE(rev.is_final, false) = true
        THEN rev.updated_at
      ELSE NULL
    END
  ),
  analysis_finalized_by_user_id = COALESCE(
    rev.analysis_finalized_by_user_id,
    (
      SELECT l.actor_user_id
      FROM tender_rp_review_log l
      WHERE l.review_id = rev.id
        AND l.action IN ('finalize_analysis', 'finalize_reject')
      ORDER BY l.created_at ASC
      LIMIT 1
    ),
    rev.analysis_owner_user_id,
    rev.started_by_user_id,
    rev.finalized_by_user_id
  )
WHERE rev.analysis_finalized_at IS NULL
  AND (
    EXISTS (
      SELECT 1 FROM tender_rp_review_log l
      WHERE l.review_id = rev.id
        AND l.action IN ('finalize_analysis', 'finalize_reject')
    )
    OR (rev.decision = 'reject' AND COALESCE(rev.is_final, false) = true)
  );
