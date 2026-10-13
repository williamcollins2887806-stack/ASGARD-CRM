-- V388 down: вернуть исходный CHECK (sms|max).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pcc_channel') THEN
    ALTER TABLE payout_confirmation_codes DROP CONSTRAINT chk_pcc_channel;
  END IF;
  ALTER TABLE payout_confirmation_codes
    ADD CONSTRAINT chk_pcc_channel CHECK (channel IN ('sms','max'));
END $$;
