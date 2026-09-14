-- V341: backfill analysis_deadline for rows that still have NULL
-- Mon–Fri business days only (same rule as src/lib/business-days.js)

UPDATE tenders t
SET analysis_deadline = sub.deadline
FROM (
  SELECT
    t2.id,
    GREATEST(
      t2.created_at::date,
      bd.deadline
    ) AS deadline
  FROM tenders t2
  CROSS JOIN LATERAL (
    SELECT x.d AS deadline
    FROM (
      SELECT
        g.d::date AS d,
        ROW_NUMBER() OVER (ORDER BY g.d DESC) AS rn
      FROM generate_series(
        t2.docs_deadline::date - INTERVAL '1 day',
        t2.docs_deadline::date - INTERVAL '40 days',
        INTERVAL '-1 day'
      ) AS g(d)
      WHERE EXTRACT(ISODOW FROM g.d) < 6
    ) x
    WHERE x.rn = CASE WHEN COALESCE(t2.participation_paid, false) THEN 5 ELSE 3 END
    LIMIT 1
  ) bd
  WHERE t2.deleted_at IS NULL
    AND t2.docs_deadline IS NOT NULL
    AND t2.analysis_deadline IS NULL
) sub
WHERE t.id = sub.id
  AND sub.deadline IS NOT NULL;
