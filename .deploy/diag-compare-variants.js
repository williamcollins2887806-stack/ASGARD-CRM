/**
 * Подбор правил compareLists на РЕАЛЬНЫХ файлах тендера.
 *
 * Считает ratio для вариантов и проверяет, что «разные» перечни не
 * схлопываются. Ничего не пишет, код приложения не меняет.
 *
 * node .deploy/diag-compare-variants.js --tender=2138
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

const MEASURE = /^(п\.?м|пог\.?\s*м|м\.?п|м2|м²|м3|м³|кв\.?\s*м|куб\.?\s*м|шт|т|тн|кг|компл|л|гкал|квт|апп|труб|секц|узел|элемент|ед)$/i;

function canonUnit(raw) {
  const s = String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/[²]/g, '2').replace(/[³]/g, '3')
    .replace(/[·•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  // Первый сегмент, который является мерой: «п.м трубок» → «пм»,
  // «м2 оребрения АВО» → «м2», «объём м3» → «м3».
  const parts = s.split(/[\s/]+/).filter(Boolean);
  for (const p of parts) {
    const c = p.replace(/[.,;:]+$/, '');
    if (MEASURE.test(c)) {
      if (/^(пог\.?м|п\.?м|м\.?п|мп|пм)$/.test(c)) return 'пм';
      if (/^(м2|кв\.?м|квм)$/.test(c)) return 'м2';
      if (/^(м3|куб\.?м|кубм)$/.test(c)) return 'м3';
      if (/^(шт|штук)[а-я]*$/.test(c)) return 'шт';
      if (/^т$|^тн$|^тонн/.test(c)) return 'т';
      return c;
    }
  }
  // Слипшиеся: «пмтрубок», «м2оребрения»
  const m = /^(пм|м2|м3|шт|т|кг|компл)/.exec(s.replace(/\s+/g, ''));
  if (m) return m[1];
  return s;
}

function ratios(listA, listB, opts) {
  const o = Object.assign({ canon: false, wildcard: false, tol: 0 }, opts || {});
  const unitOf = (p) => (o.canon ? canonUnit(p.unit) : String(p.unit || '').toLowerCase().replace(/\s+/g, '').trim());
  const volOf = (p) => {
    const v = Number(p.volume);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const keys = (p) => {
    const v = volOf(p);
    const u = unitOf(p);
    const per = es.normalizePeriodKey(p.period);
    const out = [];
    if (v != null) {
      out.push(v.toFixed(2) + '|' + (o.canon ? u : u) + '|' + per);
      out.push(v.toFixed(2) + '|' + (o.canon ? u : u));
      if (o.wildcard) {
        out.push(v.toFixed(2) + '|' + per);
        out.push(v.toFixed(2) + '|');
      }
    }
    return out;
  };
  // Матчим по объёму с допуском: для каждой позиции A ищем позицию B.
  const usedB = new Set();
  let matched = 0;
  const volB = listB.map((p, i) => ({ i, v: volOf(p), u: unitOf(p), per: es.normalizePeriodKey(p.period) }));
  for (const p of listA) {
    const v = volOf(p);
    if (v == null) continue;
    const u = unitOf(p);
    const per = es.normalizePeriodKey(p.period);
    let hit = -1;
    for (const b of volB) {
      if (usedB.has(b.i) || b.v == null) continue;
      const tol = Math.max(0.011, Math.abs(v) * o.tol);
      if (Math.abs(b.v - v) > tol) continue;
      if (o.canon) {
        // единица: либо совпала, либо у одной пусто
        if (u && b.u && u !== b.u) continue;
      } else if (u !== b.u) continue;
      // период не обязателен (второй проход без периода)
      hit = b.i;
      break;
    }
    if (hit >= 0) { usedB.add(hit); matched += 1; }
  }
  const min = Math.min(listA.length, listB.length);
  return { matched, ratio: Math.round((matched / Math.max(1, min)) * 1000) / 1000, min };
}

(async () => {
  const q = await pool.query(
    `SELECT id, original_name AS name, COALESCE(file_url, download_url, filename) AS path
       FROM documents WHERE tender_id = $1 AND original_name ~* '\\.xlsx?$' ORDER BY id`, [TENDER_ID]
  );
  const parsed = [];
  for (const d of q.rows) {
    const rel = String(d.path || '').replace(/^\/+/, '');
    let buf = null;
    for (const c of [d.path, APP + '/public/' + rel, APP + '/' + rel]) {
      try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
    }
    if (!buf) continue;
    let p = null;
    try {
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
      p = es.parseWorkbook(XLSX, wb);
    } catch (_) { continue; }
    if (p && p.stats.positions) parsed.push({ id: d.id, name: d.name, positions: p.positions });
  }
  console.log('файлов:', parsed.length);
  const variants = [
    { label: 'v0 текущий', opts: { canon: false, wildcard: false, tol: 0 } },
    { label: 'v1 канон ед.', opts: { canon: true, wildcard: false, tol: 0 } },
    { label: 'v1+пустая ед.', opts: { canon: true, wildcard: true, tol: 0 } },
    { label: 'v1+пустая ед.+tol1%', opts: { canon: true, wildcard: true, tol: 0.01 } }
  ];
  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const a = parsed[i];
      const b = parsed[j];
      if (i > 0 && a.name === parsed[0].name && b.name === parsed[0].name) continue; // копии формы
      console.log('\n### #' + a.id + ' vs #' + b.id + ' (' + a.positions.length + ' / ' + b.positions.length + ')');
      for (const v of variants) {
        const r1 = ratios(a.positions, b.positions, v.opts);
        const r2 = ratios(b.positions, a.positions, v.opts);
        console.log('  ', v.label, 'ratio_A→B', r1.ratio, '| B→A', r2.ratio,
          '| best', Math.max(r1.ratio, r2.ratio), '| matched', r1.matched, '/', r1.min);
      }
    }
  }
  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
