/**
 * Проверка гипотезы: два перечня — ОДИН объём, по-разному нарезанный.
 * Сравниваем суммы объёмов (всего и по периодам) и распределение по единицам.
 *
 * node .deploy/diag-compare-sums.js --tender=2138
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

const sum = (list, f) => list.reduce((s, p) => s + (Number(f(p)) || 0), 0);
const r2 = (v) => Math.round(v * 100) / 100;

(async () => {
  const q = await pool.query(
    `SELECT id, original_name AS name, COALESCE(file_url, download_url, filename) AS path
       FROM documents WHERE tender_id = $1 AND original_name ~* '\\.xlsx?$' ORDER BY id`, [TENDER_ID]
  );
  const parsed = [];
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
    parsed.push({ id: d.id, name: d.name, positions: p.positions, parsed: p });
  }

  for (const f of parsed) {
    const list = f.positions;
    console.log('\n#### #' + f.id, f.name, '|', list.length, 'поз.');
    console.log('  Σ volume:', r2(sum(list, (p) => p.volume)));
    console.log('  Σ volume×clean_count:', r2(sum(list, (p) => (Number(p.volume) || 0) * (Number(p.clean_count) || 1))));
    console.log('  Σ mh:', r2(sum(list, (p) => p.mh)));
    const per = new Map();
    for (const p of list) {
      const k = es.normalizePeriodKey(p.period) || '(нет)';
      per.set(k, r2((per.get(k) || 0) + (Number(p.volume) || 0)));
    }
    console.log('  Σ по периодам:', JSON.stringify([...per.entries()].sort()));
    console.log('  чистки: 1 →', list.filter((p) => Number(p.clean_count) === 1).length,
      '| 2 →', list.filter((p) => Number(p.clean_count) === 2).length,
      '| пусто →', list.filter((p) => !p.clean_count).length);
  }

  if (parsed.length === 2) {
    const A = parsed[0].positions;
    const B = parsed[1].positions;
    const sA = sum(A, (p) => p.volume);
    const sB = sum(B, (p) => p.volume);
    const sAc = sum(A, (p) => (Number(p.volume) || 0) * (Number(p.clean_count) || 1));
    const sBc = sum(B, (p) => (Number(p.volume) || 0) * (Number(p.clean_count) || 1));
    console.log('\n=== ИТОГ ===');
    console.log('  Σ A:', r2(sA), '| Σ B:', r2(sB), '| B/A:', r2(sB / (sA || 1)));
    console.log('  Σ×чистки A:', r2(sAc), '| B:', r2(sBc), '| B/A:', r2(sBc / (sAc || 1)));
  }
  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
