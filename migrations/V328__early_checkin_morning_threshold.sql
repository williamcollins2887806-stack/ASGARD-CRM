-- V328: early_checkin = morning (<09:00), not pre-dawn (<07:00)
-- ═══════════════════════════════════════════════════════════════
-- Prod evidence 2026-09-04: ALL completed autumn field_checkins have
-- checkin_at hour = 8 (MSK). Threshold <07 made early_bird impossible
-- → all-or-nothing season reward stayed at 0 forever.
-- ═══════════════════════════════════════════════════════════════

UPDATE seasonal_challenge_tasks
SET name = 'Утренний строй',
    description = 'Отметься на утреннюю смену (до 09:00) дважды'
WHERE slug = 'early_bird_2'
  AND challenge_id = (SELECT id FROM seasonal_challenges WHERE slug = 'autumn_2026');

UPDATE gamification_quests
SET name = 'Ранний иней',
    description = 'Отметься на утреннюю смену (до 09:00) десять раз за сезон',
    lore = 'Пока другие ещё собираются — ты уже в строю. Утренний холод закаляет.'
WHERE quest_type = 'seasonal'
  AND name = 'Ранний иней';

-- Past seasons remain inactive (idempotent safety after V327 typo)
UPDATE seasonal_challenges
SET is_active = false
WHERE slug IN ('spring_2026', 'summer_2026');

INSERT INTO migrations (name)
SELECT 'V328__early_checkin_morning_threshold'
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'migrations'
)
AND NOT EXISTS (
  SELECT 1 FROM migrations WHERE name = 'V328__early_checkin_morning_threshold'
);
