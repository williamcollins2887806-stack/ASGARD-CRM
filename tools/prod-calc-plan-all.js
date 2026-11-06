#!/usr/bin/env node
'use strict';
/**
 * Считает план «Люди и сроки» по всем разобранным тендерам на ПРОДЕ.
 *
 * Зачем: в карточке объёмов поля «Люди» и «Сутки» пустые, пока план не посчитан.
 * Деньги от него не зависят (см. tests/calc-plan-does-not-affect-money.test.js),
 * но РП должен видеть сроки сразу, не нажимая кнопку по каждому тендеру.
 *
 * Только план: смета, решение и статусы не трогаются.
 *
 *   node tools/prod-calc-plan-all.js --dry
 *   node tools/prod-calc-plan-all.js
 */
require('dotenv').config();
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const DRY = process.argv.includes('--dry');
const BASE = 'http://127.0.0.1:3000';

function sign(secret, u) {
  return jwt.sign(
    { id: u.id, login: u.login, role: u.role, name: u.name },
    secret || 'asgard-secret',
    { expiresIn: '2h' }
  );
}

(async () => {
  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: '123456789', database: process.env.DB_NAME || 'asgard_crm'
  });
  await db.connect();

  const { rows: users } = await db.query(
    "SELECT id, login, role, name FROM users WHERE login='n.androsov'"
  );
  const u = users[0];
  if (!u) throw new Error('нет пользователя n.androsov');
  const tk = sign(process.env.JWT_SECRET, u);

  // Сессии с разобранным ДВ, по одной на тендер.
  const { rows: sessions } = await db.query(`
    SELECT DISTINCT ON (s.tender_id)
           s.session_uid, s.tender_id,
           jsonb_array_length(COALESCE(s.stage_state->'positions','[]'::jsonb)) AS pos
      FROM tkp_quick_sessions s
     WHERE s.tender_id IS NOT NULL
       AND s.purpose IN ('rp_review_analysis', 'analysis')
       AND jsonb_array_length(COALESCE(s.stage_state->'positions','[]'::jsonb)) > 0
     ORDER BY s.tender_id DESC, s.id DESC
  `);
  await db.end();

  console.log(`тендеров с разобранным ДВ: ${sessions.length}`);
  console.log(`режим: ${DRY ? 'СУХОЙ (ничего не пишем)' : 'запись'}\n`);

  let ok = 0, skipped = 0, bad = 0;

  for (const s of sessions) {
    if (DRY) {
      console.log(`#${s.tender_id} — посчитали бы план по ${s.pos} позиц.`);
      ok += 1;
      continue;
    }
    try {
      const res = await fetch(`${BASE}/api/tkp-quick/sessions/${s.session_uid}/stage/calc-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
        body: JSON.stringify({})
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        bad += 1;
        console.log(`#${s.tender_id} ✗ ${res.status} ${String(d.error || '').slice(0, 120)}`);
        continue;
      }
      const plan = d.plan || {};
      if (!(plan.positions || []).length) {
        skipped += 1;
        console.log(`#${s.tender_id} — модель не дала план (позиций ${s.pos})`);
        continue;
      }

      // План кладём в карточку — оттуда его читает вкладка «Объёмы».
      const rr = await fetch(`${BASE}/api/tenders/${s.tender_id}/rp-review`, {
        headers: { Authorization: 'Bearer ' + tk }
      }).then((r) => r.json());
      const rj = (rr.review && rr.review.report_json) || {};
      rj.calc_plan = plan;
      const put = await fetch(`${BASE}/api/tenders/${s.tender_id}/rp-review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
        body: JSON.stringify({ report_json: rj })
      });
      if (!put.ok) {
        bad += 1;
        console.log(`#${s.tender_id} ✗ запись карточки ${put.status}`);
        continue;
      }
      ok += 1;
      console.log(`#${s.tender_id} ✓ ${plan.positions.length} позиц · ` +
        `${plan.work_days} сут · ${plan.people_total} чел · ${plan.man_hours} чел-ч`);
    } catch (e) {
      bad += 1;
      console.log(`#${s.tender_id} ✗ ${e.message}`);
    }
  }

  console.log(`\nитог: ${ok} с планом, ${skipped} без плана, ${bad} ошибок`);
})();
