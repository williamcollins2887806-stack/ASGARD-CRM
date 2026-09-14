-- V329: backfill autumn seasonal quest counters from field_checkins
-- (quests were seeded mid-window; event-driven progress missed prior checkins)

WITH autumn_start AS (SELECT TIMESTAMPTZ '2026-09-01 00:00:00+03' AS ts),
shifts AS (
  SELECT employee_id, COUNT(*)::int AS cnt
  FROM field_checkins, autumn_start
  WHERE status = 'completed' AND checkin_at >= autumn_start.ts
  GROUP BY employee_id
)
INSERT INTO gamification_quest_progress
  (employee_id, quest_id, current_count, completed, reward_claimed, period_start, completed_at)
SELECT s.employee_id, q.id,
       LEAST(s.cnt, q.target_count),
       (s.cnt >= q.target_count),
       false,
       DATE '1970-01-01',
       CASE WHEN s.cnt >= q.target_count THEN NOW() ELSE NULL END
FROM shifts s
JOIN gamification_quests q ON q.quest_type = 'seasonal' AND q.is_active
  AND q.target_action = 'total_shifts'
  AND q.name IN ('Осенний поход', 'Золотой листопад')
ON CONFLICT (employee_id, quest_id, period_start) DO UPDATE SET
  current_count = GREATEST(gamification_quest_progress.current_count, EXCLUDED.current_count),
  completed = gamification_quest_progress.completed OR EXCLUDED.completed,
  completed_at = COALESCE(gamification_quest_progress.completed_at, EXCLUDED.completed_at);

WITH autumn_start AS (SELECT TIMESTAMPTZ '2026-09-01 00:00:00+03' AS ts),
morning AS (
  SELECT employee_id, COUNT(*)::int AS cnt
  FROM field_checkins, autumn_start
  WHERE status = 'completed'
    AND checkin_at >= autumn_start.ts
    AND EXTRACT(HOUR FROM checkin_at AT TIME ZONE 'Europe/Moscow') < 9
  GROUP BY employee_id
)
INSERT INTO gamification_quest_progress
  (employee_id, quest_id, current_count, completed, reward_claimed, period_start, completed_at)
SELECT m.employee_id, q.id,
       LEAST(m.cnt, q.target_count),
       (m.cnt >= q.target_count),
       false,
       DATE '1970-01-01',
       CASE WHEN m.cnt >= q.target_count THEN NOW() ELSE NULL END
FROM morning m
JOIN gamification_quests q ON q.quest_type = 'seasonal' AND q.is_active
  AND q.target_action = 'early_checkin' AND q.name = 'Ранний иней'
ON CONFLICT (employee_id, quest_id, period_start) DO UPDATE SET
  current_count = GREATEST(gamification_quest_progress.current_count, EXCLUDED.current_count),
  completed = gamification_quest_progress.completed OR EXCLUDED.completed,
  completed_at = COALESCE(gamification_quest_progress.completed_at, EXCLUDED.completed_at);

INSERT INTO migrations (name)
SELECT 'V329__autumn_quest_progress_backfill'
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'migrations'
)
AND NOT EXISTS (
  SELECT 1 FROM migrations WHERE name = 'V329__autumn_quest_progress_backfill'
);
