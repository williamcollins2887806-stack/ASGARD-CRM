-- ═══════════════════════════════════════════════════════════════════════════
-- V407: Расширение сетки ставок полевого модуля (потолки по категориям)
--
-- Запрос: «нельзя поставить больше, чем есть. Сварщики получают 30–40–50 баллов
-- на МЛСП. Сделай ставки: на земле до 10 т слесарь, земля тяж. до 12 т,
-- платформа до 14 т и т.д. Сварщиков до 50 баллов».
--
-- Потолки (1 балл = 500 ₽, point_value = 500):
--   Склад      — 18б = 9 000 ₽
--   Земля      — 20б = 10 000 ₽
--   Земля тяж. — 24б = 12 000 ₽
--   МЛСП       — 28б = 14 000 ₽
--   Сварщик    — 50б = 25 000 ₽ (во всех 4 категориях)
--
-- Миграция ТОЛЬКО добавляет строки. Ни одна существующая строка не меняется
-- и не деактивируется — иначе у уже назначенных людей «пропал бы» тариф
-- (GET /tariffs отдаёт только is_active, а resolveAssignmentRates по
-- неактивному id вернул бы «Тариф не найден»).
--
-- Что добавляет:
--   1) «Лестницу» баллов до потолка категории для ролей-баз (Слесарь*, Мастер*):
--      по строке на каждый недостающий балл, ставка = баллы × 500,
--      имя = «<позиция> (Nб)». Если у этой же базовой позиции уже есть активная
--      строка с таким же числом баллов (например «… (+1 балл)»), дубль не создаётся.
--   2) Сетку сварщика 41…50 баллов во всех 4 категориях (было 14…40 после V313).
--
-- «Новичок …» и «Трансфер …» не расширяются — это грейд и дорожная позиция,
-- а не тарифная лестница роли. ПТО уже 14…30б на всех категориях (выше потолка),
-- «Мастер ПТО» — не базовая роль лестницы, не трогаем.
--
-- Идемпотентность: WHERE NOT EXISTS по (category, position_name, points).
-- Транзакцию открывает раннер (migrations/run.js).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Лестница базовых ролей (Слесарь*, Мастер*) до потолка категории
WITH ceilings(category, max_points) AS (
  VALUES
    ('warehouse',   18),
    ('ground',      20),
    ('ground_hard', 24),
    ('mlsp',        28)
),
src AS (
  SELECT g.category,
         g.position_name,
         g.points,
         g.sort_order,
         c.max_points
    FROM field_tariff_grid g
    JOIN ceilings c ON c.category = g.category
   WHERE g.is_active = TRUE
     AND g.is_combinable = FALSE
     AND g.points > 0
     AND (g.position_name LIKE 'Слесарь%' OR g.position_name LIKE 'Мастер%')
     AND g.position_name NOT LIKE 'Мастер ПТО%'
     AND g.position_name NOT LIKE '%(+%'          -- не берём «надбавки» (+N балл)
     AND g.position_name !~ '\(\d+б\)$'          -- и уже созданную «лестницу» (Nб)
)
INSERT INTO field_tariff_grid
  (category, position_name, points, rate_per_shift, point_value, sort_order,
   is_active, is_combinable, requires_approval, notes, created_at, updated_at)
SELECT s.category,
       s.position_name || ' (' || p.n::text || 'б)',
       p.n,
       p.n * 500,
       500,
       s.sort_order * 100 + p.n,
       TRUE,
       FALSE,
       FALSE,
       'Расширение сетки до потолка категории (V407)',
       NOW(),
       NOW()
  FROM src s
  CROSS JOIN LATERAL generate_series(s.points + 1, s.max_points) AS p(n)
 WHERE NOT EXISTS (
   SELECT 1 FROM field_tariff_grid dup
    WHERE dup.category = s.category
      AND dup.position_name = s.position_name || ' (' || p.n::text || 'б)'
      AND dup.points = p.n
 )
 -- Не плодим дубль балла, если у этой же базовой позиции уже есть активная
 -- строка с тем же числом баллов (например «… (+1 балл)»).
 AND NOT EXISTS (
   SELECT 1 FROM field_tariff_grid cover
    WHERE cover.category = s.category
      AND cover.is_active = TRUE
      AND cover.points = p.n
      AND cover.position_name LIKE s.position_name || ' (%'
 );

-- 2) Сварщик: 41…50 баллов во всех 4 категориях
INSERT INTO field_tariff_grid
  (category, position_name, points, rate_per_shift, point_value, sort_order,
   is_active, is_combinable, requires_approval, notes, created_at, updated_at)
SELECT c.category,
       'Сварщик (' || p.n::text || 'б)',
       p.n,
       p.n * 500,
       500,
       8000 + p.n,
       TRUE,
       FALSE,
       FALSE,
       'Сетка сварщика до 50б (V407)',
       NOW(),
       NOW()
  FROM (VALUES ('mlsp'), ('ground'), ('ground_hard'), ('warehouse')) AS c(category)
  CROSS JOIN generate_series(41, 50) AS p(n)
 WHERE NOT EXISTS (
   SELECT 1 FROM field_tariff_grid dup
    WHERE dup.category = c.category
      AND dup.position_name = 'Сварщик (' || p.n::text || 'б)'
      AND dup.points = p.n
 );
