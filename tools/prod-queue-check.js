#!/usr/bin/env node
'use strict';
/**
 * Прогон анализа по очереди дежурного РП на проде.
 *
 * Берёт ровно ту очередь, что видит дежурный (registry_status='рассмотрение',
 * анализ не закрыт), и по каждому тендеру показывает:
 *   • сколько документов и сколько с текстом;
 *   • нашёлся ли срок работ в ТЗ;
 *   • подтянулась ли история заказчика;
 *   • сколько позиций, у скольких есть категория и норма;
 *   • какие проблемы у позиций.
 *
 * Ничего не закрывает и не меняет. Только отчёт — чтобы решить, что чинить.
 *
 *   node tools/prod-queue-check.js
 *   node tools/prod-queue-check.js --tender=2127
 */
require('dotenv').config();
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith('--' + name + '='));
  return a ? a.split('=')[1] : null;
};
const ONLY = Number(arg('tender')) || null;
const BASE = 'http://127.0.0.1:3000';

(async () => {
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

  // Точная очередь дежурного: как в pm-duty.js.
  const { rows: queue } = await db.query(`
    SELECT t.id, t.tender_title, t.tender_description, t.docs_deadline,
           t.customer_inn, t.customer_name,
           (SELECT COUNT(*) FROM documents d WHERE d.tender_id = t.id) AS docs,
           (SELECT COUNT(*) FROM documents d WHERE d.tender_id = t.id
             AND COALESCE(LENGTH(d.ocr_text),0) > 0) AS docs_text
      FROM tenders t
      LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
     WHERE t.deleted_at IS NULL
       AND t.registry_status = 'рассмотрение'
       AND (rev.is_final IS NULL OR rev.is_final = false)
       AND rev.analysis_finalized_at IS NULL
       AND COALESCE(t.calculator_kind,'') != 'to'
       AND COALESCE(t.source,'') <> 'phone_call'
     ORDER BY t.docs_deadline ASC NULLS LAST, t.created_at ASC`);

  const list = ONLY ? queue.filter((x) => Number(x.id) === ONLY) : queue;
  console.log(`очередь дежурного: ${list.length} тендеров\n`);

  const report = [];

  for (const t of list) {
    const row = { id: Number(t.id), title: String(t.tender_title || '').slice(0, 55), docs: Number(t.docs), docs_text: Number(t.docs_text) };
    process.stdout.write(`#${row.id} ${String(row.docs).padStart(2)} док… `);

    try {
      // Сессия анализа.
      const sres = await fetch(`${BASE}/api/tkp-quick/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
        body: JSON.stringify({
          tender_id: Number(t.id),
          customer_name: t.customer_name || null,
          tz_text: [t.tender_title, t.tender_description].filter(Boolean).join('\n\n')
        })
      });
      const sd = await sres.json();
      const uid = (sd.session && sd.session.session_uid) || sd.session_uid;
      if (!uid) { row.error = 'сессия не создана'; report.push(row); console.log('✗ сессия'); continue; }

      const ares = await fetch(`${BASE}/api/tkp-quick/sessions/${uid}/stage/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
        body: JSON.stringify({
          tz_text: [t.tender_title, t.tender_description].filter(Boolean).join('\n\n')
        })
      });
      const a = await ares.json();

      row.stage = a.stage || null;
      row.schedule_days = a.schedule && a.schedule.days ? a.schedule.days : null;
      row.history = a.history_count || 0;

      if (!a.ok) {
        row.gaps = (a.gaps || []).map((g) => g.id || g.label);
        report.push(row);
        console.log(`⚠ остановка (${row.stage}): ${row.gaps.join(', ')}`);
        continue;
      }

      const pos = (a.state && a.state.positions) || [];
      row.positions = pos.length;
      row.with_cat = pos.filter((p) => p.category_code).length;
      row.with_norm = pos.filter((p) => p.norm && p.norm.code).length;
      row.blocked = pos.filter((p) => p.needs_classification).length;
      row.empty_units = pos.filter((p) => !p.unit).length;

      const problemKinds = {};
      pos.forEach((p) => (p.problems || []).forEach((pr) => {
        const k = String(pr).replace(/[«»"].*$/, '').trim().slice(0, 40);
        problemKinds[k] = (problemKinds[k] || 0) + 1;
      }));
      row.problems = problemKinds;

      report.push(row);
      console.log(`позиц ${row.positions} · кат ${row.with_cat} · норма ${row.with_norm}` +
        (row.schedule_days ? ` · срок ${row.schedule_days}` : ' · срока нет') +
        (row.history ? ` · история ${row.history}` : ''));

      // Короткая пауза, чтобы не долбить модель пачкой.
      await new Promise((r) => setTimeout(r, 1200));
    } catch (e) {
      row.error = e.message;
      report.push(row);
      console.log('✗ ' + e.message.slice(0, 60));
    }
  }

  await db.end();

  // Итоговая таблица.
  console.log('\n══════ ИТОГ ══════');
  console.log('id    | док | поз | кат | норма | срок | истор | проблемы');
  for (const r of report) {
    if (r.error) { console.log(`${String(r.id).padStart(5)} | ошибка: ${r.error}`); continue; }
    const probs = r.problems ? Object.keys(r.problems).slice(0, 2).join('; ') : (r.gaps || []).join(', ');
    console.log(
      `${String(r.id).padStart(5)} | ${String(r.docs_text).padStart(2)}/${String(r.docs).padStart(2)} | ` +
      `${String(r.positions || 0).padStart(3)} | ${String(r.with_cat || 0).padStart(3)} | ` +
      `${String(r.with_norm || 0).padStart(5)} | ${String(r.schedule_days || '—').padStart(4)} | ` +
      `${String(r.history || 0).padStart(5)} | ${String(probs || '').slice(0, 50)}`
    );
  }

  const sum = report.reduce((s, r) => ({
    pos: s.pos + (r.positions || 0),
    cat: s.cat + (r.with_cat || 0),
    norm: s.norm + (r.with_norm || 0)
  }), { pos: 0, cat: 0, norm: 0 });
  console.log(`\nвсего позиций: ${sum.pos} | с категорией: ${sum.cat} | с нормой: ${sum.norm}`);
  console.log(`остановок на данных: ${report.filter((r) => r.gaps && r.gaps.length).length}`);
  console.log(`ошибок: ${report.filter((r) => r.error).length}`);
})();
