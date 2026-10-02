/**
 * D-258 sentinel — logistics overwrite ACL + closure test filter + corrections schema
 * Run: node tests/sentinel_d258_timesheet_fixes.js
 * (static gates always; API gates if TEST_BASE_URL + DB up)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const results = [];
function pass(id, d) { results.push({ id, ok: true, detail: d }); console.log('PASS', id, d || ''); }
function fail(id, d) { results.push({ id, ok: false, detail: d }); console.log('FAIL', id, d || ''); }

const root = path.join(__dirname, '..');

// ── Static: logistics lib ──
{
  const lib = require('../src/lib/timesheet-logistics-types');
  if (lib.isPmOverwriteType('ship') && lib.isPmOverwriteType('travel')
      && !lib.isPmOverwriteType('medical') && !lib.isPmOverwriteType('warehouse')) {
    pass('lib-logistics', 'ship/travel yes, medical/warehouse no');
  } else fail('lib-logistics', 'bad ACL set');
}

// ── Static: timesheet-v2.js frontend ──
{
  const src = fs.readFileSync(path.join(root, 'public/assets/js/timesheet-v2.js'), 'utf8');
  if (src.includes('PM_LOGISTICS_OVERWRITE') && src.includes('isPmLogisticsCell')) {
    pass('ui-pm-logistics', 'PM logistics overwrite UI');
  } else fail('ui-pm-logistics', 'missing');
  if (src.includes('openCorrectionModal') && src.includes('/corrections')) {
    pass('ui-correction', 'correction modal');
  } else fail('ui-correction', 'missing');
  if (src.includes("mode === 'pm' && scope !== 'pm'")) {
    pass('ui-lock-scope', 'pm never warehouse lock');
  } else fail('ui-lock-scope', 'missing guard');
}

// ── Static: field-tab default pts ──
{
  const src = fs.readFileSync(path.join(root, 'public/assets/js/field-tab.js'), 'utf8');
  if (src.includes('emp.tariff_points') && src.includes('use_assignment_rate')) {
    pass('field-tariff-default', 'tariff_points + use_assignment_rate');
  } else fail('field-tariff-default', 'missing');
  if (src.includes('openFieldCorrectionModal')) {
    pass('field-correction', 'correction modal in field-tab');
  } else fail('field-correction', 'missing');
}

// ── Static: backend ──
{
  const src = fs.readFileSync(path.join(root, 'src/routes/timesheet-v2.js'), 'utf8');
  if (src.includes('typeAllowedForRoleOrPmLogisticsDelete') && src.includes('pmOwnsEmployeeOrWork')) {
    pass('api-pm-delete', 'PM logistics delete ACL');
  } else fail('api-pm-delete', 'missing');
  if (src.includes("login NOT LIKE 'test\\\\_%'") || src.includes("login NOT LIKE 'test\\_%'")) {
    pass('api-hide-test', 'closure-status excludes test_');
  } else fail('api-hide-test', 'filter missing');
  if (src.includes('SCOPE_LOCK_ADMIN_ROLES') && src.includes('/corrections')) {
    pass('api-lock-admin-corr', 'admin lock + corrections routes');
  } else fail('api-lock-admin-corr', 'missing');
}

// ── Migration file ──
{
  const mig = path.join(root, 'migrations/V360__timesheet_corrections.sql');
  if (fs.existsSync(mig) && fs.readFileSync(mig, 'utf8').includes('timesheet_corrections')) {
    pass('mig-v360', 'V360 present');
  } else fail('mig-v360', 'missing');
}

const failed = results.filter((r) => !r.ok);
console.log('\n=== SUMMARY ===');
console.log('PASS', results.filter((r) => r.ok).length, '/ FAIL', failed.length);
failed.forEach((f) => console.log(' -', f.id, f.detail));
const out = path.join(__dirname, 'reports', 'D258-SENTINEL.json');
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log('wrote', out);
process.exit(failed.length ? 1 : 0);
