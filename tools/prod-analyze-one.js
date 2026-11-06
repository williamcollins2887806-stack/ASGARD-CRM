#!/usr/bin/env node
'use strict';
/**
 * Анализ одного тендера на проде от лица РП Андросова.
 * Показывает: сколько документов, что вернула модель, где остановилась.
 *
 *   node tools/prod-analyze-one.js --tender=2131
 *   node tools/prod-analyze-one.js --tender=2131 --schedule=45
 */
require('dotenv').config();
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith('--' + name + '='));
  return a ? a.split('=')[1] : null;
};
const TENDER = Number(arg('tender'));
const SCHEDULE = Number(arg('schedule')) || null;
const BASE = 'http://127.0.0.1:3000';

(async () => {
  if (!TENDER) { console.error('нужен --tender=ID'); process.exit(1); }
  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: '123456789', database: process.env.DB_NAME || 'asgard_crm'
  });
  await db.connect();
  const { rows: u } = await db.query("SELECT id,login,role,name FROM users WHERE login='n.androsov'");
  const tk = jwt.sign(
    { id: u[0].id, login: u[0].login, role: u[0].role, name: u[0].name },
    process.env.JWT_SECRET || 'asgard-secret',
    { expiresIn: '3h' }
  );
  const { rows: t } = await db.query(
    'SELECT id, tender_title, tender_description, deadline FROM tenders WHERE id=$1 AND deleted_at IS NULL',
    [TENDER]
  );
  const docs = await db.query(
    "SELECT original_name, COALESCE(LENGTH(ocr_text),0) len FROM documents WHERE tender_id=$1 ORDER BY len DESC",
    [TENDER]
  );
  await db.end();

  if (!t[0]) { console.error('тендер не найден'); process.exit(1); }
  console.log(`#${TENDER} ${String(t[0].tender_title).slice(0, 70)}`);
  console.log(`документов: ${docs.rowCount} (с текстом: ${docs.rows.filter((d) => d.len > 0).length})`);
  docs.rows.slice(0, 6).forEach((d) => console.log(`   ${String(d.len).padStart(6)} симв — ${d.original_name}`));

  // Сессия анализа.
  const sres = await fetch(`${BASE}/api/tkp-quick/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
    body: JSON.stringify({
      tender_id: TENDER,
      customer_name: null,
      tz_text: [t[0].tender_title, t[0].tender_description].filter(Boolean).join('\n\n')
    })
  });
  const sd = await sres.json();
  if (!sres.ok) { console.error('сессия не создана:', sres.status, JSON.stringify(sd).slice(0, 300)); process.exit(1); }
  // Бэкенд отдаёт { session: { session_uid, ... } }, а не uid в корне.
  const uid = (sd.session && sd.session.session_uid) || sd.session_uid;
  if (!uid) { console.error('нет session_uid в ответе:', JSON.stringify(sd).slice(0, 300)); process.exit(1); }
  console.log(`\nсессия: ${uid}`);

  const body = { tz_text: [t[0].tender_title, t[0].tender_description].filter(Boolean).join('\n\n') };
  if (SCHEDULE) body.schedule_days = SCHEDULE;

  const ares = await fetch(`${BASE}/api/tkp-quick/sessions/${uid}/stage/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
    body: JSON.stringify(body)
  });
  const a = await ares.json();
  console.log(`\nанализ: HTTP ${ares.status} ok=${a.ok} stage=${a.stage}`);
  if (!a.ok) {
    console.log('пробелы:', JSON.stringify(a.gaps || []).slice(0, 500));
    console.log('срок из ТЗ:', JSON.stringify(a.schedule || null));
    process.exit(0);
  }
  const pos = (a.state && a.state.positions) || [];
  console.log(`позиций: ${pos.length} | с нормой: ${pos.filter((p) => p.norm && p.norm.code).length}`);
  console.log('суть:', JSON.stringify((a.summary || '').slice(0, 200)));
  console.log('срок:', JSON.stringify(a.schedule || null));
  pos.slice(0, 5).forEach((p) => console.log(
    `   ${String(p.volume || '—').padStart(7)} ${String(p.unit || '').padEnd(8)} ${String((p.category_code || '—') + '.' + (p.method_code || '—')).padEnd(24)} ${String(p.name).slice(0, 44)}`
  ));
})();
