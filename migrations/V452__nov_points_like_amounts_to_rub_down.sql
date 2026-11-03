-- Rollback V452: обратная конверсия только для сумм, кратных 500 и выглядящих
-- как бывшие баллы×500 в диапазоне 500…49500 (1…99 б). Рискованно на смешанных
-- данных — используйте только сразу после ошибочного apply.

UPDATE field_checkins
SET
  amount_earned = ROUND(amount_earned / 500, 2),
  day_rate = CASE
    WHEN day_rate IS NOT NULL AND day_rate >= 500 AND day_rate <= 49500
         AND MOD(ROUND(day_rate)::int, 500) = 0
      THEN ROUND(day_rate / 500, 2)
    ELSE day_rate
  END,
  updated_at = NOW()
WHERE date >= '2026-11-01'
  AND COALESCE(status, 'completed') <> 'cancelled'
  AND amount_earned >= 500
  AND amount_earned <= 49500
  AND MOD(ROUND(amount_earned)::int, 500) = 0
  AND ROUND(amount_earned / 500, 2) <= 99;

UPDATE field_trip_stages
SET
  amount_earned = CASE
    WHEN amount_earned >= 500 AND amount_earned <= 49500
         AND MOD(ROUND(amount_earned)::int, 500) = 0
         AND ROUND(amount_earned / 500, 2) <= 99
      THEN ROUND(amount_earned / 500, 2)
    ELSE amount_earned
  END,
  rate_per_day = CASE
    WHEN rate_per_day >= 500 AND rate_per_day <= 49500
         AND MOD(ROUND(rate_per_day)::int, 500) = 0
         AND ROUND(rate_per_day / 500, 2) <= 99
      THEN ROUND(rate_per_day / 500, 2)
    ELSE rate_per_day
  END,
  updated_at = NOW()
WHERE date_from >= '2026-11-01'
  AND COALESCE(status, 'active') NOT IN ('cancelled', 'rejected');
