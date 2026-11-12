#!/usr/bin/env node
'use strict';
/**
 * Шаг 4, живая проверка: норма tubes.gdo считается по сохранённым позициям.
 *
 * Берёт снимок карточки, прогоняет normalizeDv (текущая логика) и проверяет,
 * что норма отвечает не «Укажите число трубок», а даёт часы.
 *
 * Запуск (на проде): DB_PASSWORD=... node tools/verify_tubes_norm_live.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const st = require(path.join(ROOT, 'src', 'services', 'mimir-tender-stages'));
const workNorms = require(path.join(ROOT, 'src', 'services', 'work-norms'));

const argOf = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? String(hit).split('=').slice(1).join('=') : def;
};

const SNAP = argOf('snapshot', '');
const LIMIT = Number(argOf('limit', 30));

const pool = new Pool({
  host: 'localhost',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
  database: process.env.DB_NAME || 'asgard_crm',
  max: 2
});

function latestSnapshot() {
  if (SNAP && fs.existsSync(SNAP)) return SNAP;
  const dir = '/root/snapshots';
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^card-\d+-.*\.json$/.test(f)).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

(async () => {
  const snapPath = latestSnapshot();
  if (!snapPath) {
    console.log('нет снимка карточки');
    await pool.end();
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const rj = snap.report_json || {};
  const all = Array.isArray(rj.dv_positions) ? rj.dv_positions : [];
  const tubes = all.filter((p) => p.category_code === 'tubes');
  console.log('снимок:', path.basename(snapPath));
  console.log('позиций:', all.length, '| tubes:', tubes.length);

  // Прогоняем normalizeDv по «сырым» позициям снимка: они уже прошли
  // нормализацию, но у них ДОЛЖНЫ появиться tubes и length_m в метрах.
  const normalized = st.normalizeDv({ positions: all.slice(0, 400) }, { categories: [], rates: [] });
  const withTubes = normalized.positions.filter((p) => Number(p.tubes) > 0).length;
  const withLen = normalized.positions.filter((p) => Number(p.conversion_params && p.conversion_params.length_m) > 0).length;
  console.log('после normalizeDv: tubes > 0 у', withTubes, '| length_m у', withLen);

  const sample = normalized.positions
    .filter((p) => p.category_code === 'tubes' && Number(p.tubes) > 0)
    .slice(0, LIMIT);
  console.log('проверяем норму по', sample.length, 'позициям tubes');
  if (!sample.length) {
    console.log('FAIL — нет позиций с tubes, проверять нечего');
    await pool.end();
    process.exit(1);
  }

  let ok = 0;
  let needInput = 0;
  let other = 0;
  const samples = [];
  for (const p of sample) {
    const inputs = {
      volume: p.volume,
      unit: p.unit,
      tubes: p.tubes,
      diameter_mm: p.conversion_params && p.conversion_params.dn_mm,
      length_m: p.conversion_params && p.conversion_params.length_m,
      cycles: Number(p.clean_count) > 0 ? Number(p.clean_count) : null,
      fouling: p.fouling || 'medium'
    };
    let preview = null;
    try {
      const r = await workNorms.tryNormPreviewForEstimate(pool, {
        work: { work_title: p.name },
        norm_inputs: { category_code: 'tubes', method_code: 'gdo', inputs }
      });
      preview = r && r.preview;
    } catch (e) {
      preview = { ok: false, error: e.message };
    }
    if (preview && preview.ok) {
      ok += 1;
      if (samples.length < 3) {
        samples.push(`${String(p.name).slice(0, 40)} -> ${preview.results && preview.results.work_days} сут, `
          + `${Math.round((preview.results && preview.results.man_hours) || 0)} чел·ч`);
      }
    } else if (preview && preview.needs_input) {
      needInput += 1;
      if (samples.length < 3) {
        samples.push(`${String(p.name).slice(0, 40)} -> needs_input: ${preview.error}`);
      }
    } else {
      other += 1;
      if (samples.length < 3) {
        samples.push(`${String(p.name).slice(0, 40)} -> ${(preview && preview.error) || 'нет ответа'}`);
      }
    }
  }

  console.log('\nпримеры:');
  samples.forEach((s) => console.log('  ', s));
  console.log(`\nнорма посчиталась: ${ok} из ${sample.length} | needs_input: ${needInput} | прочее: ${other}`);

  let bad = 0;
  const ck = (n, cond, extra) => {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + n + (extra ? ' :: ' + extra : ''));
    if (!cond) bad += 1;
  };
  console.log();
  ck('tubes появились в позициях после normalizeDv', withTubes > 0, String(withTubes));
  ck('норма считает хотя бы половину порции', ok >= Math.ceil(sample.length * 0.5),
    `${ok}/${sample.length}`);
  ck('«Укажите число трубок» больше не в каждом ответе',
    needInput < sample.length, `needs_input ${needInput}`);

  console.log('\nитог: ' + (bad ? 'FAIL — ' + bad : 'OK'));
  await pool.end();
  process.exit(bad ? 1 : 0);
})().catch(async (e) => {
  console.log('FAIL', e.message, (e.stack || '').split('\n')[1]);
  try { await pool.end(); } catch (_) { /* уже закрыт */ }
  process.exit(1);
});
