/**
 * Полная шапка файлов: какие колонки реально есть и как их смапил parseWorkbook.
 *
 * node .deploy/diag-headers.js --tender=2138
 */
const APP = '/var/www/asgard-crm';
process.chdir(APP);
const { Pool } = require(APP + '/node_modules/pg');
const XLSX = require(APP + '/node_modules/xlsx');
const fs = require('fs');
const es = require(APP + '/src/services/excel-structure');

const arg = process.argv.find((a) => /^--tender=/.test(a));
const TENDER_ID = arg ? Number(arg.split('=')[1]) : Number(process.env.TENDER_ID) || 2138;

const pool = new Pool({
  host: 'localhost', port: 5432, user: 'asgard',
  password: process.env.DB_PASSWORD || '123456789', database: 'asgard_crm', max: 2
});

(async () => {
  const q = await pool.query(
    `SELECT id, original_name AS name, COALESCE(file_url, download_url, filename) AS path
       FROM documents WHERE tender_id = $1 AND original_name ~* '\\.xlsx?$' ORDER BY id`, [TENDER_ID]
  );
  const seen = new Set();
  for (const d of q.rows) {
    const base = String(d.name || '').replace(/\s+/g, '');
    if (seen.has(base)) continue;
    seen.add(base);
    const rel = String(d.path || '').replace(/^\/+/, '');
    let buf = null;
    for (const c of [d.path, APP + '/public/' + rel, APP + '/' + rel]) {
      try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
    }
    if (!buf) { console.log('нет файла', d.id, d.name); continue; }
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
    const p = es.parseWorkbook(XLSX, wb);
    console.log('\n#### #' + d.id, d.name);
    for (const s of p.sheets) {
      console.log('  sheet', JSON.stringify(s.name), 'header_row', s.header_row, 'positions', s.positions);
      console.log('    mapped:', JSON.stringify(s.mapped));
    }
    for (const sn of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false, defval: '', raw: false });
      let shown = 0;
      for (let r = 0; r < Math.min(aoa.length, 8); r += 1) {
        const row = aoa[r] || [];
        const nonEmpty = row.filter((c) => String(c).trim()).length;
        if (nonEmpty > 3) {
          console.log('  HEADER', sn, 'r' + (r + 1), '(' + nonEmpty + ' колонок)');
          row.forEach((c, i) => { if (String(c).trim()) console.log('     [' + i + ']', String(c).trim().slice(0, 70)); });
          shown += 1;
          if (shown >= 1) break;
        }
      }
    }
  }
  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
