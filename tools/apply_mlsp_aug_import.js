'use strict';
/**
 * Apply August MLSP timesheet payload to CRM.
 * Usage:
 *   node tools/apply_mlsp_aug_import.js --dry-run
 *   node tools/apply_mlsp_aug_import.js --apply
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const k = m[1].trim();
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const APPLY = process.argv.includes('--apply');
const payloadPath = path.join(__dirname, '_mlsp_aug_import_payload.json');
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const NOTE = payload.note || 'backfill табель Хосе 08.2026';

function ymd(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return String(d).slice(0, 10);
}

const pool = new Pool({
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'asgard_crm',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
});

async function upsertAssignment(client, empId, spec) {
  const { rows } = await client.query(
    `SELECT * FROM employee_assignments
     WHERE employee_id = $1 AND work_id = $2
     ORDER BY id DESC`,
    [empId, spec.work_id]
  );

  let target = null;
  if (spec.new_tour) {
    for (const r of rows) {
      const dep = ymd(r.departure_date);
      if (!dep || dep >= spec.date_from) {
        target = r;
        break;
      }
    }
  } else {
    target = rows[0] || null;
  }

  if (target && spec.new_tour) {
    const dep = ymd(target.departure_date);
    if (dep && dep < spec.date_from) target = null;
  }

  if (target) {
    await client.query(
      `UPDATE employee_assignments SET
         date_from = LEAST(COALESCE(date_from, $2::date), $2::date),
         date_to = $3::date,
         is_active = $4,
         departure_date = $5::date,
         departure_reason = COALESCE($6, departure_reason),
         per_diem = CASE WHEN per_diem = 0 THEN NULL ELSE per_diem END,
         updated_at = NOW()
       WHERE id = $1`,
      [
        target.id,
        spec.date_from,
        spec.date_to || null,
        !!spec.active,
        spec.departure_date || null,
        spec.reason || null,
      ]
    );
    return { id: target.id, action: 'update' };
  }

  const ins = await client.query(
    `INSERT INTO employee_assignments (
       employee_id, work_id, field_role, is_active,
       date_from, date_to, departure_date, departure_reason,
       per_diem, shift_type, created_at, updated_at
     ) VALUES (
       $1, $2, 'worker', $3,
       $4::date, $5::date, $6::date, $7,
       NULL, 'day', NOW(), NOW()
     ) RETURNING id`,
    [
      empId,
      spec.work_id,
      !!spec.active,
      spec.date_from,
      spec.date_to || null,
      spec.departure_date || null,
      spec.reason || null,
    ]
  );
  return { id: ins.rows[0].id, action: 'insert' };
}

async function upsertCheckin(client, empId, asgId, ci, actorId) {
  const { rows } = await client.query(
    `SELECT id, amount_earned FROM field_checkins
     WHERE employee_id = $1 AND date = $2::date AND work_id = $3
       AND status <> 'cancelled'
     LIMIT 1`,
    [empId, ci.date, ci.work_id]
  );
  const amount = Number(ci.amount);
  const hours = 11;
  if (rows[0]) {
    await client.query(
      `UPDATE field_checkins SET
         assignment_id = $2,
         shift = 'day',
         day_rate = $3,
         amount_earned = $3,
         hours_worked = $4,
         hours_paid = $4,
         note = $5,
         entered_by_user_id = COALESCE(entered_by_user_id, $6),
         updated_at = NOW()
       WHERE id = $1`,
      [rows[0].id, asgId, amount, hours, NOTE, actorId]
    );
    return 'update';
  }
  await client.query(
    `INSERT INTO field_checkins (
       employee_id, work_id, assignment_id, date, shift, status,
       checkin_at, hours_worked, hours_paid, day_rate, amount_earned,
       checkin_source, checkin_by, entered_by_user_id, note
     ) VALUES (
       $1, $2, $3, $4::date, 'day', 'completed',
       ($4::date + TIME '08:00')::timestamptz, $5, $5, $6, $6,
       'pm_manual', $7, $7, $8
     )`,
    [empId, ci.work_id, asgId, ci.date, hours, amount, actorId, NOTE]
  );
  return 'insert';
}

function staysOverlap(a, b) {
  const a0 = ymd(a.arrived_at);
  const b0 = ymd(b.arrived_at);
  const a1 = ymd(a.actual_departed_at) || '9999-12-31';
  const b1 = ymd(b.actual_departed_at) || '9999-12-31';
  return a0 <= b1 && b0 <= a1;
}

async function mergeOverlappingStays(client) {
  const { rows } = await client.query(`
    SELECT DISTINCT employee_id FROM mlsp_stays
  `);
  let merged = 0;
  for (const { employee_id: eid } of rows) {
    while (true) {
      const { rows: stays } = await client.query(
        `SELECT id, arrived_at, actual_departed_at
         FROM mlsp_stays WHERE employee_id = $1
         ORDER BY arrived_at, id`,
        [eid]
      );
      let pair = null;
      for (let i = 0; i < stays.length && !pair; i++) {
        for (let j = i + 1; j < stays.length; j++) {
          if (staysOverlap(stays[i], stays[j])) {
            pair = [stays[i], stays[j]];
            break;
          }
        }
      }
      if (!pair) break;
      const [a, b] = pair;
      const a0 = ymd(a.arrived_at);
      const b0 = ymd(b.arrived_at);
      const a1 = ymd(a.actual_departed_at) || '9999-12-31';
      const b1 = ymd(b.actual_departed_at) || '9999-12-31';
      const keep = a0 <= b0 ? a : b;
      const drop = keep === a ? b : a;
      const keepArr = a0 <= b0 ? a0 : b0;
      const keepDepRaw = a1 >= b1 ? a1 : b1;
      const keepDep = keepDepRaw === '9999-12-31' ? null : keepDepRaw;
      await client.query(
        `UPDATE mlsp_stays SET
           arrived_at = $2::date,
           actual_departed_at = $3::date,
           updated_at = NOW()
         WHERE id = $1`,
        [keep.id, keepArr, keepDep]
      );
      await client.query(`DELETE FROM mlsp_stay_events WHERE stay_id = $1`, [drop.id]);
      await client.query(`DELETE FROM mlsp_stays WHERE id = $1`, [drop.id]);
      merged += 1;
    }
  }
  return merged;
}

async function main() {
  const client = await pool.connect();
  try {
    const actorRes = await client.query(`
      SELECT id FROM users
      WHERE role IN ('ADMIN', 'DIRECTOR_GEN', 'HEAD_TO', 'OFFICE_MANAGER')
      ORDER BY CASE role
        WHEN 'DIRECTOR_GEN' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END, id
      LIMIT 1
    `);
    const actorId = actorRes.rows[0]?.id || null;
    if (!actorId) throw new Error('no actor user');

    const stats = {
      people: payload.people.length,
      asg_insert: 0,
      asg_update: 0,
      ci_insert: 0,
      ci_update: 0,
      merged_stays: 0,
      pe_cancelled: 0,
    };

    if (!APPLY) {
      console.log(JSON.stringify({ dry_run: true, actorId, people: stats.people,
        checkins: payload.people.reduce((n, p) => n + p.checkins.length, 0),
        assignments: payload.people.reduce((n, p) => n + p.assignments.length, 0),
        skip: payload.skip }, null, 2));
      return;
    }

    await client.query('BEGIN');

    const empIds = payload.people.map((p) => p.eid);
    for (const p of payload.people) {
      const asgByWork = {};
      for (const spec of p.assignments) {
        const r = await upsertAssignment(client, p.eid, spec);
        asgByWork[spec.work_id] = r.id;
        if (r.action === 'insert') stats.asg_insert += 1;
        else stats.asg_update += 1;
      }
      for (const ci of p.checkins) {
        let asgId = asgByWork[ci.work_id];
        if (!asgId) {
          const found = await client.query(
            `SELECT id FROM employee_assignments
             WHERE employee_id = $1 AND work_id = $2
             ORDER BY id DESC LIMIT 1`,
            [p.eid, ci.work_id]
          );
          asgId = found.rows[0]?.id;
        }
        if (!asgId) throw new Error(`no assignment emp=${p.eid} work=${ci.work_id} date=${ci.date}`);
        const act = await upsertCheckin(client, p.eid, asgId, ci, actorId);
        if (act === 'insert') stats.ci_insert += 1;
        else stats.ci_update += 1;
      }
    }

    const pe = await client.query(
      `UPDATE employee_planned_engagements
          SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2, updated_at = NOW()
        WHERE employee_id = ANY($1::int[]) AND status = 'active'
        RETURNING id`,
      [empIds, actorId]
    );
    stats.pe_cancelled = pe.rowCount;

    await client.query(
      `UPDATE employee_assignments
          SET per_diem = NULL, updated_at = NOW()
        WHERE employee_id = ANY($1::int[])
          AND work_id IN (354,403,404,405,406,407,418)
          AND per_diem = 0`,
      [empIds]
    );

    stats.merged_stays = await mergeOverlappingStays(client);
    await client.query('COMMIT');
    console.log(JSON.stringify({ applied: true, actorId, stats }, null, 2));
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
