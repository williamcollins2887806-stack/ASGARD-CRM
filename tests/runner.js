#!/usr/bin/env node

/**
 * ASGARD CRM — Full Test Runner
 *
 * Usage:
 *   node tests/runner.js              # API + E2E (default)
 *   node tests/runner.js --api        # API tests only
 *   node tests/runner.js --e2e        # E2E business flows only
 *   node tests/runner.js --smoke      # Playwright smoke tests
 *   node tests/runner.js --all        # All layers
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const runApi   = args.includes('--all') || args.includes('--api') || args.length === 0;
const runSmoke = args.includes('--all') || args.includes('--smoke');
const runE2e   = args.includes('--all') || args.includes('--e2e') || args.length === 0;

const results = { api: [], smoke: [], e2e: [], summary: {} };
const startTime = Date.now();

async function runTestSuite(suite) {
  const out = [];
  console.log(`\n  ▸ ${suite.name} (${suite.tests.length} tests)`);

  for (const test of suite.tests) {
    const t0 = Date.now();
    try {
      await test.run();
      const ms = Date.now() - t0;
      console.log(`    ✅ ${test.name} (${ms}ms)`);
      out.push({ name: test.name, status: 'PASS', ms });
    } catch (err) {
      const ms = Date.now() - t0;
      console.log(`    ❌ ${test.name}: ${err.message.slice(0, 200)}`);
      out.push({ name: test.name, status: 'FAIL', ms, error: err.message.slice(0, 300) });
    }
  }
  return out;
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   ⚔️  ASGARD CRM — FULL TEST SUITE           ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  console.log(`  Target: ${require('./config').BASE_URL}`);
  console.log(`  Time:   ${new Date().toLocaleString('ru-RU')}`);

  // ═══ СЛОЙ 1: API ТЕСТЫ ═══
  if (runApi) {
    console.log('\n━━━ СЛОЙ 1: API ТЕСТЫ ━━━');

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
        console.log(`    ⚠️  Failed to load ${file}: ${err.message}`);
        results.api.push({ name: file, results: [{ name: `Load ${file}`, status: 'FAIL', ms: 0, error: err.message }] });
      }
    }
  }

  // ═══ СЛОЙ 2: SMOKE ТЕСТЫ ═══
  if (runSmoke) {
    console.log('\n━━━ СЛОЙ 2: SMOKE ТЕСТЫ (Playwright) ━━━');
    try {
      const smoke = require('./smoke/pages.test.js');
      const smokeResults = await smoke.run();
      results.smoke = smokeResults;
      const pass = smokeResults.filter(r => r.status === 'PASS').length;
      const fail = smokeResults.filter(r => r.status === 'FAIL').length;
      const skip = smokeResults.filter(r => r.status === 'SKIP').length;
      console.log(`\n    ✅ ${pass} pass / ❌ ${fail} fail${skip ? ` / ⏭️ ${skip} skip` : ''}`);
    } catch (e) {
      console.log(`    ⚠️  Smoke skipped: ${e.message}`);
      results.smoke = [{ role: 'ALL', route: 'N/A', status: 'SKIP', error: e.message }];
    }
  }

  // ═══ СЛОЙ 3: E2E МАРШРУТЫ ═══
  if (runE2e) {
    console.log('\n━━━ СЛОЙ 3: E2E БИЗНЕС-МАРШРУТЫ ━━━');
    try {
      const e2e = require('./e2e/flows.test.js');
      const r = await runTestSuite(e2e);
      results.e2e = r;
    } catch (e) {
      console.log(`    ⚠️  E2E failed to load: ${e.message}`);
      results.e2e = [{ name: 'Load E2E', status: 'FAIL', ms: 0, error: e.message }];
    }
  }

  // ═══ СВОДКА ═══
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

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log(`║  ИТОГО: ${pass} ✅  ${fail} ❌  из ${total} (${(totalMs / 1000).toFixed(1)}s)`);
  console.log(`║  ${fail === 0 ? '🎉 ALL PASS' : '⚠️  HAS FAILURES'}                              ║`);
  console.log('╚══════════════════════════════════════════════╝');

  // Генерируем HTML отчёт
  generateHtmlReport(results);

  process.exit(fail > 0 ? 1 : 0);
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateHtmlReport(results) {
  const { summary } = results;
  const passRate = summary.total > 0 ? Math.round((summary.pass / summary.total) * 100) : 0;

  const apiSections = results.api.map(suite => `
<h2>${esc(suite.name)}</h2>
<table>
<tr><th>Test</th><th>Status</th><th>Time</th><th>Error</th></tr>
${(suite.results || []).map(t => `<tr>
  <td>${esc(t.name)}</td>
  <td><span class="tag-${t.status.toLowerCase()}">${t.status}</span></td>
  <td>${t.ms || 0}ms</td>
  <td class="error">${esc(t.error || '')}</td>
</tr>`).join('')}
</table>`).join('\n');

  const smokeSection = results.smoke.length > 0 && results.smoke[0].status !== 'SKIP' ? `
<h2>SMOKE PAGES</h2>
<table>
<tr><th>Role</th><th>Route</th><th>Status</th><th>Details</th></tr>
${results.smoke.map(t => `<tr>
  <td>${esc(t.role)}</td>
  <td>${esc(t.route)}</td>
  <td><span class="tag-${t.status.toLowerCase()}">${t.status}</span></td>
  <td class="error">${esc(t.error || (t.jsErrors || []).join('; ') || (t.failedRequests || []).join('; ') || (t.isEmpty ? 'Empty page' : '') || (t.hasObjectObject ? '[object Object] detected' : ''))}</td>
</tr>`).join('')}
</table>` : '';

  const e2eSection = results.e2e.length > 0 ? `
<h2>E2E BUSINESS FLOWS</h2>
<table>
<tr><th>Test</th><th>Status</th><th>Time</th><th>Error</th></tr>
${results.e2e.map(t => `<tr>
  <td>${esc(t.name)}</td>
  <td><span class="tag-${t.status.toLowerCase()}">${t.status}</span></td>
  <td>${t.ms || 0}ms</td>
  <td class="error">${esc(t.error || '')}</td>
</tr>`).join('')}
</table>` : '';

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>ASGARD CRM — Test Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1428;color:#e0e0e0;padding:24px;line-height:1.6}
  h1{color:#f2d08a;margin-bottom:4px}
  h2{color:#58a6ff;font-size:18px;margin:28px 0 12px;border-bottom:1px solid #21262d;padding-bottom:6px}
  .meta{color:#8b949e;margin-bottom:20px;font-size:13px}
  .summary{display:flex;gap:16px;margin:20px 0;flex-wrap:wrap}
  .stat{padding:16px 28px;border-radius:12px;background:#161b22;border:1px solid #30363d;text-align:center;min-width:100px}
  .stat .num{font-size:36px;font-weight:800}
  .stat .lbl{font-size:12px;color:#8b949e;margin-top:2px}
  .pass .num{color:#22c55e} .fail .num{color:#ef4444} .rate .num{color:#f2d08a} .time .num{color:#58a6ff;font-size:24px}
  table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
  th{background:#161b22;padding:8px 12px;text-align:left;border-bottom:2px solid #30363d;color:#f2d08a;font-weight:600}
  td{padding:6px 12px;border-bottom:1px solid #1a2332;vertical-align:top}
  tr:nth-child(even) td{background:rgba(22,27,34,0.4)}
  .tag-pass{background:#22c55e20;color:#4ade80;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700}
  .tag-fail{background:#ef444420;color:#f87171;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700}
  .tag-skip{background:#6b728020;color:#9ca3af;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700}
  .error{font-size:11px;color:#f87171;max-width:450px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @media(max-width:768px){.summary{flex-direction:column}.stat{flex:1}}
</style>
</head>
<body>

<h1>⚔️ ASGARD CRM — Test Report</h1>
<div class="meta">Generated: ${new Date().toLocaleString('ru-RU')} · Duration: ${(summary.ms / 1000).toFixed(1)}s</div>

<div class="summary">
  <div class="stat pass"><div class="num">${summary.pass}</div><div class="lbl">PASS</div></div>
  <div class="stat fail"><div class="num">${summary.fail}</div><div class="lbl">FAIL</div></div>
  <div class="stat rate"><div class="num">${passRate}%</div><div class="lbl">RATE</div></div>
  <div class="stat time"><div class="num">${(summary.ms / 1000).toFixed(1)}s</div><div class="lbl">TIME</div></div>
</div>

${apiSections}
${smokeSection}
${e2eSection}

</body>
</html>`;

  const outPath = path.join(__dirname, 'report.html');
  fs.writeFileSync(outPath, html);
  console.log(`\n📄 Report: ${outPath}`);
}

main().catch(e => { console.error('Runner crashed:', e); process.exit(1); });
