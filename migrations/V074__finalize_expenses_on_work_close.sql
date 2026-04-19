-- V074: При закрытии работы (status → 'Завершена' / 'Закрыт') все авто-расходы становятся is_finalized=TRUE
-- Это защищает от изменений при последующих правках field_checkins/worker_payments.
-- Ручные расходы (source_table='manual' или NULL) тоже помечаются is_finalized.

CREATE OR REPLACE FUNCTION finalize_work_expenses_on_close()
RETURNS TRIGGER AS $$
BEGIN
  -- При переходе в финальный статус
  IF NEW.work_status IN ('Завершена', 'Закрыт', 'Работы сдали')
     AND (OLD.work_status IS NULL OR OLD.work_status NOT IN ('Завершена', 'Закрыт', 'Работы сдали'))
  THEN
    UPDATE work_expenses
    SET is_finalized = TRUE
    WHERE work_id = NEW.id AND is_finalized = FALSE;
  END IF;

  -- Обратно: при открытии работы (из закрытой → в активную) — расходы снова редактируемые
  IF NEW.work_status NOT IN ('Завершена', 'Закрыт', 'Работы сдали')
     AND OLD.work_status IN ('Завершена', 'Закрыт', 'Работы сдали')
  THEN
    UPDATE work_expenses
    SET is_finalized = FALSE
    WHERE work_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_finalize_work_expenses ON works;
CREATE TRIGGER trg_finalize_work_expenses
AFTER UPDATE OF work_status ON works
FOR EACH ROW EXECUTE FUNCTION finalize_work_expenses_on_close();
