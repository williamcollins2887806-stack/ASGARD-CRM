/**
 * ASGARD CRM - Comprehensive Test Suite Orchestrator
 *
 * Phases:
 *   0: Pre-cleanup (remove TEST_AUTO_* from DB)
 *   1: Business scenarios (sequential, by dependency)
 *   2: Universal scanner (parallel batches by role)
 *   3: Post-cleanup (full removal of TEST_AUTO_*)
 *   4: Report generation (JSON + HTML)
 *
 * Usage: node run-all.js [--skip-cleanup] [--skip-scenarios] [--skip-scanner] [--scenario=01]
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ACCOUNTS, DIRS, BATCH_SIZE } = require('./config');
const { fullCleanup, countTestData } = require('./lib/cleanup');
const { generateJsonReport, generateHtmlReport } = require('./lib/reporter');
const { scanAllRoles } = require('./universal/page-scanner');

// ═══════════════════════════════════════════════════════════════════════════
// Scenarios
// ═══════════════════════════════════════════════════════════════════════════
// Load scenarios dynamically — skip files that don't exist yet
const SCENARIO_FILES = [
  './scenarios/01-tender-lifecycle',
  './scenarios/02-work-management',
  './scenarios/03-finance-pipeline',
  './scenarios/04-cash-workflow',
  './scenarios/05-hr-compliance',
  './scenarios/06-equipment-warehouse',
  './scenarios/07-communication',
  './scenarios/08-admin-settings',
  './scenarios/09-tkp-invoices.test',
  './scenarios/10-pagination.test',
  './scenarios/11-tasks-archive.test',
  './scenarios/12-permits-compliance.test',
  './scenarios/13-training-applications.test',
];

const SCENARIOS = [];
for (const f of SCENARIO_FILES) {
  try {
    SCENARIOS.push(require(f));
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.log(`[WARN] Scenario not found, skipping: ${f}`);
    } else {
      throw e; // re-throw syntax/runtime errors
    }
  }
}

// Routes covered by scenarios (scanner will skip these)
const SCENARIO_COVERED_ROUTES = new Set([
  '#/tenders', '#/calculator', '#/pm-works', '#/works-all',
  '#/invoices', '#/acts', '#/payments', '#/payment-registry',
  '#/cash', '#/employees', '#/permits', '#/staff-plan', '#/staff',
  '#/payroll', '#/warehouse', '#/equipment', '#/engineer-dashboard',
  '#/purchases', '#/purchase-requests', '#/procurement',
  '#/tasks', '#/calendar', '#/notifications',
  '#/settings', '#/users', '#/admin/users',
  // New scenarios (09-13)
  '#/tkp', '#/tasks-archive', '#/training', '#/training-requests',
  '#/training-applications', '#/hr-requests', '#/hr-training',
  '#/customers', '#/personnel', '#/correspondence',
  '#/proc-requests', '#/all-estimates', '#/all-works',
]);

// ═══════════════════════════════════════════════════════════════════════════
// CLI args
// ═══════════════════════════════════════════════════════════════════════════
const args = process.argv.slice(2);
const skipCleanup = args.includes('--skip-cleanup');
const skipScenarios = args.includes('--skip-scenarios');
const skipScanner = args.includes('--skip-scanner');
const onlyScenario = args.find(a => a.startsWith('--scenario='))?.split('=')[1];

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const startTime = Date.now();
  console.log('='.repeat(70));
  console.log('   ASGARD CRM - COMPREHENSIVE TEST SUITE');
  console.log('   ' + new Date().toISOString());
  console.log('='.repeat(70));

  // Ensure directories exist
  for (const dir of Object.values(DIRS)) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      scenarios: { total: 0, passed: 0, failed: 0, skipped: 0 },
      forms: { filled: 0, saved: 0, failed: 0 },
      roles: { tested: 0, all_pass: 0 },
      cleanup: { entities_removed: 0, status: 'pending' },
    },
    scenarios: [],
    universal_scan: {},
    cleanup: null,
    duration: 0,
  };

  // ─────────────────────────────────────────────────────────────────────
  // Phase 0: Pre-cleanup
  // ─────────────────────────────────────────────────────────────────────
  if (!skipCleanup) {
    console.log('\n' + '─'.repeat(70));
    console.log('PHASE 0: Pre-cleanup');
    console.log('─'.repeat(70));
    try {
      const preCleanup = await fullCleanup();
      console.log(`Pre-cleanup: removed ${preCleanup.totalDeleted} entities`);
    } catch (e) {
      console.warn(`Pre-cleanup failed (non-critical): ${e.message}`);
      console.warn('Continuing without cleanup — SSH/DB may not be available');
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Phase 1: Business Scenarios
  // ─────────────────────────────────────────────────────────────────────
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  } catch (e) {
    console.error(`FATAL: Cannot launch browser: ${e.message}`);
    process.exit(1);
  }

  if (!skipScenarios) {
    console.log('\n' + '─'.repeat(70));
    console.log('PHASE 1: Business Scenarios');
    console.log('─'.repeat(70));

    const context = {}; // shared context between scenarios

    for (const scenario of SCENARIOS) {
      // Filter by --scenario= flag
      if (onlyScenario && !scenario.name.startsWith(onlyScenario)) {
        continue;
      }

      console.log(`\n>>> Scenario: ${scenario.name}`);
      report.summary.scenarios.total++;

      try {
        const result = await scenario.run(browser, context);
        report.scenarios.push(result);

        if (result.status === 'PASSED') {
          report.summary.scenarios.passed++;
          console.log(`<<< ${scenario.name}: PASSED (${result.duration}ms)`);
        } else {
          report.summary.scenarios.failed++;
          console.log(`<<< ${scenario.name}: FAILED (${result.duration}ms)`);
        }
      } catch (e) {
        report.summary.scenarios.failed++;
        report.scenarios.push({
          name: scenario.name,
          status: 'FAILED',
          steps: [{ name: 'Fatal', status: 'FAILED', error: e.message }],
          duration: 0,
        });
        console.log(`<<< ${scenario.name}: FATAL ERROR - ${e.message}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Phase 2: Universal Scanner
  // ─────────────────────────────────────────────────────────────────────
  if (!skipScanner) {
    console.log('\n' + '─'.repeat(70));
    console.log('PHASE 2: Universal Scanner');
    console.log('─'.repeat(70));

    try {
      const scanResults = await scanAllRoles(browser, ACCOUNTS, BATCH_SIZE, SCENARIO_COVERED_ROUTES);
      report.universal_scan = scanResults;

      // Aggregate scan stats
      let totalFormsFilledScan = 0;
      let totalFormsSavedScan = 0;
      let totalErrorsScan = 0;
      let rolesAllPass = 0;

      for (const [role, data] of Object.entries(scanResults)) {
        totalFormsFilledScan += data.forms_filled || 0;
        totalFormsSavedScan += data.forms_saved || 0;
        totalErrorsScan += data.errors || 0;
        if (data.errors === 0) rolesAllPass++;
      }

      report.summary.forms.filled += totalFormsFilledScan;
      report.summary.forms.saved += totalFormsSavedScan;
      report.summary.forms.failed += totalErrorsScan;
      report.summary.roles.tested = Object.keys(scanResults).length;
      report.summary.roles.all_pass = rolesAllPass;

      console.log(`\nScanner Summary: ${totalFormsFilledScan} forms filled, ${totalFormsSavedScan} saved, ${totalErrorsScan} errors across ${Object.keys(scanResults).length} roles`);
    } catch (e) {
      console.error(`Scanner failed: ${e.message}`);
    }
  }

  // Close browser
  await browser.close();

  // ─────────────────────────────────────────────────────────────────────
  // Phase 3: Post-cleanup
  // ─────────────────────────────────────────────────────────────────────
  if (!skipCleanup) {
    console.log('\n' + '─'.repeat(70));
    console.log('PHASE 3: Post-cleanup');
    console.log('─'.repeat(70));
    try {
      const postCleanup = await fullCleanup();
      report.cleanup = postCleanup;
      report.summary.cleanup.entities_removed = postCleanup.totalDeleted;
      report.summary.cleanup.status = postCleanup.success ? 'complete' : 'partial';
      console.log(`Post-cleanup: removed ${postCleanup.totalDeleted} entities`);

      // Verify
      const remaining = await countTestData();
      const totalRemaining = Object.values(remaining).filter(v => v > 0).reduce((a, b) => a + b, 0);
      if (totalRemaining > 0) {
        console.warn(`WARNING: ${totalRemaining} TEST_AUTO_* records still remain in DB`);
        report.summary.cleanup.status = 'incomplete';
      }
    } catch (e) {
      console.warn(`Post-cleanup failed: ${e.message}`);
      report.summary.cleanup.status = 'failed';
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Phase 4: Report Generation
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log('PHASE 4: Report Generation');
  console.log('─'.repeat(70));

  report.duration = Date.now() - startTime;

  // Add scenario form counts to totals
  for (const sc of report.scenarios) {
    for (const step of (sc.steps || [])) {
      if (step.status === 'PASSED') {
        // Each passed step that involved form filling counts
      }
    }
  }

  const jsonPath = generateJsonReport(report);
  const htmlPath = generateHtmlReport(report);

  // ─────────────────────────────────────────────────────────────────────
  // Final Summary
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('   FINAL SUMMARY');
  console.log('='.repeat(70));

  console.log(`\n  Scenarios: ${report.summary.scenarios.passed}/${report.summary.scenarios.total} passed`);
  for (const sc of report.scenarios) {
    const icon = sc.status === 'PASSED' ? '+' : 'X';
    console.log(`    [${icon}] ${sc.name} (${sc.duration}ms)`);
    if (sc.status === 'FAILED') {
      const failedSteps = (sc.steps || []).filter(s => s.status === 'FAILED');
      for (const step of failedSteps) {
        console.log(`        X ${step.name}: ${step.error?.substring(0, 100)}`);
      }
    }
  }

  console.log(`\n  Universal Scanner:`);
  console.log(`    Forms filled: ${report.summary.forms.filled}`);
  console.log(`    Forms saved:  ${report.summary.forms.saved}`);
  console.log(`    Errors:       ${report.summary.forms.failed}`);
  console.log(`    Roles tested: ${report.summary.roles.tested}`);
  console.log(`    Roles clean:  ${report.summary.roles.all_pass}`);

  console.log(`\n  Cleanup: ${report.summary.cleanup.status} (${report.summary.cleanup.entities_removed} removed)`);
  console.log(`\n  Duration: ${(report.duration / 1000).toFixed(1)}s`);
  console.log(`\n  Reports:`);
  console.log(`    JSON: ${jsonPath}`);
  console.log(`    HTML: ${htmlPath}`);

  console.log('\n' + '='.repeat(70));

  // Exit with error code if any scenarios failed
  const exitCode = report.summary.scenarios.failed > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
