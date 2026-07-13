-- ═══════════════════════════════════════════════════════════════════════════
-- V284: Табель — типы «Обучение» (7 б.) и «Вертолёт» (6 б.)
--
-- По аналогии с V255 (Корабль):
--   training  — как medical, 7 баллов
--   helicopter — как ship (иной транспорт), 6 баллов
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE position_points
    DROP CONSTRAINT IF EXISTS position_points_type_chk;

ALTER TABLE position_points
    ADD CONSTRAINT position_points_type_chk
    CHECK (type IN ('warehouse', 'medical', 'travel', 'ship', 'training', 'helicopter'));

INSERT INTO position_points (type, position, points)
SELECT 'training', NULL, 7
WHERE NOT EXISTS (
    SELECT 1 FROM position_points
     WHERE type = 'training' AND COALESCE(position, '') = ''
);

INSERT INTO position_points (type, position, points)
SELECT 'helicopter', NULL, 6
WHERE NOT EXISTS (
    SELECT 1 FROM position_points
     WHERE type = 'helicopter' AND COALESCE(position, '') = ''
);
