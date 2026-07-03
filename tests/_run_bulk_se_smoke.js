#!/usr/bin/env node
/**
 * Минимальный runner для прогона ТОЛЬКО наших 2 тест-файлов:
 *   tests/api/se-bulk.test.js
 *   tests/api/handovers-manual.test.js
 *
 * Использует tests/config.js (initRealUsers + хелперы api/assert).
 * BASE_URL берётся из env TEST_BASE_URL (по умолчанию https://92.242.61.184).
 *
 * Запуск:
 *   TEST_BASE_URL=http://127.0.0.1:3100 node tests/_run_bulk_se_smoke.js
 */

'use strict';

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED:', err);
  process.exit(2);
});

(async () => {
  const path = require('path');
  const { SkipError, initRealUsers, BASE_URL } = require('./config');

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  BULK SE TRANSFERS — SMOKE on CLONE          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Time:   ${new Date().toISOString()}\n`);

  // Re-seed test users (если возможно)
  try {
    const seed = require('./helpers/seed');
    if (typeof seed === 'function') await seed();
    else if (typeof seed.seed === 'function') await seed.seed();
    console.log('  [seed] OK');
  } catch (e) {
    console.log('  [seed] Skipped:', (e.message || '').slice(0, 80));
  }

  try {
    await initRealUsers();
    console.log('  [users] initRealUsers OK\n');
  } catch (e) {
    console.error('  [users] FATAL initRealUsers:', e.message);
    process.exit(2);
  }

  const FILES = [
    'api/se-bulk.test.js',
    'api/handovers-manual.test.js'
  ];

  const summary = { total: 0, pass: 0, fail: 0, skip: 0, files: [] };

  for (const rel of FILES) {
    const file = path.join(__dirname, rel);
    console.log(`━━━ ${rel} ━━━`);
    let suite;
    try {
      suite = require(file);
    } catch (e) {
      console.log(`  ❌ LOAD FAIL: ${e.message}`);
      summary.fail++;
      summary.total++;
      summary.files.push({ file: rel, status: 'LOAD_FAIL', error: e.message });
      continue;
    }
    const tests = Array.isArray(suite.tests) ? suite.tests : [];
    console.log(`  Suite: ${suite.name || rel} (${tests.length} tests)\n`);

    const fileRes = { file: rel, pass: 0, fail: 0, skip: 0, items: [] };

    for (const t of tests) {
      const t0 = Date.now();
      try {
        await t.run();
        const ms = Date.now() - t0;
        console.log(`    ✅ ${t.name} (${ms}ms)`);
        fileRes.pass++;
        summary.pass++;
        fileRes.items.push({ name: t.name, status: 'PASS', ms });
      } catch (err) {
        const ms = Date.now() - t0;
        if (err instanceof SkipError || (err && err.name === 'SkipError')) {
          console.log(`    ⏭  ${t.name}: SKIP — ${err.message}`);
          fileRes.skip++;
          summary.skip++;
          fileRes.items.push({ name: t.name, status: 'SKIP', ms, error: err.message });
        } else {
          const msg = (err && err.message ? err.message : String(err)).slice(0, 250);
          console.log(`    ❌ ${t.name} (${ms}ms)\n        ${msg}`);
          fileRes.fail++;
          summary.fail++;
          fileRes.items.push({ name: t.name, status: 'FAIL', ms, error: msg });
        }
      }
      summary.total++;
    }
    summary.files.push(fileRes);
    console.log(`  → ${fileRes.pass} pass / ${fileRes.fail} fail / ${fileRes.skip} skip\n`);
  }

  console.log('═══════════════════════════════════════════════');
  console.log(` TOTAL: ${summary.total} tests`);
  console.log(`   ✅ PASS: ${summary.pass}`);
  console.log(`   ❌ FAIL: ${summary.fail}`);
  console.log(`   ⏭  SKIP: ${summary.skip}`);
  console.log('═══════════════════════════════════════════════');

  // Сохраняем JSON отчёт
  try {
    const fs = require('fs');
    const out = path.join(__dirname, '..', '_bulk_se_smoke_results.json');
    fs.writeFileSync(out, JSON.stringify(summary, null, 2));
    console.log(`\n  JSON report: ${out}`);
  } catch (_) {}

  process.exit(summary.fail > 0 ? 1 : 0);
})();
