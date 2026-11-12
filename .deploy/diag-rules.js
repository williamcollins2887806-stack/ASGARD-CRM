/**
 * Финальная проверка правил дедупа на реальных данных 2138.
 *
 * Проверяет ОДНОВРЕМЕННО:
 *   • файл «Форма» vs файл «Дефектная ведомость» → должны схлопнуться;
 *   • разные приложения ВНУТРИ одного файла → НЕ должны схлопнуться;
 *   • копии «Формы» → должны схлопнуться.
 *
 * node .deploy/diag-rules.js --tender=2138
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

// ── правила ─────────────────────────────────────────────────────────────────
function canonUnit(raw) {
  const s = String(raw == null ? '' : raw).toLowerCase()
    .replace(/\u00a0/g, ' ').replace(/[²]/g, '2').replace(/[³]/g, '3')
    .replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const parts = s.split(/[\s/]+/).filter(Boolean);
  for (const p of parts) {
    const c = p.replace(/[.,;:]+$/, '');
    if (/^(пог\.?м|п\.?м|м\.?п|мп|пм)$/.test(c)) return 'пм';
    if (/^(м2|кв\.?м|квм)$/.test(c)) return 'м2';
    if (/^(м3|куб\.?м|кубм)$/.test(c)) return 'м3';
    if (/^(шт|штук[а-я]*)$/.test(c)) return 'шт';
    if (/^(т|тн|тонн[а-я]*)$/.test(c)) return 'т';
    if (/^(кг|г|л|мл|км|см|мм|м|компл|комплект[а-я]*|гкал|ккал|квт|мвт|апп|труб[а-я]*|секц[а-я]*|узел|элемент[а-я]*)$/.test(c)) return c;
  }
  const m = /^(пм|м2|м3|шт|т|кг|компл|л)/.exec(s.replace(/\s+/g, ''));
  return m ? m[1] : s.replace(/\s+/g, '');
}

function computeVolume(headCell, tubesRaw, lenRaw) {
  const head = String(headCell || '').toLowerCase();
  const tubes = Number(String(tubesRaw).replace(/\s/g, '').replace(',', '.'));
  const len = Number(String(lenRaw).replace(/\s/g, '').replace(',', '.'));
  if (!(len > 0)) return null;
  const isTotal = /суммарн/.test(head);
  const isMm = /(^|[^а-яё])мм([^а-яё]|$)/.test(head);
  const lenM = isMm ? len / 1000 : len;
  if (isTotal) return lenM;
  if (Number.isFinite(tubes) && tubes > 0) return tubes * lenM;
  return lenM;
}

/** Мягкий матч: канон единицы, пустая единица = wildcard, объём ±tol. */
function softRatio(listA, listB, tol) {
  const usable = (list) => list.filter((p) => Number(p.volume) > 0);
  const A = usable(listA);
  const B = usable(listB);
  if (!A.length || !B.length) return 0;
  const byUnit = new Map();
  for (const p of B) {
    const u = canonUnit(p.unit);
    if (!byUnit.has(u)) byUnit.set(u, []);
    byUnit.get(u).push(Number(p.volume));
  }
  for (const arr of byUnit.values()) arr.sort((x, y) => x - y);
  const near = (arr, v) => {
    if (!arr || !arr.length) return false;
    const t = Math.max(0.011, Math.abs(v) * tol);
    let lo = 0;
    let hi = arr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < v - t) lo = mid + 1;
      else if (arr[mid] > v + t) hi = mid - 1;
      else return true;
    }
    return false;
  };
  let matched = 0;
  for (const p of A) {
    const v = Number(p.volume);
    const u = canonUnit(p.unit);
    if (near(byUnit.get(u), v)) { matched += 1; continue; }
    // пустая единица — wildcard по любому канону
    if (!u) {
      let any = false;
      for (const arr of byUnit.values()) { if (near(arr, v)) { any = true; break; } }
      if (any) { matched += 1; continue; }
    }
    // единица A есть, в B пусто — тоже допускаем
    if (u && near(byUnit.get(''), v)) matched += 1;
  }
  return Math.round((matched / Math.min(A.length, B.length)) * 1000) / 1000;
}

(async () => {
  const q = await pool.query(
    `SELECT id, original_name AS name, COALESCE(file_url, download_url, filename) AS path
       FROM documents WHERE tender_id = $1 AND original_name ~* '\\.xlsx?$' ORDER BY id`, [TENDER_ID]
  );
  const files = [];
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
    if (!buf) continue;
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
    const p = es.parseWorkbook(XLSX, wb);
    if (!p || !p.stats.positions) continue;

    const fixed = [];
    for (const s of p.sheets) {
      if (!s.positions) continue;
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[s.name], { header: 1, blankrows: false, defval: '', raw: false });
      const headerRow = aoa[s.header_row] || [];
      const lenHead = s.mapped.length_m != null ? headerRow[s.mapped.length_m] : '';
      for (const pos of p.positions.filter((x) => x.sheet === s.name)) {
        const raw = aoa[pos.row - 1] || [];
        let vol = pos.volume;
        if (s.mapped.volume == null && s.mapped.length_m != null) {
          const v = computeVolume(lenHead, raw[s.mapped.tubes], raw[s.mapped.length_m]);
          if (v != null && v > 0) vol = v;
        }
        // единица из заголовка колонки объёма, если колонки единиц нет
        let unit = pos.unit;
        if (!unit && s.mapped.volume != null) {
          const hcol = String(headerRow[s.mapped.volume] || '');
          const m = /(м2|м²|м3|м³|п\.?м|пог\.?м|шт|тн|т|кг)/i.exec(hcol);
          if (m) unit = m[1];
        }
        fixed.push(Object.assign({}, pos, { volume: vol, unit }));
      }
    }
    files.push({ id: d.id, name: d.name, positions: fixed });
  }

  console.log('=== ФАЙЛ vs ФАЙЛ ===');
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const a = files[i];
      const b = files[j];
      const exact = es.compareLists(a.positions, b.positions);
      const s0 = softRatio(a.positions, b.positions, 0);
      const s1 = softRatio(a.positions, b.positions, 0.01);
      console.log('  #' + a.id + ' vs #' + b.id,
        '| exact', exact.ratio, '| soft0%', s0, '| soft1%', s1,
        '|', a.positions.length, '/', b.positions.length);
    }
  }

  console.log('\n=== ЛИСТ vs ЛИСТ (разные приложения НЕ должны схлопнуться) ===');
  const normName = (s) => String(s || '').toLowerCase().replace(/\u00a0/g, ' ').replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim();
  const nameRatio = (a, b) => {
    const A = new Set(a.map((p) => normName(p.name)).filter(Boolean));
    const B = new Set(b.map((p) => normName(p.name)).filter(Boolean));
    if (!A.size || !B.size) return 0;
    let c = 0;
    for (const x of A) if (B.has(x)) c += 1;
    return Math.round((c / Math.min(A.size, B.size)) * 1000) / 1000;
  };
  for (const f of files) {
    const bySheet = new Map();
    for (const p of f.positions) {
      if (!bySheet.has(p.sheet)) bySheet.set(p.sheet, []);
      bySheet.get(p.sheet).push(p);
    }
    const keys = [...bySheet.keys()];
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const a = bySheet.get(keys[i]);
        const b = bySheet.get(keys[j]);
        if (a.length < 5 || b.length < 5) continue;
        const s1 = softRatio(a, b, 0.01);
        const nr = nameRatio(a, b);
        console.log('  #' + f.id, keys[i], a.length, 'vs', keys[j], b.length,
          '→ soft1%', s1, '| name-ratio', nr);
      }
    }
  }
  console.log('\n=== name-ratio по файлам ===');
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      console.log('  #' + files[i].id + ' vs #' + files[j].id,
        '| name-ratio', nameRatio(files[i].positions, files[j].positions));
    }
  }

  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
