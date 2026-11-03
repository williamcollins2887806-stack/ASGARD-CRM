#!/usr/bin/env node
'use strict';
/**
 * Unit: resolveAssignmentRates — канон ₽ с 01.11 (без двойного ×500).
 * Запуск: node tests/field-assignment-rate-rub.test.js
 */
const assert = require('assert');
const {
  resolveAssignmentRates,
  snapRubStep10,
  isRubStep10,
  DEFAULT_POINT_VALUE
} = require('../src/lib/field-assignment-rate');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  OK', name);
  } catch (e) {
    failed++;
    console.log('  FAIL', name, '—', e.message);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  OK', name);
  } catch (e) {
    failed++;
    console.log('  FAIL', name, '—', e.message);
  }
}

check('snapRubStep10', () => {
  assert.strictEqual(snapRubStep10(6513), 6510);
  assert.strictEqual(snapRubStep10(6515), 6520);
  assert.strictEqual(snapRubStep10(-1), 0);
});

check('isRubStep10', () => {
  assert.strictEqual(isRubStep10(6500), true);
  assert.strictEqual(isRubStep10(6510), true);
  assert.strictEqual(isRubStep10(6513), false);
});

check('DEFAULT_POINT_VALUE legacy', () => {
  assert.strictEqual(DEFAULT_POINT_VALUE, 500);
});

function mockDb(tariffRows, comboRows) {
  return {
    async query(sql, params) {
      if (/is_combinable/.test(sql)) {
        const ids = params[0] || [];
        return { rows: (comboRows || []).filter((r) => ids.includes(Number(r.id))) };
      }
      return { rows: tariffRows || [] };
    }
  };
}

(async () => {
  await checkAsync('manual_extra_rub без ×500', async () => {
    const db = mockDb([{
      id: 1, rate_per_shift: 6500, points: 13, point_value: 500, category: 'ground', is_active: true
    }], [{ id: 99, rate_per_shift: 500, points: 1, is_combinable: true, is_active: true }]);
    const r = await resolveAssignmentRates(db, {
      tariff_id: 1,
      combo_tariff_ids: [99],
      manual_extra_rub: 500
    });
    assert.ok(!r.error);
    assert.strictEqual(r.baseRate, 6500);
    assert.strictEqual(r.manualRate, 500);
    assert.strictEqual(r.comboRate, 0);
    assert.strictEqual(r.totalRate, 7000);
  });

  await checkAsync('day_rate_rub=база + manual — без DOUBLE', async () => {
    const db = mockDb([{
      id: 1, rate_per_shift: 6500, points: 13, point_value: 500, is_active: true
    }]);
    const r = await resolveAssignmentRates(db, {
      tariff_id: 1,
      day_rate_rub: 6500,
      manual_extra_rub: 500
    });
    assert.strictEqual(r.totalRate, 7000, 'ожидали 6500+500, не 6500+500+500');
  });

  await checkAsync('day_rate_rub перекрывает базу тарифа', async () => {
    const db = mockDb([{
      id: 1, rate_per_shift: 6500, points: 13, point_value: 500, is_active: true
    }]);
    const r = await resolveAssignmentRates(db, {
      tariff_id: 1,
      day_rate_rub: 8010,
      manual_extra_rub: 0
    });
    assert.strictEqual(r.totalRate, 8010);
  });

  await checkAsync('legacy manual_extra_points × pv', async () => {
    const db = mockDb([{
      id: 1, rate_per_shift: 6500, points: 13, point_value: 500, is_active: true
    }]);
    const r = await resolveAssignmentRates(db, {
      tariff_id: 1,
      manual_extra_points: 2
    });
    assert.strictEqual(r.manualRate, 1000);
    assert.strictEqual(r.totalRate, 7500);
  });

  console.log(`\nИтого: ${passed} pass, ${failed} fail`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
