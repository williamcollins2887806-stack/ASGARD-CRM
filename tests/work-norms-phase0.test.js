#!/usr/bin/env node
'use strict';

/**
 * Phase 0 unit tests — без PostgreSQL.
 * previewCalc golden с БД: см. tests/fixtures/work-norms-preview-golden.json
 * и будущий интеграционный прогон на asgard_crm_test.
 *
 * Запуск: node tests/work-norms-phase0.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const wn = require(path.join(__dirname, '..', 'src', 'services', 'work-norms.js'));
const golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'work-norms-preview-golden.json'), 'utf8')
);

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}

ok(wn.metricToCalcKind('plates_per_shift') === 'per_unit_shift', 'plates_per_shift → per_unit_shift');
ok(wn.metricToCalcKind('joints_per_shift') === 'per_unit_shift', 'joints_per_shift → per_unit_shift');
ok(wn.metricToCalcKind('min_per_tube') === 'min_per_unit', 'min_per_tube → min_per_unit');
ok(wn.metricToCalcKind('days_per_section') === 'days_per_unit', 'days_per_section → days_per_unit');

for (const c of golden.cases) {
  if (c.metric && c.expected_calc_kind) {
    ok(
      wn.metricToCalcKind(c.metric) === c.expected_calc_kind,
      `${c.id}: metric ${c.metric}`
    );
  }
}

const fitCase = golden.cases.find((c) => c.id === 'fit_two_points');
const fit = wn.fitRateFromPoints(fitCase.points);
ok(Math.abs(fit.setup_days - fitCase.expected_setup_days) < 0.05, 'fit setup_days');
ok(Math.abs(fit.productivity - fitCase.expected_productivity) < 0.5, 'fit productivity');

const nl = golden.cases.find((c) => c.id === 'nonlinear_setup_flow');
const workDays = Math.ceil(nl.params.setup_days + nl.inputs.qty / nl.params.productivity);
ok(workDays === nl.expected_work_days, 'nonlinear formula stub');

(async () => {
  const mockRates = [
    { id: 1, category_code: 'tubes', method_code: 'gdo', code: 'tubes_gdo_shift', calc_kind: 'per_unit_shift', sort_order: 1 },
    { id: 2, category_code: 'tubes', method_code: 'gmo', code: 'tubes_gmo_shift', calc_kind: 'per_unit_shift', sort_order: 1 },
    { id: 99, category_code: 'tubes', method_code: null, code: 'wrong_no_method', calc_kind: 'per_unit_shift', sort_order: 0 }
  ];
  const db = {
    async query(sql, params) {
      if (sql.includes('work_norm_categories')) {
        return {
          rows: [{
            code: 'tubes',
            methods_json: [{ code: 'gdo', primary_rate_code: 'tubes_gdo_shift' }]
          }]
        };
      }
      if (sql.includes('FROM work_norm_rates') && sql.includes('target_rate_id')) {
        return { rows: [] };
      }
      if (sql.includes('id = $1') && params[0] === 2) {
        return { rows: [mockRates[1]] };
      }
      if (sql.includes('code = $2') && params[1] === 'tubes_gdo_shift') {
        return { rows: [mockRates[0]] };
      }
      if (sql.includes('method_code IS NOT DISTINCT FROM')) {
        const method = params[1];
        const kind = params[2];
        const hit = mockRates.find((r) => r.method_code === method && r.calc_kind === kind);
        return { rows: hit ? [hit] : [] };
      }
      return { rows: [] };
    }
  };

  const expPrimary = {
    category_code: 'tubes',
    method_code: 'gdo',
    derived_metric: 'min_per_tube',
    target_rate_id: null
  };
  const r1 = await wn.findRateForPublish(db, expPrimary, {
    calcKind: 'min_per_unit',
    code: 'exp_tubes_min_per_tube'
  });
  ok(r1 && r1.code === 'tubes_gdo_shift', 'publish match prefers primary_rate_code');

  const expTarget = { ...expPrimary, target_rate_id: 2, method_code: 'gdo' };
  const r2 = await wn.findRateForPublish(db, expTarget, { calcKind: 'per_unit_shift', code: 'x' });
  ok(r2 && r2.id === 2, 'publish match target_rate_id first');

  const expMethod = {
    category_code: 'tubes',
    method_code: 'gmo',
    derived_metric: 'tubes_per_shift',
    target_rate_id: null
  };
  const r3 = await wn.findRateForPublish(db, expMethod, {
    calcKind: 'per_unit_shift',
    code: 'exp_tubes_tubes_per_shift'
  });
  ok(r3 && r3.method_code === 'gmo', 'publish requires method match, not first calc_kind');

  console.log('work-norms-phase0: ' + passed + ' assertions OK');
  console.log('Note: live previewCalc golden requires DB clone — not run here.');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
