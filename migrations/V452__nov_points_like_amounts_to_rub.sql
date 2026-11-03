-- ═══════════════════════════════════════════════════════════════════════════
-- V452: Страховка cutover баллов→₽ для ноября 2026+
--
-- Обычный путь UI (field-tab / timesheet) уже писал amount_earned в РУБЛЯХ
-- (баллы × 500 на клиенте), а в ячейке показывал баллы = amount/500.
-- Таким строкам конвертация НЕ нужна — после смены UI они сами станут «6.5к».
--
-- Но бывают «грязные» записи (D-266 класс): day_rate/amount_earned = 13/17
-- вместо 6500/8500. Их умножаем на 500.
--
-- Эвристика: значение > 0 и ≤ 99 (реальные ставки ≫ 99 ₽; MAX смены ~50б).
-- Только с 2026-11-01 (дата cutover). Идемпотентно: повторный прогон не трогает
-- уже рублёвые суммы (> 99).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) field_checkins
UPDATE field_checkins
SET
  amount_earned = ROUND(amount_earned * 500, 2),
  day_rate = CASE
    WHEN day_rate IS NOT NULL AND day_rate > 0 AND day_rate <= 99
      THEN ROUND(day_rate * 500, 2)
    WHEN day_rate IS NOT NULL AND day_rate > 99
      THEN day_rate
    ELSE ROUND(amount_earned * 500, 2)
  END,
  updated_at = NOW()
WHERE date >= '2026-11-01'
  AND COALESCE(status, 'completed') <> 'cancelled'
  AND amount_earned IS NOT NULL
  AND amount_earned > 0
  AND amount_earned <= 99;

-- day_rate загрязнён баллами, а amount_earned уже в ₽ — чиним только day_rate
UPDATE field_checkins
SET
  day_rate = ROUND(day_rate * 500, 2),
  updated_at = NOW()
WHERE date >= '2026-11-01'
  AND COALESCE(status, 'completed') <> 'cancelled'
  AND day_rate IS NOT NULL
  AND day_rate > 0
  AND day_rate <= 99
  AND (amount_earned IS NULL OR amount_earned > 99);

-- 2) field_trip_stages — деньги из баллов
UPDATE field_trip_stages
SET
  amount_earned = CASE
    WHEN amount_earned IS NOT NULL AND amount_earned > 0 AND amount_earned <= 99
      THEN ROUND(amount_earned * 500, 2)
    WHEN (amount_earned IS NULL OR amount_earned = 0)
         AND tariff_points IS NOT NULL AND tariff_points > 0
      THEN ROUND(tariff_points * 500, 2)
    ELSE amount_earned
  END,
  rate_per_day = CASE
    WHEN rate_per_day IS NOT NULL AND rate_per_day > 0 AND rate_per_day <= 99
      THEN ROUND(rate_per_day * 500, 2)
    WHEN (rate_per_day IS NULL OR rate_per_day = 0)
         AND tariff_points IS NOT NULL AND tariff_points > 0
      THEN ROUND(tariff_points * 500, 2)
    ELSE rate_per_day
  END,
  updated_at = NOW()
WHERE date_from >= '2026-11-01'
  AND COALESCE(status, 'active') NOT IN ('cancelled', 'rejected')
  AND (
    (amount_earned IS NOT NULL AND amount_earned > 0 AND amount_earned <= 99)
    OR (rate_per_day IS NOT NULL AND rate_per_day > 0 AND rate_per_day <= 99)
    OR (
      COALESCE(tariff_points, 0) > 0
      AND (amount_earned IS NULL OR amount_earned = 0)
    )
  );
