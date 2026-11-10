#!/usr/bin/env node
'use strict';
/**
 * prod-visit-rerun.js — полный прогон анализа и просчёта с графиком заездов.
 *
 * Порядок важен: сессия создаётся НОВАЯ (старая висит на этапе dv и её
 * состояние уже смешано с прошлыми попытками), затем анализ, затем этапы
 * продвигаются явно (dv → tech → decision), только после этого finalize
 * может закрыть анализ в done. calc-plan идёт между tech и decision, как в UI.
 *
 *   node tools/prod-visit-rerun.js --tender=2138 [--dry]
 */
require('dotenv').config();
const path = require('path');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const arg = (n) => {
  const a = process.argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.split('=')[1] : null;
};
const TENDER = Number(arg('tender'));
const DRY = process.argv.includes('--dry');
const PORT = Number(process.env.APP_PORT || 3000);
const SECRET = process.env.JWT_SECRET || 'asgard';

function request(method, urlPath, token, body, timeoutMs = 1800000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: Object.assign(
        { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}
      ),
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, json, raw: data.slice(0, 600) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + urlPath)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const log = (...a) => console.log(...a);

async function snap(db, tenderId) {
  const r = await db.query(`
    SELECT rev.id AS review_id, rev.is_final, rev.work_price,
           COALESCE(jsonb_array_length(rev.report_json->'dv_positions'),0) AS dv,
           COALESCE(jsonb_array_length(rev.report_json->'mtr_suggestions'),0) AS mtr,
           COALESCE(jsonb_array_length(rev.report_json->'asgard_smeta'->'works'),0) AS works,
           COALESCE(jsonb_array_length(rev.report_json->'calc_plan'),0) AS calc_plan,
           rev.report_json->'visit_plan'->>'mode' AS visit_mode,
           rev.report_json->'visit_plan'->>'trip_count' AS trip_count,
           rev.report_json->'asgard_smeta'->'totals'->>'price_no_vat' AS price_no_vat,
           rev.report_json->'asgard_smeta'->'params'->>'trip_count' AS smeta_trips,
           rev.report_json->'asgard_smeta'->'params'->>'work_days' AS work_days
      FROM tender_rp_reviews rev WHERE rev.tender_id = $1 ORDER BY rev.id DESC LIMIT 1
  `, [tenderId]);
  return r.rows[0] || null;
}

(async () => {
  if (!TENDER) { console.error('нужен --tender=ID'); process.exit(1); }
  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    database: process.env.DB_NAME || 'asgard_crm'
  });
  await db.connect();

  const before = await snap(db, TENDER);
  log('=== ДО ===');
  log(JSON.stringify(before, null, 2));

  const admin = (await db.query(
    `SELECT id, login, role, name FROM users
      WHERE role IN ('ADMIN','HEAD_TO','TO') AND is_active
      ORDER BY (role='ADMIN') DESC, id LIMIT 1`)).rows[0];
  const pm = (await db.query(
    `SELECT id, login, role, name FROM users WHERE login='n.androsov' LIMIT 1`)).rows[0];
  if (!admin || !pm) throw new Error('нет ADMIN/TO или n.androsov');
  const tokAdmin = jwt.sign({ id: admin.id, login: admin.login, role: admin.role, name: admin.name }, SECRET, { expiresIn: '4h' });
  const tokPm = jwt.sign({ id: pm.id, login: pm.login, role: pm.role, name: pm.name }, SECRET, { expiresIn: '4h' });

  if (DRY) { log('DRY — стоп'); await db.end(); return; }

  // 1. Unlock (если карточка закрыта)
  if (before && before.is_final) {
    const rw = await request('POST', `/api/tenders/${TENDER}/rp-review/to-decision`, tokAdmin, {
      action: 'rework', comment: 'переразбор графика заездов (prod-visit-rerun)'
    });
    log('rework:', rw.status, rw.json && (rw.json.ok || rw.json.error));
    if (rw.status >= 400) throw new Error('rework failed');
    await db.query(`UPDATE tenders SET calculator_user_id=$1, calculator_kind='pm', updated_at=NOW() WHERE id=$2`, [pm.id, TENDER]);
    await db.query(`UPDATE tender_rp_reviews SET calculator_user_id=$1, updated_at=NOW() WHERE tender_id=$2`, [pm.id, TENDER]);
  }

  // 2. Бэкап отчёта
  await db.query(`CREATE TABLE IF NOT EXISTS _backup_rp_report_json (
    id bigserial PRIMARY KEY, tender_id int, review_id int,
    taken_at timestamptz DEFAULT NOW(), report_json jsonb)`);
  await db.query(`INSERT INTO _backup_rp_report_json (tender_id, review_id, report_json)
    SELECT tender_id, id, report_json FROM tender_rp_reviews WHERE tender_id=$1`, [TENDER]);

  const trow = (await db.query(
    'SELECT id, customer_name, tender_title, tender_description FROM tenders WHERE id=$1',
    [TENDER])).rows[0];
  const tz = [trow.tender_title, trow.tender_description].filter(Boolean).join('\n\n');

  // 3. Новая сессия анализа
  const sres = await request('POST', '/api/tkp-quick/sessions', tokPm, {
    tender_id: TENDER,
    customer_name: trow.customer_name || null,
    tz_text: tz
  });
  const uid = (sres.json && sres.json.session && sres.json.session.session_uid)
    || (sres.json && sres.json.session_uid);
  if (!uid) throw new Error('нет session_uid: ' + sres.raw);
  log('сессия:', uid, '| HTTP', sres.status);

  const stage = (db, id) => db.query(
    'SELECT stage, stage_state FROM tkp_quick_sessions WHERE session_uid=$1', [id]
  ).then((r) => r.rows[0] || {});

  // 4. Анализ
  log('analyze…');
  const ares = await request('POST', `/api/tkp-quick/sessions/${uid}/stage/analyze`, tokPm, {
    tz_text: tz
  });
  const a = ares.json || {};
  const positions = (a.state && a.state.positions) || [];
  log('analyze HTTP', ares.status, 'ok=', a.ok,
    '| позиций:', positions.length,
    '| режим:', a.visit_mode || (a.visit_plan && a.visit_plan.mode),
    '| заездов:', a.trip_count || (a.visit_plan && a.visit_plan.trip_count),
    '| incomplete:', a.incomplete);
  if (ares.status >= 400 || !a.ok) { log('raw:', ares.raw); throw new Error('analyze failed'); }
  if (!positions.length) throw new Error('analyze вернул 0 позиций');

  const vp = a.visit_plan || (a.state && a.state.visit_plan) || null;
  if (vp) {
    log('visit_plan: mode=' + vp.mode, 'trips=' + vp.trip_count,
      'visits=' + (vp.visits || []).length,
      'totals=' + JSON.stringify(vp.totals || {}),
      'conflicts=' + (vp.conflicts || []).map((c) => c.kind).join(','));
  }

  // 5. Продвижение этапов: dv → tech → decision
  // finalize прыгает dv → done через decision, но переход проверяется машинно.
  for (const to of ['tech', 'decision']) {
    const st = await request('POST', `/api/tkp-quick/sessions/${uid}/stage`, tokPm, { stage: to });
    log('stage →', to, st.status, st.json && (st.json.ok || st.json.error));
  }

  // 6. План просчёта (люди/сроки/заезды)
  log('calc-plan…');
  const cres = await request('POST', `/api/tkp-quick/sessions/${uid}/stage/calc-plan`, tokPm, {});
  const c = cres.json || {};
  const calcPositions = (c.state && c.state.calc && c.state.calc.positions) || [];
  log('calc-plan HTTP', cres.status, 'ok=', c.ok,
    '| позиций плана:', calcPositions.length,
    '| trip_count:', c.trip_count || (c.plan && c.plan.trip_count),
    '| work_days:', (c.plan && c.plan.work_days));
  if (cres.status >= 400) log('calc-plan raw:', cres.raw);

  // 7. Финализация: перенос ДВ/плана/заездов в отчёт
  log('finalize…');
  const fres = await request('POST', `/api/tkp-quick/sessions/${uid}/stage/finalize`, tokPm, { go: true });
  log('finalize HTTP', fres.status, fres.json && (fres.json.ok || fres.json.error),
    fres.json && fres.json.report_patch && ('· ' + JSON.stringify(fres.json.report_patch).slice(0, 160)));
  if (fres.status >= 400) log('finalize raw:', fres.raw);

  // 8. Пересборка сметы: visit_plan → trip_count → дорога/проживание
  const stRow = await db.query(
    'SELECT stage, stage_state FROM tkp_quick_sessions WHERE session_uid=$1', [uid]);
  const st = (stRow.rows[0] && stRow.rows[0].stage_state) || {};
  const rev = (await db.query(
    'SELECT id, report_json FROM tender_rp_reviews WHERE tender_id=$1', [TENDER])).rows[0];
  if (!rev) throw new Error('нет отчёта РП');

  const asgardSmeta = require(path.join(ROOT, 'src/services/asgard-smeta.js'));
  const workNorms = require(path.join(ROOT, 'src/services/work-norms.js'));
  const globals = await workNorms.loadGlobals(db);
  const params = workNorms.globalsToCalcSettings(globals.map) || {};

  const rj = rev.report_json || {};
  const calc = (st.calc && st.calc.positions) || [];
  const dvPositions = Array.isArray(rj.dv_positions) && rj.dv_positions.length
    ? rj.dv_positions : (Array.isArray(st.positions) ? st.positions : []);
  const byId = new Map();
  dvPositions.forEach((p) => {
    if (!p) return;
    if (p.id != null) byId.set(String(p.id), p);
    if (p.position_id != null) byId.set(String(p.position_id), p);
  });

  const CREW_LABEL = {
    itr: 'ИТР (РП)', master: 'Мастер / бригадир', worker: 'Слесарь',
    observer: 'Наблюдающий', chemist: 'Химик', pto: 'ПТО / приёмка'
  };
  const planCrew = Array.isArray(st.calc && st.calc.crew) ? st.calc.crew : [];
  const prevCrew = Array.isArray(rj.asgard_smeta && rj.asgard_smeta.crew) ? rj.asgard_smeta.crew : [];
  const crewSource = planCrew.length ? planCrew : prevCrew;
  const crewNorm = [];
  for (const cr of crewSource) {
    const code = String(cr.role_code || cr.code || '').toLowerCase();
    if (!CREW_LABEL[code]) continue;
    const cnt = Number(cr.count) || 0;
    if (!(cnt > 0)) continue;
    const ITR_LIKE = code === 'itr' || code === 'safety';
    crewNorm.push({
      code, role: CREW_LABEL[code], count: cnt,
      shifts_per_day: ITR_LIKE ? 1 : null,
      shifts_locked: ITR_LIKE ? true : undefined,
      hours_per_shift: Number(params.shift_hours) || 12
    });
  }
  if (!crewNorm.length) throw new Error('нет бригады — смету не собираем');

  const workDays = Number((st.calc && st.calc.work_days) || 0) || null;
  if (workDays) params.work_days = Math.max(1, Math.round(workDays));
  if (!params.shifts_per_day) params.shifts_per_day = 2;
  if (!params.shift_hours) params.shift_hours = 12;

  const visitPlan = rj.visit_plan || st.visit_plan || null;
  const tripCount = Number(visitPlan && visitPlan.trip_count) > 0
    ? Number(visitPlan.trip_count)
    : (Number(st.calc && st.calc.trip_count) || 1);
  params.trip_count = Math.max(1, Math.round(tripCount));
  if (visitPlan && visitPlan.unconfirmed) params.visit_mode_unconfirmed = true;

  const mtr = Array.isArray(rj.mtr_suggestions) && rj.mtr_suggestions.length
    ? rj.mtr_suggestions
    : (Array.isArray(st.mtr_suggestions) ? st.mtr_suggestions : []);

  const works = calc.length
    ? calc.map((x) => {
      const dv = byId.get(String(x.position_id)) || {};
      return {
        id: x.id || x.position_id || null,
        name: x.name || dv.name || 'Работа',
        unit: dv.unit || null,
        volume: Number(dv.volume) || null,
        people: Number(x.people) || null,
        days: Number(x.days) || null,
        labor_hours: Number(dv.labor_hours) || null,
        volume_source: dv.volume_source || null
      };
    })
    : dvPositions.map((p, i) => ({
      id: p.id || ('dv' + (i + 1)),
      name: p.name || 'Работа',
      unit: p.unit || null,
      volume: Number(p.volume) || null,
      labor_hours: Number(p.labor_hours) || null
    }));

  const sm = asgardSmeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    params,
    crew: crewNorm,
    mtr,
    works,
    schedule: {
      duration_days: workDays,
      crews: Number((st.calc && st.calc.crews) || 0) || 1,
      shifts_per_day: params.shifts_per_day,
      shift_hours: params.shift_hours,
      trip_count: params.trip_count,
      trips: (Array.isArray(visitPlan && visitPlan.visits) ? visitPlan.visits : []).map((v) => ({
        from: v.period_start || null,
        to: v.period_end || null,
        days: Number(v.work_days) || 0,
        label: v.label || null
      }))
    },
    meta: { work_duration_days: workDays, crews: Number((st.calc && st.calc.crews) || 0) || 1 },
    filled_by: 'mimir_visit_rerun',
    updated_at: new Date().toISOString()
  });
  if (!sm || !sm.totals) throw new Error('recalcAsgardSmeta вернул пусто');

  const price = Number(sm.totals.price_no_vat) || 0;
  const nextRj = Object.assign({}, rj, {
    asgard_smeta: sm,
    dv_positions: dvPositions,
    calc_plan: calc.length ? calc : (rj.calc_plan || []),
    visit_plan: visitPlan,
    visit_mode: visitPlan ? visitPlan.mode : null,
    trip_count: params.trip_count
  });
  if (mtr.length) { nextRj.mtr_suggestions = mtr; if (!Array.isArray(nextRj.mtr) || !nextRj.mtr.length) nextRj.mtr = mtr; }

  await db.query(
    `UPDATE tender_rp_reviews SET report_json=$1::jsonb, work_price=$2, work_price_ex_vat=$2, updated_at=NOW() WHERE id=$3`,
    [JSON.stringify(nextRj), price, rev.id]
  );
  log('смета:', {
    price_no_vat: price,
    cost: sm.totals.cost,
    work_days: sm.params && sm.params.work_days,
    work_days_source: sm.work_days_source,
    trip_count: sm.params && sm.params.trip_count,
    trips: (sm.schedule && sm.schedule.trips || []).length,
    works: (sm.works || []).length,
    crew: crewNorm.length,
    dv: dvPositions.length,
    calc: calc.length,
    mtr: mtr.length
  });

  const after = await snap(db, TENDER);
  log('=== ПОСЛЕ ===');
  log(JSON.stringify(after, null, 2));

  let fails = 0;
  const gate = (label, ok, detail) => {
    log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? ' — ' + detail : ''));
    if (!ok) fails += 1;
  };
  gate('ДВ в отчёте > 0', Number(after.dv) > 0, 'dv=' + after.dv);
  gate('works в смете > 0', Number(after.works) > 0, 'works=' + after.works);
  gate('цена без НДС > 0', Number(after.price_no_vat) > 0, after.price_no_vat);
  gate('work_price = price_no_vat', Math.abs(Number(after.work_price) - Number(after.price_no_vat)) < 1,
    after.work_price + ' vs ' + after.price_no_vat);
  gate('visit_plan в отчёте', !!after.visit_mode, 'mode=' + after.visit_mode + ' trips=' + after.trip_count);
  gate('trip_count дошёл до сметы', Number(after.smeta_trips) >= 1, 'smeta_trips=' + after.smeta_trips);
  gate('МТР в отчёте > 0', Number(after.mtr) > 0, 'mtr=' + after.mtr);

  log('\nИТОГ: ' + (fails ? ('FAIL — ' + fails) : 'PASS'));
  await db.end();
  process.exit(fails ? 2 : 0);
})().catch((e) => { console.error('СБОЙ:', e && e.stack || e); process.exit(1); });
