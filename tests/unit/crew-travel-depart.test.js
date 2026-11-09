'use strict';

const assert = require('assert');
const {
  isTravelDepartCooled,
  TRAVEL_DEPART_COOLING_DAYS,
  DEPART_REASON
} = require('../../src/services/crew-travel-depart-cron');

assert.strictEqual(TRAVEL_DEPART_COOLING_DAYS, 2, 'cooling = 2 days');
assert.ok(/отъезд/i.test(DEPART_REASON), 'reason mentions отъезд');

const today = '2026-11-09';

assert.strictEqual(
  isTravelDepartCooled('2026-11-09', '2026-11-09', today),
  false,
  'same day not cooled'
);
assert.strictEqual(
  isTravelDepartCooled('2026-11-08', '2026-11-08', today),
  false,
  'yesterday not cooled (need 2d)'
);
assert.strictEqual(
  isTravelDepartCooled('2026-11-07', '2026-11-07', today),
  true,
  '2 days ago cooled'
);
assert.strictEqual(
  isTravelDepartCooled('2026-11-07', '2026-11-08', today),
  false,
  'created yesterday blocks even if travel 2d ago'
);
assert.strictEqual(
  isTravelDepartCooled('2026-11-07', null, today),
  true,
  'missing created_at still cools by travel date'
);
assert.strictEqual(
  isTravelDepartCooled(null, '2026-11-01', today),
  false,
  'no travel date'
);

console.log('ok crew-travel-depart unit');
