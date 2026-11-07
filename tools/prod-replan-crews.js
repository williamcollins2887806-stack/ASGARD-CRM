'use strict';
/**
 * Пересчёт плана на проде с НОВЫМ составом бригад (1 мастер + 4 слесаря)
 * и окном дат из ТЗ, если оно есть.
 *
 * Срок из ТЗ ищем в тексте тендера; если нет — берём срок, который РП
 * указал руками (state.schedule_days), иначе окна нет и в плане будет
 * предупреждение.
 *
 *   node tools/prod-replan-crews.js --dry
 *   node tools/prod-replan-crews.js
 */
require('dotenv').config();
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const stages = require('../src/services/mimir-tender-stages');
const sched = require('../src/services/schedule-extract');

const DRY = process.argv.includes('--dry');
const API = 'http://127.0.0.1:3000';

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

  const { rows } = await db.query(`
    SELECT r.tender_id, r.report_json, t.tender_title, t.tender_description, t.deadline
      FROM tender_rp_reviews r
      JOIN tenders t ON t.id = r.tender_id AND t.deleted_at IS NULL
     WHERE jsonb_array_length(COALESCE(r.report_json->'dv_positions','[]'::jsonb)) > 0
     ORDER BY r.tender_id DESC`);

  console.log(`тендеров: ${rows.length} | режим: ${DRY ? 'СУХОЙ' : 'запись'}\n`);

  for (const row of rows) {
    const rj = typeof row.report_json === 'string' ? JSON.parse(row.report_json) : row.report_json;
    const dv = rj.dv_positions || [];
    const prev = (rj.calc_plan && rj.calc_plan.positions) || [];
    const byId = {};
    prev.forEach((c) => { if (c.position_id) byId[c.position_id] = c; });

    const posList = dv.map((p) => {
      const c = byId[p.id] || {};
      const nd = p.norm && Number(p.norm.work_days) > 0 ? Number(p.norm.work_days) : null;
      return {
        position_id: p.id,
        name: p.name,
        apparatus: (p.objects || []).map((o) => o.tag || o.type).filter(Boolean).join(', ') || null,
        people: 5,
        days: nd || c.days || 1,
        shifts: c.shifts || 2,
        shift_hours: c.shift_hours || 8,
        parallel_group: c.parallel_group || '1',
        source: nd ? 'norm' : (c.source || 'expert'),
        source_ref: nd ? (p.norm.code || null) : (c.source_ref || null),
        explain: nd ? `норма ${p.norm.code}` : (c.explain || null)
      };
    });

    // Окно: срок из ТЗ → срок руками РП → дедлайн тендера.
    const text = [row.tender_title, row.tender_description].filter(Boolean).join('\n');
    const fromTz = sched.extractSchedule(text);
    let windowDays = fromTz.found ? fromTz.days : null;
    let winSrc = fromTz.found ? 'ТЗ' : null;
    if (!windowDays) {
      const st = (rj.schedule && rj.schedule.days) || rj.schedule_days;
      if (Number(st) > 0) { windowDays = Number(st); winSrc = 'РП'; }
    }

    const plan = stages.normalizeCalcPlan(
      { positions: posList },
      { window_days: windowDays, max_crews: 6 }
    );
    rj.calc_plan = plan;
    if (Array.isArray(plan.crew) && plan.crew.length) {
      rj.tech_json = rj.tech_json || {};
      rj.tech_json.crew = plan.crew;
      rj.tech_json.schedule = Object.assign({}, rj.tech_json.schedule || {}, {
        work_days: plan.work_days
      });
    }

    const line = `#${row.tender_id} · ${dv.length} поз · ` +
      `${plan.crews} бр×5 = ${plan.people_total} чел · ${plan.work_days} сут` +
      (windowDays ? ` (окно ${windowDays} из ${winSrc}: ${plan.fits_window ? 'влезает' : 'НЕ влезает'})` : ' (окна нет)');

    if (DRY) { console.log(line); continue; }

    const put = await fetch(`${API}/api/tenders/${row.tender_id}/rp-review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
      body: JSON.stringify({ report_json: rj })
    });
    console.log(`${put.ok ? '✓' : '✗'} ${line}`);
  }
  await db.end();
})();
