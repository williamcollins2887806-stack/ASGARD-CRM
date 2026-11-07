'use strict';

/**
 * Clone smoke for Superbrain close-out (asgard_crm_test).
 * DB_NAME forced to test clone.
 */
require('dotenv').config();
process.env.DB_NAME = 'asgard_crm_test';
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'test';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const drafts = require('../src/services/rp-review-drafts');
const smeta = require('../src/services/asgard-smeta');
const wn = require('../src/services/work-norms');

async function main() {
  const root = path.join(__dirname, '..');

  // Analysis never writes money
  const patch = drafts.mapMimirToReportFields('analysis', {
    template: 'mimir_analysis_v1',
    decision_recommend: 'go',
    summary: 'Подаём по срокам и допускам.',
    volume_summary: '2 аппарата',
    risks: 'доступ',
    total_without_vat: 999999
  }, '');
  assert.ok(!patch.asgard_smeta);
  assert.ok(patch.price_range_min == null);
  assert.ok(!patch.work_price);

  // Artifacts present
  const verified = fs.readFileSync(path.join(root, 'tests/reports/norms-web/verified.jsonl'), 'utf8')
    .trim().split(/\n/).filter(Boolean);
  assert.ok(verified.length >= 100, 'verified lines >= 100, got ' + verified.length);

  const calib = JSON.parse(
    fs.readFileSync(path.join(root, 'tests/fixtures/work-norms-calib-expert-150.json'), 'utf8')
  );
  const items = calib.items || calib;
  assert.ok(Array.isArray(items) && items.length >= 150, 'calib >= 150');

  assert.ok(fs.existsSync(path.join(root, 'tests/reports/norms-web/HUMAN-SAMPLE-15.md')));
  assert.ok(fs.existsSync(path.join(root, 'tests/reports/TENDERGURU-OUTCOME-PROBE.md')));

  const db = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'asgard_crm_test'
  });
  await db.connect();

  const cols = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='work_norm_experiences' AND column_name='source_kind'
  `);
  assert.ok(cols.rows.length === 1, 'V459 source_kind present');

  // Import first 20 calib as draft experiences (soft — skip bad categories)
  let imported = 0;
  for (const it of items.slice(0, 20)) {
    try {
      const story = String(it.story_text || it.object_label || 'calib import').slice(0, 2000);
      if (story.length < 5) continue;
      await wn.createExperience(db, {
        category_code: it.category_code,
        method_code: it.method_code || null,
        object_label: it.object_label || null,
        diameter_mm: it.diameter_mm != null ? Number(it.diameter_mm) : null,
        fouling: it.fouling || null,
        volume_value: it.volume_value != null ? Number(it.volume_value) : (it.qty != null ? Number(it.qty) : null),
        volume_unit: it.volume_unit || null,
        calendar_days: it.calendar_days != null ? Number(it.calendar_days) : null,
        shift_mode: it.shift_mode || 2,
        crew_masters: it.crew_masters || 1,
        crew_exec: it.crew_exec || 3,
        story_text: story,
        source_kind: 'calib',
        extras_json: { from: 'superbrain-e2e', url: it.url || null }
      }, { id: null, name: 'e2e' });
      imported += 1;
    } catch (e) {
      // category may not exist for some calib rows — skip
    }
  }
  console.log('imported_draft_experiences', imported);
  assert.ok(imported >= 5, 'at least 5 calib drafts imported');

  // previewCalc smoke if rate exists
  const rate = await db.query(`SELECT category_code, method_code, code FROM work_norm_rates WHERE is_active LIMIT 1`);
  if (rate.rows[0]) {
    const p = await wn.previewCalc(db, {
      category_code: rate.rows[0].category_code,
      method_code: rate.rows[0].method_code,
      rate_code: rate.rows[0].code,
      inputs: { tubes: 100, surface_m2: 40, qty: 5, length_m: 20 },
      fouling: 'medium'
    });
    console.log('preview', p.ok ? p.results && p.results.work_days : p.error);
  }

  // G/H still in cost
  const est = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { work_days: 5, markup: 2 },
    mtr: [
      { name: 'Компрессор', qty: 1, price: 100000, source: 'purchase' },
      { name: 'Кран', qty: 1, price: 20000, source: 'rent' }
    ]
  });
  assert.strictEqual(est.totals.equipment_purchase, 100000);
  assert.strictEqual(est.totals.equipment_rental, 20000);

  await db.end();
  console.log('superbrain-e2e-clone: PASS');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
