-- ═══════════════════════════════════════════════════════════════════════════
-- V453: Учёт часов офиса по СКУД + честный серверный учёт времени СРМ
--
-- Зачем. График офиса (staff_plan) знал только статус дня («оф» / «уд» / …),
-- но не часы. Проверка на проде 03.11.2026 показала: crm_presence_daily
-- записывает любой разрыв > 2 минут как 30 секунд (presence-activity.js:36-48),
-- поэтому за октябрь средний «рабочий день» = 0.69 ч, а 8 ч и более — 3 дня
-- из 304. Считать норму по такому источнику нельзя: удалёнка всегда была бы
-- в недоработке.
--
-- Что делает миграция:
--   1) skud_imports      — шапка загруженного отчёта СКУД (файл, период, sha256)
--   2) skud_punches      — сырые прохождения из отчёта (доказательство часов)
--   3) skud_person_map   — привязка «ФИО из СКУД → staff» (в т.ч. ручная)
--   4) office_hours_daily— факт часов в офисе по сотруднику и дню
--   5) office_presence_flags — реестр снятых ложных отметок «в офисе»
--   6) crm_activity_token— минутный счётчик API-активности (источник часов СРМ)
--   7) settings.skud     — пороги и белый список отправителя
--
-- Обратная миграция: V453__skud_office_hours_down.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Шапка импорта отчёта СКУД ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skud_imports (
  id            SERIAL PRIMARY KEY,
  period_from   date NOT NULL,
  period_to     date NOT NULL,
  file_name     varchar(500),
  sha256        varchar(64) NOT NULL,
  rows_total    integer NOT NULL DEFAULT 0,
  rows_used     integer NOT NULL DEFAULT 0,
  people_total  integer NOT NULL DEFAULT 0,
  people_mapped integer NOT NULL DEFAULT 0,
  unmatched_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  source        varchar(32) NOT NULL DEFAULT 'manual',   -- manual | mail | cron
  email_id      integer,                                  -- письмо-источник (mail)
  imported_by   integer,                                  -- users.id (NULL для mail/cron)
  imported_at   timestamptz NOT NULL DEFAULT NOW(),
  deleted_at    timestamptz,
  CONSTRAINT skud_imports_period_chk CHECK (period_to >= period_from)
);

-- Уникальность sha256 — только среди ЖИВЫХ импортов.
-- Раньше стоял голый UNIQUE: после отката (deleted_at) повторная загрузка
-- того же файла падала с 23505 → 500, и период нельзя было восстановить
-- (верификатор 03.11.2026, P2-2). Частичный индекс решает это.
--
-- Старый безусловный констрейнт / уникальный индекс надо снять явно:
-- на уже накатанных базах он остался бы и блокировал повтор.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'skud_imports'::regclass
       AND contype = 'u'
       AND conname LIKE '%sha256%'
  LOOP
    EXECUTE format('ALTER TABLE skud_imports DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

DROP INDEX IF EXISTS skud_imports_sha256_key;
DROP INDEX IF EXISTS uq_skud_imports_sha256;

CREATE UNIQUE INDEX IF NOT EXISTS uq_skud_imports_sha256_live
  ON skud_imports (sha256) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_skud_imports_period
  ON skud_imports (period_from, period_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_skud_imports_imported
  ON skud_imports (imported_at DESC);

COMMENT ON TABLE skud_imports IS
  'Загруженные отчёты СКУД (письмом на ящик CRM, cron-страховкой или вручную). sha256 защищает от повторного импорта того же файла.';
COMMENT ON COLUMN skud_imports.deleted_at IS
  'Мягкое удаление импорта: часы этого импорта перестают учитываться, но строки остаются для разбора.';

-- ── 2. Сырые прохождения ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skud_punches (
  id          BIGSERIAL PRIMARY KEY,
  import_id   integer NOT NULL REFERENCES skud_imports(id) ON DELETE CASCADE,
  raw_person  varchar(255) NOT NULL,     -- ФИО как в отчёте, без «(таб.№)»
  date        date NOT NULL,
  ts          timestamp NOT NULL,        -- локальное время события (MSK)
  direction   varchar(16) NOT NULL,      -- вход | выход
  event       varchar(64),               -- «доступ разрешен» | «проход» | …
  device      varchar(255)               -- считыватель + контроллер
);

CREATE INDEX IF NOT EXISTS idx_skud_punches_date ON skud_punches (date);
CREATE INDEX IF NOT EXISTS idx_skud_punches_person_date
  ON skud_punches (raw_person, date);
CREATE INDEX IF NOT EXISTS idx_skud_punches_import ON skud_punches (import_id);

COMMENT ON TABLE skud_punches IS
  'Сырые прохождения из отчёта СКУД — доказательство под часами в office_hours_daily.';

-- ── 3. Привязка ФИО из СКУД к сотруднику ───────────────────────────────────
CREATE TABLE IF NOT EXISTS skud_person_map (
  id          SERIAL PRIMARY KEY,
  raw_name    varchar(255) NOT NULL UNIQUE,
  staff_id    integer,                    -- staff.id; NULL = «в CRM нет, пропускать»
  user_id     integer,                    -- users.id, справочно для быстрых джойнов
  matched_by  varchar(16) NOT NULL DEFAULT 'auto',   -- auto | manual | skip
  confidence  numeric(4,3),               -- 1.000 — точное ФИО, ниже — догадка
  created_by  integer,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skud_person_map_staff ON skud_person_map (staff_id);

COMMENT ON TABLE skud_person_map IS
  'Привязка «ФИО в отчёте СКУД → сотрудник графика офиса». matched_by=skip — человек не работает у нас, больше не спрашивать.';

-- ── 4. Часы в офисе по дням ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_hours_daily (
  staff_id        integer NOT NULL,
  date            date NOT NULL,
  office_minutes  integer NOT NULL DEFAULT 0,
  open_ended      boolean NOT NULL DEFAULT false,  -- вход без выхода закрыт концом дня
  skud_missing    boolean NOT NULL DEFAULT false,  -- периода импорта за этот день нет
  first_in        timestamp,
  last_out        timestamp,
  segments        jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{from,to,minutes}]
  import_id       integer REFERENCES skud_imports(id) ON DELETE SET NULL,
  manual_minutes  integer,
  manual_reason   text,
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (staff_id, date)
);

CREATE INDEX IF NOT EXISTS idx_office_hours_daily_date ON office_hours_daily (date);

COMMENT ON TABLE office_hours_daily IS
  'Фактические часы сотрудника в офисе по СКУД. office_minutes — сумма интервалов «внутри здания», склейка разрывов ≤ settings.skud.merge_gap_min.';
COMMENT ON COLUMN office_hours_daily.manual_minutes IS
  'Ручная правка часов офис-менеджером/директором; при наличии перекрывает office_minutes.';

-- ── 5. Реестр снятых ложных отметок «в офисе» ──────────────────────────────
CREATE TABLE IF NOT EXISTS office_presence_flags (
  id             SERIAL PRIMARY KEY,
  staff_id       integer NOT NULL,
  user_id        integer,
  date           date NOT NULL,
  reason         varchar(32) NOT NULL DEFAULT 'skud_no_punch',
  prev_status    varchar(16),
  new_status     varchar(16),
  import_id      integer REFERENCES skud_imports(id) ON DELETE SET NULL,
  resolved_at    timestamptz,
  resolved_status varchar(16),
  resolved_comment text,
  created_at     timestamptz NOT NULL DEFAULT NOW()
);

-- Один флаг на день и человека: повторный импорт не должен плодить дубли.
CREATE UNIQUE INDEX IF NOT EXISTS uq_office_presence_flags_day
  ON office_presence_flags (staff_id, date);
CREATE INDEX IF NOT EXISTS idx_office_presence_flags_open
  ON office_presence_flags (staff_id) WHERE resolved_at IS NULL;

COMMENT ON TABLE office_presence_flags IS
  'Снятые ложные отметки «в офисе» (статус оф без прохода СКУД). Сотрудник обязан ответить статусом, отличным от «оф».';
COMMENT ON COLUMN office_presence_flags.reason IS
  'skud_no_punch — импорт покрывает день, проходов нет; skud_absent — человека нет в отчёте вовсе.';

-- ── 6. Минутный счётчик активности СРМ ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_activity_token (
  user_id    integer NOT NULL,
  minute_ts  timestamp NOT NULL,          -- начало минуты, локальное время MSK
  hits       integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, minute_ts)
);

CREATE INDEX IF NOT EXISTS idx_crm_activity_token_minute
  ON crm_activity_token (minute_ts);

COMMENT ON TABLE crm_activity_token IS
  'Активность в СРМ по минутам: пишется onRequest-хуком на каждый API-запрос (кроме шумных путей). Часы СРМ считаются сессиями с разрывом ≤ 15 мин (см. src/services/crm-activity.js).';

-- ── 7. Настройки ───────────────────────────────────────────────────────────
INSERT INTO settings (key, value_json, updated_at)
VALUES ('skud', $json${
  "merge_gap_min": 60,
  "norm_hours_per_day": 8,
  "norm_hours_per_week": 40,
  "norm_overrides": {},
  "crm_session_gap_min": 15,
  "crm_max_day_minutes": 720,
  "crm_activity_since": null,
  "mail_from": "",
  "import_cron": "10 6 * * *",
  "notify_roles": ["OFFICE_MANAGER"]
}$json$::text, NOW())
ON CONFLICT (key) DO NOTHING;
