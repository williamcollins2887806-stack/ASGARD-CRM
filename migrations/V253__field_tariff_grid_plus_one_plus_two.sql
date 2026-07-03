-- ═══════════════════════════════════════════════════════════════════════════
-- V253: Расширение справочника ставок (field_tariff_grid) +1 балл / +2 балла
--
-- Запрос юзера (23.06.2026): каждая основная позиция получает 3 варианта
-- с шагом 1 балл (= 500 ₽ по point_value).
--   Слесарь 6500 (+0)
--   Слесарь 7000 (+1 балл)
--   Слесарь 7500 (+2 балла)
--   …и так каждая базовая позиция.
--
-- Реализация:
--   1) Для существующих НЕ-комбинационных и НЕ-специальных записей создаём
--      пары «+1 балл» / «+2 балла» (если ещё не созданы).
--   2) +N балла = (orig.points + N) и (orig.rate_per_shift + N * point_value).
--   3) sort_order ставим +0.1/+0.2 относительно оригинала, чтобы в выпадашке
--      шёл порядок Слесарь / Слесарь +1 / Слесарь +2 / Мастер / Мастер +1 ...
--      (Колонка sort_order — INTEGER, поэтому используем умножение базы на 10
--      и +1/+2 к ней; см. ниже.)
--
-- Идемпотентность:
--   ON CONFLICT нет (нет UNIQUE-ключа по category+position_name+points),
--   поэтому WHERE NOT EXISTS по (category, position_name +' +N балл', points=base+N).
--
-- Не трогаем:
--   - is_combinable=TRUE (это и так «+1 балл» к основной позиции, отдельная фича).
--   - category='special' (выходной/обучение/дорога/пайковые/переработка — фикс).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) +1 балл
INSERT INTO field_tariff_grid
  (category, position_name, points, rate_per_shift, point_value, sort_order, is_active,
   is_combinable, requires_approval, notes, approved_by, approved_at, created_at, updated_at)
SELECT
  src.category,
  src.position_name || ' (+1 балл)',
  src.points + 1,
  src.rate_per_shift + COALESCE(src.point_value, 500),
  src.point_value,
  src.sort_order * 10 + 1,
  TRUE,
  FALSE,
  TRUE,  -- надбавка +1 балл требует согласования директора
  CONCAT_WS(' · ',
    'Надбавка +1 балл (=', COALESCE(src.point_value, 500)::text, '₽)',
    NULLIF(src.notes, '')),
  src.approved_by,
  src.approved_at,
  NOW(),
  NOW()
FROM field_tariff_grid src
WHERE src.is_combinable = FALSE
  AND src.category <> 'special'
  AND src.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM field_tariff_grid dup
    WHERE dup.category = src.category
      AND dup.position_name = src.position_name || ' (+1 балл)'
      AND dup.points = src.points + 1
  );

-- 2) +2 балла
INSERT INTO field_tariff_grid
  (category, position_name, points, rate_per_shift, point_value, sort_order, is_active,
   is_combinable, requires_approval, notes, approved_by, approved_at, created_at, updated_at)
SELECT
  src.category,
  src.position_name || ' (+2 балла)',
  src.points + 2,
  src.rate_per_shift + 2 * COALESCE(src.point_value, 500),
  src.point_value,
  src.sort_order * 10 + 2,
  TRUE,
  FALSE,
  TRUE,
  CONCAT_WS(' · ',
    'Надбавка +2 балла (=', (2 * COALESCE(src.point_value, 500))::text, '₽)',
    NULLIF(src.notes, '')),
  src.approved_by,
  src.approved_at,
  NOW(),
  NOW()
FROM field_tariff_grid src
WHERE src.is_combinable = FALSE
  AND src.category <> 'special'
  AND src.is_active = TRUE
  AND src.position_name NOT LIKE '%(+1 балл)%'   -- не плодим от +1 ещё +2
  AND src.position_name NOT LIKE '%(+2 балла)%'
  AND NOT EXISTS (
    SELECT 1 FROM field_tariff_grid dup
    WHERE dup.category = src.category
      AND dup.position_name = src.position_name || ' (+2 балла)'
      AND dup.points = src.points + 2
  );

-- 3) Поднять sort_order оригиналов в одной шкале (orig * 10), чтобы порядок был
--    стабильным после применения миграции.
UPDATE field_tariff_grid
   SET sort_order = sort_order * 10,
       updated_at = NOW()
 WHERE is_combinable = FALSE
   AND category <> 'special'
   AND is_active = TRUE
   AND position_name NOT LIKE '%(+1 балл)%'
   AND position_name NOT LIKE '%(+2 балла)%'
   AND sort_order < 10;  -- guard: не перемасштабируем если миграция повторно прогоняется
