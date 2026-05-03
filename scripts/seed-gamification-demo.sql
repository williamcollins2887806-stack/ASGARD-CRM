-- =================================================================
-- SEED: Gamification Demo Data
-- Запуск: psql -U asgard -d asgard_crm -f scripts/seed-gamification-demo.sql
-- =================================================================

BEGIN;

-- ═══ 1. SHOP ITEMS (16 товаров, 4 категории) ═══
INSERT INTO gamification_shop_items (name, description, price_runes, category, icon, is_active, requires_delivery, max_stock, current_stock) VALUES
  -- MERCH
  ('Футболка ASGARD', 'Фирменная футболка компании. 100% хлопок, черная, золотой принт', 2500, 'merch', '👕', true, true, 5, 5),
  ('Термос ASGARD', 'Стальной термос 500мл с гравировкой руны', 1800, 'merch', '🏆', true, true, 8, 8),
  ('Толстовка ASGARD', 'Утепленная толстовка с вышивкой. Легенда!', 4000, 'merch', '🧥', true, true, 3, 3),
  ('Кепка ASGARD', 'Бейсболка с вышитой руной на козырьке', 800, 'merch', '🧢', true, true, 15, 15),
  -- DIGITAL
  ('Стикер-пак Один', '20 нордических стикеров для Telegram', 150, 'digital', '🎨', true, false, null, 0),
  ('Стикер-пак Тор', '25 эпических стикеров с молнией и молотом', 300, 'digital', '⚡', true, false, null, 0),
  ('Аватар Берсерк', 'Анимированный аватар для профиля. Эксклюзив!', 500, 'digital', '🎭', true, false, 20, 20),
  ('Обои Вальхалла', '4K обои для рабочего стола в Norse стиле', 100, 'digital', '🖼', true, false, null, 0),
  -- PRIVILEGE
  ('VIP на 3 дня', 'Удвоенные руны, приоритет задач, золотая рамка', 600, 'privilege', '⭐', true, false, null, 0),
  ('VIP на неделю', '7 дней удвоенных рун и бонусов', 1200, 'privilege', '👑', true, false, null, 0),
  ('Доп. спин Колеса', '+1 бесплатный спин Колеса Норн сегодня', 200, 'privilege', '🔄', true, false, null, 0),
  ('x3 Множитель', 'Тройные руны за все квесты на 24 часа', 900, 'privilege', '🎯', true, false, 10, 10),
  -- COSMETIC
  ('Рамка Страж', 'Эпическая рамка аватара: синее пламя', 400, 'cosmetic', '🛡', true, false, 30, 30),
  ('Рамка Ярл', 'Золотая рамка с рунами. Показывает статус!', 1500, 'cosmetic', '⚔', true, false, 5, 5),
  ('Эффект Молния', 'Молнии вокруг аватара при входе в чат', 350, 'cosmetic', '⚡', true, false, 50, 50),
  ('Титул Воин', 'Титул под именем в профиле и в чатах', 250, 'cosmetic', '🏅', true, false, null, 0)
ON CONFLICT DO NOTHING;

-- ═══ 2. PRIZES for Wheel of Norns (12 призов) ═══
INSERT INTO gamification_prizes (tier, prize_type, name, description, value, weight, icon, is_active, requires_delivery) VALUES
  -- COMMON (50% суммарно)
  ('common', 'runes', '50 рун', 'Горсть рун из сокровищницы', 50, 250, '💰', true, false),
  ('common', 'runes', '100 рун', 'Мешочек рун', 100, 200, '💰', true, false),
  ('common', 'xp', '25 опыта', 'Искра знаний', 25, 150, '✨', true, false),
  -- RARE (30% суммарно)
  ('rare', 'runes', '250 рун', 'Сундук с рунами', 250, 100, '💎', true, false),
  ('rare', 'runes', '500 рун', 'Казна ярла', 500, 80, '💎', true, false),
  ('rare', 'xp', '100 опыта', 'Том мудрости', 100, 70, '📖', true, false),
  ('rare', 'extra_spin', 'Доп. спин', 'Ещё один шанс крутить колесо!', 1, 50, '🔄', true, false),
  -- EPIC (15% суммарно)
  ('epic', 'runes', '1000 рун', 'Сокровище Нибелунгов', 1000, 40, '👑', true, false),
  ('epic', 'multiplier', 'x2 Множитель', 'Удвоение следующего выигрыша', 2, 30, '⚡', true, false),
  ('epic', 'merch', 'Кружка ASGARD', 'Фирменная кружка викинга', 0, 20, '☕', true, true),
  -- LEGENDARY (5% суммарно)
  ('legendary', 'merch', 'Толстовка ASGARD', 'Легендарная фирменная толстовка', 0, 8, '🧥', true, true),
  ('legendary', 'runes', '5000 рун', 'Клад Фафнира — целое состояние!', 5000, 2, '🐉', true, false)
ON CONFLICT DO NOTHING;

-- ═══ 3. QUESTS (10 квестов) ═══
INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, is_active) VALUES
  -- DAILY (4)
  ('daily', 'Ранняя пташка', 'Отметиться на объекте до 08:00', 'checkin_before_8', 1, 'runes', 50, '🌅', true),
  ('daily', 'Хроника дня', 'Сделать 1 фото с объекта', 'photo_upload', 1, 'runes', 30, '📷', true),
  ('daily', 'Отчёт готов', 'Сдать дневной отчёт вовремя', 'report_submit', 1, 'runes', 40, '📋', true),
  ('daily', 'Без простоев', 'Отработать 8+ часов за смену', 'shift_8h', 1, 'runes', 60, '🔥', true),
  -- WEEKLY (3)
  ('weekly', 'Железная воля', 'Выйти на 6 смен подряд без пропусков', 'consecutive_shifts', 6, 'runes', 200, '🛡', true),
  ('weekly', 'Мастер точности', '0 ошибок чекинов за неделю', 'perfect_checkins', 7, 'runes', 150, '🎯', true),
  ('weekly', 'Наставник', 'Помочь новичку 3 раза за неделю', 'help_newbie', 3, 'runes', 180, '👥', true),
  -- SEASONAL (1)
  ('seasonal', 'Весна 2026', 'Отработать 60 смен за март-май', 'total_shifts', 60, 'runes', 1000, '🗓', true),
  -- PERMANENT (2)
  ('permanent', 'Легенда', 'Отработать 500 смен за всё время', 'lifetime_shifts', 500, 'runes', 5000, '🏛', true),
  ('permanent', 'Столетие', '100 смен без единого нарушения', 'clean_shifts', 100, 'runes', 3000, '⭐', true)
ON CONFLICT DO NOTHING;

-- ═══ 4. SEASON ═══
INSERT INTO gamification_seasons (id, name, description, theme, starts_at, ends_at, is_active, bonus_multiplier) VALUES
  ('spring-2026', 'Весна 2026', 'Весенний сезон — покажи на что способен!', 'norse', '2026-03-01', '2026-05-31 23:59:59', true, 1.0)
ON CONFLICT (id) DO NOTHING;

-- ═══ 5. SETTINGS ═══
INSERT INTO gamification_settings (key, value, description) VALUES
  ('spin_reset_hour', '6', 'Час сброса ежедневного спина (MSK)'),
  ('pity_guarantee_spins', '50', 'Гарантированный rare+ после N спинов'),
  ('weekly_bonus_runes', '500', 'Бонус за все еженедельные квесты'),
  ('xp_per_level', '100', 'XP для следующего уровня')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ═══ Проверка ═══
SELECT 'shop_items' AS table_name, COUNT(*) AS cnt FROM gamification_shop_items
UNION ALL
SELECT 'prizes', COUNT(*) FROM gamification_prizes
UNION ALL
SELECT 'quests', COUNT(*) FROM gamification_quests
UNION ALL
SELECT 'seasons', COUNT(*) FROM gamification_seasons
UNION ALL
SELECT 'settings', COUNT(*) FROM gamification_settings;
