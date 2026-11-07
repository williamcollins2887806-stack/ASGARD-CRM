'use strict';

/**
 * Phase 6 unit/sentinel gates (без живого LLM и без обязательной БД).
 * Полный clone E2E — отдельно, когда asgard_crm_test поднят.
 */
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'test-unit-skip';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const smeta = require('../src/services/asgard-smeta');
const tech = require('../src/services/rp-tech-plan');
const drafts = require('../src/services/rp-review-drafts');
const wn = require('../src/services/work-norms');
const brain = require('../src/services/tender-history-brain');
const enrich = require('../src/services/tender-outcome-enrich');
const tg = require('../src/services/tenderguru-client');
const learner = require('../src/services/mimir-conductor/reference-learner');

// --- A1: analysis never writes money ---
{
  const patch = drafts.mapMimirToReportFields('analysis', {
    template: 'mimir_analysis_v1',
    decision_recommend: 'go',
    summary: 'Подаём: сроки и допуски позволяют.',
    volume_summary: '2 аппарата, 800 труб',
    risks: 'доступ',
    feasibility: 'ок',
    competition: 'средняя',
    total_without_vat: 999999,
    totals: { total_without_vat: 999999, cost: 500000 }
  }, '');
  assert.strictEqual(patch.asgard_smeta, undefined);
  assert.strictEqual(patch.price_range_min, undefined);
  assert.strictEqual(patch.work_price, undefined);
  assert.strictEqual(patch.decision_recommend, 'go');
  assert.ok(patch.summary);
}

// --- A5 GAP-3: G/H enter cost ---
{
  const est = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { work_days: 10, shifts_per_day: 2, workers_per_shift: 6, masters_per_shift: 1, markup: 2.0 },
    mtr: [
      { name: 'Компрессор', qty: 1, price: 500000, source: 'purchase' },
      { name: 'Автокран', qty: 2, price: 45000, source: 'rent' }
    ]
  });
  assert.strictEqual(est.totals.equipment_purchase, 500000);
  assert.strictEqual(est.totals.equipment_rental, 90000);
  assert.ok(est.totals.cost >= 590000, 'cost includes G+H');
}

// --- A5 GAP-4/6: purchases_needed + role_code ---
{
  const plan = tech.buildTechPlan({
    estimate: {
      purchases_needed: [{ name: 'Насос хим', qty: 1, price: 120000, source: 'purchase' }],
      crew: [{ role: 'Сварщик НАКС', role_code: 'welder', count: 2 }]
    },
    smeta: {},
    filledBy: 'mimir'
  });
  assert.ok(plan.mtr.some((m) => /Насос/.test(m.name)));
  assert.ok(plan.crew.some((c) => c.role_code === 'welder'));
  const withSmeta = tech.applyToSmeta({ template: 'asgard_v1', params: { work_days: 5 } }, plan);
  assert.ok(withSmeta.totals.equipment_purchase >= 120000);
  const aWelder = (withSmeta.rows || []).some((r) => r.crewRole === 'welder' || /свар/i.test(r.name || ''));
  assert.ok(aWelder, 'welder row present');
}

// --- Phase 0 helpers ---
assert.strictEqual(wn.metricToCalcKind('plates_per_shift'), 'per_unit_shift');
assert.ok(typeof wn.applyNormPatch === 'function');
assert.ok(typeof wn.fitRateFromPoints === 'function');
assert.ok(typeof brain.buildHistoryBlock === 'function');
assert.ok(typeof enrich.enrichLostTenders === 'function' || typeof enrich.enrichTenderOutcome === 'function');
assert.ok(typeof tg.fetchContracts === 'function');
assert.ok(typeof learner.learnFromTenderOutcome === 'function');

// --- prompts / migrations present ---
const root = path.join(__dirname, '..');
assert.ok(fs.existsSync(path.join(root, 'templates/prompts/PROMPT-analysis-v1.md')));
for (const v of ['V459', 'V460', 'V461', 'V462', 'V463', 'V464', 'V465', 'V466']) {
  const files = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.startsWith(v + '__') && !f.includes('_down'));
  assert.ok(files.length >= 1, 'migration ' + v);
}

console.log('superbrain-phase6-unit: PASS');
