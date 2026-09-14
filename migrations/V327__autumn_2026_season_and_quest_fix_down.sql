-- Down: remove autumn season + restore summer end (approx)
DELETE FROM seasonal_worker_completions
WHERE challenge_id IN (SELECT id FROM seasonal_challenges WHERE slug = 'autumn_2026');
DELETE FROM seasonal_worker_progress
WHERE challenge_id IN (SELECT id FROM seasonal_challenges WHERE slug = 'autumn_2026');
DELETE FROM seasonal_challenge_tasks
WHERE challenge_id IN (SELECT id FROM seasonal_challenges WHERE slug = 'autumn_2026');
DELETE FROM seasonal_challenges WHERE slug = 'autumn_2026';

UPDATE seasonal_challenges
SET ends_at = '2026-09-30 23:59:59+03'
WHERE slug = 'summer_2026';

UPDATE gamification_quests
SET is_active = false
WHERE name IN ('Осенний поход', 'Золотой листопад', 'Ранний иней');

DELETE FROM migrations WHERE name = 'V327__autumn_2026_season_and_quest_fix';
