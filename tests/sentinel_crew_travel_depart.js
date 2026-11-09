/**
 * Sentinel: автоснятие с бригады по отъезду (to_site + from_site, cool 2d)
 * + idle warn-only + scope per work + D-249 reopen clear.
 *
 * Run: node tests/sentinel_crew_travel_depart.js
 * DB: asgard_crm_test (клон)
 */
'use strict';

const { Client } = require('pg');
const {
  run,
  findCandidates,
  DEPART_REASON,
  TRAVEL_DEPART_COOLING_DAYS,
  todayYmdMsk
} = require('../src/services/crew-travel-depart-cron');
const { DEPART_DAYS: IDLE_DEPART_DAYS, WARN_DAYS: IDLE_WARN_DAYS } = require('../src/services/crew-inactivity-cron');

const PG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'asgard',
  password: process.env.PGPASSWORD || '123456789',
  database: process.env.PGDATABASE || process.env.DB_NAME || 'asgard_crm_test'
};

const TAG = 'sentinel_travel_depart_' + Date.now();
const results = [];
function pass(id, detail) { results.push({ id, ok: true, detail }); console.log('PASS', id, detail || ''); }
function fail(id, detail) { results.push({ id, ok: false, detail }); console.log('FAIL', id, detail || ''); }

function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function ensureGroundSettings(db, workId) {
  await db.query(`
    INSERT INTO field_project_settings (work_id, site_category, per_diem)
    VALUES ($1, 'ground', 0)
    ON CONFLICT (work_id) DO UPDATE SET site_category = 'ground'
  `, [workId]).catch(async () => {
    const { rows } = await db.query(`SELECT work_id FROM field_project_settings WHERE work_id=$1`, [workId]);
    if (!rows.length) {
      await db.query(
        `INSERT INTO field_project_settings (work_id, site_category, per_diem) VALUES ($1,'ground',0)`,
        [workId]
      );
    } else {
      await db.query(`UPDATE field_project_settings SET site_category='ground' WHERE work_id=$1`, [workId]);
    }
  });
}

async function makeWork(db, title) {
  const { rows } = await db.query(`
    INSERT INTO works (work_title, work_status, created_at, updated_at)
    VALUES ($1, 'В работе', NOW(), NOW())
    RETURNING id
  `, [title]);
  return rows[0].id;
}

async function makeEmp(db, fio) {
  const { rows } = await db.query(`
    INSERT INTO employees (fio, is_active, created_at, updated_at)
    VALUES ($1, true, NOW(), NOW())
    RETURNING id
  `, [fio]);
  return rows[0].id;
}

async function assign(db, empId, workId, dateFrom) {
  const { rows } = await db.query(`
    INSERT INTO employee_assignments (
      employee_id, work_id, date_from, is_active, field_role, shift_type, created_at, updated_at
    ) VALUES ($1,$2,$3::date,true,'worker','day',NOW(),NOW())
    RETURNING id
  `, [empId, workId, dateFrom]);
  return rows[0].id;
}

async function stage(db, { empId, workId, type, direction, dateFrom, createdAt }) {
  const { rows } = await db.query(`
    INSERT INTO field_trip_stages (
      employee_id, work_id, stage_type, direction, date_from, date_to,
      tariff_points, rate_per_day, status, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5::date,$5::date,
      0, 0, 'active',$6::timestamptz,$6::timestamptz
    ) RETURNING id
  `, [empId, workId, type, direction, dateFrom, createdAt]);
  return rows[0].id;
}

async function shift(db, { empId, workId, assignmentId, date }) {
  await db.query(`
    INSERT INTO field_checkins (
      employee_id, work_id, assignment_id, date, shift, status,
      checkin_at, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4::date,'day','completed',
      ($4::date + TIME '09:00'), NOW(), NOW()
    )
  `, [empId, workId, assignmentId, date]);
}

async function cleanup(db, ids) {
  const { empIds, workIds, assignmentIds, stageIds } = ids;
  if (stageIds.length) {
    await db.query(`DELETE FROM field_trip_stages WHERE id = ANY($1::int[])`, [stageIds]);
  }
  if (empIds.length) {
    await db.query(`DELETE FROM field_checkins WHERE employee_id = ANY($1::int[])`, [empIds]).catch(() => {});
    await db.query(`DELETE FROM worker_payments WHERE employee_id = ANY($1::int[])`, [empIds]).catch(() => {});
    await db.query(`DELETE FROM mlsp_stays WHERE employee_id = ANY($1::int[])`, [empIds]).catch(() => {});
  }
  if (assignmentIds.length) {
    await db.query(`DELETE FROM employee_assignments WHERE id = ANY($1::int[])`, [assignmentIds]);
  }
  if (workIds.length) {
    await db.query(`DELETE FROM worker_payments WHERE work_id = ANY($1::int[])`, [workIds]).catch(() => {});
    await db.query(`DELETE FROM field_project_settings WHERE work_id = ANY($1::int[])`, [workIds]).catch(() => {});
    await db.query(`DELETE FROM works WHERE id = ANY($1::int[])`, [workIds]);
  }
  if (empIds.length) {
    await db.query(`DELETE FROM employees WHERE id = ANY($1::int[])`, [empIds]);
  }
}

async function main() {
  // crm-mailer / notify на клоне требуют DB_PASSWORD
  if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = PG.password;
  if (!process.env.DB_USER) process.env.DB_USER = PG.user;
  if (!process.env.DB_NAME) process.env.DB_NAME = PG.database;
  if (!process.env.DB_HOST) process.env.DB_HOST = PG.host;

  console.log('DB', PG.database, 'today', todayYmdMsk(), 'cool', TRAVEL_DEPART_COOLING_DAYS);
  const db = new Client(PG);
  await db.connect();

  const today = todayYmdMsk();
  const dArrive = addDays(today, -10);
  const dDepart = addDays(today, -3); // cooled (≥2)
  const dFresh = addDays(today, -1);  // not cooled
  const createdCool = addDays(today, -3) + 'T10:00:00+03:00';
  const createdFresh = addDays(today, -1) + 'T10:00:00+03:00';

  const empIds = [];
  const workIds = [];
  const assignmentIds = [];
  const stageIds = [];

  const log = { info() {}, warn() {}, error: console.error };

  try {
    // ── fixtures ──
    const workA = await makeWork(db, TAG + '_A');
    const workB = await makeWork(db, TAG + '_B');
    workIds.push(workA, workB);
    await ensureGroundSettings(db, workA);
    await ensureGroundSettings(db, workB);

    // 1) to_site + from_site cooled → should depart
    const e1 = await makeEmp(db, TAG + ' E1 depart');
    empIds.push(e1);
    assignmentIds.push(await assign(db, e1, workA, dArrive));
    stageIds.push(await stage(db, {
      empId: e1, workId: workA, type: 'travel', direction: 'to_site',
      dateFrom: dArrive, createdAt: createdCool
    }));
    stageIds.push(await stage(db, {
      empId: e1, workId: workA, type: 'travel', direction: 'from_site',
      dateFrom: dDepart, createdAt: createdCool
    }));

    // 2) from_site only → must NOT depart
    const e2 = await makeEmp(db, TAG + ' E2 from_only');
    empIds.push(e2);
    assignmentIds.push(await assign(db, e2, workA, dArrive));
    stageIds.push(await stage(db, {
      empId: e2, workId: workA, type: 'travel', direction: 'from_site',
      dateFrom: dDepart, createdAt: createdCool
    }));

    // 3) no travel, idle → must NOT depart
    const e3 = await makeEmp(db, TAG + ' E3 idle');
    empIds.push(e3);
    assignmentIds.push(await assign(db, e3, workA, addDays(today, -40)));

    // 4) to_site + from_site + shift AFTER → must NOT depart
    const e4 = await makeEmp(db, TAG + ' E4 returned');
    empIds.push(e4);
    const a4 = await assign(db, e4, workA, dArrive);
    assignmentIds.push(a4);
    stageIds.push(await stage(db, {
      empId: e4, workId: workA, type: 'travel', direction: 'to_site',
      dateFrom: dArrive, createdAt: createdCool
    }));
    stageIds.push(await stage(db, {
      empId: e4, workId: workA, type: 'travel', direction: 'from_site',
      dateFrom: dDepart, createdAt: createdCool
    }));
    await shift(db, { empId: e4, workId: workA, assignmentId: a4, date: addDays(dDepart, 1) });

    // 5) to_site + from_site but not cooled → must NOT depart
    const e5 = await makeEmp(db, TAG + ' E5 fresh');
    empIds.push(e5);
    assignmentIds.push(await assign(db, e5, workA, dArrive));
    stageIds.push(await stage(db, {
      empId: e5, workId: workA, type: 'travel', direction: 'to_site',
      dateFrom: dArrive, createdAt: createdCool
    }));
    stageIds.push(await stage(db, {
      empId: e5, workId: workA, type: 'ship', direction: 'from_site',
      dateFrom: dFresh, createdAt: createdFresh
    }));

    // 6) same person on work B without departure — stay; on A already e1
    // also: e6 on A with to+from, and active on B without travel → only A
    const e6 = await makeEmp(db, TAG + ' E6 scope');
    empIds.push(e6);
    const a6a = await assign(db, e6, workA, dArrive);
    const a6b = await assign(db, e6, workB, dArrive);
    assignmentIds.push(a6a, a6b);
    stageIds.push(await stage(db, {
      empId: e6, workId: workA, type: 'travel', direction: 'to_site',
      dateFrom: dArrive, createdAt: createdCool
    }));
    stageIds.push(await stage(db, {
      empId: e6, workId: workA, type: 'helicopter', direction: 'from_site',
      dateFrom: dDepart, createdAt: createdCool
    }));
    // work B: only to_site, no from — must keep
    stageIds.push(await stage(db, {
      empId: e6, workId: workB, type: 'travel', direction: 'to_site',
      dateFrom: dArrive, createdAt: createdCool
    }));

    // 7) to_site + ship NULL direction (heuristic B) cooled → depart
    const e7 = await makeEmp(db, TAG + ' E7 heuristicB');
    empIds.push(e7);
    assignmentIds.push(await assign(db, e7, workA, dArrive));
    stageIds.push(await stage(db, {
      empId: e7, workId: workA, type: 'travel', direction: 'to_site',
      dateFrom: dArrive, createdAt: createdCool
    }));
    stageIds.push(await stage(db, {
      empId: e7, workId: workA, type: 'ship', direction: null,
      dateFrom: dDepart, createdAt: createdCool
    }));

    pass('SETUP', `works=${workA},${workB} emps=${empIds.join(',')}`);

    // ── dry-run / apply только по нашим фикстурам (не трогаем чужие rows на клоне) ──
    const allCand = await findCandidates(db, { today });
    const fixtureSet = new Set(assignmentIds);
    const ours = allCand.filter((c) => fixtureSet.has(c.assignment_id));
    const ourEmp = new Set(ours.map((c) => c.employee_id));

    if (ourEmp.has(e1) && ourEmp.has(e6) && ourEmp.has(e7)
        && !ourEmp.has(e2) && !ourEmp.has(e3) && !ourEmp.has(e4) && !ourEmp.has(e5)
        && ours.length === 3) {
      pass('DRY-candidates', `ours=3 (e1,e6,e7); global_cand=${allCand.length}`);
    } else {
      fail('DRY-candidates', JSON.stringify(ours.map((c) => ({ e: c.employee_id, w: c.work_id, a: c.assignment_id }))));
    }

    const dry = await run(db, log, { dryRun: true, today });
    const { rows: beforeDry } = await db.query(`
      SELECT employee_id, departure_date IS NOT NULL AS gone
      FROM employee_assignments WHERE id = ANY($1::int[])`, [assignmentIds]);
    if (dry.departed === 0 && beforeDry.every((r) => !r.gone)) pass('DRY-no-write', 'all still active');
    else fail('DRY-no-write', JSON.stringify({ departed: dry.departed, beforeDry }));

    // apply только фикстуры
    const { applyDepartures } = require('../src/services/crew-travel-depart-cron');
    const departedN = await applyDepartures(db, ours, log);
    if (departedN === 3) pass('APPLY-count', `departed=${departedN}`);
    else fail('APPLY-count', `departed=${departedN}`);

    async function state(empId, workId) {
      const { rows } = await db.query(`
        SELECT is_active, departure_date::text AS dep, departure_reason, inactivity_auto_departed_at IS NOT NULL AS auto
        FROM employee_assignments
        WHERE employee_id=$1 AND work_id=$2
        ORDER BY id DESC LIMIT 1`, [empId, workId]);
      return rows[0] || null;
    }

    // Case 1
    {
      const s = await state(e1, workA);
      if (s && s.is_active === false && String(s.dep).slice(0, 10) === dDepart && s.auto) {
        pass('C1-depart-with-arrival', `${s.dep} reason=${s.departure_reason}`);
      } else fail('C1-depart-with-arrival', JSON.stringify(s));
      if (s && s.departure_reason === DEPART_REASON) pass('C1-reason', DEPART_REASON);
      else fail('C1-reason', s && s.departure_reason);
    }

    // Case 2
    {
      const s = await state(e2, workA);
      if (s && s.is_active === true && !s.dep) pass('C2-from-only-keep', 'kept');
      else fail('C2-from-only-keep', JSON.stringify(s));
    }

    // Case 3
    {
      const s = await state(e3, workA);
      if (s && s.is_active === true && !s.dep) pass('C3-idle-keep', 'kept');
      else fail('C3-idle-keep', JSON.stringify(s));
    }

    // Case 4
    {
      const s = await state(e4, workA);
      if (s && s.is_active === true && !s.dep) pass('C4-returned-keep', 'kept');
      else fail('C4-returned-keep', JSON.stringify(s));
    }

    // Case 5
    {
      const s = await state(e5, workA);
      if (s && s.is_active === true && !s.dep) pass('C5-not-cooled-keep', 'kept');
      else fail('C5-not-cooled-keep', JSON.stringify(s));
    }

    // Case 6 scope
    {
      const sa = await state(e6, workA);
      const sb = await state(e6, workB);
      if (sa && sa.is_active === false && String(sa.dep).slice(0, 10) === dDepart) {
        pass('C6-scope-A-depart', sa.dep);
      } else fail('C6-scope-A-depart', JSON.stringify(sa));
      if (sb && sb.is_active === true && !sb.dep) pass('C6-scope-B-keep', 'kept on B');
      else fail('C6-scope-B-keep', JSON.stringify(sb));
    }

    // Case 7 heuristic B
    {
      const s = await state(e7, workA);
      if (s && s.is_active === false && String(s.dep).slice(0, 10) === dDepart) {
        pass('C7-heuristicB-depart', s.dep);
      } else fail('C7-heuristicB-depart', JSON.stringify(s));
    }

    // Idle cron: warn-only — автоснятие выключено (не гоняем run() по всему клону)
    {
      if (IDLE_DEPART_DAYS == null && IDLE_WARN_DAYS === 25) {
        pass('IDLE-warn-only', `DEPART_DAYS=null WARN_DAYS=${IDLE_WARN_DAYS}`);
      } else {
        fail('IDLE-warn-only', JSON.stringify({ IDLE_DEPART_DAYS, IDLE_WARN_DAYS }));
      }
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../src/services/crew-inactivity-cron.js'),
        'utf8'
      );
      if (!/inactivity_auto_departed_at\s*=\s*NOW\(/.test(src)
          && !/departure_date\s*=\s*m\.last_activity/.test(src)) {
        pass('IDLE-no-depart-code', 'no auto-depart UPDATE in inactivity cron');
      } else {
        fail('IDLE-no-depart-code', 'auto-depart SQL still present');
      }
      const s = await state(e3, workA);
      if (s && s.is_active === true && !s.dep) pass('IDLE-e3-still-active', 'idle without travel kept');
      else fail('IDLE-e3-still-active', JSON.stringify(s));
    }

    // D-249: re-open after auto-depart clears flags (SQL mirror of POST /crew)
    {
      const s0 = await state(e1, workA);
      await db.query(`
        UPDATE employee_assignments SET
          is_active = true,
          departure_date = NULL,
          departure_reason = NULL,
          inactivity_warned_at = NULL,
          inactivity_auto_departed_at = NULL,
          updated_at = NOW()
        WHERE employee_id=$1 AND work_id=$2`, [e1, workA]);
      const s1 = await state(e1, workA);
      if (s0 && s0.auto && s1 && s1.is_active === true && !s1.dep && !s1.auto) {
        pass('D249-readd-clear', 'active + flags cleared');
      } else fail('D249-readd-clear', JSON.stringify({ s0, s1 }));
    }

    // MLSP: closeMlspAssignments reason pattern for reopen
    {
      const { closeMlspAssignments, reopenMlspAssignments } = require('../src/lib/mlsp-stay');
      const workM = await makeWork(db, TAG + '_MLSP');
      workIds.push(workM);
      await db.query(`
        INSERT INTO field_project_settings (work_id, site_category, per_diem)
        VALUES ($1, 'mlsp', 0)
        ON CONFLICT (work_id) DO UPDATE SET site_category = 'mlsp'
      `, [workM]).catch(async () => {
        const { rows } = await db.query(`SELECT 1 FROM field_project_settings WHERE work_id=$1`, [workM]);
        if (!rows.length) {
          await db.query(`INSERT INTO field_project_settings (work_id, site_category, per_diem) VALUES ($1,'mlsp',0)`, [workM]);
        } else {
          await db.query(`UPDATE field_project_settings SET site_category='mlsp' WHERE work_id=$1`, [workM]);
        }
      });
      const eM = await makeEmp(db, TAG + ' E_MLSP');
      empIds.push(eM);
      assignmentIds.push(await assign(db, eM, workM, dArrive));

      // travel-depart must NOT touch MLSP
      const cand = await findCandidates(db, { today });
      if (!cand.some((c) => c.employee_id === eM)) pass('MLSP-travel-skip', 'not in travel candidates');
      else fail('MLSP-travel-skip', 'MLSP wrongly in travel candidates');

      const closed = await closeMlspAssignments(db, eM, dDepart, 'Авто: выезд с МЛСП (дорога домой)');
      const sClosed = await state(eM, workM);
      if (closed.length === 1 && sClosed && sClosed.is_active === false) {
        pass('MLSP-close-assignment', sClosed.departure_reason);
      } else fail('MLSP-close-assignment', JSON.stringify({ closed, sClosed }));

      const reopened = await reopenMlspAssignments(db, eM, dDepart);
      const sOpen = await state(eM, workM);
      if (reopened.length === 1 && sOpen && sOpen.is_active === true && !sOpen.dep) {
        pass('MLSP-reopen-assignment', 'reopened by reason pattern');
      } else fail('MLSP-reopen-assignment', JSON.stringify({ reopened, sOpen }));
    }

    // stage without work_id must not attach to assignment
    {
      const e8 = await makeEmp(db, TAG + ' E8 noworkid');
      empIds.push(e8);
      assignmentIds.push(await assign(db, e8, workA, dArrive));
      // to_site with work_id + from_site WITHOUT work_id
      stageIds.push(await stage(db, {
        empId: e8, workId: workA, type: 'travel', direction: 'to_site',
        dateFrom: dArrive, createdAt: createdCool
      }));
      const { rows: orphan } = await db.query(`
        INSERT INTO field_trip_stages (
          employee_id, work_id, stage_type, direction, date_from, date_to,
          tariff_points, rate_per_day, status, created_at, updated_at
        ) VALUES (
          $1, NULL, 'travel', 'from_site', $2::date, $2::date,
          0, 0, 'active', $3::timestamptz, $3::timestamptz
        ) RETURNING id
      `, [e8, dDepart, createdCool]);
      stageIds.push(orphan[0].id);

      const cand = await findCandidates(db, { today });
      if (!cand.some((c) => c.employee_id === e8)) {
        pass('NO-WORKID-ignore', 'orphan from_site ignored');
      } else fail('NO-WORKID-ignore', 'orphan stage wrongly departed');
    }

  } catch (e) {
    fail('EXCEPTION', e.stack || String(e));
  } finally {
    try { await cleanup(db, { empIds, workIds, assignmentIds, stageIds }); }
    catch (ce) { console.warn('cleanup', ce.message); }
    await db.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n==== SUMMARY', results.filter((r) => r.ok).length + '/' + results.length, '====');
  if (failed.length) {
    for (const f of failed) console.log('FAIL', f.id, f.detail);
    process.exit(1);
  }
  console.log('ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
