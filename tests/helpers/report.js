/**
 * ASGARD CRM - HTML Report Generator (dark CRM theme)
 */
'use strict';

const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateReport(results) {
  const { api = [], smoke = [], e2e = [], summary = {} } = results;
  const passRate = summary.total > 0 ? Math.round((summary.pass / summary.total) * 100) : 0;

  const apiSections = api.map(suite => `
<div class="suite">
  <h2>${esc(suite.name)} <span class="suite-stats">(${(suite.results || []).filter(t => t.status === 'PASS').length}/${(suite.results || []).length})</span></h2>
  <table>
  <tr><th>Test</th><th>Status</th><th>Time</th><th>Error</th></tr>
  ${(suite.results || []).map(t => `<tr class="row-${t.status.toLowerCase()}">
    <td>${esc(t.name)}</td>
    <td><span class="tag-${t.status.toLowerCase()}">${t.status}</span></td>
    <td>${t.ms || 0}ms</td>
    <td class="error">${esc(t.error || '')}</td>
  </tr>`).join('')}
  </table>
</div>`).join('\n');

  const smokeSection = smoke.length > 0 && smoke[0]?.status !== 'SKIP' ? `
<div class="suite">
  <h2>SMOKE PAGES</h2>
  <table>
  <tr><th>Role</th><th>Route</th><th>Status</th><th>Details</th></tr>
  ${smoke.map(t => `<tr class="row-${(t.status || 'skip').toLowerCase()}">
    <td>${esc(t.role)}</td>
    <td>${esc(t.route)}</td>
    <td><span class="tag-${(t.status || 'skip').toLowerCase()}">${t.status || 'SKIP'}</span></td>
    <td class="error">${esc(t.error || '')}</td>
  </tr>`).join('')}
  </table>
</div>` : '';

  const e2eSection = e2e.length > 0 ? `
<div class="suite">
  <h2>E2E BUSINESS FLOWS</h2>
  <table>
  <tr><th>Test</th><th>Status</th><th>Time</th><th>Error</th></tr>
  ${e2e.map(t => `<tr class="row-${t.status.toLowerCase()}">
    <td>${esc(t.name)}</td>
    <td><span class="tag-${t.status.toLowerCase()}">${t.status}</span></td>
    <td>${t.ms || 0}ms</td>
    <td class="error">${esc(t.error || '')}</td>
  </tr>`).join('')}
  </table>
</div>` : '';

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>ASGARD CRM - Test Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1428;color:#e0e0e0;padding:24px;line-height:1.6}
  h1{color:#f2d08a;margin-bottom:4px;font-size:28px}
  h2{color:#58a6ff;font-size:17px;margin:20px 0 10px;border-bottom:1px solid #21262d;padding-bottom:6px}
  .suite{margin-bottom:24px}
  .suite-stats{color:#8b949e;font-weight:400;font-size:13px}
  .meta{color:#8b949e;margin-bottom:20px;font-size:13px}
  .summary{display:flex;gap:16px;margin:20px 0;flex-wrap:wrap}
  .stat{padding:16px 28px;border-radius:12px;background:#161b22;border:1px solid #30363d;text-align:center;min-width:100px}
  .stat .num{font-size:36px;font-weight:800}
  .stat .lbl{font-size:12px;color:#8b949e;margin-top:2px}
  .pass .num{color:#22c55e} .fail .num{color:#ef4444} .rate .num{color:#f2d08a} .time .num{color:#58a6ff;font-size:24px}
  table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
  th{background:#161b22;padding:8px 12px;text-align:left;border-bottom:2px solid #30363d;color:#f2d08a;font-weight:600}
  td{padding:6px 12px;border-bottom:1px solid #1a2332;vertical-align:top}
  tr.row-fail td{background:rgba(239,68,68,0.05)}
  tr:nth-child(even) td{background:rgba(22,27,34,0.4)}
  .tag-pass{background:#22c55e20;color:#4ade80;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700}
  .tag-fail{background:#ef444420;color:#f87171;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700}
  .tag-skip{background:#6b728020;color:#9ca3af;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700}
  .error{font-size:11px;color:#f87171;max-width:500px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @media(max-width:768px){.summary{flex-direction:column}.stat{flex:1}}
</style>
</head>
<body>

<h1>ASGARD CRM - Test Report</h1>
<div class="meta">Generated: ${new Date().toLocaleString('ru-RU')} | Duration: ${((summary.ms || 0) / 1000).toFixed(1)}s | Modules: ${api.length} | Roles: 15</div>

<div class="summary">
  <div class="stat pass"><div class="num">${summary.pass || 0}</div><div class="lbl">PASS</div></div>
  <div class="stat fail"><div class="num">${summary.fail || 0}</div><div class="lbl">FAIL</div></div>
  <div class="stat rate"><div class="num">${passRate}%</div><div class="lbl">RATE</div></div>
  <div class="stat time"><div class="num">${((summary.ms || 0) / 1000).toFixed(1)}s</div><div class="lbl">TIME</div></div>
</div>

${apiSections}
${smokeSection}
${e2eSection}

</body>
</html>`;

  const outPath = path.join(__dirname, '..', 'report.html');
  fs.writeFileSync(outPath, html);
  console.log(`\n  Report: ${outPath}`);
  return outPath;
}

module.exports = { generateReport };
