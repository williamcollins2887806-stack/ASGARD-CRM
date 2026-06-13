-- V191: Ребаланс экономики геймификации.
-- Жалоба: «много выигрывают». Решение —
--   магазин ×2 (за товар платят в 2 раза больше рун)
--   квесты ÷2 (награды за квесты в 2 раза меньше)
-- НЕ трогаем: gamification_prizes (рулетка), gamification_wallets (балансы),
-- курсы в field-gamification.js (silver→runes=10, runes→XP=5, daily cap=1000),
-- частоты (free_spins=1, checkin_bonus=3, pity=50).
--
-- Безопасность: backup-таблица фиксирует исходные значения. Если миграция
-- запускается повторно — таблица уже существует и CREATE падает,
-- защищая от двойного умножения. Down-миграция восстанавливает точные числа.

BEGIN;

-- Защита от повторного применения: если backup есть — это значит V191
-- уже применена, второй прогон даст ×4/÷4. Падаем явной ошибкой.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'gamification_economy_backup_v191'
  ) THEN
    RAISE EXCEPTION 'V191 already applied (backup table exists). To re-run: drop gamification_economy_backup_v191 first';
  END IF;
END$$;

-- Сохраняем точные исходные значения для возможности отката.
CREATE TABLE gamification_economy_backup_v191 (
  table_name TEXT NOT NULL,
  row_id     INT  NOT NULL,
  old_value  INT  NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (table_name, row_id)
);

COMMENT ON TABLE gamification_economy_backup_v191 IS
  'Снимок цен/наград до применения V191. Удалить только при down-миграции.';

INSERT INTO gamification_economy_backup_v191 (table_name, row_id, old_value)
SELECT 'shop', id, price_runes FROM gamification_shop_items
UNION ALL
SELECT 'quest', id, reward_amount FROM gamification_quests;

-- ─── Магазин: цены ×2 ────────────────────────────────────────────────────
-- Все активные и неактивные — чтобы при включении archive-товара цена
-- была уже в новой шкале.
UPDATE gamification_shop_items
SET price_runes = price_runes * 2;

-- ─── Квесты: награды ÷2 ──────────────────────────────────────────────────
-- Только для reward_type='runes' или 'xp' (числовые валюты).
-- 0 оставляем как 0 (это специальный признак «без награды»).
-- Не-нулевые: округление вниз, минимум 1 — daily 10-15 → 5-7,
-- никогда не падаем в 0 для квестов с reward>0.
UPDATE gamification_quests
SET reward_amount = CASE
  WHEN reward_amount IS NULL OR reward_amount = 0 THEN reward_amount
  ELSE GREATEST(1, FLOOR(reward_amount * 0.5)::int)
END
WHERE reward_type IN ('runes', 'xp');

COMMIT;
