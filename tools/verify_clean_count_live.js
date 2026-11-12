#!/usr/bin/env node
'use strict';
/**
 * Проверка шага 3 на РЕАЛЬНОМ файле заказчика: кратность и геометрия.
 *
 * Ожидание по дефектной ведомости 2138 (файл 1572):
 *   clean_count: 1 → 537, 2 → 63, 3 → 7, 4 → 9 (числовой у ≥ 600 из 673);
 *   tubes > 0 у ≥ 500;
 *   ни одна позиция не имеет clean_count строкой.
 *
 * Запуск (на проде): DB_PASSWORD=... node tools/verify_clean_count_live.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
const es = require(path.join(ROOT, 'src', 'services', 'excel-structure'));

const TENDER = Number((process.argv.find((a) => /^--tender=/.test(a)) || '').split('=')[1]) || 2138;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
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
  let usedFile = '';
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
      usedFile = `#${d.id} ${d.name}`;
    }
  }

  if (!parsed) {
    console.log('не разобрано ни одного файла');
    await pool.end();
    process.exit(1);
  }

  const list = parsed.positions;
  console.log('файл:', usedFile);
  console.log('позиций:', list.length);

  const hist = new Map();
  for (const p of list) {
    const k = p.clean_count == null ? 'null' : String(p.clean_count);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  console.log('clean_count:', JSON.stringify([...hist.entries()].sort()));

  const numeric = list.filter((p) => Number.isFinite(Number(p.clean_count)) && Number(p.clean_count) > 0).length;
  const tubes = list.filter((p) => Number(p.tubes) > 0).length;
  const lengthM = list.filter((p) => Number(p.length_m) > 0).length;
  const dn = list.filter((p) => Number(p.dn_mm) > 0).length;
  console.log('числовой clean_count:', numeric, 'из', list.length);
  console.log('tubes > 0:', tubes, '| length_m > 0:', lengthM, '| dn_mm > 0:', dn);
  console.log('с пометкой clean_count_note:', list.filter((p) => p.clean_count_note).length);

  let bad = 0;
  const ck = (name, ok, extra) => {
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + extra : ''));
    if (!ok) bad += 1;
  };
  console.log();
  ck('clean_count числовой у большинства', numeric >= Math.floor(list.length * 0.85),
    numeric + '/' + list.length);
  ck('ни одна кратность не осталась строкой',
    list.every((p) => p.clean_count == null || typeof p.clean_count === 'number'));
  ck('tubes читается у большинства', tubes >= Math.floor(list.length * 0.7), String(tubes));
  ck('length_m читается', lengthM >= Math.floor(list.length * 0.7), String(lengthM));
  ck('кратность 2+ встречается (не всё по одному)',
    list.some((p) => Number(p.clean_count) > 1),
    String(list.filter((p) => Number(p.clean_count) > 1).length) + ' позиций');

  console.log('\nитог: ' + (bad ? 'FAIL — ' + bad : 'OK'));
  await pool.end();
  process.exit(bad ? 1 : 0);
})().catch(async (e) => {
  console.log('FAIL', e.message);
  try { await pool.end(); } catch (_) { /* уже закрыт */ }
  process.exit(1);
});
