-- V347: real ASGARD warehouse layout 15×28 from docs/warehouse/asgard-warehouse-15x28-CLEAR.svg
BEGIN;

-- Fix floor dimensions (width X=15m, depth Z=28m) + rooms from drawing
UPDATE warehouse_map_floors f
SET
  width_m = 15,
  depth_m = 28,
  height_m = 5.5,
  rooms_json = '[
    {"id":"r2","label":"Комн.2 СИЗ 60м²","x":-4.5,"z":9.71,"w":6,"d":10},
    {"id":"r3","label":"Комн.3 инструмент 60м²","x":4.5,"z":9.71,"w":6,"d":10},
    {"id":"r1","label":"Комн.1 одежда 27м²","x":-4.5,"z":2.5,"w":6,"d":4.5},
    {"id":"weld","label":"Сварочная","x":-5.5,"z":-1.5,"w":3,"d":3},
    {"id":"locksmith","label":"Слесарка РЕМОНТ","x":-4.5,"z":-5.5,"w":6,"d":6},
    {"id":"kitchen","label":"Кухня","x":4.5,"z":2.5,"w":6,"d":6},
    {"id":"chem","label":"Кабинет химиков","x":-5.0,"z":-11.5,"w":5,"d":4},
    {"id":"general","label":"Общее пространство 168м²","x":2.5,"z":-7.0,"w":9,"d":12},
    {"id":"sandblast","label":"Пескоструй","x":5.5,"z":-12.5,"w":4,"d":2.5}
  ]'::jsonb,
  meta_json = '{"entrance":"south","door_x":0,"door_z":13.8,"door_w":2.4,"aisle_x":[0],"aisle_z":[12,8,4,0,-4,-8]}'::jsonb,
  updated_at = NOW()
WHERE name = 'Основной';

-- Soft-delete previous demo objects on this floor
UPDATE warehouse_map_objects o
SET deleted_at = NOW(), updated_at = NOW()
FROM warehouse_map_floors f
WHERE o.floor_id = f.id
  AND f.name = 'Основной'
  AND o.deleted_at IS NULL;

-- Insert layout from CLEAR.svg (scale 28u=1m, origin center)
INSERT INTO warehouse_map_objects (
  floor_id, warehouse_id, object_type, code, label,
  x_m, z_m, rot_deg, width_m, depth_m, height_m,
  params_json, category_tags, load_kg
)
SELECT f.id, f.warehouse_id, v.object_type, v.code, v.label,
  v.x_m, v.z_m, v.rot_deg, v.width_m, v.depth_m, v.height_m,
  v.params_json::jsonb, v.tags, v.load_kg
FROM warehouse_map_floors f
CROSS JOIN (VALUES
  -- Комн.1 одежда
  ('clothing','E1','Одежда E1',-6.30,3.94,0,1.80,0.55,2.10,'{"clothing_sections":4}',ARRAY['ppe','clothing'],200::numeric),
  ('clothing','E2','Одежда E2',-6.30,2.49,0,1.80,0.55,2.10,'{"clothing_sections":4}',ARRAY['ppe','clothing'],200),
  ('clothing','E3','Одежда E3',-6.30,1.04,0,1.80,0.55,2.10,'{"clothing_sections":4}',ARRAY['ppe','clothing'],200),
  ('clothing','F1','Одежда F1',-3.80,4.01,0,1.00,0.40,2.00,'{"clothing_sections":3}',ARRAY['ppe','clothing'],150),
  ('clothing','F2','Одежда F2',-3.80,3.31,0,1.00,0.40,2.00,'{"clothing_sections":3}',ARRAY['ppe','clothing'],150),
  ('clothing','F3','Одежда F3',-3.80,1.76,0,1.00,0.40,2.00,'{"clothing_sections":3}',ARRAY['ppe','clothing'],150),
  -- Комн.2 СИЗ
  ('shelf_light','L-R2-1','СИЗ L-R2-1',-7.10,13.41,0,0.60,2.00,2.40,'{"shelf_count":5,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['ppe'],800),
  ('shelf_light','L-R2-2','СИЗ L-R2-2',-7.10,11.21,0,0.60,2.00,2.40,'{"shelf_count":5,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['ppe'],800),
  ('shelf_light','L-R2-3','СИЗ L-R2-3',-7.10,7.51,0,0.60,2.00,2.40,'{"shelf_count":5,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['ppe'],800),
  ('shelf_light','L-R2-4','СИЗ L-R2-4',-7.10,5.31,0,0.60,2.00,2.40,'{"shelf_count":5,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['ppe'],800),
  ('shelf_light','S-R2-S1','СИЗ S-R2-S1',-6.10,14.41,0,1.00,0.40,2.20,'{"shelf_count":4,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['ppe'],600),
  ('shelf_light','S-R2-S2','СИЗ S-R2-S2',-4.90,14.41,0,1.00,0.40,2.20,'{"shelf_count":4,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['ppe'],600),
  ('shelf_light','S-R2-S3','СИЗ S-R2-S3',-3.70,14.41,0,1.00,0.40,2.20,'{"shelf_count":4,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['ppe'],600),
  ('shelf_light','S-R2-N1','СИЗ S-R2-N1',-6.10,5.01,0,1.00,0.40,2.20,'{"shelf_count":4,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['ppe'],600),
  ('shelf_light','S-R2-N2','СИЗ S-R2-N2',-4.90,5.01,0,1.00,0.40,2.20,'{"shelf_count":4,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['ppe'],600),
  ('shelf_light','S-R2-N3','СИЗ S-R2-N3',-3.70,5.01,0,1.00,0.40,2.20,'{"shelf_count":4,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['ppe'],600),
  ('shelf_light','M-R2-E','СИЗ M-R2-E',-1.85,7.76,0,0.50,1.50,2.20,'{"shelf_count":4,"places_per_shelf":1,"shelf_pitch_m":0.4}',ARRAY['ppe'],500),
  -- Комн.3 инструмент
  ('shelf_light','L-R3-1','Инстр. L-R3-1',7.10,13.41,0,0.60,2.00,2.40,'{"shelf_count":5,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['tool'],900),
  ('shelf_light','L-R3-2','Инстр. L-R3-2',7.10,11.21,0,0.60,2.00,2.40,'{"shelf_count":5,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['tool'],900),
  ('shelf_light','L-R3-3','Инстр. L-R3-3',7.10,7.51,0,0.60,2.00,2.40,'{"shelf_count":5,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['tool'],900),
  ('shelf_light','L-R3-4','Инстр. L-R3-4',7.10,5.31,0,0.60,2.00,2.40,'{"shelf_count":5,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['tool'],900),
  ('shelf_light','S-R3-S1','Инстр. S-R3-S1',3.20,14.41,0,1.00,0.40,2.20,'{"shelf_count":4,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['tool','fastener'],700),
  ('shelf_light','S-R3-S2','Инстр. S-R3-S2',4.40,14.41,0,1.00,0.40,2.20,'{"shelf_count":4,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['tool','fastener'],700),
  ('shelf_light','S-R3-S3','Инстр. S-R3-S3',5.60,14.41,0,1.00,0.40,2.20,'{"shelf_count":4,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['tool','fastener'],700),
  ('shelf_light','M-R3-N','Инстр. M-R3-N',3.45,5.46,0,1.50,0.50,2.20,'{"shelf_count":4,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['tool'],600),
  ('shelf_light','K-АКБ','Зарядка АКБ',3.20,5.31,0,1.00,0.40,1.60,'{"shelf_count":3,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['battery'],300),
  -- Слесарка
  ('workbench','WB-REP','Верстак',-6.30,-4.16,0,2.00,0.75,0.90,'{"role":"workbench"}',ARRAY['ops'],200),
  ('shelf_light','S-REP-1','Запчасти S-REP-1',-7.10,-5.29,0,0.40,1.00,2.20,'{"shelf_count":4,"places_per_shelf":1,"shelf_pitch_m":0.4}',ARRAY['spare'],500),
  ('shelf_light','S-REP-2','Запчасти S-REP-2',-7.10,-6.49,0,0.40,1.00,2.20,'{"shelf_count":4,"places_per_shelf":1,"shelf_pitch_m":0.4}',ARRAY['spare'],500),
  ('shelf_light','S-REP-3','Запчасти S-REP-3',-7.10,-7.79,0,0.40,1.00,2.20,'{"shelf_count":4,"places_per_shelf":1,"shelf_pitch_m":0.4}',ARRAY['spare'],500),
  ('shelf_light','МЕТ-1','Метизы 1',-1.70,-3.39,0,0.40,1.00,2.00,'{"shelf_count":5,"places_per_shelf":1,"shelf_pitch_m":0.35}',ARRAY['fastener'],400),
  ('shelf_light','МЕТ-2','Метизы 2',-1.70,-4.49,0,0.40,1.00,2.00,'{"shelf_count":5,"places_per_shelf":1,"shelf_pitch_m":0.35}',ARRAY['fastener'],400),
  ('shelf_light','МЕТ-3','Метизы 3',-1.75,-7.44,0,0.50,1.50,2.00,'{"shelf_count":5,"places_per_shelf":1,"shelf_pitch_m":0.35}',ARRAY['fastener'],400),
  ('shelf_light','МЕТ-4','Метизы 4',-1.70,-8.79,0,0.40,1.00,2.00,'{"shelf_count":5,"places_per_shelf":1,"shelf_pitch_m":0.35}',ARRAY['fastener'],400),
  -- Общее пространство
  ('floor_zone','H-баллоны','Клетка баллонов',2.20,-1.74,0,1.20,0.80,1.80,'{"zone_kind":"gas_cage"}',ARRAY['gas'],500),
  ('shelf_pallet','PR-1','Паллет PR-1',6.95,-4.14,0,1.10,2.70,3.50,'{"pallet_levels":3,"slots_per_level":1}',ARRAY['heavy'],2000),
  ('shelf_pallet','PR-2','Паллет PR-2',6.95,-7.04,0,1.10,2.70,3.50,'{"pallet_levels":3,"slots_per_level":1}',ARRAY['heavy'],2000),
  ('shelf_pallet','PR-3','Паллет PR-3',6.95,-9.94,0,1.10,2.70,3.50,'{"pallet_levels":3,"slots_per_level":1}',ARRAY['heavy'],2000),
  ('shelf_pallet','PR-4','Паллет PR-4',3.35,-4.14,0,1.10,2.70,3.50,'{"pallet_levels":3,"slots_per_level":1}',ARRAY['heavy'],2000),
  ('shelf_pallet','PR-5','Паллет PR-5',3.35,-7.04,0,1.10,2.70,3.50,'{"pallet_levels":3,"slots_per_level":1}',ARRAY['heavy'],2000),
  ('workbench','W1','Стол кладовщика',3.70,-1.69,0,1.60,0.70,0.90,'{"role":"desk"}',ARRAY['ops'],100),
  ('floor_zone','RCV-1','Приёмка RCV-1',5.20,-1.74,0,1.20,0.80,0.05,'{"zone_kind":"receive"}',ARRAY['ops'],1000),
  ('assembly_pallet','OUT-1','Отгрузка OUT-1',6.50,-1.74,0,1.20,0.80,0.30,'{"status":"open"}',ARRAY['assembly'],800),
  ('machine','M-SAND','Пескоструй',5.50,-12.50,0,2.20,1.40,2.00,'{"machine":"sandblaster"}',ARRAY['machine'],800),
  ('scrap','S1','Металлолом',-6.50,-10.50,0,1.80,1.40,1.20,'{"bin":true}',ARRAY['scrap'],1500)
) AS v(object_type, code, label, x_m, z_m, rot_deg, width_m, depth_m, height_m, params_json, tags, load_kg)
WHERE f.name = 'Основной'
  AND NOT EXISTS (
    SELECT 1 FROM warehouse_map_objects o
    WHERE o.floor_id = f.id AND o.code = v.code AND o.deleted_at IS NULL
  );

COMMIT;
