-- V439: D-381 — договоры субподряда с лимитом существенности для ОБС.
--
-- ЗАДАЧА (заказчик 27.10.2026). У АСГАРД два действующих договора субподряда
-- с ООО «ГСП Ремонт», и у каждого свой лимит существенности:
--   • КР-433п26 от 11.08.2026 — 3 000 000 ₽ (более свежий);
--   • КР320п26 от 04.05.2026 — 1 500 000 ₽.
-- Письмо для ОБС всегда пишется «под конкретный договор»: в тексте должно
-- стоять основание именно того договора, по которому идёт расход. Раньше
-- договор брался «какой найдётся» — и в письме оказывалось не то основание.
--
-- Дополнительно директор и бухгалтерия должны видеть ОСТАТОК лимита по
-- каждому договору. Если лимит выработан — ОБС по этому договору запрещён:
-- расход идёт другим путём.
--
-- ЧТО ЗДЕСЬ:
--   1. Таблица договоров субподряда с лимитом.
--   2. Привязка строки реестра к договору (`subcontract_id`).
--   3. Функция остатка лимита (учитывает уже проведённые через ОБС суммы).
--
-- Идемпотентна.

-- 1. Договоры субподряда с лимитом существенности.
CREATE TABLE IF NOT EXISTS subcontract_agreements (
  id               SERIAL PRIMARY KEY,
  number           TEXT NOT NULL,
  agreement_date   DATE NOT NULL,
  customer_name    TEXT,
  customer_inn     TEXT,
  work_id          INTEGER REFERENCES works(id) ON DELETE SET NULL,
  limit_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency         VARCHAR(3) NOT NULL DEFAULT 'RUB',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (number, agreement_date)
);

COMMENT ON TABLE subcontract_agreements IS
  'D-381: договоры субподряда с ООО «ГСП Ремонт» и лимитом существенности. '
  'Лимит считается отдельно по каждому договору; письмо для ОБС пишется под конкретный договор.';

-- 2. Привязка строки реестра к договору субподряда.
ALTER TABLE doc_registry
  ADD COLUMN IF NOT EXISTS subcontract_id INTEGER REFERENCES subcontract_agreements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_doc_registry_subcontract
  ON doc_registry (subcontract_id)
  WHERE deleted_at IS NULL AND subcontract_id IS NOT NULL;

-- 3. Два действующих договора (данные от заказчика 27.10.2026).
INSERT INTO subcontract_agreements (number, agreement_date, customer_name, work_id, limit_amount, note)
VALUES
  ('КР320п26',  '2026-05-04', 'ООО «ГСП Ремонт»', 417, 1500000.00,
   'Договор субподряда, лимит существенности 1,5 млн ₽'),
  ('КР-433п26', '2026-08-11', 'ООО «ГСП Ремонт»', 417, 3000000.00,
   'Договор субподряда (более свежий), лимит существенности 3 млн ₽')
ON CONFLICT (number, agreement_date) DO UPDATE
  SET limit_amount = EXCLUDED.limit_amount,
      customer_name = EXCLUDED.customer_name,
      note = EXCLUDED.note,
      updated_at = NOW();

-- 4. Функция: сколько уже проведено через ОБС по договору и сколько осталось.
--    Считаем ТОЛЬКО ОБС-расходы: лимит существенности регулирует именно
--    оплату через ОБС, обычные платежи с расчётного счёта его не расходуют.
--
--    D-381 (дефект от проверки 27.10.2026): при формировании письма счёт,
--    на который письмо и делается, попадал в «использовано ранее» — то есть
--    сам себя учитывал. Теперь исключается необязательный p_exclude_doc_id:
--    письмо считается по состоянию ДО этого счёта.
DROP FUNCTION IF EXISTS subcontract_limit_state(INTEGER);
DROP FUNCTION IF EXISTS subcontract_limit_state(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION subcontract_limit_state(
  p_subcontract_id INTEGER,
  p_exclude_doc_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
  subcontract_id INTEGER,
  number         TEXT,
  limit_amount   NUMERIC(14,2),
  spent_amount   NUMERIC(14,2),
  remaining      NUMERIC(14,2),
  used_pct       NUMERIC(6,2),
  exhausted      BOOLEAN
) AS $$
  SELECT
    a.id,
    a.number,
    a.limit_amount,
    COALESCE(SUM(d.amount_gross) FILTER (
      WHERE d.payment_source = 'obs'
        AND d.deleted_at IS NULL
        AND (p_exclude_doc_id IS NULL OR d.id <> p_exclude_doc_id)
    ), 0)::NUMERIC(14,2) AS spent_amount,
    (a.limit_amount - COALESCE(SUM(d.amount_gross) FILTER (
      WHERE d.payment_source = 'obs'
        AND d.deleted_at IS NULL
        AND (p_exclude_doc_id IS NULL OR d.id <> p_exclude_doc_id)
    ), 0))::NUMERIC(14,2) AS remaining,
    CASE WHEN a.limit_amount > 0
      THEN LEAST(9999.99, ROUND(COALESCE(SUM(d.amount_gross) FILTER (
             WHERE d.payment_source = 'obs'
               AND d.deleted_at IS NULL
               AND (p_exclude_doc_id IS NULL OR d.id <> p_exclude_doc_id)), 0)
           / a.limit_amount * 100, 2))::NUMERIC(6,2)
      ELSE 0 END::NUMERIC(6,2) AS used_pct,
    (COALESCE(SUM(d.amount_gross) FILTER (
       WHERE d.payment_source = 'obs'
         AND d.deleted_at IS NULL
         AND (p_exclude_doc_id IS NULL OR d.id <> p_exclude_doc_id)
     ), 0) >= a.limit_amount) AS exhausted
  FROM subcontract_agreements a
  LEFT JOIN doc_registry d ON d.subcontract_id = a.id
  WHERE a.id = p_subcontract_id
  GROUP BY a.id, a.number, a.limit_amount;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION subcontract_limit_state(INTEGER, INTEGER) IS
  'D-381: остаток лимита существенности по договору субподряда. '
  'Учитывает только расходы с payment_source=obs. p_exclude_doc_id исключает '
  'текущий счёт, чтобы он не считался «использованным ранее» в своём же письме.';

-- 5. Разово привязать уже существующие ОБС-счета АГПЗ к КР320п26,
--    если они шли по нему (в письмах основание — этот договор).
UPDATE doc_registry d
   SET subcontract_id = a.id, updated_at = NOW()
  FROM subcontract_agreements a
 WHERE a.number = 'КР320п26'
   AND d.subcontract_id IS NULL
   AND d.work_id = 417
   AND d.payment_source = 'obs'
   AND d.contract_label ILIKE '%320%';
