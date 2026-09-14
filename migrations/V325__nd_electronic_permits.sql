-- V325: Электронные наряды-допуски (nd_*) — конструктор ASGARD / уровень ИСОБР
-- Не путать с кадровыми employee_permits / permit_types.

CREATE TABLE IF NOT EXISTS nd_form_templates (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  legal_basis     TEXT,
  version         INT NOT NULL DEFAULT 1,
  docx_file       TEXT,
  schema_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  risks_required  BOOLEAN NOT NULL DEFAULT true,
  max_days        INT NOT NULL DEFAULT 7,
  extend_days     INT NOT NULL DEFAULT 7,
  extend_once     BOOLEAN NOT NULL DEFAULT true,
  template_ready  BOOLEAN NOT NULL DEFAULT true,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nd_risk_catalog (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  description     TEXT,
  form_codes      TEXT[] NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nd_measure_catalog (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nd_risk_measures (
  risk_id         INT NOT NULL REFERENCES nd_risk_catalog(id) ON DELETE CASCADE,
  measure_id      INT NOT NULL REFERENCES nd_measure_catalog(id) ON DELETE CASCADE,
  PRIMARY KEY (risk_id, measure_id)
);

CREATE TABLE IF NOT EXISTS nd_permits (
  id                      SERIAL PRIMARY KEY,
  work_id                 INT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  form_template_id        INT NOT NULL REFERENCES nd_form_templates(id),
  form_code               TEXT NOT NULL,
  form_version            INT NOT NULL DEFAULT 1,
  number                  TEXT,
  status                  TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','issued','active','extended','closed','cancelled')),
  work_content            TEXT,
  work_place              TEXT,
  ppe_text                TEXT,
  emergency_text          TEXT,
  sections_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
  starts_at               TIMESTAMPTZ,
  ends_at                 TIMESTAMPTZ,
  created_by_user_id      INT REFERENCES users(id),
  issued_by_employee_id   INT REFERENCES employees(id),
  issued_at               TIMESTAMPTZ,
  closed_at               TIMESTAMPTZ,
  closed_by_employee_id   INT REFERENCES employees(id),
  template_snapshot       JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nd_permits_work ON nd_permits(work_id);
CREATE INDEX IF NOT EXISTS idx_nd_permits_status ON nd_permits(status);
CREATE INDEX IF NOT EXISTS idx_nd_permits_number ON nd_permits(number);

CREATE TABLE IF NOT EXISTS nd_permit_crew (
  id              SERIAL PRIMARY KEY,
  permit_id       INT NOT NULL REFERENCES nd_permits(id) ON DELETE CASCADE,
  employee_id     INT REFERENCES employees(id) ON DELETE SET NULL,
  fio             TEXT NOT NULL,
  profession      TEXT,
  role_in_permit  TEXT DEFAULT 'member',
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nd_permit_crew_permit ON nd_permit_crew(permit_id);
CREATE INDEX IF NOT EXISTS idx_nd_permit_crew_emp ON nd_permit_crew(employee_id);

CREATE TABLE IF NOT EXISTS nd_permit_equipment (
  id              SERIAL PRIMARY KEY,
  permit_id       INT NOT NULL REFERENCES nd_permits(id) ON DELETE CASCADE,
  equipment_id    INT,
  name            TEXT NOT NULL,
  qty             TEXT DEFAULT '1',
  note            TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nd_permit_risks (
  id              SERIAL PRIMARY KEY,
  permit_id       INT NOT NULL REFERENCES nd_permits(id) ON DELETE CASCADE,
  risk_id         INT REFERENCES nd_risk_catalog(id) ON DELETE SET NULL,
  risk_title      TEXT NOT NULL,
  measure_ids     INT[] NOT NULL DEFAULT '{}',
  measure_titles  TEXT[] NOT NULL DEFAULT '{}',
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nd_risk_closures (
  id              SERIAL PRIMARY KEY,
  permit_risk_id  INT NOT NULL REFERENCES nd_permit_risks(id) ON DELETE CASCADE,
  is_closed       BOOLEAN NOT NULL DEFAULT false,
  closed_by_employee_id INT REFERENCES employees(id),
  closed_at       TIMESTAMPTZ,
  evidence_text   TEXT,
  photo_path      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nd_risk_closures_risk ON nd_risk_closures(permit_risk_id);

CREATE TABLE IF NOT EXISTS nd_acks (
  id              SERIAL PRIMARY KEY,
  permit_id       INT NOT NULL REFERENCES nd_permits(id) ON DELETE CASCADE,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ack_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sections_read   JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (permit_id, employee_id)
);

CREATE TABLE IF NOT EXISTS nd_daily (
  id              SERIAL PRIMARY KEY,
  permit_id       INT NOT NULL REFERENCES nd_permits(id) ON DELETE CASCADE,
  work_date       DATE NOT NULL,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  producer_employee_id INT REFERENCES employees(id),
  admitter_employee_id INT REFERENCES employees(id),
  producer_sign_at TIMESTAMPTZ,
  admitter_sign_at TIMESTAMPTZ,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (permit_id, work_date)
);

CREATE TABLE IF NOT EXISTS nd_extensions (
  id              SERIAL PRIMARY KEY,
  permit_id       INT NOT NULL REFERENCES nd_permits(id) ON DELETE CASCADE,
  requested_by_employee_id INT REFERENCES employees(id),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_until TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  decided_by_employee_id INT REFERENCES employees(id),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nd_events (
  id              SERIAL PRIMARY KEY,
  permit_id       INT NOT NULL REFERENCES nd_permits(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  actor_user_id   INT,
  actor_employee_id INT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nd_events_permit ON nd_events(permit_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nd_inbox (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  permit_id       INT REFERENCES nd_permits(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nd_inbox_emp ON nd_inbox(employee_id, is_read, created_at DESC);

-- ─── Seeds: form templates ───────────────────────────────────────────────
INSERT INTO nd_form_templates (code, title, legal_basis, version, schema_json, risks_required, max_days, extend_days, template_ready, sort_order)
VALUES
  ('924n_rpo', 'РПО — теплоснабжение / теплоустановки',
   'Приложение №1 к Правилам ОТ, утв. приказом Минтруда России от 17.12.2020 № 924н',
   1, '{"sections":["work_content","work_place","measures","ppe","emergency","dates"]}'::jsonb,
   true, 7, 7, true, 10),
  ('528_gas', 'Газоопасные работы',
   'Приложение №2 к ФНП, утв. приказом Ростехнадзора от 15.12.2020 № 528',
   1, '{"sections":["work_content","work_place","measures","ppe","emergency","gas_analysis","dates"]}'::jsonb,
   true, 7, 7, true, 20),
  ('528_fire', 'Огневые работы',
   'Приложение №4 к ФНП, утв. приказом Ростехнадзора от 15.12.2020 № 528',
   1, '{"sections":["work_content","work_place","measures","ppe","emergency","fire_watch","dates"]}'::jsonb,
   true, 7, 7, true, 30),
  ('528_repair', 'Ремонтные работы (ОПО)',
   'Приложение №5 к ФНП, утв. приказом Ростехнадзора от 15.12.2020 № 528',
   1, '{"sections":["work_content","work_place","prep","measures","ppe","dates"]}'::jsonb,
   true, 15, 7, true, 40),
  ('ozp', 'Работы в ограниченных и замкнутых пространствах',
   'Правила по охране труда при работах в ОЗП (приказ Минтруда)',
   1, '{"sections":["work_content","work_place","measures","ppe","emergency","atmosphere","dates"]}'::jsonb,
   true, 7, 7, true, 50),
  ('height', 'Работы на высоте',
   'Правила по охране труда при работе на высоте (приказ Минтруда № 782н)',
   1, '{"sections":["work_content","work_place","measures","ppe","dates"]}'::jsonb,
   true, 15, 15, false, 60),
  ('electrical_903n', 'Работы в электроустановках',
   'Правила по охране труда при эксплуатации электроустановок (приказ Минтруда № 903н)',
   1, '{"sections":["work_content","work_place","measures","ppe","dates"]}'::jsonb,
   true, 15, 15, false, 70)
ON CONFLICT (code) DO NOTHING;

-- ─── Seeds: risks & measures (химпромывка / АВД / РНИ + общие) ───────────
INSERT INTO nd_risk_catalog (code, title, description, form_codes, sort_order) VALUES
  ('pressure_hot', 'Остаточное давление, горячая вода/пар', 'Отключение, охлаждение, дренирование', ARRAY['924n_rpo','528_repair'], 10),
  ('chem_burn', 'Химический ожог / раздражение (кислота, щёлочь)', 'AS-MALUM, нейтрализатор', ARRAY['924n_rpo','528_repair'], 20),
  ('hose_spill', 'Разрыв рукава / пролив агрессивной жидкости', NULL, ARRAY['924n_rpo','528_repair'], 30),
  ('hpa_jet', 'Струя высокого давления (АВД), аэрозоль, шум', NULL, ARRAY['924n_rpo','528_repair'], 40),
  ('mech_injury', 'Механические травмы при демонтаже/монтаже', NULL, ARRAY['924n_rpo','528_repair','528_fire'], 50),
  ('electric', 'Поражение электрическим током', NULL, ARRAY['924n_rpo','528_repair','electrical_903n','528_fire'], 60),
  ('slip', 'Скользкие поверхности, разлив воды', NULL, ARRAY['924n_rpo','528_repair'], 70),
  ('fire_site', 'Пожарная опасность на объекте', NULL, ARRAY['924n_rpo','528_fire','528_gas'], 80),
  ('env_spill', 'Загрязнение стоков / окружающей среды', NULL, ARRAY['924n_rpo'], 90),
  ('gas_leak', 'Утечка природного газа, загазованность', NULL, ARRAY['528_gas','924n_rpo'], 100),
  ('combustion', 'Продукты сгорания (CO и др.)', NULL, ARRAY['924n_rpo','528_gas'], 110),
  ('confined', 'Недостаток кислорода / токсичная среда в ОЗП', NULL, ARRAY['ozp','528_gas'], 120),
  ('height_fall', 'Падение с высоты', NULL, ARRAY['height'], 130),
  ('arc_flash', 'Электрическая дуга / прикосновение к ТЧ', NULL, ARRAY['electrical_903n'], 140)
ON CONFLICT (code) DO NOTHING;

INSERT INTO nd_measure_catalog (code, title, description, sort_order) VALUES
  ('loto', 'LOTO: отключение энергоносителей, блокировка, плакаты', NULL, 10),
  ('cool_drain', 'Охлаждение до безопасной температуры, дренирование, проверка нулевого давления', NULL, 20),
  ('sds', 'Работа по паспортам безопасности реагентов; «кислота в воду»', NULL, 30),
  ('trays_film', 'Ёмкости в поддонах, плёнка 200 мкм, сорбент, станция промывки глаз', NULL, 40),
  ('ppe_chem', 'СИЗ: химстойкий костюм/фартук, сапоги, перчатки, очки+щиток, респиратор', NULL, 50),
  ('hose_check', 'Осмотр рукавов до пуска; запрет подтяжки под давлением', NULL, 60),
  ('hpa_two', 'АВД минимум двумя работниками; не направлять струю на людей/электронику', NULL, 70),
  ('ppe_hpa', 'СИЗ АВД: водостойкая одежда, каска со щитком, наушники, респиратор', NULL, 80),
  ('two_lift', 'Тяжёлые элементы — два работника / механизация; каска, перчатки, спецобувь', NULL, 90),
  ('elec_auth', 'Подключение уполномоченным электротехническим персоналом; УЗО, заземление', NULL, 100),
  ('fence', 'Ограждение зоны, знаки, запрет посторонним', NULL, 110),
  ('extinguish', 'Исправные огнетушители; запрет открытого огня без отдельного наряда', NULL, 120),
  ('neutralize', 'Слив только после нейтрализации и разрешения заказчика', NULL, 130),
  ('gas_ready', 'Готовность газового хозяйства; герметичность рампы; вентиляция', NULL, 140),
  ('gas_analyzer', 'Контроль дымовых газов газоанализатором; останов при высоком CO', NULL, 150),
  ('atm_test', 'Анализ воздушной среды до входа; вентиляция; СИЗОД при необходимости', NULL, 160),
  ('fall_ppe', 'Страховочная система, анкерные точки, каска с подбородочным ремнём', NULL, 170),
  ('elec_permit', 'Технические мероприятия по ПОТЭУ; указатели напряжения; заземление', NULL, 180)
ON CONFLICT (code) DO NOTHING;

-- Link risks to default measures
INSERT INTO nd_risk_measures (risk_id, measure_id)
SELECT r.id, m.id FROM nd_risk_catalog r
JOIN nd_measure_catalog m ON (
  (r.code = 'pressure_hot' AND m.code IN ('loto','cool_drain','fence')) OR
  (r.code = 'chem_burn' AND m.code IN ('sds','trays_film','ppe_chem')) OR
  (r.code = 'hose_spill' AND m.code IN ('hose_check','trays_film')) OR
  (r.code = 'hpa_jet' AND m.code IN ('hpa_two','ppe_hpa','fence')) OR
  (r.code = 'mech_injury' AND m.code IN ('two_lift','cool_drain')) OR
  (r.code = 'electric' AND m.code IN ('elec_auth','loto')) OR
  (r.code = 'slip' AND m.code IN ('fence','trays_film')) OR
  (r.code = 'fire_site' AND m.code IN ('extinguish','fence')) OR
  (r.code = 'env_spill' AND m.code IN ('neutralize','trays_film')) OR
  (r.code = 'gas_leak' AND m.code IN ('gas_ready','extinguish','fence')) OR
  (r.code = 'combustion' AND m.code IN ('gas_analyzer','gas_ready')) OR
  (r.code = 'confined' AND m.code IN ('atm_test','ppe_chem','fence')) OR
  (r.code = 'height_fall' AND m.code IN ('fall_ppe','fence')) OR
  (r.code = 'arc_flash' AND m.code IN ('elec_permit','elec_auth'))
)
ON CONFLICT DO NOTHING;
