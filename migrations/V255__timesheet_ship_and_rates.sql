-- ═══════════════════════════════════════════════════════════════════════════
-- V255: Табель — новый тип "Корабль" + апдейт ставок МО/Обучение 6→7 баллов
--
-- Запрос юзера (23.06.2026):
--   1) Добавить новый этап в табель — "Корабль" (альтернативный вид дороги
--      за повышенную ставку). 12 баллов × 500 ₽ = 6000 ₽.
--   2) Изменить ставку Медосмотра и Обучения с 6 → 7 баллов
--      (7 × 500 ₽ = 3500 ₽).
--   3) Доступ как у МО/Обучения: TO + HEAD_TO + ADMIN/DIRECTOR.
--
-- Что делает миграция:
--   1) ALTER CHECK constraint на position_points.type — добавляем 'ship'.
--      (V231 завёл type IN ('warehouse','medical','travel') — узко.)
--   2) UPDATE position_points: medical 6→7.
--   3) INSERT position_points: ship=12 (если ещё нет).
--   4) field_trip_stages.stage_type — VARCHAR(30) БЕЗ CHECK (V063), значит
--      просто разрешено любое значение; коду достаточно начать принимать 'ship'.
--      Никакой схемной правки тут не нужно.
--
-- Идемпотентность: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT, UPDATE WHERE +
-- INSERT WHERE NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Расширяем CHECK constraint на position_points.type
ALTER TABLE position_points
    DROP CONSTRAINT IF EXISTS position_points_type_chk;

ALTER TABLE position_points
    ADD CONSTRAINT position_points_type_chk
    CHECK (type IN ('warehouse', 'medical', 'travel', 'ship'));

-- 2) UPDATE: medical 6 → 7 баллов
UPDATE position_points
   SET points     = 7,
       updated_at = NOW()
 WHERE type = 'medical'
   AND COALESCE(position, '') = ''
   AND points = 6;

-- 3) INSERT: ship = 12 баллов (альтернатива travel за повышенную ставку)
INSERT INTO position_points (type, position, points)
SELECT 'ship', NULL, 12
WHERE NOT EXISTS (
    SELECT 1 FROM position_points
     WHERE type = 'ship' AND COALESCE(position, '') = ''
);
