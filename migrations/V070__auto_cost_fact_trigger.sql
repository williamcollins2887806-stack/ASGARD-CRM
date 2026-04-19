-- V070: Auto-update works.cost_fact when work_expenses change
-- cost_fact = SUM(amount) from work_expenses for each work
-- This ensures cost_fact is always synchronized with actual expenses

CREATE OR REPLACE FUNCTION update_work_cost_fact()
RETURNS TRIGGER AS $$
DECLARE
  _work_id INTEGER;
  _total NUMERIC;
BEGIN
  -- Determine which work_id was affected
  IF TG_OP = 'DELETE' THEN
    _work_id := OLD.work_id;
  ELSE
    _work_id := NEW.work_id;
  END IF;

  -- Skip if work_id is null
  IF _work_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Calculate total expenses for this work
  SELECT COALESCE(SUM(amount), 0) INTO _total
  FROM work_expenses
  WHERE work_id = _work_id;

  -- Update cost_fact on works table
  UPDATE works SET cost_fact = _total WHERE id = _work_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_work_expenses_cost_fact ON work_expenses;

-- Create trigger for INSERT, UPDATE, DELETE
CREATE TRIGGER trg_work_expenses_cost_fact
AFTER INSERT OR UPDATE OF amount OR DELETE
ON work_expenses
FOR EACH ROW
EXECUTE FUNCTION update_work_cost_fact();

-- Initialize: sync cost_fact for all works that have expenses
UPDATE works w SET cost_fact = sub.total
FROM (
  SELECT work_id, SUM(amount) AS total
  FROM work_expenses
  GROUP BY work_id
) sub
WHERE w.id = sub.work_id AND (w.cost_fact IS NULL OR w.cost_fact != sub.total);
