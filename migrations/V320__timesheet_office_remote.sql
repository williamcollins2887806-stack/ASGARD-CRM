-- V320: Табель — типы «Офис» (16 б.) и «Удалённая работа» (10 б.)
-- По легенде Excel табеля (дорога / офис / судно / МЛСП / удалёнка / МО / склад / …)

ALTER TABLE position_points
    DROP CONSTRAINT IF EXISTS position_points_type_chk;

ALTER TABLE position_points
    ADD CONSTRAINT position_points_type_chk
    CHECK (type IN (
      'warehouse', 'medical', 'travel', 'ship', 'training', 'helicopter',
      'office', 'remote'
    ));

INSERT INTO position_points (type, position, points)
SELECT 'office', NULL, 16
WHERE NOT EXISTS (
    SELECT 1 FROM position_points
     WHERE type = 'office' AND COALESCE(position, '') = ''
);

INSERT INTO position_points (type, position, points)
SELECT 'remote', NULL, 10
WHERE NOT EXISTS (
    SELECT 1 FROM position_points
     WHERE type = 'remote' AND COALESCE(position, '') = ''
);
