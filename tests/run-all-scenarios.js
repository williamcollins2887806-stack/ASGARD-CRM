#!/usr/bin/env node
/**
 * ASGARD CRM — Run ALL Playwright E2E Scenarios (1-28)
 * Includes original 21 + 7 new scenarios for added CRM features
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Ensure screenshots and reports dirs exist
const DIRS = {
  screenshots: path.join(__dirname, 'screenshots'),
  reports: path.join(__dirname, 'reports'),
};
for (const d of Object.values(DIRS)) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// All scenario files
const SCENARIO_FILES = [
  '01-tender-lifecycle.js',
  '02-work-management.js',
  '03-finance-pipeline.js',
  '04-cash-workflow.js',
  '05-hr-compliance.js',
  '06-equipment-warehouse.js',
  '07-communication.js',
  '08-admin-settings.js',
  '09-tkp-invoices.test.js',
  '10-pagination.test.js',
  '11-tasks-archive.test.js',
  '12-permits-compliance.test.js',
  '13-training-applications.test.js',
  '14-tender-full-lifecycle.test.js',
  '15-cash-cross-role.test.js',
  '16-hr-permits-flow.test.js',
  '17-work-multi-role.test.js',
  '18-equipment-procurement.test.js',
  '19-contracts-correspondence.test.js',
  '20-tasks-calendar-meetings.test.js',
  '21-director-reports.test.js',
  '22-pretender-approval-workflow.test.js',
  '23-invoice-auto-numbering.test.js',
  '24-pdf-templates.test.js',
  '25-pagination-all-pages.test.js',
  '26-dadata-autocomplete.test.js',
  '27-dashboard-widgets.test.js',
  '28-all-buttons-modals.test.js',
  '29-staff-request-lifecycle.test.js',
  '30-full-ui-audit.test.js',
  '31-deep-button-audit.test.js',
];

// Parse CLI args
const args = process.argv.slice(2);
const onlyNew = args.includes('--new');       // Run only 22-28
const onlyOld = args.includes('--old');       // Run only 01-21
const specificStr = args.find(a => a.startsWith('--only='));
const specificNums = specificStr ? specificStr.replace('--only=', '').split(',').map(Number) : null;
const verbose = args.includes('--verbose') || args.includes('-v');

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ASGARD CRM — Playwright E2E Test Suite (31 Scenarios)  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Start: ${new Date().toLocaleString()}\n`);

  let scenariosToRun = SCENARIO_FILES;
  if (onlyNew) {
    scenariosToRun = SCENARIO_FILES.filter(f => parseInt(f) >= 22);
    console.log('Running NEW scenarios only (22-28)\n');
  } else if (onlyOld) {
    scenariosToRun = SCENARIO_FILES.filter(f => parseInt(f) <= 21);
    console.log('Running original scenarios only (01-21)\n');
  } else if (specificNums) {
    scenariosToRun = SCENARIO_FILES.filter(f => {
      const num = parseInt(f);
      return specificNums.includes(num);
    });
    console.log(`Running specific scenarios: ${specificNums.join(', ')}\n`);
  }

  // Load scenarios
  const scenarios = [];
  for (const file of scenariosToRun) {
    const fullPath = path.join(__dirname, 'scenarios', file);
    if (!fs.existsSync(fullPath)) {
      console.log(`  ⚠ Scenario file not found: ${file}`);
      continue;
    }
    try {
      const mod = require(fullPath);
      scenarios.push({ file, mod, name: mod.name || file });
    } catch (e) {
      console.log(`  ⚠ Failed to load ${file}: ${e.message}`);
    }
  }

  console.log(`Loaded ${scenarios.length} scenarios\n`);

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const allResults = [];
  let passed = 0;
  let failed = 0;
  let totalSteps = 0;
  let passedSteps = 0;
  let failedSteps = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[${i + 1}/${scenarios.length}] ${sc.name}`);
    console.log('─'.repeat(60));

    const context = {};
    let result;

    try {
      result = await sc.mod.run(browser, context);
    } catch (e) {
      result = {
        name: sc.name,
        status: 'FAILED',
        steps: [{ name: 'initialization', status: 'FAILED', error: e.message?.substring(0, 300) }],
        duration: 0,
        error: e.message?.substring(0, 500),
      };
    }

    allResults.push(result);

    // Print step results
    const stepsPassed = (result.steps || []).filter(s => s.status === 'PASSED').length;
    const stepsFailed = (result.steps || []).filter(s => s.status === 'FAILED').length;
    const stepsTotal = (result.steps || []).length;

    totalSteps += stepsTotal;
    passedSteps += stepsPassed;
    failedSteps += stepsFailed;

    for (const step of (result.steps || [])) {
      const icon = step.status === 'PASSED' ? '✓' : step.status === 'FAILED' ? '✗' : '○';
      const dur = step.duration ? ` (${(step.duration / 1000).toFixed(1)}s)` : '';
      console.log(`  ${icon} ${step.name}${dur}`);
      if (step.error && verbose) {
        console.log(`    Error: ${step.error}`);
      }
      if (step.note && verbose) {
        console.log(`    Note: ${step.note}`);
      }
    }

    const dur = result.duration ? ` in ${(result.duration / 1000).toFixed(1)}s` : '';
    if (result.status === 'PASSED') {
      passed++;
      console.log(`  → PASSED (${stepsPassed}/${stepsTotal} steps)${dur}`);
    } else {
      failed++;
      console.log(`  → FAILED (${stepsPassed}/${stepsTotal} steps passed)${dur}`);
      if (result.error) {
        console.log(`    Last error: ${result.error}`);
      }
    }
  }

  await browser.close();

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('SUMMARY');
  console.log('─'.repeat(60));
  console.log(`Scenarios: ${passed} PASSED, ${failed} FAILED, ${scenarios.length} total`);
  console.log(`Steps:     ${passedSteps} PASSED, ${failedSteps} FAILED, ${totalSteps} total`);
  console.log(`Duration:  ${(allResults.reduce((s, r) => s + (r.duration || 0), 0) / 1000).toFixed(1)}s`);
  console.log('═'.repeat(60));

  // Save JSON report
  const reportPath = path.join(DIRS.reports, `report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { passed, failed, total: scenarios.length, totalSteps, passedSteps, failedSteps },
    results: allResults,
  }, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  // Failed scenarios detail
  if (failed > 0) {
    console.log('\n--- FAILED SCENARIOS ---');
    for (const r of allResults.filter(r => r.status === 'FAILED')) {
      console.log(`\n  ${r.name}:`);
      for (const s of (r.steps || []).filter(s => s.status === 'FAILED')) {
        console.log(`    ✗ ${s.name}: ${s.error}`);
      }
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(2);
});
