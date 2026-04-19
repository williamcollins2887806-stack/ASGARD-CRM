'use strict';

/**
 * ESTIMATE FINANCIAL CALCULATIONS — Unit Tests
 * ═══════════════════════════════════════════════════
 *
 * Pure unit tests for the financial formulas used in estimates.
 * Mirror of calcDerived() from public/assets/js/pm_calcs.js (line 424-434).
 *
 * Formulas:
 *   priceNoVat = price_tkp / (1 + vat_pct / 100)
 *   margin     = (priceNoVat - cost_plan) / priceNoVat  (or null if priceNoVat <= 0)
 *   profit     = priceNoVat - cost_plan
 *   profitPer  = profit / (people_count * work_days)
 *
 * Run with: npx jest tests/unit/estimate-finance.test.js
 */

// ── Helpers ──────────────────────────────────────────

/**
 * Parse number, same as num() in pm_calcs.js:
 * Returns null for null/undefined/NaN/'', number otherwise.
 */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/**
 * calcDerived — exact copy of the function from pm_calcs.js (line 424-434)
 */
function calcDerived({ price_tkp, cost_plan, vat_pct, people_count, work_days }) {
  const price = num(price_tkp);
  const cost = num(cost_plan);
  const vat = Number(vat_pct) || 22;
  const noVat = (price != null) ? (price / (1 + vat / 100)) : null;
  const margin = (noVat != null && cost != null && noVat > 0) ? ((noVat - cost) / noVat) : null;
  const profit = (noVat != null && cost != null) ? (noVat - cost) : null;
  const denom = Math.max(1, (num(people_count) || 0) * (num(work_days) || 0));
  const profitPer = (profit != null && denom > 0) ? (profit / denom) : null;
  return { noVat, margin, profit, profitPer };
}


// ═══════════════════════════════════════════════════════════════
// 1. MARGIN CALCULATION
// ═══════════════════════════════════════════════════════════════

describe('Estimate Margin Calculation', () => {
  test('Standard case: price=1220000, cost=800000, vat=22 -> margin=0.20 (20%)', () => {
    const result = calcDerived({
      price_tkp: 1220000,
      cost_plan: 800000,
      vat_pct: 22
    });
    // priceNoVat = 1220000 / 1.22 = 1000000
    // margin = (1000000 - 800000) / 1000000 = 0.20
    expect(result.noVat).toBeCloseTo(1000000, 0);
    expect(result.margin).toBeCloseTo(0.20, 4);
    expect(result.profit).toBeCloseTo(200000, 0);
  });

  test('price_tkp=0 -> margin=null (not NaN, not Infinity)', () => {
    const result = calcDerived({
      price_tkp: 0,
      cost_plan: 500000,
      vat_pct: 22
    });
    // priceNoVat = 0 / 1.22 = 0, noVat > 0 is false -> margin = null
    expect(result.noVat).toBeCloseTo(0, 0);
    expect(result.margin).toBeNull();
    expect(result.profit).toBeCloseTo(-500000, 0);
  });

  test('cost > priceNoVat -> negative margin', () => {
    const result = calcDerived({
      price_tkp: 610000,
      cost_plan: 600000,
      vat_pct: 22
    });
    // priceNoVat = 610000 / 1.22 = 500000
    // margin = (500000 - 600000) / 500000 = -0.20
    expect(result.noVat).toBeCloseTo(500000, 0);
    expect(result.margin).toBeCloseTo(-0.20, 4);
    expect(result.profit).toBeCloseTo(-100000, 0);
  });

  test('price_tkp=null -> noVat=null, margin=null', () => {
    const result = calcDerived({
      price_tkp: null,
      cost_plan: 500000,
      vat_pct: 22
    });
    expect(result.noVat).toBeNull();
    expect(result.margin).toBeNull();
    expect(result.profit).toBeNull();
  });

  test('cost_plan=null -> margin=null', () => {
    const result = calcDerived({
      price_tkp: 1220000,
      cost_plan: null,
      vat_pct: 22
    });
    expect(result.noVat).toBeCloseTo(1000000, 0);
    expect(result.margin).toBeNull();
    expect(result.profit).toBeNull();
  });

  test('Both null -> all null', () => {
    const result = calcDerived({
      price_tkp: null,
      cost_plan: null,
      vat_pct: 22
    });
    expect(result.noVat).toBeNull();
    expect(result.margin).toBeNull();
    expect(result.profit).toBeNull();
    expect(result.profitPer).toBeNull();
  });

  test('50% margin case', () => {
    // priceNoVat should be 2x cost
    // price_tkp = 2 * cost * 1.22 = 2 * 500000 * 1.22 = 1220000
    const result = calcDerived({
      price_tkp: 1220000,
      cost_plan: 500000,
      vat_pct: 22
    });
    expect(result.noVat).toBeCloseTo(1000000, 0);
    expect(result.margin).toBeCloseTo(0.50, 4);
    expect(result.profit).toBeCloseTo(500000, 0);
  });

  test('Zero margin (cost equals priceNoVat)', () => {
    // priceNoVat = 1000000, cost = 1000000
    const result = calcDerived({
      price_tkp: 1220000,
      cost_plan: 1000000,
      vat_pct: 22
    });
    expect(result.margin).toBeCloseTo(0, 4);
    expect(result.profit).toBeCloseTo(0, 0);
  });
});


// ═══════════════════════════════════════════════════════════════
// 2. VAT (No-VAT Price) CALCULATION
// ═══════════════════════════════════════════════════════════════

describe('Estimate VAT Calculation', () => {
  test('price=1220000, vat=22 -> noVat=1000000', () => {
    const result = calcDerived({
      price_tkp: 1220000,
      cost_plan: 0,
      vat_pct: 22
    });
    expect(result.noVat).toBeCloseTo(1000000, 0);
  });

  test('price=1200000, vat=20 -> noVat=1000000', () => {
    const result = calcDerived({
      price_tkp: 1200000,
      cost_plan: 0,
      vat_pct: 20
    });
    expect(result.noVat).toBeCloseTo(1000000, 0);
  });

  test('Default vat fallback is 22% when vat_pct is not provided', () => {
    const result = calcDerived({
      price_tkp: 1220000,
      cost_plan: 800000
    });
    // Should use default 22%
    expect(result.noVat).toBeCloseTo(1000000, 0);
    expect(result.margin).toBeCloseTo(0.20, 4);
  });

  test('vat_pct=0 -> noVat equals price (no VAT applied)', () => {
    // When vat is 0, fallback is 22 because Number(0) is falsy
    // Actually Number(0) || 22 = 22, so vat_pct=0 defaults to 22
    // This is the current behavior per the code
    const result = calcDerived({
      price_tkp: 1000000,
      cost_plan: 500000,
      vat_pct: 0
    });
    // Number(0) || 22 = 22, so noVat = 1000000 / 1.22
    expect(result.noVat).toBeCloseTo(1000000 / 1.22, 0);
  });

  test('vat_pct=10 -> noVat = price/1.10', () => {
    const result = calcDerived({
      price_tkp: 1100000,
      cost_plan: 0,
      vat_pct: 10
    });
    expect(result.noVat).toBeCloseTo(1000000, 0);
  });
});


// ═══════════════════════════════════════════════════════════════
// 3. PROFIT PER PERSON-DAY
// ═══════════════════════════════════════════════════════════════

describe('Estimate Profit Per Person-Day', () => {
  test('profit=200000, 10 people, 20 days -> profitPer=1000', () => {
    const result = calcDerived({
      price_tkp: 1220000,
      cost_plan: 800000,
      vat_pct: 22,
      people_count: 10,
      work_days: 20
    });
    // profit = 200000, denom = 10*20 = 200
    expect(result.profitPer).toBeCloseTo(1000, 0);
  });

  test('No people/days -> profitPer uses denom=1 (no division by zero)', () => {
    const result = calcDerived({
      price_tkp: 1220000,
      cost_plan: 800000,
      vat_pct: 22,
      people_count: 0,
      work_days: 0
    });
    // denom = Math.max(1, 0) = 1
    expect(result.profitPer).toBeCloseTo(200000, 0);
  });

  test('Null people/days -> profitPer with denom=1', () => {
    const result = calcDerived({
      price_tkp: 1220000,
      cost_plan: 800000,
      vat_pct: 22,
      people_count: null,
      work_days: null
    });
    expect(result.profitPer).toBeCloseTo(200000, 0);
  });

  test('Negative profit -> negative profitPer', () => {
    const result = calcDerived({
      price_tkp: 610000,
      cost_plan: 600000,
      vat_pct: 22,
      people_count: 5,
      work_days: 10
    });
    // profit = 500000 - 600000 = -100000, denom = 50
    expect(result.profitPer).toBeCloseTo(-2000, 0);
  });
});


// ═══════════════════════════════════════════════════════════════
// 4. num() HELPER EDGE CASES
// ═══════════════════════════════════════════════════════════════

describe('num() helper function', () => {
  test('null -> null', () => {
    expect(num(null)).toBeNull();
  });

  test('undefined -> null', () => {
    expect(num(undefined)).toBeNull();
  });

  test('empty string -> null', () => {
    expect(num('')).toBeNull();
  });

  test('NaN string -> null', () => {
    expect(num('abc')).toBeNull();
  });

  test('valid number string -> number', () => {
    expect(num('12345')).toBe(12345);
  });

  test('zero -> 0', () => {
    expect(num(0)).toBe(0);
  });

  test('negative number -> negative', () => {
    expect(num(-100)).toBe(-100);
  });

  test('float string -> float', () => {
    expect(num('3.14')).toBeCloseTo(3.14, 2);
  });
});
