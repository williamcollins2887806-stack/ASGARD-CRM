DELETE FROM position_points WHERE type IN ('training', 'helicopter');

ALTER TABLE position_points
    DROP CONSTRAINT IF EXISTS position_points_type_chk;

ALTER TABLE position_points
    ADD CONSTRAINT position_points_type_chk
    CHECK (type IN ('warehouse', 'medical', 'travel', 'ship'));
