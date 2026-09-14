'use strict';

const assert = require('assert');
const { isHomeRoadCooled, HOME_SPLIT_COOLING_DAYS } = require('../../src/lib/mlsp-stay');

assert.strictEqual(HOME_SPLIT_COOLING_DAYS, 1);

assert.strictEqual(isHomeRoadCooled('2026-09-01', '2026-09-01', '2026-09-01'), false, 'same day not cooled');
assert.strictEqual(isHomeRoadCooled('2026-08-31', '2026-09-01', '2026-09-01'), false, 'created today not cooled');
assert.strictEqual(isHomeRoadCooled('2026-08-31', '2026-08-31', '2026-09-01'), true, 'yesterday mark cooled');
assert.strictEqual(isHomeRoadCooled('2026-07-17', '2026-07-17', '2026-09-01'), true, 'historical from_site cooled');
assert.strictEqual(isHomeRoadCooled(null, '2026-08-31', '2026-09-01'), false, 'no travel date');
assert.strictEqual(isHomeRoadCooled('2026-08-31', null, '2026-09-01'), true, 'missing created_at still cools by travel date');

console.log('mlsp-stay-home-split: OK');
