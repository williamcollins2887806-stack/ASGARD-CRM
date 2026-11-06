#!/usr/bin/env node
'use strict';
/**
 * Пересчёт норм и плана по УЖЕ сохранённым карточкам на проде.
 *
 * Позиции в карточках созданы до исправления ключей, поэтому в них нет
 * блока norm и модель считала «экспертом». Здесь:
 *   1. берём dv_positions из report_json;
 *   2. заново прогоняем norm-preview с ПРАВИЛЬНЫМИ ключами категории;
 *   3. пересчитываем план новой формулой (бригады + окно дат);
 *   4. пишем обратно в карточку.
 * Модель не вызывается — только справочник и арифметика.
 *
 *   node tools/prod-recalc-norms.js --dry
 *   node tools/prod-recalc-norms.js
 */
require('dotenv').config();
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const workNorms = require('../src/services/work-norms');
const stages = require('../src/services/mimir-tender-stages');

const DRY = process.argv.includes('--dry');
const API = 'http://127.0.0.1:3000';

function inputsForPosition(pos) {
  const u = String(pos.unit || '').toLowerCase();
  const v = Number(pos.volume) || 0;
  const cat = String(pos.category_code || '');
  const isM3 = u.includes('м³') || u.includes('м3');
  const isM2 = u.includes('м²') || u.includes('м2');
  const base = {};
  if (isM3) base.circuit_m3 = v;
  if (isM3) base.volume_m3 = v;
  if (isM2) base.surface_m2 = v;

  if (u.includes('труб')) return Object.assign({}, base, { tubes: v, diameter_mm: 25, length_m: 6 });
  if (u.includes('стык')) return Object.assign({}, base, { joints: v, dn_mm: 159 });
  // Объём и площадь НЕ должны попадать в длину.
  if (!isM3 && !isM2) {
    if (u.includes('цикл')) return Object.assign({}, base, { cycles: v || 2 });
    if (u.includes('м')) return Object.assign({}, base, { length_m: v, dn_mm: 159 });
  }

  if (cat === 'boilers') return Object.assign({}, base, { cycles: 2, boilers: 1 });
  if (cat === 'plates') return Object.assign({}, base, { cycles: 2, apparatus: 1 });
  if (cat === 'chem_circuits' || (cat === 'towers_hvac' && !isM2)) {
    return Object.assign({}, base, { cycles: 2, apparatus_count: 1, points: 1, objects: 1 });
  }
  if (cat === 'vessels') return Object.assign({}, base, { deposit_cm: null, manways: 2 });
  if (cat === 'towers_hvac') return Object.assign({}, base, { cells: 1, biofouling: 'medium' });
  if (cat === 'tubes' || cat === 'avo') {
    return Object.assign({}, base, { tubes: v, diameter_mm: 25, length_m: 6 });
  }
  return Object.assign({}, base, { qty: v });
}

(async () => {
  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: '123456789', database: 'asgard_crm'
  });
  await db.connect();

  const { rows: u } = await db.query("SELECT id,login,role,name FROM users WHERE login='n.androsov'");
  const tk = jwt.sign(
    { id: u[0].id, login: u[0].login, role: u[0].role, name: u[0].name },
    process.env.JWT_SECRET || 'asgard-secret',
    { expiresIn: '2h' }
  );

  const { rows } = await db.query(`
    SELECT r.tender_id, r.report_json, t.deadline
      FROM tender_rp_reviews r
      JOIN tenders t ON t.id = r.tender_id AND t.deleted_at IS NULL
     WHERE jsonb_array_length(COALESCE(r.report_json->'dv_positions','[]'::jsonb)) > 0
     ORDER BY r.tender_id DESC`);

  console.log(`тендеров: ${rows.length} | режим: ${DRY ? 'СУХОЙ' : 'запись'}\n`);

  let totalNorm = 0;
  let totalPos = 0;

  for (const row of rows) {
    const rj = typeof row.report_json === 'string' ? JSON.parse(row.report_json) : row.report_json;
    const dv = rj.dv_positions || [];
    if (!dv.length) continue;
    totalPos += dv.length;

    let withNorm = 0;
    for (const p of dv) {
      if (!p.category_code) continue;
      try {
        const b = await workNorms.tryNormPreviewForEstimate(db, {
          work: { work_title: p.name },
          norm_inputs: {
            category_code: p.category_code,
            method_code: p.method_code,
            inputs: inputsForPosition(p),
            fouling: p.fouling || 'medium'
          }
        });
        if (b.preview && b.preview.ok) {
          p.norm = {
            code: b.preview.rate && b.preview.rate.code,
            work_days: b.preview.results && b.preview.results.work_days,
            crew: b.preview.crew,
            trace: b.preview.trace,
            fallback: !!b.preview.fallback
          };
          withNorm += 1;
        } else if (b.preview && b.preview.needs_input) {
          p.norm = { error: b.preview.error, needs_input: true };
          if (process.env.DBG) {
            console.log(`   [${p.category_code}.${p.method_code}] ${b.preview.error} <- ${JSON.stringify(inputsForPosition(p))}`);
          }
        }
      } catch (e) {
        if (process.env.DBG) console.log(`   [${p.category_code}] исключение: ${e.message}`);
      }
    }
    totalNorm += withNorm;

    const prev = (rj.calc_plan && rj.calc_plan.positions) || [];
    const byId = {};
    prev.forEach((c) => { if (c.position_id) byId[c.position_id] = c; });

    const planPositions = dv.map((p) => {
      const c = byId[p.id] || {};
      const normDays = p.norm && Number(p.norm.work_days) > 0 ? Number(p.norm.work_days) : null;
      const crew = p.norm && p.norm.crew;
      const normCrew = crew
        ? (Number(crew.master) || 0) + (Number(crew.exec) || 0) + (Number(crew.observers) || 0)
        : null;
      return {
        position_id: p.id,
        name: p.name,
        apparatus: (p.objects || []).map((o) => o.tag || o.type).filter(Boolean).join(', ') || null,
        people: normCrew || c.people || 3,
        days: normDays || c.days || 1,
        shifts: c.shifts || 2,
        shift_hours: c.shift_hours || (crew && crew.shift_hours) || 8,
        parallel_group: c.parallel_group || '1',
        source: normDays ? 'norm' : (c.source || 'expert'),
        source_ref: normDays ? (p.norm.code || null) : (c.source_ref || null),
        explain: normDays ? `норма ${p.norm.code}` : (c.explain || null)
      };
    });

    let windowDays = null;
    if (row.deadline) {
      const d = Math.ceil((new Date(row.deadline).getTime() - Date.now()) / 86400000);
      if (d > 0) windowDays = d;
    }

    const plan = stages.normalizeCalcPlan(
      { positions: planPositions },
      { window_days: windowDays, max_crews: 3 }
    );
    rj.calc_plan = plan;

    const line = `#${row.tender_id} · ${dv.length} позиц · норм ${withNorm} · ` +
      `бригад ${plan.crews} · срок ${plan.work_days} сут` +
      (windowDays ? ` (окно ${windowDays}: ${plan.fits_window ? 'влезает' : 'НЕ влезает'})` : '');

    if (DRY) { console.log(line); continue; }

    const put = await fetch(`${API}/api/tenders/${row.tender_id}/rp-review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
      body: JSON.stringify({ report_json: rj })
    });
    console.log(`${put.ok ? '✓' : '✗'} ${line}${put.ok ? '' : ' — HTTP ' + put.status}`);
  }

  await db.end();
  console.log(`\nнормы найдены у ${totalNorm} из ${totalPos} позиций`);
})();
