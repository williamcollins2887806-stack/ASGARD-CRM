/**
 * Один ли это перечень: сравниваем ПОЗИЦИИ ПО НАЗВАНИЯМ и по порядку строк,
 * а не по объёмам. Если названия совпадают, а объёмы нет — это один перечень,
 * где один файл считает «за год», другой «на 1 чистку».
 *
 * node .deploy/diag-compare-names.js --tender=2138
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

const normName = (s) => String(s || '')
  .toLowerCase()
  .replace(/\u00a0/g, ' ')
  .replace(/[«»"'`]/g, '')
  .replace(/\bпоз\.?\s*/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

(async () => {
  const q = await pool.query(
    `SELECT id, original_name AS name, COALESCE(file_url, download_url, filename) AS path
       FROM documents WHERE tender_id = $1 AND original_name ~* '\\.xlsx?$' ORDER BY id`, [TENDER_ID]
  );
  const pick = new Set();
  for (const d of q.rows) {
    if (/Форма тендерного/i.test(d.name)) { if (!pick.size) pick.add(d.id); }
    else pick.add(d.id);
  }
  const parsed = [];
  for (const d of q.rows) {
    if (!pick.has(d.id)) continue;
    const rel = String(d.path || '').replace(/^\/+/, '');
    let buf = null;
    for (const c of [d.path, APP + '/public/' + rel, APP + '/' + rel]) {
      try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
    }
    if (!buf) continue;
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
    const p = es.parseWorkbook(XLSX, wb);
    if (p && p.stats.positions) parsed.push({ id: d.id, name: d.name, positions: p.positions });
  }
  if (parsed.length < 2) { console.log('мало файлов:', parsed.map((x) => x.id)); await pool.end(); return; }

  const A = parsed[0];
  const B = parsed[1];
  console.log('A #' + A.id, A.name, A.positions.length);
  console.log('B #' + B.id, B.name, B.positions.length);

  const nameA = A.positions.map((p) => normName(p.name));
  const nameB = B.positions.map((p) => normName(p.name));
  const setA = new Set(nameA);
  const setB = new Set(nameB);
  let common = 0;
  for (const x of setA) if (setB.has(x)) common += 1;
  console.log('\nназваний уникальных:', setA.size, '/', setB.size, '| общих:', common,
    '| ratio:', Math.round((common / Math.min(setA.size, setB.size)) * 1000) / 1000);

  // Построчно: тот же порядок?
  let sameOrder = 0;
  for (let i = 0; i < Math.min(nameA.length, nameB.length); i += 1) {
    if (nameA[i] === nameB[i]) sameOrder += 1;
  }
  console.log('совпало по порядку строк:', sameOrder, 'из', Math.min(nameA.length, nameB.length));

  // Первые 12 пар
  console.log('\nпервые 12 пар (A name | A vol | B name | B vol | B/A по объёму):');
  for (let i = 0; i < 12; i += 1) {
    const a = A.positions[i] || {};
    const b = B.positions[i] || {};
    const ra = Number(a.volume);
    const rb = Number(b.volume);
    const k = ra > 0 && rb > 0 ? (Math.round((rb / ra) * 100) / 100) : null;
    console.log(' ', i + 1, '|', String(a.name).slice(0, 42), '|', ra, '|',
      String(b.name).slice(0, 42), '|', rb, '|', k);
  }

  // Совпавшие названия: как относятся объёмы
  const byNameB = new Map();
  for (const p of B.positions) {
    const k = normName(p.name);
    if (!byNameB.has(k)) byNameB.set(k, []);
    byNameB.get(k).push(Number(p.volume) || 0);
  }
  const ratios = [];
  for (const p of A.positions) {
    const k = normName(p.name);
    const arr = byNameB.get(k);
    if (!arr || !arr.length) continue;
    const ra = Number(p.volume);
    if (!(ra > 0)) continue;
    for (const rb of arr) {
      if (rb > 0) ratios.push(Math.round((rb / ra) * 100) / 100);
    }
  }
  const hist = new Map();
  for (const r of ratios) {
    const k = r < 0.5 ? '<0.5' : r < 0.9 ? '0.5-0.9' : r < 1.1 ? '~1' : r < 2 ? '1-2' : r < 5 ? '2-5' : '>5';
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  console.log('\nотношение объёмов по совпавшим названиям:', JSON.stringify([...hist.entries()]),
    '| всего пар:', ratios.length);
  console.log('примеры отношений:', JSON.stringify(ratios.slice(0, 20)));

  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
