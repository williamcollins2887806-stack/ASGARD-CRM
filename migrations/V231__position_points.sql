-- ═══════════════════════════════════════════════════════════════════════════
-- V231: position_points — настройки баллов по типам отметки/позиции
-- Источник: TIMESHEET_V2_CONTRACT.md, секция «БД (новые таблицы)».
-- Используется новым роутом /api/timesheet/v2 для проекции points в клетках
-- (warehouse/medical/travel) и для UI «Настройки баллов».
--
-- type:
--   'warehouse' — работа на складе
--   'medical'   — медосмотр
--   'travel'    — дорога
-- position:
--   для warehouse: 'слесарь' | 'мастер'
--   для medical/travel: NULL  (баллы одинаковые независимо от позиции)
--
-- Уникальность: контракт декларирует PK (type, COALESCE(position, '')) — но
-- PostgreSQL НЕ поддерживает выражения в PRIMARY KEY (только в UNIQUE INDEX).
-- Реализация: суррогатный SERIAL PK + UNIQUE INDEX на (type, COALESCE(position,'')).
-- Семантика «один setting на (type,position)» сохранена; код выбирает по
-- WHERE type=$1 AND COALESCE(position,'') = COALESCE($2,'').
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS + ON CONFLICT для seed.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS position_points (
    id          SERIAL      PRIMARY KEY,
    type        VARCHAR(20) NOT NULL,
    position    VARCHAR(20),
    points      INTEGER     NOT NULL,
    updated_by  INTEGER     REFERENCES users(id),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT position_points_type_chk   CHECK (type IN ('warehouse', 'medical', 'travel')),
    CONSTRAINT position_points_points_chk CHECK (points >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_position_points_type_position
    ON position_points (type, (COALESCE(position, '')));

-- Seed: точные значения из контракта.
-- ON CONFLICT по уникальному индексу — поэтому используем безопасный двух-шаговый
-- INSERT через NOT EXISTS (для совместимости с выражением COALESCE в индексе).
INSERT INTO position_points (type, position, points)
SELECT 'warehouse', 'слесарь', 10
WHERE NOT EXISTS (
    SELECT 1 FROM position_points WHERE type='warehouse' AND COALESCE(position,'')='слесарь'
);

INSERT INTO position_points (type, position, points)
SELECT 'warehouse', 'мастер', 12
WHERE NOT EXISTS (
    SELECT 1 FROM position_points WHERE type='warehouse' AND COALESCE(position,'')='мастер'
);

INSERT INTO position_points (type, position, points)
SELECT 'medical', NULL, 6
WHERE NOT EXISTS (
    SELECT 1 FROM position_points WHERE type='medical' AND COALESCE(position,'')=''
);

INSERT INTO position_points (type, position, points)
SELECT 'travel', NULL, 6
WHERE NOT EXISTS (
    SELECT 1 FROM position_points WHERE type='travel' AND COALESCE(position,'')=''
);
