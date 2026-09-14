-- V327: Autumn 2026 season + fix seasonal quests
-- ═══════════════════════════════════════════════════════════════
-- Lessons from summer:
-- 1) roulette metric used wrong column (spun_at) → fixed in code
-- 2) lesson_passed required mandatory lessons released in window → too hard
-- 3) spring seasonal quests stayed active past season_end
-- 4) no autumn content after summer
--
-- This migration:
-- - closes summer_2026 (ends yesterday MSK)
-- - seeds autumn_2026 (2026-09-01 .. 2026-11-30) with achievable tasks
-- - deactivates spring-themed seasonal quests
-- - adds autumn seasonal quests for runes
-- ═══════════════════════════════════════════════════════════════

-- 1) Close summer early (user: autumn already started)
UPDATE seasonal_challenges
SET ends_at = '2026-09-03 23:59:59+03',
    description = COALESCE(description, '') || ' (сезон закрыт 03.09.2026 — переход на осень)'
WHERE slug = 'summer_2026'
  AND ends_at > '2026-09-03 23:59:59+03';

-- Past seasons stay in DB for history, but not flagged active
UPDATE seasonal_challenges
SET is_active = false
WHERE slug IN ('spring_2026', 'summer_2026');

-- 2) Autumn 2026 challenge
INSERT INTO seasonal_challenges
  (slug, season_name, description, icon, color, starts_at, ends_at,
   reward_type, reward_value, reward_label, reward_icon, is_active)
VALUES (
  'autumn_2026',
  'Осень 2026',
  'Золотой сезон Асгарда. Пять простых испытаний — реальные смены, уроки, колесо, стрик и ранний выход. Награда: руны в магазин.',
  '🍂',
  '#ea580c',
  '2026-09-01 00:00:00+03',
  '2026-11-30 23:59:59+03',
  'runes',
  300,
  '300 рун + значок «Золотая осень»',
  '🍂',
  true
) ON CONFLICT (slug) DO UPDATE SET
  season_name = EXCLUDED.season_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  reward_type = EXCLUDED.reward_type,
  reward_value = EXCLUDED.reward_value,
  reward_label = EXCLUDED.reward_label,
  reward_icon = EXCLUDED.reward_icon,
  is_active = true;

-- Replace autumn tasks (idempotent)
DELETE FROM seasonal_challenge_tasks
WHERE challenge_id = (SELECT id FROM seasonal_challenges WHERE slug = 'autumn_2026');

WITH ch AS (SELECT id FROM seasonal_challenges WHERE slug = 'autumn_2026')
INSERT INTO seasonal_challenge_tasks (challenge_id, slug, name, description, icon, action_type, target_value, sort_order)
SELECT ch.id, t.slug, t.name, t.descr, t.icon, t.action, t.target, t.ord
FROM ch, (VALUES
  ('shifts_10',     'Листопад смен',     'Отработай 10 смен за осень',                    '⚒️', 'shifts',         10, 1),
  ('lessons_2',     'Мудрость Мимира',   'Сдай 2 урока в Чертогах (любые)',               '📖', 'lesson_passed',   2, 2),
  ('roulette_3',    'Три судьбы',        'Крутани Колесо Норн 3 раза',                    '🎡', 'roulette_spins',  3, 3),
  ('streak_3',      'Три дня огня',      'Проработай 3 дня подряд',                       '🔥', 'streak_days',     3, 4),
  ('early_bird_2',  'Утренний строй',    'Отметься на утреннюю смену (до 09:00) дважды',  '🌅', 'checkin_early',   2, 5)
) AS t(slug, name, descr, icon, action, target, ord);

-- 3) Deactivate expired / spring seasonal quests (runes quests)
UPDATE gamification_quests
SET is_active = false
WHERE quest_type = 'seasonal'
  AND (
    id IN (15, 16, 17, 30)  -- КАО Азот Весна / Майский / Новобранец / Весна 2026
    OR (season_end IS NOT NULL AND season_end < DATE '2026-09-01')
    OR name ILIKE '%весна%'
    OR name ILIKE '%майск%'
  );

-- Keep «Мастер объекта» only if it has a future season_end; otherwise deactivate
UPDATE gamification_quests
SET is_active = false
WHERE id = 31 AND (season_end IS NULL OR season_end < CURRENT_DATE);

-- 4) Autumn seasonal quests (runes, honour season_end)
INSERT INTO gamification_quests
  (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, season_end, is_active, reward_item)
SELECT * FROM (VALUES
  ('seasonal'::varchar, 'Осенний поход', 'Отработай 20 смен до конца ноября',
   'total_shifts', 20, 'runes', 200, '🍂',
   'Листья падают — ты стоишь. Двадцать смен осени закаляют сильнее летнего зноя.',
   '2026-11-30'::date, true, NULL::varchar),
  ('seasonal', 'Золотой листопад', 'Отработай 40 смен до конца ноября',
   'total_shifts', 40, 'runes', 450, '🍁',
   'Сорок смен. Осень сдалась — ты нет. Кузня Асгарда гремит твоим именем.',
   '2026-11-30', true, NULL),
  ('seasonal', 'Ранний иней', 'Отметься на утреннюю смену (до 09:00) десять раз за сезон',
   'early_checkin', 10, 'runes', 150, '🌄',
   'Пока другие ещё собираются — ты уже в строю. Утренний холод закаляет.',
   '2026-11-30', true, NULL)
) AS v(quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, season_end, is_active, reward_item)
WHERE NOT EXISTS (
  SELECT 1 FROM gamification_quests gq WHERE gq.name = v.name AND gq.quest_type = 'seasonal'
);

-- If re-run: reactivate autumn quests by name
UPDATE gamification_quests
SET is_active = true,
    season_end = '2026-11-30',
    reward_type = 'runes',
    reward_amount = CASE name
      WHEN 'Осенний поход' THEN 200
      WHEN 'Золотой листопад' THEN 450
      WHEN 'Ранний иней' THEN 150
      ELSE reward_amount
    END,
    target_count = CASE name
      WHEN 'Осенний поход' THEN 20
      WHEN 'Золотой листопад' THEN 40
      WHEN 'Ранний иней' THEN 10
      ELSE target_count
    END
WHERE quest_type = 'seasonal'
  AND name IN ('Осенний поход', 'Золотой листопад', 'Ранний иней');

-- Bookkeeping (best-effort)
INSERT INTO migrations (name)
SELECT 'V327__autumn_2026_season_and_quest_fix'
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'migrations'
)
AND NOT EXISTS (
  SELECT 1 FROM migrations WHERE name = 'V327__autumn_2026_season_and_quest_fix'
);
