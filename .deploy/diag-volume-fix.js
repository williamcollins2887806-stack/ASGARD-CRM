/**
 * Проверка гипотезы о корне дедупа: объём в «Форме» считается ИЗ ГЕОМЕТРИИ
 * с двойным счётом трубок и ложным «мм» в слове «Суммарная».
 *
 * Считает: (1) текущий объём, (2) объём после исправления, (3) ratio дедупа
 * в обоих случаях. Ничего не пишет.
 *
 * node .deploy/diag-volume-fix.js --tender=2138
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

// Та же логика, что в parseWorkbook, но с исправлением:
//  • «мм» ищем как ОТДЕЛЬНЫЙ сегмент, а не подстроку (в «Суммарная» есть «мм»);
//  • колонка «Суммарная длина …» — это УЖЕ сумма по всем трубкам, умножать на N нельзя.
function computeVolume(headCell, tubesRaw, lenRaw) {
  const head = String(headCell || '').toLowerCase();
  const tubes = Number(String(tubesRaw).replace(/\s/g, '').replace(',', '.'));
  const len = Number(String(lenRaw).replace(/\s/g, '').replace(',', '.'));
  if (!(len > 0)) return null;
  const isTotal = /суммарн/.test(head);
  const isMm = /(^|[^а-яё])мм([^а-яё]|$)/.test(head);
  const lenM = isMm ? len / 1000 : len;
  if (isTotal) return lenM;                       // уже сумма
  if (Number.isFinite(tubes) && tubes > 0) return tubes * lenM;
  return lenM;
}

const normUnit = (u) => String(u == null ? '' : u).toLowerCase().replace(/\s+/g, '').trim();
// Канон единицы: мера — ПЕРВЫЙ сегмент, а не вся строка («п.м трубок» → «пм»).
function canonUnit(raw) {
  const s = String(raw == null ? '' : raw).toLowerCase()
    .replace(/\u00a0/g, ' ').replace(/[²]/g, '2').replace(/[³]/g, '3')
    .replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const parts = s.split(/[\s/]+/).filter(Boolean);
  for (const p of parts) {
    const c = p.replace(/[.,;:]+$/, '');
    if (/^(пог\.?м|п\.?м|м\.?п|мп|пм|пмтрубок)$/.test(c)) return 'пм';
    if (/^(м2|кв\.?м|квм)$/.test(c)) return 'м2';
    if (/^(м3|куб\.?м|кубм)$/.test(c)) return 'м3';
    if (/^(шт|штук[а-я]*)$/.test(c)) return 'шт';
    if (/^(т|тн|тонн[а-я]*)$/.test(c)) return 'т';
    if (/^(кг|г|л|мл|км|см|мм|м|компл|комплект[а-я]*|гкал|ккал|квт|мвт|апп|труб[а-я]*|секц[а-я]*|узел|элемент[а-я]*)$/.test(c)) return c;
  }
  const m = /^(пм|м2|м3|шт|т|кг|компл|л)/.exec(s.replace(/\s+/g, ''));
  return m ? m[1] : s.replace(/\s+/g, '');
}
const r3 = (v) => Math.round(v * 1000) / 1000;

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

    // Пересчитываем объём по исправленному правилу там, где он был из геометрии.
    const fixed = [];
    for (const s of p.sheets) {
      if (!s.positions) continue;
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[s.name], { header: 1, blankrows: false, defval: '', raw: false });
      const headerRow = aoa[s.header_row] || [];
      const cols = {
        tubes: s.mapped.tubes != null ? headerRow[s.mapped.tubes] : null,
        len: s.mapped.length_m != null ? headerRow[s.mapped.length_m] : null
      };
      const rows = p.positions.filter((x) => x.sheet === s.name);
      for (const pos of rows) {
        const raw = aoa[pos.row - 1] || [];
        const tubesRaw = s.mapped.tubes != null ? raw[s.mapped.tubes] : '';
        const lenRaw = s.mapped.length_m != null ? raw[s.mapped.length_m] : '';
        const hasVolumeCol = s.mapped.volume != null;
        let vol = pos.volume;
        if (!hasVolumeCol) {
          const v = computeVolume(cols.len, tubesRaw, lenRaw);
          if (v != null && v > 0) vol = v;
        }
        fixed.push(Object.assign({}, pos, { volume: vol }));
      }
    }
    files.push({ id: d.id, name: d.name, positions: p.positions, fixedPositions: fixed });
  }

  for (const f of files) {
    const sumOld = f.positions.reduce((s, p) => s + (Number(p.volume) || 0), 0);
    const sumNew = f.fixedPositions.reduce((s, p) => s + (Number(p.volume) || 0), 0);
    console.log('#%s %s | %d поз. | Σ volume сейчас %s → после фикса %s',
      f.id, String(f.name).slice(0, 50), f.positions.length, r3(sumOld), r3(sumNew));
  }

  console.log('\n=== ratio дедупа (volume|unit, без периода) ===');
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const a = files[i];
      const b = files[j];
      const cmpOld = es.compareLists(a.positions, b.positions);
      const cmpNew = es.compareLists(a.fixedPositions, b.fixedPositions);
      console.log('  #' + a.id + ' vs #' + b.id + ' | сейчас ratio', cmpOld.ratio, cmpOld.sameList,
        '| после фикса объёма ratio', cmpNew.ratio, cmpNew.sameList);
    }
  }

  // Разъезды объёмов после фикса — что осталось и почему.
  if (files.length >= 2) {
    const a = files[0].fixedPositions;
    const b = files[1].fixedPositions;
    const key = (p) => (Number(p.volume) > 0 ? Number(p.volume).toFixed(2) : '—') + '|' + normUnit(p.unit);
    const keysB = new Set(b.map(key));
    const miss = a.map(key).filter((k) => !keysB.has(k));
    console.log('\nпосле фикса не совпало по volume|unit (точно):', miss.length, 'из', a.length);
    // С допуском 1% по объёму (округление в источнике).
    const byVolB = new Map();
    for (const p of b) {
      const v = Number(p.volume);
      if (!(v > 0)) continue;
      const u = canonUnit(p.unit);
      if (!byVolB.has(u)) byVolB.set(u, []);
      byVolB.get(u).push(v);
    }
    let nearHit = 0;
    const nearMiss = [];
    for (const p of a) {
      const v = Number(p.volume);
      if (!(v > 0)) continue;
      const arr = byVolB.get(canonUnit(p.unit)) || [];
      const ok = arr.some((x) => Math.abs(x - v) <= Math.max(1, Math.abs(v) * 0.01));
      if (ok) nearHit += 1;
      else if (nearMiss.length < 10) nearMiss.push(v.toFixed(2) + '|' + canonUnit(p.unit));
    }
    console.log('совпало с каноном единицы + допуском 1%:', nearHit, 'из', a.filter((p) => Number(p.volume) > 0).length);
    console.log('не совпало (примеры):', JSON.stringify(nearMiss));
    const hist = new Map();
    for (const m of miss) {
      const u = m.split('|')[1] || '(пусто)';
      hist.set(u, (hist.get(u) || 0) + 1);
    }
    console.log('  точных промахов по единицам:', JSON.stringify([...hist.entries()]));
  }

  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
