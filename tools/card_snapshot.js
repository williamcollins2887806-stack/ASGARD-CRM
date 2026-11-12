#!/usr/bin/env node
'use strict';
/**
 * card_snapshot.js — снимок report_json карточки в файл.
 *
 * Зачем: прогон анализа перезаписывает карточку ЦЕЛИКОМ, а история в
 * tender_rp_review_log хранит payload по ~60 символов (проверено 12.11.2026).
 * То есть откатить разбор нечем. Именно так были потеряны прежние 675
 * позиций #2138: прогон дал 115, и вернуть стало нечего.
 *
 * Снимок делается ПЕРЕД каждым шагом правок.
 *
 * Запуск (на проде, из каталога приложения):
 *   DB_PASSWORD=... node tools/card_snapshot.js --tender=2138 --label=s2
 *   → /root/snapshots/card-2138-s2-<дата>.json
 *
 * Проверка после записи: файл читается обратно, JSON.parse проходит,
 * число позиций совпадает с исходным.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));

const argOf = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? String(hit).split('=').slice(1).join('=') : def;
};

const TENDER = Number(argOf('tender', process.env.TENDER_ID || 2138));
const LABEL = String(argOf('label', 'manual')).replace(/[^\w.-]+/g, '_').slice(0, 40);
const DIR = argOf('dir', '/root/snapshots');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = path.join(DIR, `card-${TENDER}-${LABEL}-${stamp}.json`);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
  database: process.env.DB_NAME || 'asgard_crm',
  max: 2
});

(async () => {
  const q = await pool.query(
    'SELECT id, report_json, updated_at FROM tender_rp_reviews '
    + 'WHERE tender_id = $1 ORDER BY id DESC LIMIT 1', [TENDER]);
  if (!q.rows[0]) {
    console.log(`нет карточки по тендеру ${TENDER} — снимать нечего`);
    await pool.end();
    process.exit(1);
  }
  const row = q.rows[0];
  const rj = row.report_json || {};
  const positions = Array.isArray(rj.dv_positions) ? rj.dv_positions.length : 0;

  const payload = {
    tender: TENDER,
    review_id: row.id,
    updated_at: row.updated_at,
    saved_at: new Date().toISOString(),
    label: LABEL,
    positions_count: positions,
    report_json: rj
  };

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');

  // Читаем обратно: снимок, который не открывается, — не снимок.
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  const backPositions = Array.isArray(back.report_json.dv_positions)
    ? back.report_json.dv_positions.length : 0;

  const ok = backPositions === positions
    && back.review_id === row.id
    && fs.statSync(file).size > 1000;

  console.log('снимок:', file);
  console.log('позиций в снимке:', backPositions, '| в карточке:', positions);
  console.log('размер:', Math.round(fs.statSync(file).size / 1024), 'КБ');
  console.log(ok ? 'OK — снимок читается и совпадает' : 'FAIL — снимок не совпал');

  await pool.end();
  process.exit(ok ? 0 : 1);
})().catch(async (e) => {
  console.log('FAIL', e.message);
  try { await pool.end(); } catch (_) { /* уже закрыт */ }
  process.exit(1);
});
