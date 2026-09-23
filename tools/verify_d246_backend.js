#!/usr/bin/env node
'use strict';

/**
 * D-246 sentinel — HTTP-проверка двух бэковых 500 на клоне (:3100).
 *
 *  1. GET /api/worker-payments/project/:work_id/crew-all → 200 + on_site (42P10 был → 500).
 *  2. GET /api/pm-duty/... — дайджест-агрегаты: closed_calc виден (см. check_digest_counts.js).
 *
 * Запуск:
 *   node tools/verify_d246_backend.js
 *   TEST_BASE_URL=http://127.0.0.1:3100 node tools/verify_d246_backend.js
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

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error('FAIL: JWT_SECRET не задан'); process.exit(2); }

const results = [];
function check(name, pass, proof) {
  results.push({ name, pass: !!pass, proof: proof === undefined ? '' : String(proof) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${proof !== undefined ? '  — ' + proof : ''}`);
}

function token(role, id, name) {
  return jwt.sign(
    { id, login: role, name: name || role, role, email: null, pinVerified: true },
    SECRET,
    { expiresIn: '1h' }
  );
}

async function apiGet(url, tok) {
  const res = await fetch(BASE + url, { headers: { Authorization: 'Bearer ' + tok } });
  let body = null;
  try { body = await res.json(); } catch (_) { /* not json */ }
  return { status: res.status, body };
}

(async () => {
  // Клон должен быть на 3100, не на проде.
  if (!/127\.0\.0\.1|localhost/.test(BASE)) {
    console.error('FAIL: sentinel только на локальный клон, а не ' + BASE);
    process.exit(2);
  }

  const db = require('../src/services/db');
  if ((process.env.DB_NAME || '') !== 'asgard_crm_test') {
    console.error(`FAIL: DB_NAME=${process.env.DB_NAME} — sentinel только на asgard_crm_test`);
    await db.end();
    process.exit(2);
  }

  // ── 1) crew-all: work_id, где есть и assignment, и чекин (дубли join'а) ──
  const workQ = await db.query(`
    SELECT ea.work_id, count(DISTINCT ea.employee_id) AS n
    FROM employee_assignments ea
    WHERE ea.work_id IS NOT NULL
    GROUP BY 1
    HAVING count(DISTINCT ea.employee_id) > 0
    ORDER BY n DESC
    LIMIT 5`);
  const workIds = workQ.rows.map((r) => r.work_id);
  check('crew-all: найдены работы с бригадой на клоне', workIds.length > 0, `works=${workIds.join(',')}`);

  const ADMIN = await db.query(`select id from users where role='ADMIN' and coalesce(is_active,true) order by id limit 1`);
  if (!ADMIN.rows.length) { console.error('FAIL: нет ADMIN в users'); await db.end(); process.exit(2); }
  const adminTok = token('ADMIN', ADMIN.rows[0].id, 'Admin');

  let okCount = 0;
  for (const wid of workIds) {
    const { status, body } = await apiGet(`/api/worker-payments/project/${wid}/crew-all`, adminTok);
    const onSite = body && Array.isArray(body.on_site) ? body.on_site.length : -1;
    const ok = status === 200 && onSite >= 0 && Array.isArray(body.others);
    if (ok) okCount++;
    check(`crew-all work=${wid} -> 200 без 42P10`, ok, `HTTP ${status} on_site=${onSite} others=${body && body.others ? body.others.length : 'n/a'}`);
  }
  check('crew-all: все работы ответили 200', okCount === workIds.length, `${okCount}/${workIds.length}`);

  // Контроль: тот же SQL старым способом обязан падать — иначе тест тавтологичен.
  const wid0 = workIds[0];
  let legacyFailed = false;
  try {
    await db.query(`
      SELECT DISTINCT e.id AS employee_id, COALESCE(NULLIF(TRIM(e.fio), ''), NULLIF(TRIM(e.full_name), ''), 'ID ' || e.id) AS employee_name, e.position, 0 AS per_diem_rate
      FROM employees e
      LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.work_id = $1
      LEFT JOIN field_checkins fc ON fc.employee_id = e.id AND fc.work_id = $1
      WHERE (ea.work_id = $1 OR fc.work_id = $1) AND COALESCE(e.is_active, true) = true
      ORDER BY e.fio`, [wid0]);
  } catch (e) {
    legacyFailed = e.code === '42P10';
  }
  check('control: старый DISTINCT…ORDER BY e.fio действительно падал 42P10', legacyFailed, `work=${wid0}`);

  // ── 2) Дайджест: closed_calc виден в payload ──
  const { buildWeeklyDigest } = require('../src/services/pm-analysis-weekly-report');
  const payload = await buildWeeklyDigest(db, { weekStart: '2026-09-14', weekEnd: '2026-09-20' });
  check('digest: kpi.closed_calc = 1', Number(payload.kpi?.closed_calc) === 1, `closed_calc=${payload.kpi?.closed_calc}`);
  check('digest: kpi.taken = 0 (анализов не закрывали)', Number(payload.kpi?.taken) === 0, `taken=${payload.kpi?.taken}`);
  const androsov = (payload.duty || []).find((d) => /андросов/i.test(d.pm_name || ''));
  check('digest: у дежурного PM closed_calc = 1', Number(androsov?.closed_calc) === 1, `closed_calc=${androsov?.closed_calc}`);
  check('digest: verdict учитывает просчёт (не «почти не было»)',
    !!payload.verdict && !/Закрытых анализов за.*почти не было/.test(payload.verdict),
    String(payload.verdict).slice(0, 140));

  // ── 3) Письмо: плитка + блок «только просчёты» + сноска ──
  const { generatePmAnalysisWeeklyEmail } = require('../src/services/pm-analysis-weekly-email');
  const mail = String(generatePmAnalysisWeeklyEmail(payload) || '');
  check('email: есть плитка «Закрыто просчётов»', /Закрыто просчётов/.test(mail));
  check('email: есть сноска про просчёты', /закрытые сметы\/КП/.test(mail));
  check('email: плитка «Закрыто просчётов» = 1 (строгий порядок цифра→подпись)',
    /font-weight:bold;color:#1e293b;">1<\/div>\s*<div style="font-size:10px;color:#64748b;line-height:1.3;">Закрыто просчётов</.test(mail),
    'tile(1, "Закрыто просчётов")');
  check('email: в таблице дежурства строка «просчётов N»', /просчётов\s*1/.test(mail));
  {
    const before = mail;
    const oneCalc = await db.query(`
      SELECT count(*)::int AS n FROM (
        SELECT DISTINCT l.review_id FROM tender_rp_review_log l
        WHERE l.action='finalize' AND l.payload_json->>'mode'='calc'
          AND l.created_at::date BETWEEN '2026-09-14' AND '2026-09-20') z`);
    check('email: число просчётов в письме = числу в логе',
      Number(oneCalc.rows[0].n) === 1 && /просчётов\s*1/.test(before),
      `log=${oneCalc.rows[0].n}`);
  }

  // ── 4) Рейтинг: справочный closed_calc виден и НЕ меняет score ──
  const rating = require('../src/services/pm-analysis-rating');
  const calcActor = await db.query(`
    SELECT l.actor_user_id AS uid
    FROM tender_rp_review_log l
    WHERE l.action = 'finalize' AND l.payload_json->>'mode' = 'calc'
      AND l.created_at::date BETWEEN '2026-09-14' AND '2026-09-20'
    ORDER BY l.created_at LIMIT 1`);
  if (calcActor.rows.length) {
    const uid = calcActor.rows[0].uid;
    const live = await rating.computeUserRating(db, uid, 'd30', '2026-09-20');
    check('rating: activity.closed_calc = 1 за окно 14–20.09',
      Number(live.activity?.closed_calc) === 1, `closed_calc=${live.activity?.closed_calc}`);
    // Инвариант: метрика справочная — база = сумма компонентов, activity в неё не входит.
    const sumPts = Object.values(live.components).reduce((s, c) => s + (c.points || 0), 0);
    check('rating: score не изменился от новой метрики (base = Σ компонентов)',
      Math.abs(Number(live.base) - Math.round(sumPts * 10) / 10) < 0.15,
      `base=${live.base} Σpoints=${Math.round(sumPts * 10) / 10}`);
    // Инвариант: activity — справочная метрика, в формулу score не входит.
    check('rating: score = clamp(base + бонусы − штрафы), activity не участвует',
      Number(live.score) === Math.round(Math.max(0, Math.min(100,
        live.base + Number(live.bonuses.total || 0) - Number(live.penalties.total || 0)))),
      `score=${live.score} base=${live.base} bonus=${live.bonuses.total} penalty=${live.penalties.total}`);
    check('rating: activity не подмешана в components',
      !Object.prototype.hasOwnProperty.call(live.components, 'closed_calc')
        && !Object.prototype.hasOwnProperty.call(live.components, 'activity'),
      `keys=[${Object.keys(live.components).join(',')}]`);
  } else {
    check('rating: найден актор закрытого просчёта', false, 'нет строк finalize/calc за 14–20.09');
  }

  await db.end();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n═══ D-246 ИТОГ: ${results.length - failed.length}/${results.length} PASS ═══`);
  if (failed.length) failed.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.proof}`));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
