-- V465 down: откат mount + research_seed вставок V465

BEGIN;

DELETE FROM work_norm_rates WHERE code IN (
  'mount_to_shift', 'dismount_to_shift', 'rigging_lift_shift', 'flange_joint_shift',
  'cutting_m_shift', 'fire_works_shift', 'boiler_to_m2_shift', 'pipe_gdo_by_dn_shift',
  'pipe_pickle_mh_dn', 'tubes_drill_pcs_shift', 'pipe_hydrotest_hours',
  'vent_tower_lm_shift', 'tower_fill_m2_shift_expert'
);

DELETE FROM work_norm_categories WHERE code = 'mount';

-- repair_weld: убрать cutting/fire_works из methods_json (грубо — вернуть V314 набор)
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"compabloc","label":"Компаблок","primary_rate_code":"compabloc_m2_shift","derived_metric":"m2_per_shift","volume_unit":"м2"},
    {"code":"plates_pack","label":"Пакет пластин","primary_rate_code":"plates_pack_pcs_shift","derived_metric":"plates_per_shift","volume_unit":"пластин"},
    {"code":"weld","label":"Сварка","primary_rate_code":"weld_joint_shift","derived_metric":"joints_per_shift","volume_unit":"стык"}
  ]'::jsonb,
  updated_at = NOW()
WHERE code = 'repair_weld';

UPDATE work_norm_categories SET
  methods_json = COALESCE((
    SELECT jsonb_agg(elem ORDER BY ord)
    FROM (
      SELECT elem, ordinality AS ord
      FROM jsonb_array_elements(methods_json) WITH ORDINALITY AS t(elem, ordinality)
      WHERE elem->>'code' IS DISTINCT FROM 'hydrotest'
    ) s
  ), '[]'::jsonb),
  updated_at = NOW()
WHERE code = 'pipelines';

UPDATE work_norm_rates SET
  params_json = params_json - 'by_diameter' - 'cover_metal_mult' - 'cover_polymer_mult' - 'source',
  notes = regexp_replace(COALESCE(notes, ''), '; V465: by_diameter Е11 \(research_seed orientir\)', '', 'g'),
  updated_at = NOW()
WHERE code = 'insul_mh_m2';

DELETE FROM work_norm_change_log WHERE entity_type = 'catalog' AND entity_id = 'V465';

COMMIT;
