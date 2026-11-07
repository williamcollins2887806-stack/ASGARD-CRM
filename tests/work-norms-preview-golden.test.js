#!/usr/bin/env node
'use strict';

/**
 * Загружает golden fixture и прогоняет детерминированные проверки без БД.
 * Полный previewCalc — только на клоне БД (см. комментарий в fixture).
 *
 * Запуск: node tests/work-norms-preview-golden.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const wn = require(path.join(__dirname, '..', 'src', 'services', 'work-norms.js'));
const golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'work-norms-preview-golden.json'), 'utf8')
);

let n = 0;
for (const c of golden.cases) {
  if (c.metric && c.expected_calc_kind) {
    assert.strictEqual(
      wn.metricToCalcKind(c.metric),
      c.expected_calc_kind,
      c.id
    );
    n++;
  }
  if (c.points) {
    const fit = wn.fitRateFromPoints(c.points);
    assert.ok(fit.productivity > 0, c.id + ' productivity');
    n++;
  }
}

console.log('work-norms-preview-golden: ' + n + ' checks OK (DB previewCalc not executed)');
