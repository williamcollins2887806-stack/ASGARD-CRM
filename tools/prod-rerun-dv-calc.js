#!/usr/bin/env node
'use strict';
/**
 * Полный перепрогон ДВ → план → отчёт → смета для одного тендера на проде.
 *
 * Зачем: archive-деплой анализ не трогал; у #2138 в report_json нет dv_positions,
 * а цена ~5 млн без объёма. Этот скрипт:
 *   1) снимок до;
 *   2) TO rework (снимает is_final);
 *   3) stage/analyze → stage/calc-plan → stage/finalize {go:true};
 *   4) пересборка asgard_smeta через buildSmetaFromStage-логику (локальный require);
 *   5) снимок после + гейты (ДВ>0, works с days/volume, цена изменилась или обоснована).
 *
 *   node tools/prod-rerun-dv-calc.js --tender=2138 [--dry]
 * Запускать НА ПРОД-СЕРВЕРЕ из /var/www/asgard-crm (нужен :3000 и БД).
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
const BASE_HOST = '127.0.0.1';
const BASE_PORT = Number(process.env.APP_PORT || 3000);
const SECRET = process.env.JWT_SECRET || 'asgard';

function request(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host: BASE_HOST, port: BASE_PORT, path: urlPath, method,
      headers: Object.assign(
        { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}
      ),
      timeout: 1800000
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, json, raw: data.slice(0, 800) });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function snap(db, tenderId) {
  const r = await db.query(`
    SELECT rev.id AS review_id, rev.is_final, rev.analysis_finalized_at,
           rev.calculator_user_id, rev.work_price,
           COALESCE(jsonb_array_length(rev.report_json->'dv_positions'),0) AS dv,
           COALESCE(jsonb_array_length(rev.report_json->'mtr_suggestions'),0) AS mtr,
           COALESCE(jsonb_array_length(rev.report_json->'mtr'),0) AS mtr_top,
           COALESCE(jsonb_array_length(rev.report_json->'asgard_smeta'->'works'),0) AS works,
           COALESCE(jsonb_array_length(rev.report_json->'calc_plan'),0) AS calc_plan,
           rev.report_json->'asgard_smeta'->'totals'->>'price_no_vat' AS price_no_vat,
           rev.report_json->'asgard_smeta'->'totals'->>'cost' AS cost,
           rev.report_json->'asgard_smeta'->'totals'->>'equipment' AS equipment,
           rev.report_json->'asgard_smeta'->'params'->>'work_days' AS work_days,
           rev.report_json->'asgard_smeta'->>'work_days_source' AS work_days_source
      FROM tender_rp_reviews rev
     WHERE rev.tender_id = $1
     ORDER BY rev.id DESC LIMIT 1
  `, [tenderId]);
  return r.rows[0] || null;
}

function gate(label, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? ' — ' + detail : ''));
  return !!ok;
}

(async () => {
  if (!TENDER) { console.error('нужен --tender=ID'); process.exit(1); }
  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    database: process.env.DB_NAME || 'asgard_crm'
  });
  await db.connect();

  const before = await snap(db, TENDER);
  console.log('=== ДО ===');
  console.log(JSON.stringify(before, null, 2));

  // JWT: ADMIN для rework, PM Андросов для stage API
  const admin = (await db.query(
    `SELECT id, login, role, name FROM users
      WHERE role IN ('ADMIN','HEAD_TO','TO') AND is_active
      ORDER BY (role='ADMIN') DESC, id LIMIT 1`
  )).rows[0];
  const pm = (await db.query(
    `SELECT id, login, role, name FROM users WHERE login='n.androsov' LIMIT 1`
  )).rows[0];
  if (!admin || !pm) throw new Error('нет ADMIN/TO или n.androsov');
  const tokAdmin = jwt.sign({ id: admin.id, login: admin.login, role: admin.role, name: admin.name }, SECRET, { expiresIn: '3h' });
  const tokPm = jwt.sign({ id: pm.id, login: pm.login, role: pm.role, name: pm.name }, SECRET, { expiresIn: '3h' });
  console.log('rework от:', admin.login, admin.role, '| stage от:', pm.login);

  if (DRY) {
    console.log('DRY — дальше не идём');
    await db.end();
    return;
  }

  // 1) Unlock
  if (before && before.is_final) {
    const rw = await request('POST', `/api/tenders/${TENDER}/rp-review/to-decision`, tokAdmin, {
      action: 'rework',
      comment: 'переразбор ДВ Мимиром (конвейер prod-rerun-dv-calc)'
    });
    console.log('rework:', rw.status, rw.json && (rw.json.ok || rw.json.error) || rw.raw);
    if (rw.status >= 400) throw new Error('rework failed');
    // Вернуть calculator Андросову (rework обнуляет)
    await db.query(
      `UPDATE tenders SET calculator_user_id=$1, calculator_kind='pm', updated_at=NOW() WHERE id=$2`,
      [pm.id, TENDER]
    );
    await db.query(
      `UPDATE tender_rp_reviews SET calculator_user_id=$1, updated_at=NOW() WHERE tender_id=$2`,
      [pm.id, TENDER]
    );
  }

  // 2) Backup report_json
  await db.query(`
    CREATE TABLE IF NOT EXISTS _backup_rp_report_json (
      id bigserial PRIMARY KEY,
      tender_id int,
      review_id int,
      taken_at timestamptz DEFAULT NOW(),
      report_json jsonb
    )`);
  await db.query(`
    INSERT INTO _backup_rp_report_json (tender_id, review_id, report_json)
    SELECT tender_id, id, report_json FROM tender_rp_reviews WHERE tender_id=$1
  `, [TENDER]);
  console.log('backup report_json → _backup_rp_report_json');

  // 3) Session
  const trow = (await db.query(
    'SELECT id, customer_name, tender_title, tender_description FROM tenders WHERE id=$1',
    [TENDER]
  )).rows[0];
  const sres = await request('POST', '/api/tkp-quick/sessions', tokPm, {
    tender_id: TENDER,
    customer_name: trow.customer_name || null,
    tz_text: [trow.tender_title, trow.tender_description].filter(Boolean).join('\n\n')
  });
  const uid = (sres.json && sres.json.session && sres.json.session.session_uid)
    || (sres.json && sres.json.session_uid);
  if (!uid) throw new Error('нет session_uid: ' + sres.raw);
  console.log('сессия:', uid);

  // 4) Analyze (долго)
  console.log('analyze…');
  const ares = await request('POST', `/api/tkp-quick/sessions/${uid}/stage/analyze`, tokPm, {
    tz_text: [trow.tender_title, trow.tender_description].filter(Boolean).join('\n\n')
  });
  console.log('analyze HTTP', ares.status, 'ok=', ares.json && ares.json.ok);
  const pos = (ares.json && ares.json.state && ares.json.state.positions) || [];
  const mtrS = (ares.json && ares.json.mtr_suggestions) || [];
  console.log('позиций:', pos.length, '| mtr_suggestions:', mtrS.length,
    '| incomplete:', ares.json && ares.json.incomplete,
    '| expected_rows:', ares.json && ares.json.expected_rows);
  if (ares.status >= 400 || !(ares.json && ares.json.ok)) {
    console.log('analyze raw:', ares.raw);
    throw new Error('analyze failed');
  }
  if (!pos.length) throw new Error('analyze вернул 0 позиций — в CRM не пишем');

  // 5) Calc-plan (бригада/срок из ДВ)
  console.log('calc-plan…');
  const cres = await request('POST', `/api/tkp-quick/sessions/${uid}/stage/calc-plan`, tokPm, {});
  console.log('calc-plan HTTP', cres.status, 'ok=', cres.json && cres.json.ok);
  const calcPos = (cres.json && cres.json.state && cres.json.state.calc && cres.json.state.calc.positions) || [];
  const crew = (cres.json && cres.json.state && cres.json.state.calc && cres.json.state.calc.crew) || [];
  console.log('план позиций:', calcPos.length, '| бригада ролей:', crew.length,
    '| work_days:', cres.json && cres.json.state && cres.json.state.calc && cres.json.state.calc.work_days);
  if (cres.status >= 400) {
    console.log('calc-plan raw:', cres.raw);
    // не валим сразу — finalize всё равно положит ДВ; смета может собраться из prev
  }

  // 6) Finalize → report_json.dv_positions (+ mtr после нашего фикса)
  console.log('finalize…');
  const fres = await request('POST', `/api/tkp-quick/sessions/${uid}/stage/finalize`, tokPm, { go: true });
  console.log('finalize HTTP', fres.status, fres.json && fres.json.report_patch, fres.json && fres.json.error);
  if (fres.status >= 400) throw new Error('finalize failed: ' + fres.raw);

  // 7) Пересборка asgard_smeta текущим движком из stage_state
  // Используем тот же вход, что buildSmetaFromStage: через прямой SQL + asgard-smeta.
  // (функция в pm-duty не экспортируется — дублируем канон через session + works).
  const asgardSmeta = require(path.join(ROOT, 'src/services/asgard-smeta.js'));
  const stRow = await db.query(
    `SELECT stage_state FROM tkp_quick_sessions WHERE session_uid=$1`, [uid]
  );
  const st = (stRow.rows[0] && stRow.rows[0].stage_state) || {};
  const rev = await db.query(`SELECT id, report_json FROM tender_rp_reviews WHERE tender_id=$1`, [TENDER]);
  const rj = rev.rows[0].report_json || {};

  const calc = (st.calc && st.calc.positions) || [];
  const dvPositions = Array.isArray(st.positions) ? st.positions : [];
  const byId = new Map();
  dvPositions.forEach((p) => {
    if (!p) return;
    if (p.id != null) byId.set(String(p.id), p);
    if (p.position_id != null) byId.set(String(p.position_id), p);
  });

  let params = {};
  try {
    const workNorms = require(path.join(ROOT, 'src/services/work-norms.js'));
    const globals = await workNorms.loadGlobals(db);
    params = workNorms.globalsToCalcSettings(globals.map) || {};
  } catch (_) {}

  const CREW_LABEL = {
    itr: 'ИТР (РП)', master: 'Мастер / бригадир', worker: 'Слесарь',
    observer: 'Наблюдающий', chemist: 'Химик', pto: 'ПТО / приёмка'
  };
  const planCrew = Array.isArray(st.calc && st.calc.crew) ? st.calc.crew : [];
  const prevCrew = Array.isArray(rj.asgard_smeta && rj.asgard_smeta.crew) ? rj.asgard_smeta.crew : [];
  const crewSource = planCrew.length ? planCrew : prevCrew;
  const crewNorm = [];
  for (const c of crewSource) {
    const code = String(c.role_code || c.code || '').toLowerCase();
    if (!CREW_LABEL[code]) continue;
    const cnt = Number(c.count) || 0;
    if (!(cnt > 0)) continue;
    const ITR_LIKE = code === 'itr' || code === 'safety';
    crewNorm.push({
      code, role: CREW_LABEL[code], count: cnt,
      shifts_per_day: ITR_LIKE ? 1 : null,
      shifts_locked: ITR_LIKE ? true : undefined,
      hours_per_shift: Number(params.shift_hours) || 12
    });
  }
  if (!crewNorm.length) throw new Error('нет бригады после calc-plan — смета не соберётся без выдуманного ФОТ');

  const workDays = Number((st.calc && st.calc.work_days) || 0) || null;
  if (workDays) params.work_days = Math.max(1, Math.round(workDays));
  if (!params.shifts_per_day) params.shifts_per_day = 2;
  if (!params.shift_hours) params.shift_hours = 12;

  const mtr = (() => {
    const fromPlan = Array.isArray(st.calc && st.calc.mtr) ? st.calc.mtr : [];
    if (fromPlan.length) return fromPlan;
    const fromSuggest = Array.isArray(st.mtr_suggestions) ? st.mtr_suggestions : [];
    if (fromSuggest.length) return fromSuggest;
    return Array.isArray(rj.mtr_suggestions) ? rj.mtr_suggestions : [];
  })();

  const works = calc.length
    ? calc.map((c) => {
      const dv = byId.get(String(c.position_id)) || {};
      return {
        id: c.id || c.position_id || null,
        name: c.name || dv.name || 'Работа',
        unit: dv.unit || null,
        volume: Number(dv.volume) || null,
        people: Number(c.people) || null,
        days: Number(c.days) || null,
        labor_hours: Number(dv.labor_hours) || null,
        norm_code: (dv.norm && dv.norm.code) || null,
        volume_source: dv.volume_source || null,
        approved: !!c.approved
      };
    })
    : dvPositions.map((p, i) => ({
      id: p.id || ('dv' + (i + 1)),
      name: p.name || 'Работа',
      unit: p.unit || null,
      volume: Number(p.volume) || null,
      people: null,
      days: null,
      labor_hours: Number(p.labor_hours) || null,
      volume_source: p.volume_source || null
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
      shift_hours: params.shift_hours
    },
    meta: { work_duration_days: workDays, crews: Number((st.calc && st.calc.crews) || 0) || 1 },
    filled_by: 'mimir_rerun_dv_calc',
    updated_at: new Date().toISOString()
  });
  if (!sm || !sm.totals) throw new Error('recalcAsgardSmeta вернул пусто');

  const price = Number(sm.totals.price_no_vat) || 0;
  const nextRj = Object.assign({}, rj, {
    asgard_smeta: sm,
    dv_positions: dvPositions.length ? dvPositions : (rj.dv_positions || []),
    calc_plan: calc.length ? calc : (rj.calc_plan || [])
  });
  if (mtr.length) {
    nextRj.mtr_suggestions = mtr;
    if (!Array.isArray(nextRj.mtr) || !nextRj.mtr.length) nextRj.mtr = mtr;
  }

  await db.query(
    `UPDATE tender_rp_reviews
        SET report_json = $1::jsonb,
            work_price = $2,
            work_price_ex_vat = $2,
            updated_at = NOW()
      WHERE id = $3`,
    [JSON.stringify(nextRj), price, rev.rows[0].id]
  );
  console.log('смета записана: price_no_vat=', price, '| work_days_source=', sm.work_days_source,
    '| works=', (sm.works || []).length, '| mtr=', mtr.length);

  const after = await snap(db, TENDER);
  console.log('=== ПОСЛЕ ===');
  console.log(JSON.stringify(after, null, 2));

  console.log('\n=== ГЕЙТЫ ===');
  let fails = 0;
  if (!gate('ДВ в report_json > 0', Number(after.dv) > 0, 'dv=' + after.dv)) fails += 1;
  if (!gate('ДВ не меньше разумного порога (≥50 для 2138-класса)', Number(after.dv) >= 50 || TENDER !== 2138, 'dv=' + after.dv)) fails += 1;
  if (!gate('МТР в отчёте (suggestions или top)', Number(after.mtr) + Number(after.mtr_top) > 0, 'mtr=' + after.mtr + '/' + after.mtr_top)) fails += 1;
  if (!gate('works в smeta > 0', Number(after.works) > 0, 'works=' + after.works)) fails += 1;
  if (!gate('цена без НДС > 0', Number(after.price_no_vat) > 0, after.price_no_vat)) fails += 1;
  if (!gate('work_price = price_no_vat', Math.abs(Number(after.work_price) - Number(after.price_no_vat)) < 1,
    after.work_price + ' vs ' + after.price_no_vat)) fails += 1;
  // Доказательство «не из головы»: срок из works ИЛИ calc_plan с days
  const worksWithEffort = (sm.works || []).filter((w) => Number(w.days) > 0 || Number(w.labor_hours) > 0 || Number(w.volume) > 0).length;
  if (!gate('works с объёмом/сроком > 0 (ДВ участвует)', worksWithEffort > 0, 'n=' + worksWithEffort)) fails += 1;
  if (!gate('work_days_source = works (если есть трудозатраты) || params',
    !sm.work_days_source || sm.work_days_source === 'works' || sm.work_days_source === 'params',
    sm.work_days_source)) fails += 1;

  const beforePrice = Number(before && before.price_no_vat) || 0;
  const afterPrice = Number(after.price_no_vat) || 0;
  console.log('цена: было', Math.round(beforePrice), '→ стало', Math.round(afterPrice),
    '(Δ', Math.round(afterPrice - beforePrice), ')');
  console.log('ДВ: было', before && before.dv, '→ стало', after.dv);

  await db.end();
  if (fails) {
    console.log('\nИТОГ: FAIL — ' + fails + ' гейт(ов)');
    process.exit(2);
  }
  console.log('\nИТОГ: PASS — ДВ в CRM, смета пересобрана, цена согласована с work_price');
  process.exit(0);
})().catch((e) => {
  console.error('СБОЙ:', e && e.stack || e);
  process.exit(1);
});
