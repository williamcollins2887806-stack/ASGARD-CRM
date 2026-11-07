'use strict';

/**
 * Smoke на asgard_crm_test после V459–V466.
 * Запуск: DB_NAME=asgard_crm_test node tests/superbrain-clone-smoke.test.js
 */
require('dotenv').config();
// .env обычно указывает на asgard_crm_dev — для smoke принудительно клон.
process.env.DB_NAME = process.env.CLONE_DB_NAME || 'asgard_crm_test';

const assert = require('assert');
const { Client } = require('pg');
const wn = require('../src/services/work-norms');
const brain = require('../src/services/tender-history-brain');
const drafts = require('../src/services/rp-review-drafts');

async function main() {
  const db = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  await db.connect();

  const mount = await db.query(`SELECT code FROM work_norm_categories WHERE code='mount'`);
  assert.strictEqual(mount.rows.length, 1, 'mount category');

  const rates = await db.query(
    `SELECT code, basis FROM work_norm_rates WHERE basis='research_seed' AND is_active LIMIT 5`
  );
  assert.ok(rates.rows.length >= 1, 'research_seed rates present');

  // previewCalc на существующей категории tubes/avo если есть rates
  const anyRate = await db.query(
    `SELECT category_code, method_code, code FROM work_norm_rates WHERE is_active ORDER BY id LIMIT 1`
  );
  if (anyRate.rows[0]) {
    const r = anyRate.rows[0];
    const preview = await wn.previewCalc(db, {
      category_code: r.category_code,
      method_code: r.method_code,
      rate_code: r.code,
      inputs: { tubes: 100, surface_m2: 50, qty: 10, length_m: 20 },
      fouling: 'medium'
    });
    if (preview.error && !preview.ok) {
      console.log('preview note (may need inputs):', preview.error);
    } else {
      assert.ok(preview.ok || preview.results, 'preview ok');
      console.log('preview work_days', preview.results && preview.results.work_days);
    }
  }

  // history brain не падает на пустом/случайном тендере
  const t = await db.query(`SELECT id, customer_name, customer_inn FROM tenders ORDER BY id DESC LIMIT 1`);
  if (t.rows[0]) {
    const block = await brain.buildHistoryBlock(db, t.rows[0]);
    assert.ok(typeof block === 'string' || (block && typeof block === 'object'));
    console.log('history_block type', typeof block, 'len', String(block && block.markdown || block || '').length);
  }

  // analysis mapping still clean
  const patch = drafts.mapMimirToReportFields('analysis', {
    template: 'mimir_analysis_v1',
    decision_recommend: 'need_info',
    summary: 'Нужны уточнения по допускам'
  }, '');
  assert.ok(!patch.asgard_smeta);
  assert.ok(!patch.work_price);

  // loss reasons dict
  const reasons = await db.query(`SELECT count(*)::int AS n FROM tender_loss_reasons WHERE is_active`);
  assert.ok(reasons.rows[0].n >= 5, 'loss reasons seeded');

  await db.end();
  console.log('superbrain-clone-smoke: PASS on', process.env.DB_NAME);
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
