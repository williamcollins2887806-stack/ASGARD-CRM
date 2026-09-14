-- V322: work #354 (огневые подогреватели МЛСП) → site_category=mlsp + бэкфилл закрытых stay
-- Было ошибочно ground_hard.

UPDATE field_project_settings
   SET site_category = 'mlsp',
       updated_at = NOW()
 WHERE work_id = 354
   AND COALESCE(site_category, '') <> 'mlsp';

-- Бэкфилл: закрытые вахты по людям со сменами day/night на #354
INSERT INTO mlsp_stays (
  employee_id, arrived_at, planned_depart_at, actual_departed_at, departed_source,
  notify_14_sent_at, notify_7_sent_at, created_at, updated_at
)
SELECT
  x.employee_id,
  x.first_shift AS arrived_at,
  (x.first_shift + 44) AS planned_depart_at,
  COALESCE(x.departure_date, x.last_shift) AS actual_departed_at,
  'manual',
  NOW(),
  NOW(),
  NOW(),
  NOW()
FROM (
  SELECT
    fc.employee_id,
    MIN(fc.date)::date AS first_shift,
    MAX(fc.date)::date AS last_shift,
    (
      SELECT MAX(ea.departure_date)
      FROM employee_assignments ea
      WHERE ea.work_id = 354 AND ea.employee_id = fc.employee_id
    ) AS departure_date
  FROM field_checkins fc
  WHERE fc.work_id = 354
    AND fc.status = 'completed'
    AND fc.shift IN ('day', 'night')
  GROUP BY fc.employee_id
) x
WHERE NOT EXISTS (
  SELECT 1 FROM mlsp_stays s
  WHERE s.employee_id = x.employee_id
    AND s.arrived_at = x.first_shift
);

INSERT INTO mlsp_stay_events (stay_id, event_type, payload)
SELECT s.id, 'opened',
       json_build_object(
         'source', 'backfill_354',
         'work_id', 354,
         'arrived_at', s.arrived_at,
         'planned_depart_at', s.planned_depart_at
       )
FROM mlsp_stays s
WHERE s.actual_departed_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM field_checkins fc
    WHERE fc.employee_id = s.employee_id AND fc.work_id = 354
      AND fc.status = 'completed' AND fc.shift IN ('day', 'night')
      AND fc.date = s.arrived_at
  )
  AND NOT EXISTS (
    SELECT 1 FROM mlsp_stay_events e
    WHERE e.stay_id = s.id AND e.event_type = 'opened' AND e.payload->>'source' = 'backfill_354'
  );

INSERT INTO mlsp_stay_events (stay_id, event_type, payload)
SELECT s.id, 'departed',
       json_build_object(
         'source', 'backfill_354',
         'actual_departed_at', s.actual_departed_at,
         'work_id', 354
       )
FROM mlsp_stays s
WHERE s.actual_departed_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM field_checkins fc
    WHERE fc.employee_id = s.employee_id AND fc.work_id = 354
      AND fc.status = 'completed' AND fc.shift IN ('day', 'night')
      AND fc.date = s.arrived_at
  )
  AND NOT EXISTS (
    SELECT 1 FROM mlsp_stay_events e
    WHERE e.stay_id = s.id AND e.event_type = 'departed' AND e.payload->>'source' = 'backfill_354'
  );
