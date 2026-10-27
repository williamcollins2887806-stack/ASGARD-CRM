-- ═══════════════════════════════════════════════════════════════════════════
-- V443: явная база суммы расхода (с НДС / без НДС) + нормализация ставки
-- ═══════════════════════════════════════════════════════════════════════════
-- Основание: разбор финансового отчёта работы #406 (27.10.2026).
--
-- ДЕФЕКТ (корневой, порождает все остальные):
--   В `work_expenses.amount` не было указано, БРУТТО это (с НДС) или НЕТТО.
--   Каждый путь ввода трактовал сумму по-своему:
--     • vanilla-форма (public/assets/js/work_expenses.js:604) считает
--       НДС как amount*rate/(100+rate) — неявно БРУТТО;
--     • ПАНХ в #406 внесли как НЕТТО (23 111 014,72 + НДС 22%) — строка
--       перестала сходиться на 1 317 029,92 ₽;
--     • autoWorkExpense (src/routes/payment-invoices.js:269) не передаёт НДС
--       вовсе — по базе потеряно 32,6 млн ₽ вычета из 1177 связанных счетов.
--
-- ЧТО ДЕЛАЕМ:
--   1. Колонка `vat_basis` — явный ответ, что такое `amount`.
--   2. Нормализация `vat_rate` к ПРОЦЕНТАМ: в БД лежат и 0.2 (1134 строки),
--      и 22.0 (147 строк). UI показывал «НДС 0.2%».
--   3. Backfill `vat_basis` для существующих строк по сохранённым величинам.
--      Строки, которые ни в одну сторону не сходятся (7 штук, 23,8 млн),
--      НЕ переписываем — им ставим NULL и отдаём в отчёт как «требует сверки».
--
-- ВАЖНО: суммы (amount, vat_amount, amount_ex_vat) миграция НЕ меняет.
-- Правит только метаданные: базу и шкалу ставки. Деньги — руками, по договору.

BEGIN;

-- ─── 1. Колонка базы ───────────────────────────────────────────────────────
ALTER TABLE work_expenses
  ADD COLUMN IF NOT EXISTS vat_basis VARCHAR(8);

COMMENT ON COLUMN work_expenses.vat_basis IS
  'Что такое amount: gross = сумма с НДС, net = сумма без НДС, NULL = не указано (legacy). См. src/services/vat-calc.js';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_expenses_vat_basis_chk'
  ) THEN
    ALTER TABLE work_expenses
      ADD CONSTRAINT work_expenses_vat_basis_chk
      CHECK (vat_basis IS NULL OR vat_basis IN ('gross', 'net'));
  END IF;
END $$;

-- ─── 2. Нормализация ставки к процентам ────────────────────────────────────
-- 0.2 → 20, 0.1 → 10, 0.05 → 5. Значения > 1 уже в процентах — не трогаем.
UPDATE work_expenses
   SET vat_rate = ROUND(vat_rate * 100, 2)
 WHERE vat_rate IS NOT NULL
   AND vat_rate > 0
   AND vat_rate < 1;

-- Ставки вне допустимого набора (18, 0) приводим к NULL, чтобы не врали в UI.
-- 0 оставляем: это осознанный «без НДС» из doc-registry.
UPDATE work_expenses
   SET vat_rate = NULL
 WHERE vat_rate IS NOT NULL
   AND vat_rate NOT IN (0, 5, 10, 20, 22);

-- 2b. Ставка записана, но НЕ соответствует сумме НДС → ставим ту, по которой
--     НДС реально посчитан. Пример с прода (27.10.2026): счёт № BP-7784
--     «ТД БАШПРОМТОРГ», amount 601 456, vat_rate=20, vat_amount=108 459,28.
--     108 459,28 = 601 456 × 22/122 — ставка на самом деле 22%.
--     Считаем сумму НДС источником истины (её взяли из счёта), ставку — производной.
WITH pairs AS (
  SELECT w.id, w.amount, w.vat_amount, r.rate
    FROM work_expenses w
    CROSS JOIN (VALUES (5.0),(10.0),(20.0),(22.0)) AS r(rate)
   WHERE COALESCE(w.vat_amount, 0) > 0
),
matched AS (
  SELECT id,
         max(CASE WHEN ABS(vat_amount - ROUND(amount*rate/(100+rate), 2)) <= 1 THEN rate END) AS gross_rate,
         max(CASE WHEN ABS(vat_amount - ROUND(amount*rate/100, 2)) <= 1 THEN rate END) AS net_rate
    FROM pairs
   GROUP BY id
)
UPDATE work_expenses w
   SET vat_rate = COALESCE(m.gross_rate, m.net_rate)
  FROM matched m
 WHERE w.id = m.id
   AND COALESCE(m.gross_rate, m.net_rate) IS NOT NULL
   AND (w.vat_rate IS DISTINCT FROM COALESCE(m.gross_rate, m.net_rate));

-- ─── 3. Backfill vat_basis по сохранённым величинам ────────────────────────
-- 3a. amount = amount_ex_vat + vat_amount → сумма БРУТТО.
UPDATE work_expenses
   SET vat_basis = 'gross'
 WHERE vat_basis IS NULL
   AND COALESCE(vat_amount, 0) > 0
   AND amount_ex_vat IS NOT NULL
   AND ABS(amount - (amount_ex_vat + vat_amount)) <= 0.02;

-- 3b. amount = amount_ex_vat (НДС сверху) → сумма НЕТТО.
UPDATE work_expenses
   SET vat_basis = 'net'
 WHERE vat_basis IS NULL
   AND COALESCE(vat_amount, 0) > 0
   AND amount_ex_vat IS NOT NULL
   AND ABS(amount - amount_ex_vat) <= 0.02;

-- 3c. amount_ex_vat нет, но vat_amount сходится с amount*r/(100+r) → БРУТТО.
UPDATE work_expenses
   SET vat_basis = 'gross'
 WHERE vat_basis IS NULL
   AND COALESCE(vat_amount, 0) > 0
   AND amount_ex_vat IS NULL
   AND vat_rate IS NOT NULL AND vat_rate > 0
   AND ABS(vat_amount - ROUND(amount * vat_rate / (100 + vat_rate), 2)) <= 1;

-- 3d. amount_ex_vat нет, но vat_amount сходится с amount*r/100 → НЕТТО.
UPDATE work_expenses
   SET vat_basis = 'net'
 WHERE vat_basis IS NULL
   AND COALESCE(vat_amount, 0) > 0
   AND amount_ex_vat IS NULL
   AND vat_rate IS NOT NULL AND vat_rate > 0
   AND ABS(vat_amount - ROUND(amount * vat_rate / 100, 2)) <= 1;

-- 3e. НДС не выделен — база фактически «без НДС». Помечаем 'net',
--     чтобы отчёт не пытался очищать сумму от несуществующего НДС.
UPDATE work_expenses
   SET vat_basis = 'net'
 WHERE vat_basis IS NULL
   AND COALESCE(vat_amount, 0) = 0;

-- 3f. Остаток — противоречивые строки. Базу НЕ выдумываем.
--     Их видно запросом ниже; каждая требует сверки с документом.

COMMENT ON COLUMN work_expenses.vat_rate IS
  'Ставка НДС в ПРОЦЕНТАХ: 0/5/10/20/22. NULL = не задана. До V443 встречались доли (0.2) — нормализованы.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА после применения (ожидания в комментариях)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1) Ставки только в процентах:
--    SELECT vat_rate, COUNT(*) FROM work_expenses GROUP BY 1 ORDER BY 1;
--    ОЖИДАНИЕ: только 0 / 5 / 10 / 20 / 22 / NULL. Ни одного значения < 1, кроме 0.
--
-- 2) Все строки с НДС получили базу, кроме противоречивых:
--    SELECT vat_basis, COUNT(*), SUM(amount) FROM work_expenses GROUP BY 1;
--    ОЖИДАНИЕ: NULL — 7 строк (~23,85 млн), это строки под сверку.
--              Ниже список — все 7 должны быть перечислены.
--
-- 3) Противоречивые строки (попадут в отчёт как «требует сверки»):
--    SELECT id, work_id, category, amount, amount_ex_vat, vat_amount, vat_rate, supplier
--      FROM work_expenses
--     WHERE COALESCE(vat_amount,0) > 0
--       AND vat_basis IS NULL
--     ORDER BY amount DESC;
--    ОЖИДАНИЕ на 27.10.2026:
--      5257 |  406 | subcontract | 23 111 014,72  (ПАНХ — внесён как нетто, чинится ручной правкой)
--      7293 |  417 | materials   |    601 456,00
--      7287 |  418 | materials   |     79 200,00
--      7291 | 1941 | materials   |     25 690,00
--      7296 |  424 | materials   |     13 726,00
--      7289 |  424 | materials   |     10 000,00
--      5242 |  406 | materials   |      5 645,00
