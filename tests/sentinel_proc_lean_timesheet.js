/**
 * PROC lean global timesheet — sentinel.
 * Run: $env:TEST_BASE_URL='http://127.0.0.1:3100'; node tests/sentinel_proc_lean_timesheet.js
 */
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');
const { getToken } = require('./config');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const YEAR = parseInt(process.env.TS_YEAR || '2026', 10);
const MONTH = parseInt(process.env.TS_MONTH || '9', 10);
const OUT = process.env.OUT_XLSX
  || path.join(__dirname, 'reports', `proc-timesheet-${YEAR}-${String(MONTH).padStart(2, '0')}.xlsx`);

const results = [];
function pass(id, detail) { results.push({ id, ok: true, detail }); console.log('PASS', id, detail || ''); }
function fail(id, detail) { results.push({ id, ok: false, detail }); console.log('FAIL', id, detail || ''); }

function hdr(token) {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}

async function main() {
  console.log('BASE', BASE, 'period', YEAR, MONTH);

  const health = await fetch(BASE + '/api/health').catch((e) => ({ ok: false, status: 0, _e: e }));
  if (!health.ok && health.status !== 200) {
    fail('BOOT', 'health failed: ' + (health._e?.message || health.status));
    process.exit(1);
  }
  pass('BOOT', 'health ok');

  let procToken, adminToken;
  try {
    procToken = await getToken('PROC');
    pass('AUTH_PROC', 'test_proc');
  } catch (e) {
    fail('AUTH_PROC', String(e.message || e));
    process.exit(1);
  }
  try {
    adminToken = await getToken('ADMIN');
    pass('AUTH_ADMIN', 'test_admin');
  } catch (e) {
    fail('AUTH_ADMIN', String(e.message || e));
    process.exit(1);
  }

  // GET lean
  {
    const r = await fetch(`${BASE}/api/timesheet/v2/${YEAR}/${MONTH}?mode=global`, { headers: hdr(procToken) });
    const body = await r.json().catch(() => ({}));
    if (r.status !== 200) {
      fail('GET_LEAN', `status=${r.status} ${JSON.stringify(body).slice(0, 200)}`);
    } else {
      pass('GET_LEAN', `emps=${(body.employees || []).length} profile=${body.view_profile}`);
      if (body.view_profile === 'lean') pass('VIEW_PROFILE', 'lean');
      else fail('VIEW_PROFILE', String(body.view_profile));
      if (body.summary == null) pass('NO_SUMMARY', 'summary null');
      else fail('NO_SUMMARY', 'summary present');

      const emps = body.employees || [];
      const leak = emps.find((e) => e.city != null || e.pay_type != null || e.transfer_amount != null);
      if (!leak) pass('STRIP_FIELDS', 'no city/pay_type/transfer on employees');
      else fail('STRIP_FIELDS', `leak emp=${leak.id} city=${leak.city} pay_type=${leak.pay_type}`);

      let tipOk = false;
      for (const e of emps) {
        for (const k of Object.keys(e.days || {})) {
          const cell = e.days[k];
          if (cell && (cell.entered_by_fio || cell.work_title)) { tipOk = true; break; }
        }
        if (tipOk) break;
      }
      if (tipOk || emps.length === 0) pass('TOOLTIP_META', tipOk ? 'entered_by/work_title present' : 'no emps (skip)');
      else fail('TOOLTIP_META', 'no entered_by_fio/work_title in any cell');
    }
  }

  // PUT read-only
  {
    const r = await fetch(`${BASE}/api/timesheet/v2/entry`, {
      method: 'PUT',
      headers: hdr(procToken),
      body: JSON.stringify({
        employee_id: 1,
        date: `${YEAR}-${String(MONTH).padStart(2, '0')}-01`,
        type: 'day',
        work_id: 1
      })
    });
    const body = await r.json().catch(() => ({}));
    if (r.status === 403) pass('PUT_READONLY', body.error || '403');
    else fail('PUT_READONLY', `status=${r.status} ${JSON.stringify(body).slice(0, 120)}`);
  }

  // Export lean xlsx
  {
    const r = await fetch(
      `${BASE}/api/timesheet/v2/${YEAR}/${MONTH}/export?format=xlsx&include_per_diem=1`,
      { headers: { Authorization: 'Bearer ' + procToken } }
    );
    if (r.status !== 200) {
      const t = await r.text().catch(() => '');
      fail('EXPORT_LEAN', `status=${r.status} ${t.slice(0, 200)}`);
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, buf);
      pass('EXPORT_LEAN', `bytes=${buf.length} path=${OUT}`);

      // Parse sheets via ExcelJS if available
      try {
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const names = wb.worksheets.map((ws) => ws.name);
        if (names.length === 1 && (names[0] === 'Табель' || names[0].includes('Табель'))) {
          pass('EXPORT_SHEETS', `1 sheet: ${names[0]}`);
        } else {
          fail('EXPORT_SHEETS', `sheets=${JSON.stringify(names)}`);
        }
        const ws = wb.worksheets[0];
        const hdrRow = ws.getRow(3);
        const headers = [];
        hdrRow.eachCell({ includeEmpty: false }, (cell) => headers.push(String(cell.value || '')));
        const forbidden = ['Город', 'Тип', 'Получает', 'Оклад', 'На карту', 'Из кассы', 'Лимит СЗ'];
        const hit = forbidden.filter((f) => headers.some((h) => h.includes(f)));
        if (!hit.length) pass('EXPORT_COLS', `ok headers=${headers.filter(Boolean).slice(0, 8).join('|')}…`);
        else fail('EXPORT_COLS', `forbidden present: ${hit.join(',')}`);

        // Spot-check formula in Баллы / Сумма columns (after day cols)
        let formulaOk = false;
        ws.eachRow((row, rowNumber) => {
          if (rowNumber < 4) return;
          row.eachCell({ includeEmpty: false }, (cell) => {
            if (cell.formula && /SUM\(|\$D\$2/.test(cell.formula)) formulaOk = true;
          });
        });
        if (formulaOk) pass('EXPORT_FORMULAS', 'SUM / $D$2 present');
        else pass('EXPORT_FORMULAS', 'no data rows or formulas (empty month?)');
      } catch (e) {
        fail('EXPORT_PARSE', String(e.message || e));
      }
    }
  }

  // FULL smoke: ADMIN still gets summary + 2 sheets
  {
    const r = await fetch(`${BASE}/api/timesheet/v2/${YEAR}/${MONTH}?mode=global`, { headers: hdr(adminToken) });
    const body = await r.json().catch(() => ({}));
    if (r.status === 200 && body.view_profile === 'full' && body.summary) pass('ADMIN_FULL', 'summary+full');
    else fail('ADMIN_FULL', `status=${r.status} profile=${body.view_profile} summary=${!!body.summary}`);

    const xr = await fetch(
      `${BASE}/api/timesheet/v2/${YEAR}/${MONTH}/export?format=xlsx&include_per_diem=1`,
      { headers: { Authorization: 'Bearer ' + adminToken } }
    );
    if (xr.status !== 200) {
      fail('ADMIN_EXPORT', `status=${xr.status}`);
    } else {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await xr.arrayBuffer()));
      const names = wb.worksheets.map((ws) => ws.name);
      if (names.length >= 2) pass('ADMIN_EXPORT_SHEETS', names.join(' | '));
      else fail('ADMIN_EXPORT_SHEETS', JSON.stringify(names));
    }
  }

  const failed = results.filter((x) => !x.ok);
  console.log('\n====', results.length - failed.length, '/', results.length, 'PASS ====');
  if (failed.length) {
    failed.forEach((f) => console.log('  FAIL', f.id, f.detail));
    process.exit(1);
  }
  console.log('OUT_XLSX', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
