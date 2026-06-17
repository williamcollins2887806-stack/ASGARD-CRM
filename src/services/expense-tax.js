/**
 * Единая логика 55%-нагрузки и НДС-вычета для work_expenses.
 *
 * До этого было два расходящихся места:
 *   - src/routes/works.js:815 — по category (legacy)
 *   - src/services/expense-recognize.js:308 — по payment_method (V081)
 * Из-за чего desktop-отчёт и Мимир-Кошелёк показывали РАЗНЫЙ tax_burden / маржу
 * на одной и той же работе. Этот модуль закрывает расхождение.
 *
 * Логика 55% (страховые/НДФЛ/обналичка):
 *   1. Если у записи есть `payment_method` — используем его (canonical post-V081):
 *      - cash | card                                → 55%
 *      - auto + category IN (fot, per_diem, payroll) → 55%
 *      - bank | self                                → 0% (счёт с НДС, либо самозанятый)
 *   2. Если `payment_method` пустой (legacy, до V081) — fallback по category:
 *      - payroll | fot | cash | per_diem | subcontract → 55%
 *      - всё прочее → 0%
 *
 * Логика НДС к вычету:
 *   - Только если `vat_amount > 0` в записи (значит был счёт-фактура).
 *   - НЕ синтезируем НДС из amount — иначе наличка из «Красного&Белого»
 *     даёт фантомный вычет и завышает маржу.
 *
 * Тесты см. tests/expense-tax.test.js.
 */

const TAX_PAYMENT_METHODS = new Set(['cash', 'card']);
const TAX_AUTO_CATEGORIES = new Set(['fot', 'per_diem', 'payroll']);
const TAX_LEGACY_CATEGORIES = new Set(['payroll', 'fot', 'cash', 'per_diem', 'subcontract']);

/**
 * @param {{category?: string|null, payment_method?: string|null}} expense
 * @returns {boolean} нужно ли начислить 55% на эту запись
 */
function isTaxableExpense(expense) {
  if (!expense) return false;
  const cat = String(expense.category || '').toLowerCase();
  const method = String(expense.payment_method || '').toLowerCase();

  // 1. Если payment_method заполнен — canonical путь (post-V081)
  if (method) {
    if (TAX_PAYMENT_METHODS.has(method)) return true;
    if (method === 'auto' && TAX_AUTO_CATEGORIES.has(cat)) return true;
    return false; // bank | self | прочее — 55% не начисляем
  }

  // 2. Legacy fallback по category (записи до V081, payment_method == NULL)
  return TAX_LEGACY_CATEGORIES.has(cat);
}

/**
 * Сумма НДС к вычету по одной записи.
 * @param {{vat_amount?: number|string|null}} expense
 * @returns {number}
 */
function calcVatDeductible(expense) {
  if (!expense) return 0;
  const v = Number(expense.vat_amount);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
}

/**
 * 55% нагрузка по одной записи (округлено до копеек).
 * @param {{amount?: number|string, category?: string|null, payment_method?: string|null}} expense
 * @param {number} [taxRatePct=55]
 * @returns {number}
 */
function calcTaxBurden(expense, taxRatePct = 55) {
  if (!isTaxableExpense(expense)) return 0;
  const amount = parseFloat(expense?.amount) || 0;
  return Math.round((amount * taxRatePct) / 100 * 100) / 100;
}

/**
 * Аггрегирует массив записей: возвращает totals (без округления каждого шага).
 * @param {Array} expenses
 * @param {number} [taxRatePct=55]
 * @returns {{total: number, taxBurden: number, vatDeductible: number}}
 */
function aggregate(expenses, taxRatePct = 55) {
  let total = 0;
  let taxBurden = 0;
  let vatDeductible = 0;
  for (const e of expenses || []) {
    const amt = parseFloat(e.amount) || 0;
    total += amt;
    taxBurden += calcTaxBurden(e, taxRatePct);
    vatDeductible += calcVatDeductible(e);
  }
  return {
    total: Math.round(total * 100) / 100,
    taxBurden: Math.round(taxBurden * 100) / 100,
    vatDeductible: Math.round(vatDeductible * 100) / 100,
  };
}

module.exports = {
  TAX_PAYMENT_METHODS,
  TAX_AUTO_CATEGORIES,
  TAX_LEGACY_CATEGORIES,
  isTaxableExpense,
  calcVatDeductible,
  calcTaxBurden,
  aggregate,
};
