/**
 * Reporter - JSON and HTML report generation
 */

const fs = require('fs');
const path = require('path');
const { DIRS } = require('../config');

/**
 * Generate comprehensive JSON report
 */
function generateJsonReport(data) {
  const filePath = path.join(DIRS.reports, 'comprehensive.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`[REPORT] JSON report saved: ${filePath}`);
  return filePath;
}

/**
 * Generate HTML dashboard report
 */
function generateHtmlReport(data) {
  const filePath = path.join(DIRS.reports, 'comprehensive.html');

  const scenarioRows = (data.scenarios || []).map(s => {
    const statusClass = s.status === 'PASSED' ? 'pass' : s.status === 'FAILED' ? 'fail' : 'skip';
    const stepsHtml = (s.steps || []).map(step => {
      const stepClass = step.status === 'PASSED' ? 'pass' : step.status === 'FAILED' ? 'fail' : 'skip';
      return `<div class="step ${stepClass}">
        <span class="step-status">${step.status === 'PASSED' ? '+' : step.status === 'FAILED' ? 'X' : '-'}</span>
        ${escapeHtml(step.name)}
        ${step.error ? `<div class="error-detail">${escapeHtml(step.error)}</div>` : ''}
        ${step.screenshot ? `<a href="../${step.screenshot}" target="_blank">[screenshot]</a>` : ''}
      </div>`;
    }).join('');
    return `<tr class="${statusClass}">
      <td>${escapeHtml(s.name)}</td>
      <td class="status-${statusClass}">${s.status}</td>
      <td>${s.duration || '-'}ms</td>
      <td>${stepsHtml}</td>
    </tr>`;
  }).join('');

  const scanRows = Object.entries(data.universal_scan || {}).map(([role, info]) => {
    const statusClass = info.errors === 0 ? 'pass' : 'fail';
    return `<tr class="${statusClass}">
      <td>${escapeHtml(role)}</td>
      <td>${info.pages_visited || 0}</td>
      <td>${info.forms_filled || 0}</td>
      <td>${info.forms_saved || 0}</td>
      <td>${info.errors || 0}</td>
      <td class="status-${statusClass}">${info.errors === 0 ? 'PASS' : 'ISSUES'}</td>
    </tr>`;
  }).join('');

  const summary = data.summary || {};

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>ASGARD CRM - Comprehensive Test Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #0d1117; color: #c9d1d9; }
  h1, h2, h3 { color: #58a6ff; }
  .dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 20px 0; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; text-align: center; }
  .card .value { font-size: 2em; font-weight: bold; color: #58a6ff; }
  .card .label { color: #8b949e; margin-top: 4px; }
  .card.pass .value { color: #3fb950; }
  .card.fail .value { color: #f85149; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th { background: #21262d; color: #c9d1d9; padding: 10px; text-align: left; border: 1px solid #30363d; }
  td { padding: 8px 10px; border: 1px solid #30363d; }
  tr.pass { background: #0d1117; }
  tr.fail { background: #1c0d0d; }
  tr.skip { background: #1c1a0d; }
  .status-pass { color: #3fb950; font-weight: bold; }
  .status-fail { color: #f85149; font-weight: bold; }
  .status-skip { color: #d29922; }
  .step { padding: 4px 0; }
  .step.pass .step-status { color: #3fb950; }
  .step.fail .step-status { color: #f85149; }
  .step.skip .step-status { color: #d29922; }
  .error-detail { color: #f85149; font-size: 0.85em; margin-left: 20px; }
  .timestamp { color: #8b949e; font-size: 0.9em; }
  .filter-bar { margin: 10px 0; }
  .filter-bar button { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-right: 4px; }
  .filter-bar button.active { background: #58a6ff; color: #0d1117; }
</style>
</head>
<body>
<h1>ASGARD CRM - Comprehensive Test Report</h1>
<p class="timestamp">Generated: ${new Date().toISOString()}</p>

<div class="dashboard">
  <div class="card ${(summary.scenarios?.passed || 0) === (summary.scenarios?.total || 0) ? 'pass' : 'fail'}">
    <div class="value">${summary.scenarios?.passed || 0}/${summary.scenarios?.total || 0}</div>
    <div class="label">Scenarios Passed</div>
  </div>
  <div class="card ${(summary.forms?.failed || 0) === 0 ? 'pass' : 'fail'}">
    <div class="value">${summary.forms?.filled || 0}</div>
    <div class="label">Forms Filled</div>
  </div>
  <div class="card">
    <div class="value">${summary.forms?.saved || 0}</div>
    <div class="label">Forms Saved</div>
  </div>
  <div class="card ${(summary.roles?.all_pass || 0) === (summary.roles?.tested || 0) ? 'pass' : 'fail'}">
    <div class="value">${summary.roles?.tested || 0}</div>
    <div class="label">Roles Tested</div>
  </div>
  <div class="card">
    <div class="value">${summary.cleanup?.entities_removed || 0}</div>
    <div class="label">Entities Cleaned</div>
  </div>
</div>

<h2>Business Scenarios</h2>
<div class="filter-bar">
  <button class="active" onclick="filterRows('scenario-table','all')">All</button>
  <button onclick="filterRows('scenario-table','pass')">Passed</button>
  <button onclick="filterRows('scenario-table','fail')">Failed</button>
</div>
<table id="scenario-table">
<thead><tr><th>Scenario</th><th>Status</th><th>Duration</th><th>Steps</th></tr></thead>
<tbody>${scenarioRows}</tbody>
</table>

<h2>Universal Scanner (by Role)</h2>
<table id="scan-table">
<thead><tr><th>Role</th><th>Pages</th><th>Forms Filled</th><th>Forms Saved</th><th>Errors</th><th>Status</th></tr></thead>
<tbody>${scanRows}</tbody>
</table>

${data.cleanup ? `
<h2>Cleanup</h2>
<p>Status: <span class="status-${data.cleanup.success ? 'pass' : 'fail'}">${data.cleanup.success ? 'Complete' : 'Partial'}</span></p>
<p>Total entities removed: ${data.cleanup.totalDeleted || 0}</p>
${data.cleanup.errors?.length > 0 ? `<p class="error-detail">Errors: ${escapeHtml(data.cleanup.errors.join(', '))}</p>` : ''}
` : ''}

<script>
function filterRows(tableId, filter) {
  const table = document.getElementById(tableId);
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach(r => {
    if (filter === 'all') { r.style.display = ''; return; }
    r.style.display = r.classList.contains(filter) ? '' : 'none';
  });
  const btns = table.previousElementSibling.querySelectorAll('button');
  btns.forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}
</script>
</body>
</html>`;

  fs.writeFileSync(filePath, html);
  console.log(`[REPORT] HTML report saved: ${filePath}`);
  return filePath;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { generateJsonReport, generateHtmlReport };
