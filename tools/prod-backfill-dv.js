#!/usr/bin/env node
'use strict';
/**
 * Заполняет карточки анализа на ПРОДЕ из уже разобранных сессий Мимира.
 *
 * Зачем: прогон 06.11 разобрал тендеры, но карточки сохраняли только текст
 * объёма. Позиции, вопросы для звонка и контакт остались в сессии. Здесь
 * переносим их в report_json штатным PUT — тем же, что делает кнопка.
 *
 * Только чтение сессий и запись карточки. Тендер, статусы, решения не трогаем.
 *
 *   node tools/prod-backfill-dv.js --dry
 *   node tools/prod-backfill-dv.js
 */
require('dotenv').config();
const { Client } = require('pg');

const DRY = process.argv.includes('--dry');
const BASE = process.env.PROD_BASE || 'http://127.0.0.1:3000';

async function token() {
  const jwt = require('jsonwebtoken');
  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: '123456789', database: 'asgard_crm'
  });
  await db.connect();
  const { rows: [u] } = await db.query(
    "SELECT id, login, role, name FROM users WHERE login='n.androsov'"
  );
  await db.end();
  if (!u) throw new Error('нет пользователя n.androsov');
  return jwt.sign(
    { id: u.id, login: u.login, role: u.role, name: u.name },
    process.env.JWT_SECRET || 'asgard-secret',
    { expiresIn: '2h' }
  );
}

(async () => {
  const tk = await token();
  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: '123456789', database: 'asgard_crm'
  });
  await db.connect();

  // Сессии, где Мимир уже выписал позиции, по одному тендеру.
  const { rows } = await db.query(`
    SELECT DISTINCT ON (s.tender_id)
           s.session_uid, s.tender_id, s.stage,
           jsonb_array_length(COALESCE(s.stage_state->'positions','[]'::jsonb)) AS pos
      FROM tkp_quick_sessions s
     WHERE s.tender_id IS NOT NULL
       AND s.purpose IN ('rp_review_analysis', 'analysis')
       AND jsonb_array_length(COALESCE(s.stage_state->'positions','[]'::jsonb)) > 0
     ORDER BY s.tender_id DESC, s.id DESC
  `);
  console.log('сессий с позициями:', rows.length);
  await db.end();

  let ok = 0, skip = 0, fail = 0;
  for (const s of rows) {
    const sr = await fetch(`${BASE}/api/tkp-quick/sessions/${s.session_uid}/stage`, {
      headers: { Authorization: 'Bearer ' + tk }
    });
    if (!sr.ok) { fail++; console.log(`#${s.tender_id} stage ${sr.status}`); continue; }
    const st = await sr.json();
    const positions = (st.state && st.state.positions) || [];
    if (!positions.length) { skip++; continue; }

    const scopeText = positions.map((p) =>
      `${p.name} — ${p.volume} ${p.unit || ''}`.trim()).join('; ');
    const problems = positions.filter((p) => p.needs_classification || (p.problems || []).length);
    const reportJson = {
      mode: 'analysis',
      summary: `Мимир разобрал ТЗ: ${positions.length} позиц.` +
        (problems.length ? ' Часть требует уточнения.' : ''),
      scope: scopeText,
      volume_summary: scopeText,
      dv_positions: positions,
      call_questions: st.call_questions || [],
      contact: st.contact || null,
      decision_recommend: st.decision_recommend || 'need_info',
      feasibility: problems.length ? 'conditional' : 'yes',
      resources: positions.map((p) => p.tech_equip).filter(Boolean).join('; ')
    };

    if (DRY) {
      console.log(`#${s.tender_id} → dv=${positions.length} q=${(st.call_questions || []).length} ` +
        `contact=${st.contact && st.contact.phone ? st.contact.phone : '—'}`);
      ok++;
      continue;
    }

    const put = await fetch(`http://127.0.0.1:3000/api/tenders/${s.tender_id}/rp-review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
      body: JSON.stringify({ mode: 'analysis', report_json: reportJson })
    });
    if (put.ok) {
      ok++;
      console.log(`#${s.tender_id} ✓ dv=${positions.length} q=${reportJson.call_questions.length}`);
    } else {
      fail++;
      console.log(`#${s.tender_id} ✗ ${put.status} ${(await put.text()).slice(0, 120)}`);
    }
  }
  console.log(`\nитог: ${ok} записано, ${skip} пусто, ${fail} ошибок${DRY ? ' (dry)' : ''}`);
})();
