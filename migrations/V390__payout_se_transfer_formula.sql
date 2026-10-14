-- V390: Формула перевода для самозанятых + галка «переводим официально».
-- ═══════════════════════════════════════════════════════════════════════════
-- 1) worker_payments.official_transfer — была ли выплата помечена «переводим
--    официально» (для не-СЗ: +15% к переведённой сумме, канал «банк»).
--
-- 2) settings — коэффициенты пересчёта «выплата → реальный перевод»:
--    Самозанятые (площадка ReStaff):
--      переводим = выплата × 1.064            (то, что видит рабочий)
--      реальный перевод = выплата × (1+c)/(1-c) × (1+НДС), где
--        c   = payout_se_commission_rate     (комиссия ReStaff 3.5%)
--        НДС = payout_se_vat_rate            (НДС 22%)
--      т.е. для 100 000 ₽: рабочему 106 400 ₽, реальный перевод 135 216,67 ₽.
--    Наличные «официально»:
--      переводим = выплата × (1 + payout_official_markup_rate)  (+15%)
--
-- Значения в настройках, а не в коде: ставки меняются без деплоя.
-- Идемпотентно: ADD COLUMN IF NOT EXISTS, ON CONFLICT (key) DO NOTHING.

ALTER TABLE worker_payments
  ADD COLUMN IF NOT EXISTS official_transfer BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS info_amount NUMERIC(12,2);

COMMENT ON COLUMN worker_payments.official_transfer IS
  'V390: выплата помечена «переводим официально» (не-СЗ, +15% к переводу, канал банк).';
COMMENT ON COLUMN worker_payments.info_amount IS
  'V390: сумма, которую видит рабочий в приложении (СЗ: X × 1.064). Реальный перевод хранится в transfer_amount.';

--   Однако применяется не пересборка ставок, а сам коэффициент (ТЗ заказчика),
--   чтобы система считала ровно ту сумму, что согласована с площадкой. Ставки
--   хранятся для прозрачности в UI/аудите.
INSERT INTO settings (key, value_json, updated_at) VALUES
  ('payout_se_commission_rate',   '0.035',            NOW()),  -- комиссия СЗ-сервиса (ReStaff)
  ('payout_se_vat_rate',          '0.22',             NOW()),  -- НДС на перевод
  ('payout_se_info_coef',         '1.064',            NOW()),  -- показываем рабочему: X × 1.064
  ('payout_se_transfer_coef',     '1.3521666667',     NOW()),  -- (1.064/0.96)×1.22 — реальный перевод
  ('payout_official_markup_rate', '0.15',             NOW())   -- «официально»: X × 1.15
ON CONFLICT (key) DO NOTHING;

-- Удобный индекс под отчёты по официальным переводам (идемпотентно).
CREATE INDEX IF NOT EXISTS idx_wp_official_transfer
  ON worker_payments (official_transfer)
  WHERE official_transfer IS TRUE;
