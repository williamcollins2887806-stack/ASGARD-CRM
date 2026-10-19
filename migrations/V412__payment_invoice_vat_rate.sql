-- V412: ставка НДС в заявке на оплату (заказчик 19.10.2026).
--
-- «НДС у нас не только 22% бывает и 5 и 0 и 10».
-- Раньше в payment_invoices была только СУММА НДС (vat_amount) без СТАВКИ —
-- нельзя было ни проверить начисление, ни показать «НДС 5%» в карточке.
--
-- Ставки РФ: 22% (основная с 2026), 20% (до 2026), 10% (льготная),
-- 5% и 7% (УСН-спецрежимы), 0% (экспорт/не облагается).
-- `vat_rate` = NULL означает «без НДС» (не путать с 0% — это разные вещи).

ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS vat_rate numeric(6,2),
  ADD COLUMN IF NOT EXISTS amount_net numeric(16,2);

COMMENT ON COLUMN payment_invoices.vat_rate IS
  'V412: ставка НДС в процентах (22/20/10/7/5/0). NULL — без НДС.';
COMMENT ON COLUMN payment_invoices.amount_net IS
  'V412: сумма без НДС. Для «без НДС» равна amount.';

-- Заполняем ставку у существующих счетов, где есть сумма НДС.
-- t = gross × r/(100+r)  →  r = 100 × t/(gross − t)
UPDATE payment_invoices
   SET vat_rate = ROUND(100 * vat_amount / NULLIF(amount - vat_amount, 0), 2)
 WHERE vat_rate IS NULL
   AND vat_amount IS NOT NULL AND vat_amount > 0
   AND amount IS NOT NULL AND amount > vat_amount;

-- Нетто = сумма минус НДС (там, где ещё не заполнено).
UPDATE payment_invoices
   SET amount_net = ROUND(amount - COALESCE(vat_amount, 0), 2)
 WHERE amount_net IS NULL AND amount IS NOT NULL;
