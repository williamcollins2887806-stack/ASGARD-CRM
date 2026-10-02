'use strict';

/**
 * Telephony emulation suite runner (local asgard_crm_test only).
 * Usage: node tests/telephony/emulation/run.js
 *        node tests/telephony/emulation/run.js --only=E03
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { assertLocalDb, DEFAULT_DATABASE_URL } = require('../integration/harness');

const ROOT = path.resolve(__dirname, '../../..');
const REPORT = path.join(ROOT, 'tests', 'reports', 'TELEPHONY-EMU-GATE.md');

function parseArgs(argv) {
  const out = { only: null, skipLayer1: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--only=')) out.only = a.slice('--only='.length).toUpperCase();
    if (a === '--skip-layer1') out.skipLayer1 = true;
  }
  return out;
}

function runLayer1() {
  const env = {
    ...process.env,
    DB_NAME: 'asgard_crm_test',
    DB_USER: process.env.DB_USER || 'asgard',
    DB_PASSWORD: process.env.DB_PASSWORD || '123456789',
    DB_HOST: process.env.DB_HOST || '127.0.0.1',
    DATABASE_URL: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
    TEST_BASE_URL: process.env.TEST_BASE_URL || 'http://127.0.0.1:3100',
    TELEPHONY_EMU_MOCK: '1',
  };
  const results = [];

  try {
    const out = execFileSync(process.execPath, ['tests/telephony/scenario-runner.js', '--all'], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
    });
    results.push({ id: 'E01a-scenarios', ok: true, detail: (out.match(/Scenarios:.*/) || [''])[0] });
  } catch (e) {
    results.push({
      id: 'E01a-scenarios',
      ok: false,
      detail: (e.stdout || '') + (e.stderr || e.message),
    });
  }

  try {
    const out = execFileSync(process.execPath, ['tests/telephony/integration/run.js', '--all'], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
    });
    results.push({ id: 'E01b-integration', ok: true, detail: (out.match(/Integration:.*/) || [''])[0] });
  } catch (e) {
    results.push({
      id: 'E01b-integration',
      ok: false,
      detail: (e.stdout || '') + (e.stderr || e.message),
    });
  }

  return results;
}

const SUITES = [
  require('./e02-webhook'),
  require('./e03-softphone'),
  require('./e04-blind-transfer'),
  require('./e05-consult-transfer'),
  require('./e06-multitab'),
  require('./e07-pipeline'),
  require('./e08-negatives'),
  require('./e09-ui-clicks'),
];

function writeReport(rows) {
  const ts = new Date().toISOString();
  let md = `# TELEPHONY-EMU-GATE\n\n`;
  md += `Timestamp: ${ts}\n`;
  md += `DB: \`asgard_crm_test\` (loopback). Prod / live Mango / cutover: **out of scope**.\n\n`;
  md += `| ID | Title | Result | Detail |\n|----|-------|--------|--------|\n`;
  for (const r of rows) {
    md +=
      '| ' +
      r.id +
      ' | ' +
      (r.title || '') +
      ' | ' +
      (r.ok ? '**PASS**' : '**FAIL**') +
      ' | ' +
      String(r.detail || '')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ')
        .slice(0, 200) +
      ' |\n';
  }
  const failed = rows.filter((r) => !r.ok).length;
  const passed = rows.filter((r) => r.ok).length;
  md += `\n## Summary\n\n- Passed: ${passed}\n- Failed: ${failed}\n`;
  md += failed
    ? '\n**GATE: RED** — fix FAIL before live calls.\n'
    : '\n**GATE: GREEN** — mechanics + UI click chains (E01–E09) ready for live-call planning.\n';
  md += `\n## Residual (live only)\n\n- Real JsSIP/WebRTC media, mic, DTMF audio\n- Live trunk Mango→Asterisk cutover\n- Prod deploy\n`;
  md += `- See \`tests/reports/TELEPHONY-LIVE-CHECKLIST.md\` for B1–B4 cutover steps\n`;
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, md, 'utf8');
  console.log('\nWrote', REPORT);
}

async function main() {
  try {
    assertLocalDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL);
  } catch (e) {
    console.error('DB guard:', e.message);
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  const rows = [];

  if (!args.only && !args.skipLayer1) {
    console.log('=== Layer1 scenarios + integration ===');
    const l1 = runLayer1();
    for (const x of l1) {
      console.log(x.id, x.ok ? 'PASS' : 'FAIL', x.detail.slice(0, 80));
      rows.push({
        id: x.id === 'E01a-scenarios' || x.id === 'E01b-integration' ? 'E01' : x.id,
        title: x.id,
        ok: x.ok,
        detail: x.detail,
      });
    }
    // Collapse duplicate E01 rows into one if both ok
    const e01s = rows.filter((r) => r.id === 'E01');
    if (e01s.length === 2) {
      const ok = e01s.every((r) => r.ok);
      rows.splice(
        0,
        rows.length,
        ...rows.filter((r) => r.id !== 'E01'),
        {
          id: 'E01',
          title: 'Layer1 scenarios+integration',
          ok,
          detail: e01s.map((r) => r.detail).join('; '),
        }
      );
    }
  } else if (args.only === 'E01') {
    const l1 = runLayer1();
    const ok = l1.every((x) => x.ok);
    rows.push({
      id: 'E01',
      title: 'Layer1 scenarios+integration',
      ok,
      detail: l1.map((x) => x.detail).join('; '),
    });
  }

  for (const suite of SUITES) {
    if (args.only && suite.id.toUpperCase() !== args.only) continue;
    process.stdout.write(`[${suite.id}] ${suite.title} … `);
    try {
      const meta = await suite.run();
      console.log('OK');
      rows.push({ id: suite.id, title: suite.title, ok: true, detail: JSON.stringify(meta || {}) });
    } catch (e) {
      console.log('FAIL');
      console.error(' ', e.message);
      if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
      rows.push({ id: suite.id, title: suite.title, ok: false, detail: e.message });
    }
  }

  writeReport(rows);
  const failed = rows.filter((r) => !r.ok).length;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
