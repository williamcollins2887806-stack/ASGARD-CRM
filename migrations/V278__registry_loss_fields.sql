-- Registry loss modal fields (mockup v3)
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS loss_winner_price NUMERIC,
  ADD COLUMN IF NOT EXISTS loss_reasons JSONB;

COMMENT ON COLUMN tenders.loss_winner_price IS 'Сумма победителя при проигрыше (реестр)';
COMMENT ON COLUMN tenders.loss_reasons IS 'Массив id причин проигрыша из модалки реестра';
