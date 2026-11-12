/**
 * Сырые ячейки единиц/объёмов на реальном файле: почему единица выходит
 * строкой вида «п.м трубок» и откуда расхождение объёмов.
 *
 * node .deploy/diag-units-2138.js --tender=2138
 */
const APP = '/var/www/asgard-crm';
process.chdir(APP);
const { Pool } = require(APP + '/node_modules/pg');
const XLSX = require(APP + '/node_modules/xlsx');
const fs = require('fs');
const es = require(APP + '/src/services/excel-structure');

const arg = process.argv.find((a) => /^--tender=/.test(a));
const TENDER_ID = arg ? Number(arg.split('=')[1]) : Number(process.env.TENDER_ID) || 2138;
const ONLY = process.argv.find((a) => /^--doc=/.test(a));

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
    if (ONLY && Number(String(ONLY).split('=')[1]) !== d.id) continue;
    const rel = String(d.path || '').replace(/^\/+/, '');
    let buf = null;
    for (const c of [d.path, APP + '/public/' + rel, APP + '/' + rel]) {
      try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
    }
    if (!buf) { console.log('нет файла', d.id, d.name); continue; }
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
    const parsed = es.parseWorkbook(XLSX, wb);
    console.log('\n#### #' + d.id, d.name, '->', parsed.stats.positions, 'поз.');
    console.log('листы:');
    for (const s of parsed.sheets) {
      console.log('  ', JSON.stringify({ name: s.name, rows: s.rows, header_row: s.header_row, mapped: s.mapped, columns: s.columns }));
    }
    // Сырые заголовки + юниты
    for (const name of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '', raw: false });
      for (let r = 0; r < Math.min(aoa.length, 12); r += 1) {
        const row = aoa[r] || [];
        const hit = row.some((c) => /объ[её]м|площад|осадок|ед\.?\s*изм|трубок|длин/i.test(String(c)));
        if (hit) console.log('  SHEET', name, 'r' + (r + 1), JSON.stringify(row.slice(0, 18)));
      }
    }
    const byUnit = new Map();
    for (const p of parsed.positions) {
      const k = String(p.unit == null ? '(пусто)' : p.unit);
      if (!byUnit.has(k)) byUnit.set(k, []);
      if (byUnit.get(k).length < 3) byUnit.get(k).push({ row: p.row, name: String(p.name).slice(0, 40), volume: p.volume, raw: p.raw_fields });
    }
    for (const [u, rows] of byUnit) {
      console.log('  UNIT', JSON.stringify(u), 'примеры:', JSON.stringify(rows));
    }
  }
  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
