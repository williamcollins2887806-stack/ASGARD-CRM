/**
 * Диагностика дедупа на реальном тендере: почему два перечня НЕ схлопнулись.
 *
 * Запуск на проде:  node .deploy/diag-compare-2138.js --tender=2138
 *
 * Печатает по каждой паре файлов: ratio / ratio_volume / overlap, размеры,
 * распределение единиц и первые «только в A» / «только в B» отпечатки.
 * Ничего не пишет в БД.
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
  password: process.env.DB_PASSWORD || '123456789', database: 'asgard_crm', max: 3
});

const normUnit = (u) => String(u == null ? '' : u).toLowerCase().replace(/\s+/g, '').trim();
const volUnit = (p) => {
  const v = Number(p.volume);
  return (Number.isFinite(v) && v > 0 ? v.toFixed(2) : '—') + '|' + normUnit(p.unit);
};
const sigOf = (p) => volUnit(p) + '|' + es.normalizePeriodKey(p.period);

function unitHist(list) {
  const m = new Map();
  for (const p of list) {
    const u = normUnit(p.unit) || '(пусто)';
    m.set(u, (m.get(u) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

(async () => {
  const docsQ = await pool.query(
    `SELECT id, original_name AS name, ocr_status, length(COALESCE(ocr_text,'')) AS text_len
       FROM documents
      WHERE tender_id = $1
      ORDER BY id`, [TENDER_ID]
  );
  console.log('документов:', docsQ.rows.length);

  const parsed = [];
  for (const d of docsQ.rows) {
    if (!/\.xlsx?$/i.test(d.name)) continue;
    const f = await pool.query(
      `SELECT COALESCE(file_url, download_url, filename) AS path FROM documents WHERE id = $1`, [d.id]
    );
    const raw = (f.rows[0] && f.rows[0].path) || '';
    const rel = String(raw).replace(/^\/+/, '');
    const cand = [raw, APP + '/public/' + rel, APP + '/' + rel].filter(Boolean);
    let buf = null;
    for (const c of cand) {
      try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
    }
    if (!buf) { console.log('  нет файла:', d.id, d.name, raw); continue; }
    let p = null;
    try {
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
      p = es.parseWorkbook(XLSX, wb);
    } catch (e) {
      console.log('  ошибка разбора:', d.id, d.name, e.message);
      continue;
    }
    if (!p || !p.stats || !p.stats.positions) {
      console.log('  пусто:', d.id, d.name);
      continue;
    }
    parsed.push({ id: d.id, name: d.name, positions: p.positions });
    console.log(`#${d.id} ${d.name} -> ${p.stats.positions} поз., unit-гистограмма:`,
      JSON.stringify(unitHist(p.positions)));
  }

  if (parsed.length < 2) { console.log('сравнивать нечего'); await pool.end(); return; }

  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const a = parsed[i];
      const b = parsed[j];
      const cmp = es.compareLists(a.positions, b.positions);
      const setA = new Set(a.positions.map(sigOf));
      const setB = new Set(b.positions.map(sigOf));
      const onlyA = [...setA].filter((x) => !setB.has(x));
      const onlyB = [...setB].filter((x) => !setA.has(x));
      console.log('\n=== #' + a.id + ' vs #' + b.id + ' ===');
      console.log('  размеры:', a.positions.length, 'vs', b.positions.length);
      console.log('  ratio:', cmp.ratio, '| ratio_volume:', cmp.ratio_volume,
        '| overlap:', cmp.overlap, '| sameList:', cmp.sameList);
      console.log('  set-размеры:', setA.size, 'vs', setB.size,
        '| onlyA:', onlyA.length, '| onlyB:', onlyB.length);
      if (onlyA.length) console.log('  onlyA[0..7]:', JSON.stringify(onlyA.slice(0, 8)));
      if (onlyB.length) console.log('  onlyB[0..7]:', JSON.stringify(onlyB.slice(0, 8)));
      // Диагностика разъезда единиц: есть ли пары с одинаковым объёмом, но разной единицей.
      const byVolA = new Map();
      for (const p of a.positions) {
        const v = Number(p.volume);
        if (!(v > 0)) continue;
        const k = v.toFixed(2);
        if (!byVolA.has(k)) byVolA.set(k, new Set());
        byVolA.get(k).add(normUnit(p.unit));
      }
      let volSameUnitDiff = 0;
      const samples = [];
      for (const p of b.positions) {
        const v = Number(p.volume);
        if (!(v > 0)) continue;
        const k = v.toFixed(2);
        const ua = byVolA.get(k);
        if (!ua) continue;
        const ub = normUnit(p.unit);
        if (!ua.has(ub)) {
          volSameUnitDiff += 1;
          if (samples.length < 6) samples.push(k + ' A=' + [...ua].join('/') + ' B=' + (ub || '(пусто)'));
        }
      }
      console.log('  объём совпал, единица разошлась:', volSameUnitDiff);
      if (samples.length) console.log('    ', JSON.stringify(samples));
    }
  }

  await pool.end();
})().catch(async (e) => {
  console.log('FAIL', e.message);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
