-- ═══════════════════════════════════════════════════════════════════════════
-- V255 DOWN: откат «Корабль» + medical 7→6
-- ═══════════════════════════════════════════════════════════════════════════

-- Откатываем CHECK constraint
ALTER TABLE position_points
    DROP CONSTRAINT IF EXISTS position_points_type_chk;

ALTER TABLE position_points
    ADD CONSTRAINT position_points_type_chk
    CHECK (type IN ('warehouse', 'medical', 'travel'));

-- Удаляем строку 'ship' (она бы упала на новом CHECK)
DELETE FROM position_points WHERE type = 'ship';

-- medical 7 → 6
UPDATE position_points
   SET points     = 6,
       updated_at = NOW()
 WHERE type = 'medical'
   AND COALESCE(position, '') = ''
   AND points = 7;
