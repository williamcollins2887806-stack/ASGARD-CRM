-- V390 down: откат формулы перевода СЗ и галки «официально».
-- Идемпотентно. Настройки удаляются только если их не переопределяли вручную
-- (значения откатываются к «до V390» — ключей не было вовсе).

DROP INDEX IF EXISTS idx_wp_official_transfer;

ALTER TABLE worker_payments
  DROP COLUMN IF EXISTS official_transfer,
  DROP COLUMN IF EXISTS info_amount;

DELETE FROM settings WHERE key IN (
  'payout_se_commission_rate',
  'payout_se_vat_rate',
  'payout_se_info_coef',
  'payout_se_transfer_coef',
  'payout_official_markup_rate'
);
