-- V410: алиасы почт сотрудников + включение приёма счетов.
--
-- Проблема (заказчик 19.10.2026): «счета шлют 20–50 сотрудников с разных почт,
-- в том числе личных». Сотрудник пишет с адреса, которого нет в `users.email`
-- (алиас вроде pd@ = Путков, или личный andr0sov.nikita@yandex.ru) → инициатор
-- не находился, заявка уходила админу, и сотрудник «не видел свой счёт».
--
-- Решение: отдельная таблица алиасов «почта → пользователь». Она:
--   • заполняется автоматически, когда офис-менеджер переназначает ответственного
--     (следующее письмо с этой почты резолвится само);
--   • может быть дозаполнена вручную/скриптом (адрес + пользователь);
--   • поддерживает несколько адресов на одного сотрудника (корп. + личный).
--
-- Сотрудник БЕЗ аккаунта в CRM записывается как запись с user_id=NULL и ссылкой
-- на employees (если найдётся) — чтобы офис-менеджер мог назначить владельца.

CREATE TABLE IF NOT EXISTS user_email_aliases (
  id             SERIAL PRIMARY KEY,
  email          varchar(255) NOT NULL,
  user_id        integer REFERENCES users(id) ON DELETE CASCADE,
  employee_id    integer,
  source         varchar(24) NOT NULL DEFAULT 'manual', -- manual|learned|import
  label          varchar(200),
  created_by     integer,
  created_at     timestamp NOT NULL DEFAULT NOW(),
  updated_at     timestamp NOT NULL DEFAULT NOW()
);

-- Адрес уникален в нижнем регистре (одна почта — один сотрудник).
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_email_aliases_email ON user_email_aliases (lower(email));
-- Быстрый поиск владельца адреса (главный горячий путь приёма письма).
CREATE INDEX IF NOT EXISTS idx_user_email_aliases_user ON user_email_aliases (user_id);
-- Поиск «аккаунты, ещё не привязанные к сотруднику» (для диагностики/офис-менеджера).
CREATE INDEX IF NOT EXISTS idx_user_email_aliases_unassigned ON user_email_aliases (id) WHERE user_id IS NULL;

COMMENT ON TABLE user_email_aliases IS
  'V410: почтовые алиасы сотрудников (почта → users.id). Инициатор счёта ищется здесь, затем в users.email.';
COMMENT ON COLUMN user_email_aliases.source IS
  'manual — привязано руками/скриптом; learned — выучено при переназначении ответственного; import — заливка списка.';

-- ── Включить контур приёма счетов ─────────────────────────────────────────
-- V398 создала настройку со значением 'false' (safety-дефолт) и на проде её так
-- и не включили → ни один счёт с почты не создавал заявку. Включаем.
INSERT INTO settings (key, value_json, updated_at)
VALUES ('email_intake_enabled', 'true', NOW())
ON CONFLICT (key) DO UPDATE SET value_json = 'true', updated_at = NOW();

-- Адрес, куда сотрудники ставят CRM в копию.
INSERT INTO settings (key, value_json, updated_at)
VALUES ('crm_copy_email', '"crm@asgard-service.com"', NOW())
ON CONFLICT (key) DO NOTHING;
