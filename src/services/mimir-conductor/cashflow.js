/**
 * ASGARD CRM — Mimir Conductor: модель денежного потока (Сессия 7)
 * ═══════════════════════════════════════════════════════════════════════════
 * Чистый Node-расчёт (без LLM) кэш-флоу подрядного проекта: аванс, удержания,
 * отсрочка оплаты, банковская гарантия, стоимость оборотного капитала, налог
 * на прибыль и чистая прибыль. Используется агентом financial_modeler.
 *
 * Упрощённая помесячная модель: затраты равномерно распределены по сроку,
 * выручка приходит аванс (в начале) + остаток с учётом отсрочки и удержания.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const DAYS_IN_MONTH = 30;

/**
 * Помесячная модель кэш-флоу.
 * @param {Object} p
 * @param {number} p.contract_value — цена контракта (с НДС или без — единообразно)
 * @param {number} p.total_cost — полная себестоимость
 * @param {number} p.duration_days — срок проекта
 * @param {number} [p.advance_pct=30] — аванс, %
 * @param {number} [p.retention_pct=5] — гарантийное удержание, %
 * @param {number} [p.payment_terms_days=45] — отсрочка оплаты по актам
 * @param {boolean} [p.bg_required=true] — требуется ли банковская гарантия
 * @param {number} [p.bg_rate_annual=0.04] — ставка БГ годовых
 * @param {number} [p.working_capital_rate=0.20] — стоимость оборотки годовых
 * @param {number} [p.profit_tax_rate=0.20] — налог на прибыль
 * @returns {Object} модель + ключевые метрики
 */
function computeCashFlow({
  contract_value,
  total_cost,
  duration_days,
  advance_pct = 30,
  retention_pct = 5,
  payment_terms_days = 45,
  bg_required = true,
  bg_rate_annual = 0.04,
  working_capital_rate = 0.20,
  profit_tax_rate = 0.20
}) {
  const cv = Number(contract_value) || 0;
  const cost = Number(total_cost) || 0;
  const durDays = Math.max(DAYS_IN_MONTH, Number(duration_days) || DAYS_IN_MONTH);
  const months = Math.max(1, Math.ceil(durDays / DAYS_IN_MONTH));

  const advance = cv * (advance_pct / 100);
  const retentionAmount = cv * (retention_pct / 100);
  // Выручка к получению по актам (за вычетом аванса и удержания).
  const progressRevenue = cv - advance - retentionAmount;

  const monthlyCost = cost / months;
  const monthlyProgress = progressRevenue / months;
  const paymentLagMonths = Math.ceil(payment_terms_days / DAYS_IN_MONTH);

  // Помесячный баланс: на старте приходит аванс; затраты каждый месяц; выручка
  // по актам приходит с лагом paymentLagMonths; удержание — в конце.
  const timeline = [];
  let balance = 0;
  let maxGap = 0;
  const totalMonths = months + paymentLagMonths + 1;
  for (let m = 0; m < totalMonths; m++) {
    let inflow = 0;
    let outflow = 0;
    if (m === 0) inflow += advance;
    if (m < months) outflow += monthlyCost;
    // Выручка по актам месяца (m - lag).
    const progressMonth = m - paymentLagMonths;
    if (progressMonth >= 0 && progressMonth < months) inflow += monthlyProgress;
    // Удержание возвращается в самом конце.
    if (m === totalMonths - 1) inflow += retentionAmount;

    balance += inflow - outflow;
    if (balance < maxGap) maxGap = balance;
    timeline.push({
      month: m + 1,
      inflow: Math.round(inflow),
      outflow: Math.round(outflow),
      balance: Math.round(balance)
    });
  }

  const maxCashGap = Math.abs(Math.min(0, maxGap));
  const projectYears = durDays / 365;

  // Стоимость банковской гарантии: процент от аванса (и/или контракта) за срок.
  const bgBase = bg_required ? Math.max(advance, cv * 0.1) : 0;
  const bgTotalCost = bg_required ? bgBase * bg_rate_annual * Math.max(projectYears, payment_terms_days / 365) : 0;

  // Стоимость оборотного капитала: финансирование кассового разрыва за срок.
  const workingCapitalCost = maxCashGap * working_capital_rate * Math.max(projectYears, 0.25);

  // Прибыль до налога: цена − себестоимость − БГ − оборотка.
  const grossProfit = cv - cost;
  const profitBeforeTax = grossProfit - bgTotalCost - workingCapitalCost;
  const profitTax = profitBeforeTax > 0 ? profitBeforeTax * profit_tax_rate : 0;
  const netProfit = profitBeforeTax - profitTax;

  const round = (x) => Math.round(x);
  return {
    contract_value: round(cv),
    total_cost: round(cost),
    duration_days: durDays,
    months,
    advance_pct,
    advance: round(advance),
    retention_pct,
    retention_amount: round(retentionAmount),
    payment_terms_days,
    bg_required: !!bg_required,
    bg_total_cost: round(bgTotalCost),
    working_capital_cost: round(workingCapitalCost),
    max_cash_gap: round(maxCashGap),
    gross_profit: round(grossProfit),
    profit_before_tax: round(profitBeforeTax),
    profit_tax: round(profitTax),
    net_profit: round(netProfit),
    roi_pct: cost > 0 ? Math.round((grossProfit / cost) * 1000) / 10 : 0,
    roi_after_tax_pct: cost > 0 ? Math.round((netProfit / cost) * 1000) / 10 : 0,
    net_margin_pct: cv > 0 ? Math.round((netProfit / cv) * 1000) / 10 : 0,
    timeline
  };
}

module.exports = { computeCashFlow };
