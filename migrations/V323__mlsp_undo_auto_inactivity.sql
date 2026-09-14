-- V323: откат авто-убытия на МЛСП + открыть вахты (тот же arrived_at).
-- Порог warn/depart 25/30 дней — в src/services/crew-inactivity-cron.js

-- 1) Вернуть назначения, снятые авто-кроном, на работах МЛСП
UPDATE employee_assignments ea
   SET is_active = true,
       departure_date = NULL,
       departure_reason = NULL,
       inactivity_warned_at = NULL,
       updated_at = NOW()
  FROM field_project_settings fps
 WHERE ea.work_id = fps.work_id
   AND fps.site_category = 'mlsp'
   AND ea.departure_date IS NOT NULL
   AND COALESCE(ea.departure_reason, '') LIKE 'Авто: нет отметок%';

-- 2) Открыть вахты backfill_354 у тех, кому вернули assignment (п.1).
--    Не трогаем «убытие по табелю РП» — у них assignment по-прежнему закрыт.
UPDATE mlsp_stays s
   SET actual_departed_at = NULL,
       departed_source = NULL,
       updated_at = NOW()
 WHERE s.actual_departed_at IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM mlsp_stay_events e
     WHERE e.stay_id = s.id
       AND e.event_type = 'departed'
       AND e.payload->>'source' = 'backfill_354'
   )
   AND EXISTS (
     SELECT 1
     FROM employee_assignments ea
     JOIN field_project_settings fps ON fps.work_id = ea.work_id AND fps.site_category = 'mlsp'
     WHERE ea.employee_id = s.employee_id
       AND COALESCE(ea.is_active, true) = true
       AND ea.departure_date IS NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM mlsp_stays s2
     WHERE s2.employee_id = s.employee_id
       AND s2.actual_departed_at IS NULL
   );

INSERT INTO mlsp_stay_events (stay_id, event_type, payload)
SELECT s.id, 'reopened',
       json_build_object(
         'source', 'v323_undo_auto_inactivity',
         'note', 'Снято автоубытие; вахта продолжается с исходным arrived_at'
       )
FROM mlsp_stays s
WHERE s.actual_departed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM mlsp_stay_events e
    WHERE e.stay_id = s.id
      AND e.event_type = 'departed'
      AND e.payload->>'source' = 'backfill_354'
  )
  AND NOT EXISTS (
    SELECT 1 FROM mlsp_stay_events e
    WHERE e.stay_id = s.id
      AND e.event_type = 'reopened'
      AND e.payload->>'source' = 'v323_undo_auto_inactivity'
  );
