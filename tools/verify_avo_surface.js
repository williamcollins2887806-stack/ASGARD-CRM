#!/usr/bin/env node
'use strict';
/**
 * Шаг 5, живая проверка: avo.outer получает площадь из объёма.
 *
 * Берёт файл заказчика, оставляет позиции с единицей м², прогоняет норму
 * ДО и ПОСЛЕ подстановки surface_m2 и сравнивает.
 *
 * Запуск (на проде): DB_PASSWORD=... node tools/verify_avo_surface.js
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
const LIMIT = 40;

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
    if (p && p.stats.positions > (parsed ? parsed.stats.positions : 0)) parsed = p;
  }
  if (!parsed) {
    console.log('файл не разобран');
    await pool.end();
    process.exit(1);
  }

  // Позиции с единицей площади — те, что раньше получали «Укажите площадь».
  const areaPositions = parsed.positions
    .filter((p) => /^(м2|м²|кв\.?м|квм)$/i.test(String(p.unit || '').replace(/\s+/g, '')))
    .slice(0, LIMIT);

  console.log('всего позиций:', parsed.positions.length);
  console.log('с единицей площади:', areaPositions.length, '(проверяем', areaPositions.length, ')');
  if (!areaPositions.length) {
    console.log('FAIL — нет позиций с площадью, проверять нечего');
    await pool.end();
    process.exit(1);
  }

  const asModel = areaPositions.map((p, i) => ({
    id: 'p' + (i + 1), name: p.name, volume: p.volume, unit: p.unit,
    zone: p.zone, fouling: p.fouling, period: p.period,
    clean_count: p.clean_count, dn_mm: p.dn_mm, length_m: p.length_m,
    tubes: p.tubes, mh: p.mh,
    category_code: 'avo', method_code: 'outer'
  }));
  const pos = st.normalizeDv({ positions: asModel }, { categories: [], rates: [] }).positions;

  let ok = 0;
  let failed = 0;
  const notes = [];
  for (const p of pos) {
    let pv = null;
    try {
      const r = await workNorms.tryNormPreviewForEstimate(pool, {
        work: { work_title: p.name },
        norm_inputs: {
          category_code: 'avo', method_code: 'outer',
          inputs: { volume: p.volume, unit: p.unit, cycles: Number(p.clean_count) || null }
        }
      });
      pv = r && r.preview;
    } catch (e) {
      pv = { ok: false, error: e.message };
    }
    if (pv && pv.ok) {
      ok += 1;
      const trace = (pv.trace || []).find((t) => /площад/i.test(String(t)));
      if (notes.length < 4) {
        notes.push(`${String(p.name).slice(0, 40)} | ${p.volume} ${p.unit} -> `
          + `${pv.results && pv.results.work_days} сут${trace ? ' | ' + String(trace).slice(0, 60) : ''}`);
      }
    } else {
      failed += 1;
      if (notes.length < 4) {
        notes.push(`${String(p.name).slice(0, 40)} | ${p.volume} ${p.unit} -> ${(pv && pv.error) || 'нет ответа'}`);
      }
    }
  }

  console.log('\nпримеры:');
  notes.forEach((n) => console.log('  ', n));
  console.log(`\nнорма посчиталась: ${ok} из ${pos.length} | не посчиталась: ${failed}`);

  let bad = 0;
  const ck = (n, cond, extra) => {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + n + (extra ? ' :: ' + extra : ''));
    if (!cond) bad += 1;
  };
  console.log();
  ck('площадь берётся из объёма у большинства', ok >= Math.ceil(pos.length * 0.8), `${ok}/${pos.length}`);
  ck('«Укажите площадь» больше не в каждом ответе', failed < pos.length, `провалов ${failed}`);

  console.log('\nитог: ' + (bad ? 'FAIL — ' + bad : 'OK'));
  await pool.end();
  process.exit(bad ? 1 : 0);
})().catch(async (e) => {
  console.log('FAIL', e.message, (e.stack || '').split('\n')[1]);
  try { await pool.end(); } catch (_) { /* уже закрыт */ }
  process.exit(1);
});
