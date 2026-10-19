-- V411: график отпусков офиса.
--
-- Заказчик (17–18.10.2026): график отпусков только для ОФИСА (не для полевых рабочих).
-- Периоды со сложным согласованием: ставят все офисные, согласуют ВСЕ директора
-- (период «согласован» только когда «за» все), отклонение — с обязательным комментарием,
-- снятые дни запоминаются и повторно не ставятся. За 15 дней до отпуска директору уходит
-- письмо с кнопками Да/Нет, напоминания раз в сутки (всего 3), без ответа — автоснятие.
--
-- ЕДИНАЯ ТОЧКА ПРАВДЫ ПО БАЛАНСУ: office_vacation_days (вводит бухгалтерия).
-- График офиса (staff_plan) остаётся витриной: согласованный отпуск проставляется
-- в него статусом «отп» сервисным слоем, сам график отпуск не согласует.
--
-- Привязка к сотруднику: office_vacations.employee_id → staff.id (та же сущность,
-- что у графика офиса и присутствия), user_id → users.id (кто поставил/подписал).

-- ── 1. Периоды отпусков ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_vacations (
  id              SERIAL PRIMARY KEY,
  employee_id     integer NOT NULL,               -- staff.id
  user_id         integer,                        -- users.id (владелец/инициатор)
  date_from       date    NOT NULL,
  date_to         date    NOT NULL,
  days            integer NOT NULL,               -- оплачиваемые календарные (без праздников, ст. 120 ТК)
  cal_days        integer NOT NULL DEFAULT 0,     -- календарных дней всего (включая праздники)
  holidays_count  integer NOT NULL DEFAULT 0,     -- сколько праздников попало в период (продлевают отпуск)
  kind            varchar(16) NOT NULL DEFAULT 'extra',   -- main (14 дней 1 раз в год) | extra
  year            integer NOT NULL,               -- год, к которому относится отпуск (date_from)
  status          varchar(16) NOT NULL DEFAULT 'draft',   -- draft|pending|approved|rejected|cancelled
  reason          varchar(1000),                  -- комментарий директора при отклонении (обязателен)
  decided_by      integer,                        -- users.id последнего принявшего решение
  decided_at      timestamp,
  submitted_at    timestamp,                      -- когда нажал «Готово и согласовать»
  created_at      timestamp NOT NULL DEFAULT NOW(),
  updated_at      timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT office_vacations_period_chk CHECK (date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_office_vacations_emp   ON office_vacations (employee_id, date_from);
CREATE INDEX IF NOT EXISTS idx_office_vacations_year  ON office_vacations (year, status);
CREATE INDEX IF NOT EXISTS idx_office_vacations_status ON office_vacations (status);

COMMENT ON TABLE office_vacations IS
  'График отпусков офиса: периоды. days — оплачиваемые календарные (без праздников ст.112, ст.120 ТК)';
COMMENT ON COLUMN office_vacations.kind IS
  'main — основной отпуск (14 кал. дн. разом, 1 раз в год); extra — остальные (до 7 дн.)';
COMMENT ON COLUMN office_vacations.status IS
  'draft|pending|approved|rejected|cancelled; approved => сервис пишет «отп» в staff_plan';
COMMENT ON COLUMN office_vacations.holidays_count IS
  'Нерабочие праздничные дни внутри периода — продлевают отпуск, но в days не входят';

-- ── 2. Голоса директоров (согласование всеми директорами) ───────────────────
CREATE TABLE IF NOT EXISTS office_vacation_approvals (
  id                SERIAL PRIMARY KEY,
  vacation_id       integer NOT NULL REFERENCES office_vacations(id) ON DELETE CASCADE,
  director_user_id  integer NOT NULL,             -- users.id директора
  decision          varchar(16) NOT NULL,         -- approve | reject
  comment           varchar(1000),                -- обязателен при reject
  decided_at        timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_office_vac_approval
  ON office_vacation_approvals (vacation_id, director_user_id);
CREATE INDEX IF NOT EXISTS idx_office_vac_approval_vac
  ON office_vacation_approvals (vacation_id);

COMMENT ON TABLE office_vacation_approvals IS
  'Голоса директоров по периоду отпуска. Период approved, когда «за» все директора';

-- ── 3. Балансы дней (вводит бухгалтерия) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_vacation_days (
  id               SERIAL PRIMARY KEY,
  employee_id      integer NOT NULL,              -- staff.id
  year             integer NOT NULL,
  available_days   integer NOT NULL DEFAULT 0,    -- положено за год
  carry_over_days  integer NOT NULL DEFAULT 0,    -- не отгулено за прошлый год (перенос)
  updated_by       integer,                       -- users.id бухгалтера
  updated_at       timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_office_vac_days
  ON office_vacation_days (employee_id, year);

COMMENT ON TABLE office_vacation_days IS
  'Балансы дней отпуска (вводит бухгалтерия): положено за год + не отгулено за прошлый год';
COMMENT ON COLUMN office_vacation_days.carry_over_days IS
  'Перенос прошлого года. Ст. 124 ТК РФ: перенос не более 12 дней — проверяется в UI';

-- ── 4. Снятые директором дни (повторно поставить нельзя) ────────────────────
CREATE TABLE IF NOT EXISTS office_vacation_blocked_days (
  id             SERIAL PRIMARY KEY,
  employee_id    integer NOT NULL,                -- staff.id — блокировка ТОЛЬКО для него
  date           date    NOT NULL,
  vacation_id    integer,                         -- период, из которого сняты дни
  reason         varchar(1000),                   -- комментарий директора
  blocked_by     integer,                         -- users.id
  created_at     timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_office_vac_blocked
  ON office_vacation_blocked_days (employee_id, date);
CREATE INDEX IF NOT EXISTS idx_office_vac_blocked_emp
  ON office_vacation_blocked_days (employee_id, date);

COMMENT ON TABLE office_vacation_blocked_days IS
  'Дни, снятые директором. Блокируются ПО СОТРУДНИКУ — повторно поставить нельзя, у коллег они свободны';

-- ── 5. Напоминания и автоснятие ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_vacation_reminders (
  id                 SERIAL PRIMARY KEY,
  vacation_id        integer NOT NULL REFERENCES office_vacations(id) ON DELETE CASCADE,
  seq                integer NOT NULL,            -- 1..3
  sent_at            timestamp NOT NULL DEFAULT NOW(),
  auto_cancelled_at  timestamp                    -- проставляется при автоснятии
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_office_vac_reminder
  ON office_vacation_reminders (vacation_id, seq);

COMMENT ON TABLE office_vacation_reminders IS
  'Письма директору по периоду: за 15 дней + напоминания раз в сутки (всего 3), далее автоснятие';

-- ── 6. Журнал действий ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_vacation_audit (
  id           SERIAL PRIMARY KEY,
  vacation_id  integer,
  employee_id  integer,
  actor_id     integer,                           -- users.id
  action       varchar(32) NOT NULL,              -- create|update|submit|approve|reject|cancel|close|autocancel|balance
  details      jsonb,
  created_at   timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_office_vac_audit_vac
  ON office_vacation_audit (vacation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_vac_audit_emp
  ON office_vacation_audit (employee_id, created_at DESC);

COMMENT ON TABLE office_vacation_audit IS
  'Журнал действий по графику отпусков: кто поставил, согласовал, снял, закрыл';

-- ── 7. Закрытие графика (по годам) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_vacation_periods (
  id          SERIAL PRIMARY KEY,
  year        integer NOT NULL,
  closed      boolean NOT NULL DEFAULT false,
  closed_by   integer,
  closed_at   timestamp,
  updated_at  timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_office_vac_period
  ON office_vacation_periods (year);

COMMENT ON TABLE office_vacation_periods IS
  'Состояние графика отпусков по годам: закрыт директором => редактирование запрещено у всех';

-- ── 8. Права ролей (role_presets, как принято в проекте) ────────────────────
-- Модуль vacations: read — все офисные роли; write — свои периоды (владелец, проверяется в роуте);
-- отдельные операции согласования/балансов ограничены ролями в коде роута.
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete)
SELECT r.role, 'vacations', true, true, false
FROM (VALUES
  ('ADMIN'), ('DIRECTOR_GEN'), ('DIRECTOR_COMM'), ('DIRECTOR_DEV'),
  ('HEAD_PM'), ('PM'), ('HEAD_TO'), ('TO'), ('PROC'),
  ('BUH'), ('OFFICE_MANAGER'), ('CHIEF_ENGINEER'), ('HR'), ('HR_MANAGER')
) AS r(role)
WHERE EXISTS (SELECT 1 FROM role_presets rp WHERE rp.role = r.role LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM role_presets rp2 WHERE rp2.role = r.role AND rp2.module_key = 'vacations'
  );
