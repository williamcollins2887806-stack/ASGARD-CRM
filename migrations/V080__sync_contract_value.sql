-- V080: Синхронизация суммы контракта между tenders и works
--
-- SSoT (Single Source of Truth):
--   До выигрыша: tenders.tender_price — единственный источник
--   После выигрыша: works.contract_value — основной, синкается в tender_price
--
-- Триггер 1: works.contract_value изменился → обновить tenders.tender_price
-- Триггер 2: tenders.tender_price изменился → обновить works.contract_value (если work есть)
--
-- Защита от рекурсии: pg_trigger_depth() > 1 → пропустить

-- 1. works → tenders
CREATE OR REPLACE FUNCTION sync_contract_value_to_tender()
RETURNS TRIGGER AS $$
BEGIN
  -- Защита от рекурсии
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  -- Только если contract_value реально изменился
  IF NEW.contract_value IS DISTINCT FROM OLD.contract_value AND NEW.tender_id IS NOT NULL THEN
    UPDATE tenders SET
      tender_price = NEW.contract_value,
      updated_at = NOW()
    WHERE id = NEW.tender_id
      AND (tender_price IS DISTINCT FROM NEW.contract_value);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_contract_to_tender ON works;
CREATE TRIGGER trg_sync_contract_to_tender
AFTER UPDATE ON works
FOR EACH ROW EXECUTE FUNCTION sync_contract_value_to_tender();

-- 2. tenders → works
CREATE OR REPLACE FUNCTION sync_tender_price_to_work()
RETURNS TRIGGER AS $$
BEGIN
  -- Защита от рекурсии
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  -- Только если tender_price реально изменился
  IF NEW.tender_price IS DISTINCT FROM OLD.tender_price THEN
    UPDATE works SET
      contract_value = NEW.tender_price,
      updated_at = NOW()
    WHERE tender_id = NEW.id
      AND (contract_value IS DISTINCT FROM NEW.tender_price);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_tender_price_to_work ON tenders;
CREATE TRIGGER trg_sync_tender_price_to_work
AFTER UPDATE ON tenders
FOR EACH ROW EXECUTE FUNCTION sync_tender_price_to_work();

-- 3. При создании work из тендера — скопировать tender_price в contract_value (если пусто)
CREATE OR REPLACE FUNCTION sync_contract_on_work_create()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tender_id IS NOT NULL AND (NEW.contract_value IS NULL OR NEW.contract_value = 0) THEN
    SELECT tender_price INTO NEW.contract_value
    FROM tenders WHERE id = NEW.tender_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_contract_on_create ON works;
CREATE TRIGGER trg_sync_contract_on_create
BEFORE INSERT ON works
FOR EACH ROW EXECUTE FUNCTION sync_contract_on_work_create();

COMMENT ON FUNCTION sync_contract_value_to_tender() IS 'V080: works.contract_value → tenders.tender_price';
COMMENT ON FUNCTION sync_tender_price_to_work() IS 'V080: tenders.tender_price → works.contract_value';
COMMENT ON FUNCTION sync_contract_on_work_create() IS 'V080: при создании work — копировать tender_price';
