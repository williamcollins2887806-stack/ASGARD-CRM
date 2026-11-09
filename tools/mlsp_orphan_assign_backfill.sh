#!/bin/bash
# Снять с бригады МЛСП-сирот: stay уже закрыт auto_travel, assignment ещё active.
# Безопасно: snapshot → UPDATE только без open stay / без смен и to_site после съезда.
# Usage: bash tools/mlsp_orphan_assign_backfill.sh [--dry-run]
set -euo pipefail

DRY=0
if [[ "${1:-}" == "--dry-run" || "${1:-}" == "-n" ]]; then DRY=1; fi

PGPASSWORD="${PGPASSWORD:-123456789}"
export PGPASSWORD

psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -v dry="$DRY" <<'SQL'
\pset pager off

DROP TABLE IF EXISTS _orphan_close;
CREATE TEMP TABLE _orphan_close AS
WITH last_closed AS (
  SELECT DISTINCT ON (s.employee_id)
         s.id AS stay_id, s.employee_id, s.arrived_at, s.actual_departed_at,
         s.departed_source, s.transport
  FROM mlsp_stays s
  WHERE s.actual_departed_at IS NOT NULL
  ORDER BY s.employee_id, s.actual_departed_at DESC, s.id DESC
)
SELECT ea.id AS assignment_id,
       ea.employee_id,
       COALESCE(e.fio, e.full_name) AS fio,
       ea.work_id,
       lc.stay_id,
       lc.actual_departed_at::date AS stay_departed,
       lc.departed_source
FROM employee_assignments ea
JOIN field_project_settings fps ON fps.work_id=ea.work_id AND fps.site_category='mlsp'
JOIN employees e ON e.id=ea.employee_id
JOIN last_closed lc ON lc.employee_id=ea.employee_id
WHERE COALESCE(ea.is_active,true)=true
  AND ea.departure_date IS NULL
  AND lc.departed_source = 'auto_travel'
  AND NOT EXISTS (
    SELECT 1 FROM mlsp_stays s2
    WHERE s2.employee_id=ea.employee_id AND s2.actual_departed_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM field_checkins fc
    WHERE fc.employee_id=ea.employee_id AND fc.work_id=ea.work_id
      AND fc.status='completed' AND fc.shift IN ('day','night')
      AND fc.date > lc.actual_departed_at
  )
  AND NOT EXISTS (
    SELECT 1 FROM field_trip_stages fts
    WHERE fts.employee_id=ea.employee_id AND fts.work_id=ea.work_id
      AND fts.direction='to_site'
      AND fts.stage_type IN ('travel','ship','helicopter')
      AND COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')
      AND fts.date_from::date > lc.actual_departed_at
  );

SELECT COUNT(*) AS will_close FROM _orphan_close;
SELECT assignment_id, fio, work_id, stay_departed::text, departed_source FROM _orphan_close ORDER BY work_id, fio;

\if :dry
\echo 'DRY-RUN: no writes'
\else
BEGIN;

CREATE TABLE IF NOT EXISTS _snap_mlsp_orphan_assign_20261109 AS
SELECT * FROM employee_assignments WHERE false;

INSERT INTO _snap_mlsp_orphan_assign_20261109
SELECT ea.*
FROM employee_assignments ea
JOIN _orphan_close o ON o.assignment_id = ea.id
WHERE NOT EXISTS (
  SELECT 1 FROM _snap_mlsp_orphan_assign_20261109 s WHERE s.id = ea.id
);

UPDATE employee_assignments ea
   SET departure_date = o.stay_departed,
       departure_reason = COALESCE(
         ea.departure_reason,
         'Авто: выезд с МЛСП (backfill: stay закрыт, назначение висело)'
       ),
       is_active = false,
       inactivity_auto_departed_at = NOW(),
       updated_at = NOW()
  FROM _orphan_close o
 WHERE ea.id = o.assignment_id
   AND COALESCE(ea.is_active, true) = true
   AND ea.departure_date IS NULL;

UPDATE employees e
   SET readiness_status = 'unknown', readiness_updated_at = NOW()
 WHERE e.id IN (SELECT employee_id FROM _orphan_close)
   AND COALESCE(e.readiness_status,'') IN ('on_site','');

-- отменить pending removal warns
UPDATE site_crew_removal_requests r
   SET status = 'cancelled', updated_at = NOW()
 WHERE status = 'warned'
   AND EXISTS (
     SELECT 1 FROM _orphan_close o
     WHERE o.work_id = r.work_id AND o.employee_id = r.employee_id
   );

SELECT COUNT(*) AS closed_now
FROM employee_assignments ea
JOIN _orphan_close o ON o.assignment_id = ea.id
WHERE ea.is_active = false AND ea.departure_date IS NOT NULL;

COMMIT;
\echo 'APPLIED'
\endif
SQL
