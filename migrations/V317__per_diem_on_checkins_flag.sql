-- V317: флаг «суточные за смены на объекте» (независимо от категории МЛСП/земля)
-- false = суточные только на этапах (дорога/корабль/МО/склад/обучение/ожидание/вертолёт)
-- true  = как раньше: этапы + completed checkins day/night

ALTER TABLE field_project_settings
  ADD COLUMN IF NOT EXISTS per_diem_on_checkins boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN field_project_settings.per_diem_on_checkins IS
  'Если false — суточные не начисляются за field_checkins (смены на объекте), только за field_trip_stages';

-- Все объекты МЛСП / Приразломная: выключить суточные за смены на платформе
UPDATE field_project_settings fps
SET per_diem_on_checkins = false,
    updated_at = NOW()
FROM works w
WHERE w.id = fps.work_id
  AND (
    fps.site_category = 'mlsp'
    OR w.work_title ILIKE '%МЛСП%'
    OR w.work_title ILIKE '%Приразлом%'
  );

-- Работы МЛСП без field_project_settings — создать запись с флагом false
-- (чтобы начисление уже учитывало правило даже до «Запустить Field»)
INSERT INTO field_project_settings (
  work_id, is_active, site_category, schedule_type, shift_hours, per_diem,
  per_diem_on_checkins, geo_radius_meters, geo_required,
  rounding_rule, rounding_step, created_at, updated_at
)
SELECT
  w.id,
  false,
  'mlsp',
  'shift',
  11,
  1000,
  false,
  500,
  false,
  'half_up',
  0.5,
  NOW(),
  NOW()
FROM works w
WHERE (
    w.work_title ILIKE '%МЛСП%'
    OR w.work_title ILIKE '%Приразлом%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM field_project_settings fps WHERE fps.work_id = w.id
  );
