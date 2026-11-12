#!/usr/bin/env bash
# Рантайм-проверка P2 на РЕАЛЬНЫХ данных #2138: план по позициям ДВ несёт
# разрез трудосуток по заездам, работа на объекте не уехала от числа выездов,
# а дорога/проживание выросли.
set -euo pipefail
APP=/var/www/asgard-crm
V=/tmp/verify-p2
rm -rf "$V"
mkdir -p "$V"
cp -r "$APP/src" "$V/src"
cp /tmp/p2-mimir-tender-stages.js "$V/src/services/mimir-tender-stages.js"

cat > "$V/p2.js" <<'EOS'
const APP = '/var/www/asgard-crm';
const V = '/tmp/verify-p2';
process.chdir(APP);
const { Pool } = require(APP + '/node_modules/pg');
const stages = require(V + '/src/services/mimir-tender-stages');
const smeta = require(V + '/src/services/asgard-smeta');

const pool = new Pool({
  host: 'localhost', port: 5432, user: 'asgard',
  password: '123456789', database: 'asgard_crm', max: 2
});

(async () => {
  const rev = await pool.query(
    'SELECT id, report_json FROM tender_rp_reviews WHERE tender_id = 2138 ORDER BY id DESC LIMIT 1'
  );
  if (!rev.rows[0]) { console.log('нет карточки'); await pool.end(); return; }
  const rj = rev.rows[0].report_json || {};
  const positions = Array.isArray(rj.dv_positions) ? rj.dv_positions : [];
  const vp = rj.visit_plan || {};
  const visits = Array.isArray(vp.visits) ? vp.visits : [];
  console.log('позиций:', positions.length, '| заездов:', visits.length,
    '| режим:', vp.mode || '—', '| trip_count:', vp.trip_count);

  const planPositions = positions.map((p, i) => ({
    id: p.id || ('dv' + (i + 1)),
    name: p.name,
    people: p.people || null,
    days: p.days || null,
    mh: p.mh || null,
    shifts: p.shifts || null,
    shift_hours: p.shift_hours || null,
    source: p.source || null,
    period: p.period || null
  }));

  // Привязываем позиции к заездам по периоду — как делает attachPositionsToVisits.
  const normalizedVisits = visits.map((v, i) => {
    const label = String(v.label || '').toLowerCase();
    const ids = planPositions
      .filter((p) => {
        const pl = String(p.period || '').toLowerCase();
        return pl && label && (pl === label || label.includes(pl) || pl.includes(label));
      })
      .map((p) => String(p.id));
    return { id: v.id || ('v' + (i + 1)), label: v.label, period_start: v.period_start,
      period_end: v.period_end, position_ids: ids.length ? ids : (v.position_ids || []) };
  });
  console.log('размечено позиций по заездам:',
    normalizedVisits.map((v) => (v.position_ids || []).length));

  const plan = stages.normalizeCalcPlan(
    { positions: planPositions, trip_count: visits.length || 1, visits: normalizedVisits },
    { visit_mode: vp.mode || 'visits', trip_count: visits.length || 1, dv_positions: planPositions }
  );

  console.log('\nwork_days:', plan.work_days, '| источник:', plan.work_days_source,
    '| бригад:', plan.crews, '| людей:', plan.headcount_shift,
    '| MH:', Math.round(plan.man_hours));
  console.log('work_days_per_trip:', plan.work_days_per_trip,
    '| Σ разрез:', plan.visits_work_total);
  console.log('разрез по заездам:');
  for (const v of plan.visits_work) {
    console.log('  ', v.label || v.id, '| трудосуток', v.work_days,
      '| доля', v.share_pct + '%', '| чел·ч', v.person_hours, '| позиц.', v.positions);
  }
  console.log('проверка окон:');
  for (const w of plan.visit_window_check) {
    console.log('  ', w.label || w.id, '|', w.checked ? (w.ok ? 'OK' : 'FAIL') : 'не проверено', '|', w.message);
  }

  // Контроль: работа на объекте не зависит от числа выездов, дорога — зависит.
  const mk = (trips) => {
    const p = stages.normalizeCalcPlan(
      { positions: planPositions, trip_count: trips, visits: trips > 1 ? normalizedVisits : [] },
      { visit_mode: trips > 1 ? 'visits' : 'continuous', trip_count: trips, dv_positions: planPositions }
    );
    const est = smeta.recalcAsgardSmeta({
      template: 'asgard_v1', crew: p.crew,
      params: { work_days: p.work_days, shifts_per_day: 1, shift_hours: p.shift_hours || 12,
        trip_count: p.trip_count || 1, calc_formula_version: 2 },
      works: []
    });
    const row = (id) => (est.rows.find((r) => r.id === id) || {});
    return { p, est, row };
  };
  const one = mk(1);
  const many = mk(Math.max(2, visits.length || 2));
  console.log('\nсмета: трудосутки', one.p.work_days, 'vs', many.p.work_days,
    '| смены рабочих', one.row('a3').qty, 'vs', many.row('a3').qty,
    '| дни дороги', one.row('a6').qty, 'vs', many.row('a6').qty,
    '| командировочные', Math.round(one.est.totals.travel), 'vs', Math.round(many.est.totals.travel));

  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message, (e.stack || '').split('\n')[1]); try { await pool.end(); } catch (_) {} process.exit(1); });
EOS
cd "$V" && node p2.js
