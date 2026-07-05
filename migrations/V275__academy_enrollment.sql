-- V275: Academy enrollment — зачисление в Чертоги Мимира, амнистия ветеранам, onboarding для новичков
-- ACADEMY_ROLLOUT_MONDAY = 2026-07-07 (понедельник deploy)

BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS academy_enrolled_at DATE,
  ADD COLUMN IF NOT EXISTS academy_onboarding_passed_at TIMESTAMPTZ;

ALTER TABLE academy_lessons
  ADD COLUMN IF NOT EXISTS is_onboarding BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS academy_lesson_waivers (
  id              SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  lesson_id       INTEGER REFERENCES academy_lessons(id) ON DELETE CASCADE,
  waiver_type     TEXT NOT NULL CHECK (waiver_type IN ('grandfather','pm_exempt','attestation','medical')),
  effective_until DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      INTEGER REFERENCES users(id),
  note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_academy_waivers_employee
  ON academy_lesson_waivers(employee_id);

CREATE INDEX IF NOT EXISTS idx_academy_waivers_lesson
  ON academy_lesson_waivers(employee_id, lesson_id)
  WHERE lesson_id IS NOT NULL;

-- Вводная руна (week 1 — СИЗ)
UPDATE academy_lessons
SET is_onboarding = true
WHERE week_number = 1 AND status = 'published';

-- Ветераны: зачисление с rollout, onboarding считается пройденным (амнистия)
UPDATE employees
SET
  academy_enrolled_at = '2026-07-07'::date,
  academy_onboarding_passed_at = COALESCE(academy_onboarding_passed_at, NOW())
WHERE created_at < '2026-07-07'::timestamptz
   OR academy_enrolled_at IS NULL AND created_at IS NULL;

-- Новички после rollout: зачисление с понедельника недели найма
UPDATE employees
SET academy_enrolled_at = DATE_TRUNC('week', created_at)::date
WHERE created_at >= '2026-07-07'::timestamptz
  AND academy_enrolled_at IS NULL;

-- Changelog для field-приложения
INSERT INTO app_updates (version, title, changes, target) VALUES (
  '3.1.0',
  'Обновлены правила Чертогов Мимира',
  '[
    {"icon":"🏛️","text":"Для выхода на смену нужна только одна актуальная руна — не десятки"},
    {"icon":"📚","text":"Старые пропущенные руны остались в летописи за награды, но смену не блокируют"},
    {"icon":"🪖","text":"Новым рабочим — одна вводная руна перед первыми сменами"},
    {"icon":"⚡","text":"Каждую неделю — одна обязательная руна, просрочка блокирует только её"}
  ]'::jsonb,
  'field'
) ON CONFLICT (version) DO NOTHING;

COMMIT;
