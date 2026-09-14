#!/usr/bin/env node
'use strict';
/**
 * Закрыть долги по суточным помесячно.
 * ЗП / аванс / премии не трогает.
 * Уже paid/confirmed суточные засчитываются в свой месяц — без двойной выплаты.
 */
process.chdir('/var/www/asgard-crm');

const { Client } = require('/var/www/asgard-crm/node_modules/pg');
const { getPerDiemAccruedMap } = require('/var/www/asgard-crm/src/lib/worker-per-diem-days');

const ACTOR_ID = Number(process.env.PD_ACTOR_ID || 3455);
const DRY = process.argv.includes('--dry');

function monthStart(y, m) {
  return `${y}-${String(m).padStart(2, '0')}-01`;
}
function monthEnd(y, m) {
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
function paidAtIso(y, m) {
  const last = new Date(Date.UTC(y, m, 0, 15, 0, 0)); // конец месяца 18:00 MSK
  return last.toISOString();
}

(async () => {
  const db = new Client({
    user: 'asgard', password: '123456789', database: 'asgard_crm', host: '127.0.0.1',
  });
  await db.connect();
  const q = (t, p) => db.query(t, p);

  const { rows: actor } = await q(`SELECT id, role FROM users WHERE id=$1`, [ACTOR_ID]);
  if (!actor[0]) throw new Error('actor missing ' + ACTOR_ID);
  const paidByRole = actor[0].role === 'DIRECTOR_GEN' || actor[0].role === 'DIRECTOR_COMM'
    ? 'director'
    : (actor[0].role === 'ADMIN' ? 'admin' : 'director');

  const { rows: empRows } = await q(`
    SELECT DISTINCT employee_id FROM (
      SELECT employee_id FROM field_checkins WHERE status='completed' AND date >= '2026-03-01'
      UNION
      SELECT employee_id FROM field_trip_stages
      WHERE COALESCE(status,'active') NOT IN ('cancelled','rejected')
        AND COALESCE(date_to, date_from) >= '2026-03-01'
    ) x
  `);
  const empIds = empRows.map((r) => Number(r.employee_id));
  console.log(JSON.stringify({ dry: DRY, actor: actor[0], employees: empIds.length }));

  const { rows: cancelPreview } = await q(`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS amt
    FROM worker_payments
    WHERE type='per_diem' AND status='pending'
  `);
  console.log('pending per_diem to cancel', cancelPreview[0]);

  if (!DRY) {
    await q(`
      UPDATE worker_payments
      SET status='cancelled',
          comment = COALESCE(comment,'') || ' [cancel: monthly SSoT split V324]',
          updated_at = NOW()
      WHERE type='per_diem' AND status='pending'
    `);
  }

  const { rows: paidRows } = await q(`
    SELECT employee_id,
           CASE
             WHEN pay_year IS NOT NULL AND pay_month IS NOT NULL
               THEN pay_year * 100 + pay_month
             WHEN period_from IS NOT NULL
               THEN EXTRACT(YEAR FROM period_from)::int * 100 + EXTRACT(MONTH FROM period_from)::int
             WHEN paid_at IS NOT NULL
               THEN EXTRACT(YEAR FROM (paid_at AT TIME ZONE 'Europe/Moscow'))::int * 100
                  + EXTRACT(MONTH FROM (paid_at AT TIME ZONE 'Europe/Moscow'))::int
             ELSE NULL
           END AS ym,
           SUM(amount)::numeric AS paid
    FROM worker_payments
    WHERE type='per_diem' AND status IN ('paid','confirmed')
    GROUP BY 1, 2
  `);
  const paidMap = {};
  for (const r of paidRows) {
    if (r.ym == null) continue;
    const key = `${r.employee_id}:${r.ym}`;
    paidMap[key] = Number(r.paid) || 0;
  }

  const months = [];
  for (let m = 3; m <= 9; m++) months.push([2026, m]);

  const inserts = [];
  const summary = [];

  for (const [y, m] of months) {
    const accMap = await getPerDiemAccruedMap(db, empIds, y, m);
    let monthAccrued = 0, monthPaid = 0, monthNeed = 0, nPay = 0;
    for (const empId of empIds) {
      const acc = accMap[empId] || { accrued: 0, days: 0 };
      const accrued = Math.round(Number(acc.accrued) || 0);
      const days = Number(acc.days) || 0;
      const ym = y * 100 + m;
      const already = Math.round(Number(paidMap[`${empId}:${ym}`] || 0));
      const need = Math.max(0, accrued - already);
      monthAccrued += accrued;
      monthPaid += already;
      monthNeed += need;
      if (need > 0) {
        nPay += 1;
        inserts.push({ empId, y, m, accrued, days, already, need });
      }
    }
    summary.push({ y, m, monthAccrued, monthPaid, monthNeed, nPay });
  }
  console.log('summary', summary);
  console.log('inserts', inserts.length, 'sumNeed', inserts.reduce((s, x) => s + x.need, 0));

  if (DRY) {
    console.log('DRY sample', inserts.slice(0, 8));
    await db.end();
    return;
  }

  const { rows: workPick } = await q(`
    SELECT DISTINCT ON (employee_id, y, m)
      employee_id, y, m, work_id
    FROM (
      SELECT employee_id,
             EXTRACT(YEAR FROM date)::int AS y,
             EXTRACT(MONTH FROM date)::int AS m,
             work_id
      FROM field_checkins
      WHERE employee_id = ANY($1::int[]) AND status='completed' AND work_id IS NOT NULL
      UNION ALL
      SELECT employee_id,
             EXTRACT(YEAR FROM date_from)::int,
             EXTRACT(MONTH FROM date_from)::int,
             work_id
      FROM field_trip_stages
      WHERE employee_id = ANY($1::int[])
        AND COALESCE(status,'active') NOT IN ('cancelled','rejected')
        AND work_id IS NOT NULL
    ) s
    ORDER BY employee_id, y, m, work_id DESC
  `, [empIds]);
  const workMap = {};
  for (const r of workPick) workMap[`${r.employee_id}:${r.y * 100 + r.m}`] = r.work_id;

  let inserted = 0;
  for (const it of inserts) {
    const workId = workMap[`${it.empId}:${it.y * 100 + it.m}`] || null;
    const comment = `[AUTO-MONTH] ${it.y}-${String(it.m).padStart(2, '0')} (${it.days} дн.) закрытие долга, уже было ${it.already} ₽`;
    await q(`
      INSERT INTO worker_payments (
        employee_id, work_id, type, period_from, period_to, pay_month, pay_year,
        amount, days, rate_per_day, status, payment_method,
        paid_at, paid_by, paid_by_role, comment, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, 'per_diem', $3::date, $4::date, $5, $6,
        $7, $8, 1000, 'paid', 'auto',
        $9::timestamptz, $10, $11, $12, $10, NOW(), NOW()
      )
    `, [
      it.empId, workId,
      monthStart(it.y, it.m), monthEnd(it.y, it.m),
      it.m, it.y,
      it.need, it.days,
      paidAtIso(it.y, it.m),
      ACTOR_ID, paidByRole, comment,
    ]);
    inserted += 1;
  }

  const { rows: leftover } = await q(`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS amt
    FROM worker_payments
    WHERE type='per_diem' AND status='pending'
  `);

  console.log(JSON.stringify({ inserted, leftoverPending: leftover[0] }));
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
