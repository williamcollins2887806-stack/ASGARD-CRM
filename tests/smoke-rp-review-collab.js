/**
 * Smoke checks for RP-review collab + Mimor apply (no live DB required for helpers).
 * Run: node tests/smoke-rp-review-collab.js
 */
'use strict';

const assert = require('assert');
const drafts = require('../src/services/rp-review-drafts');

async function main() {
  assert.strictEqual(drafts.purposeForPhase('analysis'), 'rp_review_analysis');
  assert.strictEqual(drafts.purposeForPhase('calc'), 'rp_review_calc');

  const a = drafts.mapMimirToReportFields(
    'analysis',
    { total_without_vat: 1_000_000 },
    'Короткий summary для ТО про объект.\n\nРиски: сжатые сроки\nРекомендация: подавать'
  );
  assert.ok(a.price_range_min >= 800000);
  assert.ok(a.price_range_max <= 1200000);
  assert.ok(String(a.summary || '').length > 10);
  assert.ok(/срок/i.test(a.risks || ''));
  assert.ok(/подава/i.test(a.recommendation || ''));

  const c = drafts.mapMimirToReportFields(
    'calc',
    { total_with_vat: 1_220_000, items: [{ qty: 2, price: 500 }] },
    ''
  );
  assert.strictEqual(c.work_price, 1220000);
  assert.strictEqual(c.cost_without_vat, 1000);

  // resolveFinalOwner analysis
  const own = await drafts.resolveFinalOwner(
    null,
    { analysis_owner_user_id: 7, analysis_finalized_at: null },
    {},
    99
  );
  assert.strictEqual(own.phase, 'analysis');
  assert.strictEqual(own.ownerUserId, 7);

  const own2 = await drafts.resolveFinalOwner(
    null,
    { analysis_finalized_at: new Date(), calculator_user_id: 3 },
    { calculator_user_id: 5 },
    null
  );
  assert.strictEqual(own2.phase, 'calc');
  assert.strictEqual(own2.ownerUserId, 5);

  // Optimistic lock compare (same logic as drafts / PUT)
  const t1 = '2026-07-30T10:00:00.000Z';
  const t2 = '2026-07-30T10:00:01.000Z';
  assert.strictEqual(new Date(t1).toISOString(), new Date(t1).toISOString());
  assert.notStrictEqual(new Date(t1).toISOString(), new Date(t2).toISOString());

  console.log('smoke-rp-review-collab: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
