-- down V322
UPDATE field_project_settings
   SET site_category = 'ground_hard'
 WHERE work_id = 354;

DELETE FROM mlsp_stay_events
 WHERE payload->>'source' = 'backfill_354';

DELETE FROM mlsp_stays s
 WHERE EXISTS (
   SELECT 1 FROM mlsp_stay_events e
   WHERE e.stay_id = s.id AND e.event_type = 'opened' AND e.payload->>'source' = 'backfill_354'
 );
