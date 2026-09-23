#!/usr/bin/env node
'use strict';

/**
 * Sentinel дайджеста РП (D-246).
 *
 * Строит buildWeeklyDigest за указанную неделю и печатает счётчики:
 *   - analysis (taken / go / reject) — закрытые АНАЛИЗЫ;
 *   - closed_calc — закрытые ПРОСЧЁТЫ (action='finalize', mode='calc').
 *
 * Плюс независимая перекрёстная проверка тем же фильтром напрямую в БД
 * (не через сервис) — чтобы «зелёный» скрипт нельзя было получить,
 * просто исправив сервис.
 *
 * Запуск (клон!):
 *   node tools/check_digest_counts.js --week 2026-09-14..2026-09-20
 *   node tools/check_digest_counts.js --week 2026-09-14..2026-09-20 --json
 *
 * Ожидание для 14–20.09.2026: analysis.taken = 0, closed_calc = 1.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile(path.join(__dirname, '..', '.env'));

const db = require('../src/services/db');
const { buildWeeklyDigest } = require('../src/services/pm-analysis-weekly-report');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function parseWeek(s) {
  if (!s) return { weekStart: '2026-09-14', weekEnd: '2026-09-20' };
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (!m) throw new Error('--week ожидает YYYY-MM-DD..YYYY-MM-DD');
  return { weekStart: m[1], weekEnd: m[2] };
}

/**
 * Перекрёстная проверка «в лоб»: те же определения, что в сервисе,
 * но отдельным SQL. Для closed_calc снимаем последнее finalize_* по review,
 * чтобы reject→submit не двойнился (как в loadAnalysisByPm).
 */
async function crossCheck(weekStart, weekEnd) {
  const q = (text, params) => db.query(text, params);

  const analysis = await q(`
    WITH last_fin AS (
      SELECT DISTINCT ON (l.review_id)
        l.review_id, l.actor_user_id AS uid, l.action
      FROM tender_rp_review_log l
      WHERE l.action IN ('finalize_analysis', 'finalize_reject')
        AND l.created_at::date BETWEEN $1::date AND $2::date
      ORDER BY l.review_id, l.created_at DESC
    )
    SELECT COUNT(*)::int AS taken,
           COUNT(*) FILTER (WHERE action = 'finalize_analysis')::int AS go,
           COUNT(*) FILTER (WHERE action = 'finalize_reject')::int AS reject
    FROM last_fin
  `, [weekStart, weekEnd]);

  const calc = await q(`
    WITH last_calc AS (
      SELECT DISTINCT ON (l.review_id)
        l.review_id, l.actor_user_id AS uid, l.action, l.payload_json->>'mode' AS mode
      FROM tender_rp_review_log l
      WHERE l.created_at::date BETWEEN $1::date AND $2::date
        AND (
          l.payload_json->>'mode' = 'calc'
          OR l.action IN ('finalize_analysis', 'finalize_reject')
        )
      ORDER BY l.review_id, l.created_at DESC
    )
    SELECT COUNT(*) FILTER (WHERE mode = 'calc' AND action = 'finalize')::int AS closed_calc,
           COUNT(*) FILTER (WHERE action = 'finalize_analysis')::int AS go,
           COUNT(*) FILTER (WHERE action = 'finalize_reject')::int AS reject
    FROM last_calc
  `, [weekStart, weekEnd]);

  // Сырой список закрытых просчётов — для доказательства (кто/когда/тендер).
  const calcRows = await q(`
    SELECT l.id, l.review_id, l.actor_user_id, u.name AS actor_name,
           l.payload_json->>'mode' AS mode, l.created_at
    FROM tender_rp_review_log l
    LEFT JOIN users u ON u.id = l.actor_user_id
    WHERE l.action = 'finalize'
      AND l.payload_json->>'mode' = 'calc'
      AND l.created_at::date BETWEEN $1::date AND $2::date
    ORDER BY l.created_at
  `, [weekStart, weekEnd]);

  return { analysis: analysis.rows[0], calc: calc.rows[0], calcRows: calcRows.rows };
}

(async () => {
  const { weekStart, weekEnd } = parseWeek(arg('week'));
  const asJson = process.argv.includes('--json');

  const payload = await buildWeeklyDigest(db, { weekStart, weekEnd });
  const cross = await crossCheck(weekStart, weekEnd);

  const kpi = payload.kpi || {};
  const digestCalc = kpi.closed_calc != null ? kpi.closed_calc : null;

  const perfPm = (payload.duty || []).map((d) => ({
    pm: d.pm_name, taken: d.taken, go: d.go, reject: d.reject, closed_calc: d.closed_calc != null ? d.closed_calc : null
  }));

  const out = {
    week: `${weekStart}..${weekEnd}`,
    db_name: process.env.DB_NAME || 'asgard_crm',
    digest: {
      taken: kpi.taken || 0,
      go: kpi.go || 0,
      reject: kpi.reject || 0,
      closed_calc: digestCalc,
      submitted: kpi.submitted || 0,
      cancelled: kpi.cancelled || 0
    },
    crosscheck: {
      taken: cross.analysis.taken,
      go: cross.analysis.go,
      reject: cross.analysis.reject,
      closed_calc: cross.calc.closed_calc
    },
    closed_calc_rows: cross.calcRows,
    duty_by_pm: perfPm,
    consistent: {
      analysis: (kpi.taken || 0) === cross.analysis.taken
        && (kpi.go || 0) === cross.analysis.go
        && (kpi.reject || 0) === cross.analysis.reject,
      closed_calc: digestCalc === cross.calc.closed_calc
    }
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`=== Дайджест ${out.week} (DB ${out.db_name}) ===`);
    console.log(`analysis : taken=${out.digest.taken} go=${out.digest.go} reject=${out.digest.reject}`);
    console.log(`calc     : closed_calc=${out.digest.closed_calc}`);
    console.log(`registry : submitted=${out.digest.submitted} cancelled=${out.digest.cancelled}`);
    console.log(`cross    : taken=${cross.analysis.taken} go=${cross.analysis.go} reject=${cross.analysis.reject} closed_calc=${cross.calc.closed_calc}`);
    console.log('closed_calc rows:');
    if (!cross.calcRows.length) console.log('  (нет)');
    for (const r of cross.calcRows) {
      console.log(`  log#${r.id} review=${r.review_id} actor=${r.actor_user_id}(${r.actor_name || '—'}) mode=${r.mode} at=${r.created_at.toISOString ? r.created_at.toISOString() : r.created_at}`);
    }
    console.log('duty by PM:');
    if (!perfPm.length) console.log('  (нет дежурных с закрытиями)');
    for (const d of perfPm) {
      console.log(`  ${d.pm}: taken=${d.taken} go=${d.go} reject=${d.reject} closed_calc=${d.closed_calc}`);
    }
    console.log(`consistent: analysis=${out.consistent.analysis} closed_calc=${out.consistent.closed_calc}`);
  }

  const ok = out.consistent.analysis && out.consistent.closed_calc;
  await db.end();
  process.exit(ok ? 0 : 1);
})().catch(async (err) => {
  console.error('FAIL:', err && err.message);
  try { await db.end(); } catch (_) { /* ignore */ }
  process.exit(2);
});
