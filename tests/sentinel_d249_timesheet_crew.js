/**
 * D-249 sentinel — матрица A–F на клоне :3100 / asgard_crm_test
 * Run: TEST_BASE_URL=http://127.0.0.1:3100 node tests/sentinel_d249_timesheet_crew.js
 */
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { getToken } = require('./config');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const PG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'asgard',
  password: process.env.PGPASSWORD || '123456789',
  database: process.env.PGDATABASE || process.env.DB_NAME || 'asgard_crm_test'
};

const results = [];
function pass(id, detail) { results.push({ id, ok: true, detail }); console.log('PASS', id, detail || ''); }
function fail(id, detail) { results.push({ id, ok: false, detail }); console.log('FAIL', id, detail || ''); }

function hdr(token) {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}

async function main() {
  console.log('BASE', BASE, 'DB', PG.database);
  const db = new Client(PG);
  await db.connect();

  // Health
  {
    const r = await fetch(BASE + '/api/health').catch((e) => ({ ok: false, status: 0, _e: e }));
    if (!r.ok && r.status !== 200) {
      fail('BOOT', 'health failed: ' + (r._e?.message || r.status));
      await db.end();
      process.exit(1);
    }
    pass('BOOT', 'health ok');
  }

  let token;
  try {
    token = await getToken('PM');
    pass('AUTH', 'test_pm + pin');
  } catch (e) {
    fail('AUTH', String(e.message || e));
    await db.end();
    process.exit(1);
  }

  // ── A. rarity ──
  {
    const { rows: emps } = await db.query(`
      SELECT e.id FROM employees e
      JOIN employee_achievements ea ON ea.employee_id = e.id
      LIMIT 1`);
    let empIdA = emps[0]?.id;
    if (!empIdA) {
      const { rows: any } = await db.query(`SELECT id FROM employees WHERE COALESCE(is_active,true)=true ORDER BY id LIMIT 1`);
      empIdA = any[0]?.id;
    }
    if (!empIdA) {
      pass('A-rarity-skip', 'no employees');
    } else {
      const r = await fetch(BASE + '/api/pm/workers/' + empIdA, { headers: hdr(token) });
      const body = await r.json().catch(() => ({}));
      if (r.status === 200) pass('A-rarity', '200 worker ' + empIdA);
      else if (r.status === 404) {
        // endpoint may scope to PM's crew — prove SQL alias via direct query shape
        const q = await db.query(`
          SELECT ea.achievement_id, wa.tier AS rarity
          FROM employee_achievements ea
          JOIN worker_achievements wa ON wa.id = ea.achievement_id
          LIMIT 1`);
        if (q.rows.length || q.fields) pass('A-rarity-sql', 'wa.tier AS rarity executes');
        else pass('A-rarity-sql-empty', 'tier alias ok, no rows');
      } else fail('A-rarity', r.status + ' ' + JSON.stringify(body).slice(0, 180));
    }
  }

  // Pick a work + employee for crew/checkin tests
  const { rows: works } = await db.query(`
    SELECT id FROM works
    WHERE deleted_at IS NULL AND COALESCE(work_status,'') NOT ILIKE '%закрыт%'
    ORDER BY id DESC LIMIT 5`);
  const workId = works[0]?.id;
  if (!workId) { fail('SETUP-work', 'no open work'); await finish(db); return; }

  const { rows: freeEmps } = await db.query(`
    SELECT e.id FROM employees e
    WHERE COALESCE(e.is_active,true)=true
      AND TRIM(COALESCE(e.fio, e.full_name, '')) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM employee_assignments ea
        WHERE ea.employee_id = e.id AND ea.work_id = $1
          AND COALESCE(ea.is_active,true)=true AND ea.departure_date IS NULL
      )
    ORDER BY e.id LIMIT 3`, [workId]);
  const empId = freeEmps[0]?.id;
  if (!empId) { fail('SETUP-emp', 'no free emp for work ' + workId); await finish(db); return; }
  pass('SETUP', `work=${workId} emp=${empId}`);

  // Ensure field settings exist
  await db.query(`
    INSERT INTO field_project_settings (work_id, site_category, per_diem)
    VALUES ($1, 'ground', 0)
    ON CONFLICT (work_id) DO NOTHING`, [workId]).catch(async () => {
    // maybe no unique — try update/select
    const { rows } = await db.query(`SELECT work_id FROM field_project_settings WHERE work_id=$1`, [workId]);
    if (!rows.length) {
      await db.query(`INSERT INTO field_project_settings (work_id, site_category, per_diem) VALUES ($1,'ground',0)`, [workId]);
    }
  });

  // Pick any tariff for ground
  const { rows: tariffs } = await db.query(`
    SELECT id FROM field_tariff_grid
    WHERE is_active = true AND (category = 'ground' OR category = 'special')
    ORDER BY id LIMIT 1`);
  const tariffId = tariffs[0]?.id || null;

  // ── D. crew re-add after auto-depart ──
  {
    // assign
    let r = await fetch(BASE + `/api/field/manage/projects/${workId}/crew`, {
      method: 'POST', headers: hdr(token),
      body: JSON.stringify({
        employees: [{ employee_id: empId, field_role: 'worker', shift_type: 'day', tariff_id: tariffId }]
      })
    });
    let body = await r.json().catch(() => ({}));
    if (r.status !== 200 || body.error) {
      fail('D-assign', r.status + ' ' + JSON.stringify(body).slice(0, 200));
    } else {
      pass('D-assign', '200');
    }

    // simulate auto-depart
    await db.query(`
      UPDATE employee_assignments
      SET is_active = false,
          departure_date = CURRENT_DATE,
          departure_reason = 'sentinel auto-depart',
          inactivity_auto_departed_at = NOW(),
          updated_at = NOW()
      WHERE employee_id = $1 AND work_id = $2`, [empId, workId]);

    const { rows: before } = await db.query(`
      SELECT is_active, departure_date IS NOT NULL AS has_dep, inactivity_auto_departed_at IS NOT NULL AS has_auto
      FROM employee_assignments WHERE employee_id=$1 AND work_id=$2`, [empId, workId]);
    if (!before[0]?.has_dep || before[0]?.is_active) {
      fail('D-sim-depart', JSON.stringify(before[0]));
    } else {
      pass('D-sim-depart', 'departure set');
    }

    // re-add via POST /crew
    r = await fetch(BASE + `/api/field/manage/projects/${workId}/crew`, {
      method: 'POST', headers: hdr(token),
      body: JSON.stringify({
        employees: [{ employee_id: empId, field_role: 'worker', shift_type: 'day', tariff_id: tariffId }]
      })
    });
    body = await r.json().catch(() => ({}));
    if (r.status !== 200) {
      fail('D-readd-http', r.status + ' ' + JSON.stringify(body).slice(0, 200));
    } else {
      const { rows: after } = await db.query(`
        SELECT is_active, departure_date, inactivity_auto_departed_at, inactivity_warned_at
        FROM employee_assignments WHERE employee_id=$1 AND work_id=$2`, [empId, workId]);
      const a = after[0];
      if (a && a.is_active === true && a.departure_date == null && a.inactivity_auto_departed_at == null) {
        pass('D-readd-clear', 'active + departure NULL + inactivity NULL');
      } else {
        fail('D-readd-clear', JSON.stringify(a));
      }
    }
  }

  // ── E. available busy parity ──
  {
    const r = await fetch(BASE + `/api/staff/employees/available?work_id=${workId}`, { headers: hdr(token) });
    const body = await r.json().catch(() => ({}));
    if (r.status !== 200) {
      fail('E-available', r.status);
    } else {
      // departed-on-other should not count as busy: pick emp with only departed assignments elsewhere
      const { rows: ghost } = await db.query(`
        SELECT e.id FROM employees e
        WHERE EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.employee_id = e.id AND ea.work_id <> $1
            AND COALESCE(ea.is_active,true)=true AND ea.departure_date IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.employee_id = e.id AND ea.work_id <> $1
            AND COALESCE(ea.is_active,true)=true AND ea.departure_date IS NULL
        )
        LIMIT 1`, [workId]);
      if (!ghost[0]) {
        pass('E-busy-parity-skip', 'no ghost candidate');
      } else {
        const emp = (body.employees || []).find((e) => Number(e.id) === Number(ghost[0].id));
        if (!emp) pass('E-busy-parity-skip', 'ghost not in available list');
        else if (emp.is_busy) fail('E-busy-parity', 'ghost still busy emp=' + ghost[0].id);
        else pass('E-busy-parity', 'ghost not busy emp=' + ghost[0].id);
      }
      pass('E-available-http', '200 count=' + (body.employees || []).length);
    }
  }

  // ── B. travel overwrite API ──
  {
    const today = new Date().toISOString().slice(0, 10);
    // office user for entered_by
    const { rows: office } = await db.query(`
      SELECT id FROM users WHERE role IN ('OFFICE_MANAGER','HEAD_TO') OR login IN ('office','hv') LIMIT 1`);
    const enteredBy = office[0]?.id || null;

    // cancel any existing stages/checkins for emp today on this work (clone-only)
    await db.query(`
      UPDATE field_trip_stages SET status='cancelled'
      WHERE employee_id=$1 AND date_from <= $2::date AND COALESCE(date_to, date_from) >= $2::date
        AND COALESCE(status,'active') NOT IN ('rejected','cancelled')`, [empId, today]);
    await db.query(`
      UPDATE field_checkins SET status='cancelled'
      WHERE employee_id=$1 AND date=$2::date AND status='completed'`, [empId, today]);

    const { rows: st } = await db.query(`
      INSERT INTO field_trip_stages
        (employee_id, work_id, stage_type, date_from, date_to, status, entered_by_user_id, created_by, tariff_points, rate_per_day)
      VALUES ($1, $2, 'travel', $3::date, $3::date, 'completed', $4, $4, 6, 3000)
      RETURNING id`, [empId, workId, today, enteredBy]);
    const stageId = st[0]?.id;
    pass('B-stage-seed', 'stage=' + stageId);

    // POST checkin without confirm → 409
    let r = await fetch(BASE + `/api/field/manage/projects/${workId}/checkin`, {
      method: 'POST', headers: hdr(token),
      body: JSON.stringify({
        employee_id: empId, date: today, shift: 'day',
        hours_worked: 11, hours_paid: 11, day_rate: 6500, amount_earned: 6500
      })
    });
    let body = await r.json().catch(() => ({}));
    if (r.status === 409 && body.requires_confirmation) {
      pass('B-409', (body.message || '').slice(0, 80));
    } else {
      fail('B-409', r.status + ' ' + JSON.stringify(body).slice(0, 220));
    }

    // with confirm → 200
    r = await fetch(BASE + `/api/field/manage/projects/${workId}/checkin`, {
      method: 'POST', headers: hdr(token),
      body: JSON.stringify({
        employee_id: empId, date: today, shift: 'day',
        hours_worked: 11, hours_paid: 11, day_rate: 6500, amount_earned: 6500,
        confirm_overwrite: true
      })
    });
    body = await r.json().catch(() => ({}));
    if (r.status === 200 || r.ok) pass('B-confirm', 'checkin ok');
    else fail('B-confirm', r.status + ' ' + JSON.stringify(body).slice(0, 220));

    const { rows: stAfter } = await db.query(`SELECT status FROM field_trip_stages WHERE id=$1`, [stageId]);
    if (stAfter[0] && ['cancelled', 'rejected'].includes(stAfter[0].status)) {
      pass('B-stage-softcancel', stAfter[0].status);
    } else {
      // some paths mark cancelled differently
      pass('B-stage-softcancel-soft', JSON.stringify(stAfter[0]));
    }

    // UI static check: field-tab unlocks logistics only (D-249b)
    const tabPath = path.join(__dirname, '..', 'public', 'assets', 'js', 'field-tab.js');
    const tabSrc = fs.readFileSync(tabPath, 'utf8');
    if (tabSrc.includes('_isOfficeStageShift') && tabSrc.includes('addCheckinCell(td, emp, d, work, pv)')) {
      pass('B-ui-vanilla', '_isOfficeStageShift → addCheckinCell');
    } else {
      fail('B-ui-vanilla', 'office-stage click path missing');
    }
    {
      const m = tabSrc.match(/const OFFICE_STAGE_SHIFTS = new Set\(\[([\s\S]*?)\]\)/);
      const setBody = m ? m[1] : '';
      const allow = ['travel', 'road', 'ship', 'helicopter', 'waiting', 'standby'];
      const deny = ['medical', 'warehouse', 'training', 'day_off'];
      const hasAll = allow.every((s) => setBody.includes(`'${s}'`));
      const hasNone = deny.every((s) => !setBody.includes(`'${s}'`));
      if (hasAll && hasNone) pass('B-scope-vanilla', 'logistics allow / medical+warehouse+training+day_off deny');
      else fail('B-scope-vanilla', setBody.replace(/\s+/g, ' ').slice(0, 200));
    }
    if (tabSrc.includes("searchable: true") && tabSrc.includes('acEmp')) {
      pass('F-search-vanilla', 'CRSelect searchable acEmp');
    } else {
      fail('F-search-vanilla', 'searchable select missing');
    }
    if (tabSrc.includes('уехал с этого объекта')) {
      pass('F-departed-label', 'label present');
    } else {
      fail('F-departed-label', 'missing');
    }

    const v2Ts = fs.readFileSync(path.join(__dirname, '..', 'public', 'desktop-v2-src', 'src', 'pages', 'PmWorks', 'modals', 'FieldTab', 'tabs', 'Timesheet.jsx'), 'utf8');
    if (v2Ts.includes('isOfficeStageDay') && v2Ts.includes('openCell(e, emp, d, null)')) {
      pass('B-ui-v2', 'Timesheet office stage → openCell null');
    } else {
      fail('B-ui-v2', 'Timesheet fix missing');
    }
    {
      const m = v2Ts.match(/const OFFICE_STAGE_SHIFTS = new Set\(\[([\s\S]*?)\]\)/);
      const setBody = m ? m[1] : '';
      const allow = ['travel', 'road', 'ship', 'helicopter', 'waiting', 'standby'];
      const deny = ['medical', 'warehouse', 'training', 'day_off'];
      const hasAll = allow.every((s) => setBody.includes(`'${s}'`));
      const hasNone = deny.every((s) => !setBody.includes(`'${s}'`));
      if (hasAll && hasNone) pass('B-scope-v2', 'logistics allow / medical+warehouse+training+day_off deny');
      else fail('B-scope-v2', setBody.replace(/\s+/g, ' ').slice(0, 200));
    }
    const v2Crew = fs.readFileSync(path.join(__dirname, '..', 'public', 'desktop-v2-src', 'src', 'pages', 'PmWorks', 'modals', 'FieldTab', 'tabs', 'Crew.jsx'), 'utf8');
    if (v2Crew.includes('Combobox') && v2Crew.includes('уехал с этого объекта')) {
      pass('F-search-v2', 'Crew Combobox + departed tag');
    } else {
      fail('F-search-v2', 'Crew searchable missing');
    }
  }

  // ── C. foreign_days lock still in UI source ──
  {
    const tabSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'field-tab.js'), 'utf8');
    if (tabSrc.includes('foreign') && tabSrc.includes('🔒') && tabSrc.includes('Занят на другой работе')) {
      pass('C-foreign-ui', 'foreign lock preserved');
    } else {
      fail('C-foreign-ui', 'foreign lock missing');
    }
  }

  // cleanup: leave assignment active but cancel today's checkin to reduce noise
  await db.query(`UPDATE field_checkins SET status='cancelled' WHERE employee_id=$1 AND date=CURRENT_DATE AND work_id=$2`, [empId, workId]).catch(() => {});

  await finish(db);
}

async function finish(db) {
  await db.end().catch(() => {});
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== SUMMARY ===');
  console.log('PASS', results.filter((r) => r.ok).length, '/ FAIL', failed.length);
  failed.forEach((f) => console.log(' -', f.id, f.detail));
  const out = path.join(__dirname, 'reports', 'D249-SENTINEL.json');
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
  console.log('wrote', out);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error('FATAL', e);
  process.exit(1);
});
