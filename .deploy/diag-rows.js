/**
 * Факты по двум файлам: полная шапка, сырые значения первых строк и то,
 * что реально посчитал parseWorkbook. Без догадок.
 *
 * node .deploy/diag-rows.js --tender=2138
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
  for (const d of q.rows) {
    if (!/1460|1572$/.test(String(d.id))) continue;
    const rel = String(d.path || '').replace(/^\/+/, '');
    let buf = null;
    for (const c of [d.path, APP + '/public/' + rel, APP + '/' + rel]) {
      try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
    }
    if (!buf) continue;
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
    const p = es.parseWorkbook(XLSX, wb);
    console.log('\n################ #' + d.id, d.name);
    const sheetName = p.sheets.filter((s) => s.positions > 0)[0].name;
    const head = p.sheets.find((s) => s.name === sheetName);
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: '', raw: false });
    console.log('лист:', sheetName, '| header_row:', head.header_row, '| mapped:', JSON.stringify(head.mapped));
    console.log('ПОЛНАЯ ШАПКА:');
    (aoa[head.header_row] || []).forEach((c, i) => {
      if (String(c).trim()) console.log('   [' + i + ']', String(c).trim().slice(0, 80));
    });
    console.log('СЫРЫЕ СТРОКИ 2..4 и что посчитал parseWorkbook:');
    for (let r = 1; r <= 3; r += 1) {
      const row = aoa[head.header_row + r] || [];
      const pos = p.positions.filter((x) => x.sheet === sheetName)[r - 1] || {};
      console.log('  --- строка', head.header_row + r + 1, '---');
      Object.keys(head.mapped).forEach((f) => {
        console.log('     ', f, '[' + head.mapped[f] + '] =', JSON.stringify(String(row[head.mapped[f]] || '').slice(0, 40)));
      });
      console.log('      => parsed:', JSON.stringify({
        name: pos.name, volume: pos.volume, unit: pos.unit, clean_count: pos.clean_count,
        tubes: pos.tubes, length_m: pos.length_m, mh: pos.mh, period: pos.period
      }));
    }
  }
  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
