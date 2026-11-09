-- V479: пакет проверок МЛСП = коды permit_types из Дружины; всё WARN (не блокирует Excel)
BEGIN;

-- старые «выдуманные» lowercase-коды гасим
UPDATE mlsp_requirement_pack SET is_active = false
 WHERE code IN (
   'passport','medical','offshore_med','psych','bosiet','helicopter','height_1','fire',
   'labor','first_aid','confined','gas_hazard','ice_class'
 );

-- канон Дружины (permit_types.code) — только предупреждения
INSERT INTO mlsp_requirement_pack (code, label, severity, sort_order, is_active) VALUES
  ('MEDCHECK',     'Медицинский осмотр',                          'warn', 20,  true),
  ('OFFSHORE_MED', 'Морской медицинский осмотр',                  'warn', 30,  true),
  ('PSYCH',        'Психиатрическое освидетельствование',         'warn', 40,  true),
  ('BOSIET',       'БОСИЕТ',                                      'warn', 50,  true),
  ('HELICOPTER',   'Вертолётная подготовка (HUET)',               'warn', 60,  true),
  ('HEIGHT_1',     'Работы на высоте (1 группа)',                 'warn', 70,  true),
  ('PTM',          'Пожарная безопасность (ПТМ)',                 'warn', 80,  true),
  ('OT',           'Охрана труда (ОТ)',                           'warn', 90,  true),
  ('PMP',          'Первая медицинская помощь (ПМП)',             'warn', 100, true),
  ('CONFINED',     'Работа в замкнутых пространствах',            'warn', 110, true),
  ('GAS_HAZARD',   'Газоопасные работы',                          'warn', 120, true),
  ('ICE_CLASS',    'Ледовый класс',                               'warn', 130, true),
  ('NAKS',         'НАКС (для сварщиков)',                        'warn', 140, true),
  ('FSB',          'Пропуск ФСБ',                                 'warn', 200, true),
  ('MLSP_PASS',    'Пропуск МЛСП',                                'warn', 210, true)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  severity = 'warn',
  sort_order = EXCLUDED.sort_order,
  is_active = true;

-- FSB / MLSP_PASS уже могли быть — принуждаем warn
UPDATE mlsp_requirement_pack
   SET severity = 'warn', is_active = true
 WHERE code IN ('FSB', 'MLSP_PASS');

COMMENT ON TABLE mlsp_requirement_pack IS
  'Проверки генератора МЛСП: коды = permit_types.code Дружины; severity=warn — Excel не блокируется';

COMMIT;
