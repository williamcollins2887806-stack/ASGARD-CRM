#!/usr/bin/env bash
# Проверка P2 на ЖИВОМ коде прода (/var/www/asgard-crm), без копий.
set -euo pipefail
APP=/var/www/asgard-crm
cat > /tmp/live-p2.js <<'EOS'
const APP = '/var/www/asgard-crm';
process.chdir(APP);
const { Pool } = require(APP + '/node_modules/pg');
const stages = require(APP + '/src/services/mimir-tender-stages');
const smeta = require(APP + '/src/services/asgard-smeta');
const es = require(APP + '/src/services/excel-structure');

const pool = new Pool({
  host: 'localhost', port: 5432, user: 'asgard',
  password: '123456789', database: 'asgard_crm', max: 2
});

(async () => {
  console.log('== P1: дедуп ==');
  const rev = await pool.query(
    'SELECT report_json FROM tender_rp_reviews WHERE tender_id = 2138 ORDER BY id DESC LIMIT 1');
  const rj = (rev.rows[0] && rev.rows[0].report_json) || {};
  const positions = Array.isArray(rj.dv_positions) ? rj.dv_positions : [];
  console.log('позиций в карточке:', positions.length, '(было 1348 в ориентире, реально 675)');

  console.log('\n== P2: разрез трудосуток ==');
  const vp = rj.visit_plan || {};
  const visits = Array.isArray(vp.visits) ? vp.visits : [];
  const planPositions = positions.map((p, i) => ({
    id: p.id || ('dv' + (i + 1)), name: p.name, people: p.people || null,
    days: p.days || null, mh: p.mh || null, shifts: p.shifts || null,
    shift_hours: p.shift_hours || null, source: p.source || null, period: p.period || null
  }));
  const normalizedVisits = visits.map((v, i) => {
    const label = String(v.label || '').toLowerCase();
    const ids = planPositions.filter((p) => {
      const pl = String(p.period || '').toLowerCase();
      return pl && label && (pl === label || label.includes(pl) || pl.includes(label));
    }).map((p) => String(p.id));
    return { id: v.id || ('v' + (i + 1)), label: v.label, period_start: v.period_start,
      period_end: v.period_end, position_ids: ids.length ? ids : (v.position_ids || []) };
  });
  const plan = stages.normalizeCalcPlan(
    { positions: planPositions, trip_count: visits.length || 1, visits: normalizedVisits },
    { visit_mode: vp.mode || 'visits', trip_count: visits.length || 1, dv_positions: planPositions }
  );
  console.log('work_days:', plan.work_days, '| источник:', plan.work_days_source,
    '| бригад:', plan.crews, '| trip_count:', plan.trip_count, '| заездов:', plan.visits.length);
  console.log('work_days_per_trip:', plan.work_days_per_trip, '| Σ разрез:', plan.visits_work_total);
  for (const v of plan.visits_work) {
    console.log('  ', v.label || v.id, '| трудосуток', v.work_days, '| доля', v.share_pct + '%');
  }

  console.log('\n== парсер: объём из геометрии на реальном файле ==');
  const XLSX = require(APP + '/node_modules/xlsx');
  const fs = require('fs');
  const q = await pool.query(
    "SELECT id, original_name AS name, COALESCE(file_url, download_url, filename) AS path "
    + "FROM documents WHERE tender_id = 2138 AND original_name ~* '\\.xlsx?$' ORDER BY id LIMIT 2");
  for (const d of q.rows) {
    const rel = String(d.path || '').replace(/^\/+/, '');
    let buf = null;
    for (const c of [d.path, APP + '/public/' + rel, APP + '/' + rel]) {
      try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
    }
    if (!buf) continue;
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
    const p = es.parseWorkbook(XLSX, wb);
    const sum = p.positions.reduce((s, x) => s + (Number(x.volume) || 0), 0);
    console.log(' #' + d.id, String(d.name).slice(0, 40), '|', p.stats.positions, 'поз. | Σ volume',
      Math.round(sum));
  }

  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message, (e.stack || '').split('\n')[1]); try { await pool.end(); } catch (_) {} process.exit(1); });
EOS
cd "$APP" && node /tmp/live-p2.js
