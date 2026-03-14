/**
 * ASGARD CRM - Master Test Runner
 * Runs ALL test suites sequentially with real-time error logging
 * and writes a combined error report at the end.
 *
 * Usage:  node run-everything.js
 *
 * Output: reports/all-errors.log   — all errors in one file
 *         reports/run-summary.json  — machine-readable summary
 *         console                   — real-time progress + errors
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.join(__dirname, 'reports');
const ERROR_LOG = path.join(REPORT_DIR, 'all-errors.log');
const SUMMARY_FILE = path.join(REPORT_DIR, 'run-summary.json');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// ═══════════════════════════════════════════════════════════════════════════
// Test suites to run (order matters — simplest first)
// ═══════════════════════════════════════════════════════════════════════════
const SUITES = [
  {
    name: 'test-crm-v2',
    file: 'test-crm-v2.js',
    description: 'Smoke test (admin only, pages + buttons)',
  },
  {
    name: 'test-all-roles',
    file: 'test-all-roles.js',
    description: 'Multi-role smoke test (14 roles, page loads + button clicks)',
  },
  {
    name: 'run-all',
    file: 'run-all.js',
    args: ['--skip-cleanup'],
    description: 'Comprehensive suite (13 scenarios + universal scanner, no DB cleanup)',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════
function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function ensureDirs() {
  for (const d of [REPORT_DIR, SCREENSHOT_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

/**
 * Run a single test suite as a child process, streaming stdout/stderr in real-time.
 * Captures all output and extracts error lines.
 * @returns {Promise<{exitCode: number, duration: number, errors: string[], output: string}>}
 */
function runSuite(suite) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const args = [path.join(__dirname, suite.file), ...(suite.args || [])];
    const child = spawn('node', args, {
      cwd: __dirname,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const errors = [];

    // Real-time stdout
    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      // Print to console in real-time
      process.stdout.write(text);
      // Extract error lines
      extractErrors(text, errors, suite.name);
    });

    // Real-time stderr
    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
      // All stderr is considered error-relevant
      extractErrors(text, errors, suite.name);
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      resolve({
        exitCode: code || 0,
        duration,
        errors,
        output: stdout + stderr,
      });
    });

    child.on('error', (err) => {
      errors.push(`[${suite.name}] SPAWN ERROR: ${err.message}`);
      resolve({
        exitCode: 1,
        duration: Date.now() - startTime,
        errors,
        output: stdout + stderr,
      });
    });
  });
}

/**
 * Extract error-relevant lines from output text
 */
function extractErrors(text, errors, suiteName) {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isError =
      /\bERROR\b/i.test(trimmed) ||
      /\bОШИБКА\b/i.test(trimmed) ||
      /\bFAILED\b/i.test(trimmed) ||
      /\bFATAL\b/i.test(trimmed) ||
      /\bX\s+\[/.test(trimmed) ||       // "  X [pageName]" pattern from test-all-roles
      /\bX\b.*:/.test(trimmed) ||        // "X scenario: error" pattern
      /HTTP 5xx/i.test(trimmed) ||
      /UNCAUGHT/i.test(trimmed) ||
      /PAGE_TIMEOUT/i.test(trimmed) ||
      /Exception:/i.test(trimmed) ||
      /unhandledrejection/i.test(trimmed) ||
      /Cannot read prop/i.test(trimmed) ||
      /is not defined/i.test(trimmed) ||
      /is not a function/i.test(trimmed) ||
      /ECONNREFUSED/i.test(trimmed) ||
      /ETIMEDOUT/i.test(trimmed) ||
      /status.*fail/i.test(trimmed);

    if (isError) {
      errors.push(`[${suiteName}] ${trimmed.substring(0, 500)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  ensureDirs();

  const allErrors = [];
  const summary = {
    startTime: timestamp(),
    suites: [],
    totalErrors: 0,
    totalDuration: 0,
  };

  console.log('╔' + '═'.repeat(68) + '╗');
  console.log('║   ASGARD CRM — MASTER TEST RUNNER                                 ║');
  console.log('║   ' + timestamp() + '                                              ║');
  console.log('╚' + '═'.repeat(68) + '╝');
  console.log(`\nSuites to run: ${SUITES.length}`);
  SUITES.forEach((s, i) => console.log(`  ${i + 1}. ${s.name} — ${s.description}`));

  // Initialize error log
  fs.writeFileSync(ERROR_LOG, `ASGARD CRM — ERROR LOG\nStarted: ${timestamp()}\n${'='.repeat(70)}\n\n`);

  const totalStart = Date.now();

  for (let i = 0; i < SUITES.length; i++) {
    const suite = SUITES[i];

    console.log('\n' + '╔' + '═'.repeat(68) + '╗');
    console.log(`║  [${i + 1}/${SUITES.length}] ${suite.name.padEnd(55)}║`);
    console.log(`║  ${suite.description.padEnd(60).substring(0, 60)}    ║`);
    console.log('╚' + '═'.repeat(68) + '╝\n');

    const result = await runSuite(suite);

    const suiteResult = {
      name: suite.name,
      file: suite.file,
      exitCode: result.exitCode,
      duration: result.duration,
      durationHuman: `${(result.duration / 1000).toFixed(1)}s`,
      errorCount: result.errors.length,
      status: result.exitCode === 0 && result.errors.length === 0 ? 'PASSED' : 'ISSUES',
    };

    summary.suites.push(suiteResult);
    allErrors.push(...result.errors);

    // Append errors to log file in real-time
    if (result.errors.length > 0) {
      const section = `\n${'─'.repeat(70)}\nSuite: ${suite.name} (exit code: ${result.exitCode}, ${suiteResult.durationHuman})\n${'─'.repeat(70)}\n`;
      const errorLines = result.errors.map((e, idx) => `  ${idx + 1}. ${e}`).join('\n');
      fs.appendFileSync(ERROR_LOG, section + errorLines + '\n');
    }

    // Suite result banner
    const icon = suiteResult.status === 'PASSED' ? '+' : 'X';
    console.log(`\n[${icon}] ${suite.name}: ${suiteResult.status} | ${suiteResult.durationHuman} | ${result.errors.length} errors`);

    // Cooldown between suites (let server recover)
    if (i < SUITES.length - 1) {
      console.log(`\n  Cooldown: waiting 10s before next suite...`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Final summary
  // ─────────────────────────────────────────────────────────────────────
  summary.endTime = timestamp();
  summary.totalDuration = Date.now() - totalStart;
  summary.totalDurationHuman = `${(summary.totalDuration / 1000).toFixed(1)}s`;
  summary.totalErrors = allErrors.length;

  // Deduplicate errors
  const uniqueErrors = [...new Set(allErrors)];
  summary.uniqueErrors = uniqueErrors.length;

  // Write final error log section
  fs.appendFileSync(ERROR_LOG, `\n\n${'='.repeat(70)}\nFINAL SUMMARY\n${'='.repeat(70)}\n`);
  fs.appendFileSync(ERROR_LOG, `Finished: ${summary.endTime}\n`);
  fs.appendFileSync(ERROR_LOG, `Duration: ${summary.totalDurationHuman}\n`);
  fs.appendFileSync(ERROR_LOG, `Total errors: ${summary.totalErrors} (${summary.uniqueErrors} unique)\n\n`);

  for (const s of summary.suites) {
    fs.appendFileSync(ERROR_LOG, `  [${s.status === 'PASSED' ? '+' : 'X'}] ${s.name}: ${s.status} (${s.durationHuman}, ${s.errorCount} errors)\n`);
  }

  if (uniqueErrors.length > 0) {
    fs.appendFileSync(ERROR_LOG, `\n\nALL UNIQUE ERRORS:\n${'─'.repeat(70)}\n`);
    uniqueErrors.forEach((e, i) => {
      fs.appendFileSync(ERROR_LOG, `${i + 1}. ${e}\n`);
    });
  } else {
    fs.appendFileSync(ERROR_LOG, '\nNo errors found!\n');
  }

  // Write JSON summary
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify({ ...summary, uniqueErrorsList: uniqueErrors }, null, 2));

  // Console final report
  console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
  console.log('║   MASTER TEST RUNNER — FINAL RESULTS                              ║');
  console.log('╚' + '═'.repeat(68) + '╝');

  for (const s of summary.suites) {
    const icon = s.status === 'PASSED' ? '+' : 'X';
    console.log(`  [${icon}] ${s.name.padEnd(25)} ${s.status.padEnd(10)} ${s.durationHuman.padStart(8)}  ${s.errorCount} errors`);
  }

  console.log(`\n  Total duration: ${summary.totalDurationHuman}`);
  console.log(`  Total errors:   ${summary.totalErrors} (${summary.uniqueErrors} unique)`);
  console.log(`\n  Error log:   ${ERROR_LOG}`);
  console.log(`  JSON summary: ${SUMMARY_FILE}`);
  console.log('');

  // Exit with error if any suite had issues
  process.exit(summary.totalErrors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('MASTER RUNNER FATAL:', e);
  process.exit(1);
});
