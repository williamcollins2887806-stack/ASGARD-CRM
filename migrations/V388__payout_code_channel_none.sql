-- V388: payout_confirmation_codes.channel — разрешить 'none'.
-- ═══════════════════════════════════════════════════════════════════════════
-- Если код создан, но ни MAX, ни SMS не доставлены (нет креденшелов/сбои),
-- ранее в channel писалось 'sms' (недостоверно). Теперь честно пишем 'none'.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pcc_channel') THEN
    ALTER TABLE payout_confirmation_codes DROP CONSTRAINT chk_pcc_channel;
  END IF;
  ALTER TABLE payout_confirmation_codes
    ADD CONSTRAINT chk_pcc_channel CHECK (channel IN ('sms','max','none'));
END $$;
