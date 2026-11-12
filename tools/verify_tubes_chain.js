#!/usr/bin/env node
'use strict';
/**
 * Шаг 4, проверка ЦЕПОЧКИ: парсер -> normalizeDv -> норма.
 *
 * Снимок карточки для этого не годится: он уже содержит результат разбора,
 * где tubes потерялись. Берём файл заказчика, парсим текущим excel-structure,
 * прогоняем через текущий normalizeDv и вызываем норму.
 *
 * Запуск (на проде): DB_PASSWORD=... node tools/verify_tubes_chain.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
const es = require(path.join(ROOT, 'src', 'services', 'excel-structure'));
const st = require(path.join(ROOT, 'src', 'services', 'mimir-tender-stages'));
const workNorms = require(path.join(ROOT, 'src', 'services', 'work-norms'));

const TENDER = Number((process.argv.find((a) => /^--tender=/.test(a)) || '').split('=')[1]) || 2138;
const LIMIT = Number((process.argv.find((a) => /^--limit=/.test(a)) || '').split('=')[1]) || 25;

const pool = new Pool({
  host: 'localhost',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
  database: process.env.DB_NAME || 'asgard_crm',
  max: 2
});

(async () => {
  const q = await pool.query(
    "SELECT id, original_name AS name, COALESCE(file_url, download_url, filename) AS path "
    + "FROM documents WHERE tender_id = $1 AND original_name ~* '\\.xlsx?$' ORDER BY id",
    [TENDER]);

  const seen = new Set();
  let parsed = null;
  let file = '';
  for (const d of q.rows) {
    const base = String(d.name || '').replace(/\s+/g, '');
    if (seen.has(base)) continue;
    seen.add(base);
    const rel = String(d.path || '').replace(/^\/+/, '');
    let buf = null;
    for (const c of [d.path, path.join(ROOT, 'public', rel), path.join(ROOT, rel)]) {
      try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) { /* нет файла */ }
    }
    if (!buf) continue;
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
    const p = es.parseWorkbook(XLSX, wb);
    if (p && p.stats.positions > (parsed ? parsed.stats.positions : 0)) {
      parsed = p;
      file = `#${d.id} ${d.name}`;
    }
  }
  if (!parsed) {
    console.log('файл не разобран');
    await pool.end();
    process.exit(1);
  }

  console.log('файл:', file);
  console.log('парсер: позиций', parsed.positions.length,
    '| tubes > 0', parsed.positions.filter((p) => Number(p.tubes) > 0).length,
    '| length_m > 0', parsed.positions.filter((p) => Number(p.length_m) > 0).length,
    '| clean_count > 0', parsed.positions.filter((p) => Number(p.clean_count) > 0).length);

  // Позиции парсера -> формат ответа модели -> normalizeDv.
  const asModel = parsed.positions.map((p, i) => ({
    id: 'p' + (i + 1),
    name: p.name,
    volume: p.volume,
    unit: p.unit,
    zone: p.zone,
    fouling: p.fouling,
    period: p.period,
    clean_count: p.clean_count,
    dn_mm: p.dn_mm,
    length_m: p.length_m,
    tubes: p.tubes,
    mh: p.mh,
    category_code: 'tubes',
    method_code: 'gdo'
  }));

  const normalized = st.normalizeDv({ positions: asModel }, { categories: [], rates: [] });
  const pos = normalized.positions;
  const nTubes = pos.filter((p) => Number(p.tubes) > 0).length;
  const nLen = pos.filter((p) => Number(p.conversion_params && p.conversion_params.length_m) > 0).length;
  console.log('после normalizeDv: tubes > 0 у', nTubes, '| length_m у', nLen, 'из', pos.length);

  const sample = pos.filter((p) => Number(p.tubes) > 0 && Number(p.conversion_params && p.conversion_params.length_m) > 0)
    .slice(0, LIMIT);
  console.log('проверяем норму по', sample.length, 'позициям');

  let ok = 0;
  let need = 0;
  const notes = [];
  for (const p of sample) {
    const inputs = {
      volume: p.volume,
      unit: p.unit,
      tubes: p.tubes,
      diameter_mm: p.conversion_params.dn_mm,
      length_m: p.conversion_params.length_m,
      cycles: Number(p.clean_count) > 0 ? Number(p.clean_count) : null,
      fouling: p.fouling || 'medium'
    };
    let pv = null;
    try {
      const r = await workNorms.tryNormPreviewForEstimate(pool, {
        work: { work_title: p.name },
        norm_inputs: { category_code: 'tubes', method_code: 'gdo', inputs }
      });
      pv = r && r.preview;
    } catch (e) {
      pv = { ok: false, error: e.message };
    }
    if (pv && pv.ok) {
      ok += 1;
      if (notes.length < 3) {
        notes.push(`${String(p.name).slice(0, 42)} | tubes ${p.tubes} len ${p.conversion_params.length_m} -> `
          + `${pv.results && pv.results.work_days} сут / ${Math.round((pv.results && pv.results.man_hours) || 0)} чел·ч`);
      }
    } else {
      need += 1;
      if (notes.length < 3) {
        notes.push(`${String(p.name).slice(0, 42)} | tubes ${p.tubes} len ${p.conversion_params.length_m} -> `
          + `${(pv && pv.error) || 'нет ответа'}`);
      }
    }
  }

  console.log('\nпримеры:');
  notes.forEach((n) => console.log('  ', n));
  console.log(`\nнорма посчиталась: ${ok} из ${sample.length} | не посчиталась: ${need}`);

  let bad = 0;
  const ck = (n, cond, extra) => {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + n + (extra ? ' :: ' + extra : ''));
    if (!cond) bad += 1;
  };
  console.log();
  ck('tubes доезжают от парсера до позиции', nTubes >= parsed.positions.filter((p) => Number(p.tubes) > 0).length * 0.9,
    `${nTubes} из ${parsed.positions.filter((p) => Number(p.tubes) > 0).length}`);
  ck('length_m в метрах (не 6090)', pos.filter((p) => p.conversion_params && p.conversion_params.length_m > 100).length === 0);
  ck('норма считает большинство', ok >= Math.ceil(sample.length * 0.8), `${ok}/${sample.length}`);

  console.log('\nитог: ' + (bad ? 'FAIL — ' + bad : 'OK'));
  await pool.end();
  process.exit(bad ? 1 : 0);
})().catch(async (e) => {
  console.log('FAIL', e.message, (e.stack || '').split('\n')[1]);
  try { await pool.end(); } catch (_) { /* уже закрыт */ }
  process.exit(1);
});
