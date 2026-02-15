#!/usr/bin/env node

/**
 * ASGARD CRM - Stage 12 Full Test Runner
 *
 * Usage:
 *   node tests/test-all.js                # API + E2E (default)
 *   node tests/test-all.js --api-only     # API tests only
 *   node tests/test-all.js --e2e-only     # E2E business flows only
 *   node tests/test-all.js --smoke-only   # Playwright smoke tests
 *   node tests/test-all.js --all          # All layers
 *   node tests/test-all.js --seed         # Seed test users first
 *   node tests/test-all.js --cleanup      # Remove test users after
 *
 * Environment:
 *   TEST_URL=http://localhost:3000   # Target server
 *   JWT_SECRET=...                   # For token synthesis fallback
 *   DATABASE_URL=...                 # For seed (optional)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const runApi   = args.includes('--all') || args.includes('--api-only') || (!args.some(a => a.startsWith('--') && a.endsWith('-only')));
const runSmoke = args.includes('--all') || args.includes('--smoke-only');
const runE2e   = args.includes('--all') || args.includes('--e2e-only') || (!args.some(a => a.startsWith('--') && a.endsWith('-only')));
const doSeed   = args.includes('--seed');
const doCleanup = args.includes('--cleanup');

const results = { api: [], smoke: [], e2e: [], summary: {} };
const startTime = Date.now();

async function runTestSuite(suite) {
  const out = [];
  console.log(`\n  \u25B8 ${suite.name} (${suite.tests.length} tests)`);

  for (const test of suite.tests) {
    const t0 = Date.now();
    try {
      await test.run();
      const ms = Date.now() - t0;
      process.stdout.write(`    \u2705 ${test.name} (${ms}ms)\n`);
      out.push({ name: test.name, status: 'PASS', ms });
    } catch (err) {
      const ms = Date.now() - t0;
      process.stdout.write(`    \u274C ${test.name}: ${err.message.slice(0, 200)}\n`);
      out.push({ name: test.name, status: 'FAIL', ms, error: err.message.slice(0, 300) });
    }
  }
  return out;
}

async function main() {
  const { BASE_URL } = require('./helpers/api');
  const { initAuth } = require('./helpers/auth');

  console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551   ASGARD CRM - STAGE 12 FULL TEST SUITE      \u2551');
  console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D\n');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Time:   ${new Date().toLocaleString('ru-RU')}`);

  // Optional: seed test users
  if (doSeed) {
    console.log('\n--- SEED ---');
    const { seed } = require('./helpers/seed');
    await seed();
  }

  // Initialize auth tokens
  await initAuth();

  // === LAYER 1: API TESTS ===
  if (runApi) {
    console.log('\n\u2501\u2501\u2501 LAYER 1: API TESTS \u2501\u2501\u2501');

    const apiDir = path.join(__dirname, 'api');
    const apiFiles = fs.readdirSync(apiDir)
      .filter(f => f.endsWith('.test.js'))
      .sort();

    for (const file of apiFiles) {
      try {
        const suite = require(path.join(apiDir, file));
        const r = await runTestSuite(suite);
        results.api.push({ name: suite.name, results: r });
      } catch (err) {
        console.log(`    \u26A0\uFE0F  Failed to load ${file}: ${err.message}`);
        results.api.push({ name: file, results: [{ name: `Load ${file}`, status: 'FAIL', ms: 0, error: err.message }] });
      }
    }
  }

  // === LAYER 2: SMOKE TESTS ===
  if (runSmoke) {
    console.log('\n\u2501\u2501\u2501 LAYER 2: SMOKE TESTS (Playwright) \u2501\u2501\u2501');
    try {
      const smoke = require('./smoke/test-pages.js');
      const smokeResults = await smoke.run();
      results.smoke = smokeResults;
      const pass = smokeResults.filter(r => r.status === 'PASS').length;
      const fail = smokeResults.filter(r => r.status === 'FAIL').length;
      console.log(`\n    \u2705 ${pass} pass / \u274C ${fail} fail`);
    } catch (e) {
      console.log(`    \u26A0\uFE0F  Smoke skipped: ${e.message}`);
      results.smoke = [{ role: 'ALL', route: 'N/A', status: 'SKIP', error: e.message }];
    }
  }

  // === LAYER 3: E2E FLOWS ===
  if (runE2e) {
    console.log('\n\u2501\u2501\u2501 LAYER 3: E2E BUSINESS FLOWS \u2501\u2501\u2501');

    const e2eDir = path.join(__dirname, 'e2e');
    const e2eFiles = fs.readdirSync(e2eDir)
      .filter(f => f.endsWith('.test.js'))
      .sort();

    for (const file of e2eFiles) {
      try {
        const suite = require(path.join(e2eDir, file));
        const r = await runTestSuite(suite);
        results.e2e.push(...r);
      } catch (err) {
        console.log(`    \u26A0\uFE0F  Failed to load ${file}: ${err.message}`);
        results.e2e.push({ name: `Load ${file}`, status: 'FAIL', ms: 0, error: err.message });
      }
    }
  }

  // Optional: cleanup
  if (doCleanup) {
    console.log('\n--- CLEANUP ---');
    const { cleanup } = require('./helpers/seed');
    await cleanup();
  }

  // === SUMMARY ===
  const totalMs = Date.now() - startTime;
  const allTests = [
    ...results.api.flatMap(s => s.results || []),
    ...results.smoke.filter(t => t.status !== 'SKIP'),
    ...results.e2e
  ];
  const pass = allTests.filter(t => t.status === 'PASS').length;
  const fail = allTests.filter(t => t.status === 'FAIL').length;
  const total = allTests.length;

  results.summary = { total, pass, fail, ms: totalMs };

  console.log('\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log(`\u2551  TOTAL: ${pass} \u2705  ${fail} \u274C  of ${total} (${(totalMs / 1000).toFixed(1)}s)`);
  console.log(`\u2551  ${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'}`);
  console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D');

  // Generate HTML report
  const { generateReport } = require('./helpers/report');
  generateReport(results);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('Runner crashed:', e); process.exit(1); });
