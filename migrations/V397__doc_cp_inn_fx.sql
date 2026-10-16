-- ============================================================================
-- V397: Doc Hub — ИНН контрагента и курсы для валютных счетов.
-- ----------------------------------------------------------------------------
-- Зачем:
--   • Антидубль и акты сверки требуют ИНН на строке реестра, а не только
--     supplier_id (план F4: ключ (inn|norm_name, number, date, amount, currency)).
--   • Валютные счета (план F8): нужен курс и дата курса, иначе USD/EUR
--     «схлопнется» в рубль и может ложно склеиться с рублёвым счётом.
-- Идемпотентно, аддитивно. Down — V397__..._down.sql.
-- ============================================================================

ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS counterparty_inn VARCHAR(20);
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(14,6);
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS fx_rate_date DATE;

-- Backfill ИНН из карточки поставщика (где связь уже есть).
UPDATE doc_registry d
   SET counterparty_inn = s.inn
  FROM suppliers s
 WHERE d.supplier_id = s.id
   AND (d.counterparty_inn IS NULL OR d.counterparty_inn = '')
   AND s.inn IS NOT NULL AND s.inn <> '';

-- Backfill ИНН по точному совпадению нормализованного имени (осторожно:
-- только когда такое имя однозначно указывает на одного поставщика с ИНН).
UPDATE doc_registry d
   SET counterparty_inn = sub.inn
  FROM (
    SELECT lower(trim(name)) AS nm, min(inn) AS inn, count(DISTINCT inn) AS n
      FROM suppliers WHERE inn IS NOT NULL AND inn <> '' AND deleted_at IS NULL
     GROUP BY 1 HAVING count(DISTINCT inn) = 1
  ) sub
 WHERE (d.counterparty_inn IS NULL OR d.counterparty_inn = '')
   AND lower(trim(coalesce(d.counterparty_name, ''))) = sub.nm;

-- Нормализованный индекс под антидубль/акты.
CREATE INDEX IF NOT EXISTS idx_doc_cp_inn ON doc_registry (counterparty_inn)
  WHERE deleted_at IS NULL AND counterparty_inn IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doc_cp_inn_date
  ON doc_registry (counterparty_inn, invoice_date)
  WHERE deleted_at IS NULL AND counterparty_inn IS NOT NULL;

COMMENT ON COLUMN doc_registry.counterparty_inn IS
  'V397: ИНН контрагента на строке (для антидубля и актов сверки; F4 плана).';
COMMENT ON COLUMN doc_registry.fx_rate IS
  'V397: курс валюты к рублю на дату операции (валютные счета; F8 плана).';
