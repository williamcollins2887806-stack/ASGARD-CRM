-- V392 down: возврат ограничения kind к advance/salary.
-- Идемпотентно. Записи других типов переклассифицируются в 'salary',
-- иначе ALTER не пройдёт.

DO $$
BEGIN
  UPDATE payout_batch_items SET kind = 'salary'
   WHERE kind IN ('bonus', 'penalty', 'per_diem');
  ALTER TABLE payout_batch_items DROP CONSTRAINT IF EXISTS chk_pbi_kind;
  ALTER TABLE payout_batch_items
    ADD CONSTRAINT chk_pbi_kind
    CHECK (kind IN ('advance', 'salary'));
END $$;

DELETE FROM settings WHERE key = 'payout_mark_paid_limit';
