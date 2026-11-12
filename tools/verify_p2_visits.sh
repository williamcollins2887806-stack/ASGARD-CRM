#!/usr/bin/env bash
set -euo pipefail
cat > /tmp/verify-p2/vp.js <<'EOS'
const APP = '/var/www/asgard-crm';
process.chdir(APP);
const { Pool } = require(APP + '/node_modules/pg');
const pool = new Pool({ host: 'localhost', user: 'asgard', password: '123456789', database: 'asgard_crm', max: 2 });
(async () => {
  const r = await pool.query(
    'SELECT report_json FROM tender_rp_reviews WHERE tender_id = 2138 ORDER BY id DESC LIMIT 1');
  const rj = r.rows[0].report_json || {};
  const vp = rj.visit_plan || {};
  console.log('mode:', vp.mode, '| trip_count:', vp.trip_count, '| unconfirmed:', vp.unconfirmed,
    '| source:', vp.source);
  console.log('visits:', JSON.stringify((vp.visits || []).map((v) => ({
    id: v.id, label: v.label, start: v.period_start, end: v.period_end,
    position_ids: (v.position_ids || []).length, work_days: v.work_days,
    person_hours: v.person_hours, positions: v.positions
  })), null, 1));
  console.log('totals:', JSON.stringify(vp.totals));
  console.log('conflicts:', JSON.stringify(vp.conflicts));
  console.log('basis:', JSON.stringify(vp.basis));
  console.log('report visit_mode:', rj.visit_mode, '| trip_count:', rj.trip_count);
  // Периоды позиций ДВ
  const per = new Map();
  for (const p of rj.dv_positions || []) {
    const k = String(p.period || p.period_start || '(нет)');
    per.set(k, (per.get(k) || 0) + 1);
  }
  console.log('периоды позиций ДВ:', JSON.stringify([...per.entries()].sort((a,b)=>b[1]-a[1])));
  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} });
EOS
cd /tmp/verify-p2 && node vp.js
