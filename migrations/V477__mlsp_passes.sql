-- V477: МЛСП · пропуска и транспорт (генератор бланков, реестр SLA, рейсы)
-- Контур Хосе: заявки перелёт/корабль/СРЗ/ММРП/МЛСП/ФСБ + реестр +45 + история.

BEGIN;

CREATE TABLE IF NOT EXISTS mlsp_applications (
  id                SERIAL PRIMARY KEY,
  app_type          VARCHAR(32) NOT NULL,
  -- flight | ship | pass_35srz | pass_mmrp | pass_mlsp | pass_fsb
  status            VARCHAR(32) NOT NULL DEFAULT 'draft',
  -- draft | exported | sent | cancelled
  contract_id       INTEGER,
  contract_number   TEXT,
  curator           TEXT,
  ship_curator      TEXT,
  mvz               TEXT,
  route_text        TEXT,
  date_from         DATE,
  date_to           DATE,
  direction         VARCHAR(16),
  -- inbound | outbound | both | null
  transport         VARCHAR(16),
  -- helicopter | plane | ship | null
  outgoing_number   TEXT,
  subject_text      TEXT,
  purpose_text      TEXT,
  pass_kind         VARCHAR(32),
  -- for 35srz: walk|drive; for fsb: individual|collective; mmrp: single|permanent
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  people            JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings          JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocks            JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exported_at       TIMESTAMPTZ,
  CONSTRAINT mlsp_applications_type_chk CHECK (app_type IN (
    'flight', 'ship', 'pass_35srz', 'pass_mmrp', 'pass_mlsp', 'pass_fsb'
  )),
  CONSTRAINT mlsp_applications_status_chk CHECK (status IN (
    'draft', 'exported', 'sent', 'cancelled'
  ))
);

CREATE INDEX IF NOT EXISTS idx_mlsp_apps_type_created
  ON mlsp_applications (app_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mlsp_apps_contract
  ON mlsp_applications (contract_number);

COMMENT ON TABLE mlsp_applications IS
  'Сгенерированные транспортные/пропускные заявки МЛСП (бланки Excel).';

CREATE TABLE IF NOT EXISTS mlsp_outgoing_registry (
  id              SERIAL PRIMARY KEY,
  series          TEXT NOT NULL DEFAULT '141603',
  seq             INTEGER NOT NULL,
  number          TEXT NOT NULL UNIQUE,
  issued_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  contract_number TEXT,
  note            TEXT,
  application_id  INTEGER REFERENCES mlsp_applications(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mlsp_outgoing_seq_positive CHECK (seq > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mlsp_outgoing_series_seq
  ON mlsp_outgoing_registry (series, seq);

COMMENT ON TABLE mlsp_outgoing_registry IS
  'Исходящие номера заявок на пропуск МЛСП (серия 141603/NN).';

-- Стартовый номер как в Excel Хосе
INSERT INTO mlsp_outgoing_registry (series, seq, number, issued_at, contract_number, note)
SELECT '141603', 1, '141603/01', DATE '2026-01-19',
       'ГНШ-24/10000/00056/Р от 01.04.24 г.',
       'Исходный присланный бланк (импорт из Excel)'
WHERE NOT EXISTS (SELECT 1 FROM mlsp_outgoing_registry WHERE number = '141603/01');

CREATE TABLE IF NOT EXISTS mlsp_pass_registry (
  id                     SERIAL PRIMARY KEY,
  responsible_name       TEXT,
  contract_number        TEXT,
  request_no             TEXT,
  request_date           DATE,
  planned_ready          DATE,
  curator                TEXT,
  curator_confirm_date   DATE,
  status                 VARCHAR(32) NOT NULL DEFAULT 'Подана',
  issued_date            DATE,
  comment                TEXT,
  application_id         INTEGER REFERENCES mlsp_applications(id) ON DELETE SET NULL,
  outgoing_number        TEXT,
  people_count           INTEGER,
  created_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mlsp_pass_registry_status_chk CHECK (status IN (
    'Подана', 'Подтверждена', 'В работе', 'Готова', 'Сорвана'
  ))
);

CREATE INDEX IF NOT EXISTS idx_mlsp_pass_reg_status
  ON mlsp_pass_registry (status, planned_ready);
CREATE INDEX IF NOT EXISTS idx_mlsp_pass_reg_contract
  ON mlsp_pass_registry (contract_number);

COMMENT ON TABLE mlsp_pass_registry IS
  'Реестр заявок на пропуск МЛСП: SLA +45, статусы и эскалации Хосе.';

-- Живые строки из Реестр_пропусков_МЛСП_Яндекс
INSERT INTO mlsp_pass_registry (
  responsible_name, contract_number, request_no, request_date, planned_ready,
  curator, curator_confirm_date, status, comment, people_count
)
SELECT * FROM (VALUES
  (
    'Хосе',
    'ГНШ-26/10000/00073/Р от 21.04.26',
    '36',
    DATE '2026-08-17',
    DATE '2026-10-01',
    'Седов В.А.',
    NULL::date,
    'В работе',
    'Не понятно куда пропала заявка, по информации от Маркова — заявка пришла недавно. Седов пока обратную связь не даёт…',
    NULL::int
  ),
  (
    'Хосе',
    'ГНШ-26/10000/00073/Р от 21.04.26',
    '43',
    DATE '2026-10-21',
    DATE '2026-12-05',
    'Седов В.А.',
    DATE '2026-10-21',
    'Подтверждена',
    'Отправлено Виктору, подтверждение получили. В заявке 40 чел.',
    40
  )
) AS v(responsible_name, contract_number, request_no, request_date, planned_ready,
        curator, curator_confirm_date, status, comment, people_count)
WHERE NOT EXISTS (
  SELECT 1 FROM mlsp_pass_registry r
   WHERE r.request_no = v.request_no
     AND r.contract_number = v.contract_number
);

CREATE TABLE IF NOT EXISTS mlsp_transport_legs (
  id               SERIAL PRIMARY KEY,
  application_id   INTEGER REFERENCES mlsp_applications(id) ON DELETE SET NULL,
  employee_id      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  fio              TEXT NOT NULL,
  leg_date         DATE NOT NULL,
  direction        VARCHAR(16) NOT NULL,
  -- inbound | outbound
  transport        VARCHAR(16) NOT NULL DEFAULT 'plane',
  -- helicopter | plane | ship
  route_text       TEXT,
  contract_number  TEXT,
  curator          TEXT,
  position         TEXT,
  source           TEXT NOT NULL DEFAULT 'app',
  -- app | history_import
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mlsp_transport_dir_chk CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT mlsp_transport_kind_chk CHECK (transport IN ('helicopter', 'plane', 'ship'))
);

CREATE INDEX IF NOT EXISTS idx_mlsp_legs_date
  ON mlsp_transport_legs (leg_date DESC);
CREATE INDEX IF NOT EXISTS idx_mlsp_legs_emp
  ON mlsp_transport_legs (employee_id, leg_date DESC)
  WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mlsp_legs_fio_date
  ON mlsp_transport_legs (fio, leg_date DESC);

COMMENT ON TABLE mlsp_transport_legs IS
  'Рейсы людей: перелёты и корабль. Сводка «кто когда летит/едет» + плашки в Дружине.';

-- Метаданные договоров ГНШ для генератора (МВЗ / кураторы), без ломки contracts
CREATE TABLE IF NOT EXISTS mlsp_contract_meta (
  id                 SERIAL PRIMARY KEY,
  contract_id        INTEGER,
  contract_number    TEXT NOT NULL UNIQUE,
  mvz                TEXT,
  curator            TEXT,
  ship_curator       TEXT,
  end_date           DATE,
  counterparty_inn   TEXT,
  counterparty_name  TEXT NOT NULL DEFAULT 'ООО «Газпром нефть шельф»',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO mlsp_contract_meta (contract_number, mvz, curator, ship_curator, end_date)
SELECT * FROM (VALUES
  ('ГНШ-24/10000/00036/Р от 20.03.24', '5850371101', 'Мишин А.А.', 'Мишин А.А.', NULL::date),
  ('ГНШ-24/10000/00056/Р от 01.04.24 г.', '5850374402', 'Марков М.В.', 'Марков М.В.', DATE '2027-12-31'),
  ('ГНШ-25/10000/00178/Р от 16.05.25г', NULL, 'Ворончихин Д.С.', 'Ворончихин Д.С.', NULL::date),
  ('ГНШ-25/10000/00296/Р от 17.12.25 г.', '5850374402', 'Марков М.В.', 'Седов В.А.', NULL::date),
  ('ГНШ-26/10000/00073/Р от 21.04.26', '58550371101', 'Седов В.А.', 'Пантыкин А.И.', NULL::date),
  ('ГНШ-26/11000/00120/Р от 09.07.2026', NULL, 'Пантыкин А.И.', NULL, NULL::date)
) AS v(contract_number, mvz, curator, ship_curator, end_date)
WHERE NOT EXISTS (
  SELECT 1 FROM mlsp_contract_meta m WHERE m.contract_number = v.contract_number
);

-- Пакет BLOCK-допусков для МЛСП (настраиваемый)
CREATE TABLE IF NOT EXISTS mlsp_requirement_pack (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  severity    VARCHAR(8) NOT NULL DEFAULT 'block',
  -- block | warn
  sort_order  INTEGER NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT mlsp_req_sev_chk CHECK (severity IN ('block', 'warn'))
);

INSERT INTO mlsp_requirement_pack (code, label, severity, sort_order) VALUES
  ('passport',     'Паспорт РФ (смена 20/45)',              'block', 10),
  ('medical',      'Периодический медосмотр',               'block', 20),
  ('offshore_med', 'Шельфовый / морской медосмотр (УТМ)',   'block', 30),
  ('psych',        'Психиатрическое освидетельствование',   'block', 40),
  ('bosiet',       'BOSIET / БМПВО',                        'block', 50),
  ('helicopter',   'Вертолётная подготовка (HUET)',         'block', 60),
  ('height_1',     'Работы на высоте',                      'block', 70),
  ('fire',         'Пожарно-технический минимум',           'block', 80),
  ('labor',        'Охрана труда',                          'block', 90),
  ('first_aid',    'Первая помощь',                         'block', 100),
  ('confined',     'Закрытые пространства',                 'block', 110),
  ('gas_hazard',   'Газоопасные работы',                    'block', 120),
  ('ice_class',    'Ледовый / арктический модуль',          'block', 130),
  ('FSB',          'Пропуск ФСБ (Варандей)',                'warn',  200),
  ('MLSP_PASS',    'Пропуск МЛСП',                          'warn',  210)
ON CONFLICT (code) DO NOTHING;

COMMIT;
