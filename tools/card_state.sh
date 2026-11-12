#!/usr/bin/env bash
set -euo pipefail
cat > /tmp/card-state.js <<'EOS'
const APP = '/var/www/asgard-crm';
process.chdir(APP);
const { Pool } = require(APP + '/node_modules/pg');
const p = new Pool({ host: 'localhost', user: 'asgard', password: '123456789', database: 'asgard_crm', max: 2 });
(async () => {
  const r = await p.query('SELECT report_json, updated_at FROM tender_rp_reviews WHERE tender_id=2138 ORDER BY id DESC LIMIT 1');
  const rj = r.rows[0].report_json || {};
  const vp = rj.visit_plan || {};
  const cp = rj.calc_plan || {};
  console.log('обновлено:', r.rows[0].updated_at);
  console.log('visit_plan: mode', vp.mode, '| trip_count', vp.trip_count, '| visits', (vp.visits || []).length);
  console.log('calc_plan: work_days', cp.work_days, '| per_trip', cp.work_days_per_trip,
    '| trip_count', cp.trip_count, '| split', (cp.visits_work || []).length);
  await p.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await p.end(); } catch (_) {} });
EOS
cd /var/www/asgard-crm && node /tmp/card-state.js
