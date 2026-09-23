#!/usr/bin/env node
'use strict';

/**
 * D-246: сравнение `pm_analysis_rating_daily` ДО / ПОСЛЕ пересчёта на клоне.
 *
 * Зачем: правка рейтинга (`activity.closed_calc`) не должна менять баллы молча.
 * Скрипт снимает сохранённые снапшоты (они зеркалят прод), гоняет `recomputeAll`
 * новым кодом и печатает дельты по каждому user_id/window_kind.
 *
 * Ожидание: delta_score = 0, delta_grade = 0 для всех; activity_json появился.
 * Любая ненулевая дельта — FAIL (значит метрика влезла в скоринг).
 *
 * Запуск (только клон!):
 *   node tools/check_rating_delta.js --as-of 2026-09-20
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile(path.join(__dirname, '..', '.env'));

const ARG = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const AS_OF = ARG('as-of', '2026-09-20');

(async () => {
  const db = require('../src/services/db');
  if ((process.env.DB_NAME || '') !== 'asgard_crm_test') {
    console.error(`FAIL: DB_NAME=${process.env.DB_NAME} — сравнение только на asgard_crm_test`);
    await db.end();
    process.exit(2);
  }

  const before = await db.query(`
    SELECT user_id, window_kind, score, grade, period_start, period_end
    FROM pm_analysis_rating_daily
    WHERE as_of_date = $1::date
  `, [AS_OF]);

  if (!before.rows.length) {
    console.error(`FAIL: нет снапшотов на ${AS_OF} — нечего сравнивать`);
    await db.end();
    process.exit(2);
  }
  console.log(`Снапшотов ДО: ${before.rows.length} (as_of=${AS_OF})`);

  const rating = require('../src/services/pm-analysis-rating');
  const res = await rating.recomputeAll(db, AS_OF);
  console.log(`Пересчёт: ${res.users}/${res.total} пользователей`);

  const after = await db.query(`
    SELECT user_id, window_kind, score, grade, activity_json
    FROM pm_analysis_rating_daily
    WHERE as_of_date = $1::date
  `, [AS_OF]);

  const key = (r) => `${r.user_id}/${r.window_kind}`;
  const aMap = new Map(after.rows.map((r) => [key(r), r]));

  const deltas = [];
  for (const b of before.rows) {
    const a = aMap.get(key(b));
    if (!a) {
      deltas.push({ k: key(b), field: 'row', from: 'есть', to: 'НЕТ' });
      continue;
    }
    if (Number(a.score) !== Number(b.score)) {
      deltas.push({ k: key(b), field: 'score', from: b.score, to: a.score });
    }
    if (String(a.grade) !== String(b.grade)) {
      deltas.push({ k: key(b), field: 'grade', from: b.grade, to: a.grade });
    }
  }

  const withActivity = after.rows.filter((r) => r.activity_json != null);
  const calcSum = after.rows
    .filter((r) => r.window_kind === 'd30')
    .reduce((s, r) => s + Number((r.activity_json || {}).closed_calc || 0), 0);

  console.log(`\nСтрок с activity_json: ${withActivity.length}/${after.rows.length}`);
  console.log(`Σ closed_calc по d30 (все РП): ${calcSum}`);
  console.log('\nТаблица: user/window | дельта score | дельта grade');
  if (!deltas.length) {
    console.log('  — расхождений нет (0/0)');
  } else {
    for (const d of deltas) console.log(`  FAIL ${d.k} | ${d.field}: ${d.from} → ${d.to}`);
  }

  await db.end();

  const ok = deltas.length === 0 && withActivity.length === after.rows.length;
  console.log(`\n═══ ИТОГ: ${ok ? 'PASS' : 'FAIL'} (дельт ${deltas.length}, activity заполнен ${withActivity.length}/${after.rows.length}) ═══`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
