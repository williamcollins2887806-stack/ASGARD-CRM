'use strict';

/**
 * Пакет чат-калибровки (1=A): структура + fit на парах small/big.
 * Импорт в БД: POST /api/work-norms/experiences/batch с этим JSON (после логина).
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { fitRateFromPoints, metricToCalcKind } = require('../src/services/work-norms');

const batch = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/work-norms-calib-batch-v1.json'), 'utf8')
);

assert.ok(batch.items.length >= 50, 'пакет ≥50 сценариев');
assert.strictEqual(batch.meta.source_kind, 'calib');

for (const it of batch.items) {
  assert.ok(it.category_code, 'category_code');
  assert.ok(it.story_text && it.story_text.length >= 10, 'story_text');
  assert.ok(Number(it.calendar_days) > 0, 'calendar_days');
  assert.ok(Number(it.volume_value) > 0 || Number(it.qty) > 0, 'volume');
}

const tubePair = batch.items.filter(
  (x) => x.category_code === 'tubes' && x.diameter_mm === 20 && x.fouling === 'medium'
    && (x.object_label.includes('Малый') || x.object_label.includes('Большой'))
);
assert.ok(tubePair.length >= 2, 'есть пара small/big для fit');
const points = tubePair.map((x) => ({
  qty: Number(x.volume_value),
  days: Number(x.calendar_days),
  fouling: x.fouling
}));
const fit = fitRateFromPoints(points);
assert.ok(fit.setup_days != null && Number.isFinite(fit.setup_days), 'fit setup_days');
assert.ok(fit.productivity == null || fit.productivity > 0, 'fit productivity');

assert.strictEqual(metricToCalcKind('plates_per_shift'), 'per_unit_shift');
assert.strictEqual(metricToCalcKind('min_per_tube'), 'min_per_unit');

console.log('work-norms-calib-batch: OK items=', batch.items.length, 'fit=', fit);
