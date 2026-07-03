-- V267 down: удалить типы каталога (только те, на которые никто не ссылается).
-- Категории существующих кодов, выровненные в up-миграции, не откатываем
-- (это безопасное денормализованное значение).
DELETE FROM permit_types pt
WHERE pt.code IN (
  'OT_A','OT_B','OT_V','PTM','FIRE_SAFETY','PROMBEZ','FIRST_AID',
  'SIZ_USE','SIZ_FALL','SIZ_RESP',
  'EB_II','EB_III','EB_IV','EB_V',
  'HEIGHT_1','HEIGHT_2','HEIGHT_3','OTZP_1','OTZP_2','OTZP_3','DRAGER',
  'CRANE_OP','SLINGER','RIGGER','MK_ASSEMBLY',
  'GAS_CUTTING','GAS_HAZARD',
  'NDT_VIC','NDT_PVK','NDT_MPK','NDT_RK','NDT_UZK',
  'WELD_RDS','WELD_TIG','WELD_MIG_MAG','WELD_GAS','WELD_ORBITAL','WELD_POLY',
  'MED_EXAM','MED_EXAM_PRELIM','PSYCH_EXAM','VACCINATION',
  'PB_A1','PB_B1','PB_B2','PB_B3','PB_B4','PB_B5','PB_B6','PB_B7','PB_B8',
  'PB_B9','PB_B10','PB_B11','PB_B12','PB_G1','PB_G2','PB_G3'
)
AND NOT EXISTS (SELECT 1 FROM employee_permits ep WHERE ep.type_id = pt.id);
