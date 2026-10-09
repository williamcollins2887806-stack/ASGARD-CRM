'use strict';
/**
 * Ремедиация после переноса отметок УММ-2 (422→1937):
 *  A) добрать «Фомина» (в файле только фамилия) — 12 отметок 422→1937 + суточные;
 *  B) пересчитать ФОТ-агрегаты (source_table='field_checkins_agg') для работы 422:
 *     триггер sync_field_checkin_to_expense пересчитывает только NEW.work_id,
 *     поэтому старые агрегаты на 422 остались и задваивали ФОТ.
 *
 * DRY-RUN по умолчанию; APPLY=1 — запись.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { getPerDiemDays } = require('../src/lib/worker-per-diem-days');

const APPLY = process.env.APPLY === '1';
const SRC_WORK = 422;
const DST_WORK = 1937;
const PER_DIEM = 1000;
const ADMIN_USER = 1;
const FROM = '2025-10-01';
const TO = '2026-06-30';

function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }

(async () => {
  const marks = JSON.parse(fs.readFileSync(path.join(__dirname, 'umm2-marks.json'), 'utf8'));
  const pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'asgard', password: process.env.PGPASSWORD || '123456789',
    database: process.env.PGDATABASE || 'asgard_crm'
  });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    // ── A) Фомина (в файле только фамилия) ───────────────────────────
    const fioMarks = marks.filter((m) => /^фомина$/i.test(norm(m.fio)));
    console.log('отметок «Фомина» в файле:', fioMarks.length, fioMarks.map((m) => m.day).join(', '));
    const fominas = (await db.query(`SELECT id, full_name FROM employees WHERE lower(full_name) LIKE 'фомина%'`)).rows;
    console.log('сотрудники Фомина:', JSON.stringify(fominas));
    let fominaMoved = 0; let fominaEmp = null;
    if (fominas.length === 1) {
      fominaEmp = fominas[0].id;
      const days = fioMarks.map((m) => m.day);
      const rows = await db.query(
        `SELECT id, work_id FROM field_checkins WHERE employee_id=$1 AND date = ANY($2::date[]) ORDER BY date`,
        [fominaEmp, days]);
      console.log('найдено отметок Фомина по датам:', rows.rows.length, '| работы:', JSON.stringify([...new Set(rows.rows.map((r) => r.work_id))]));
      const ids = rows.rows.filter((r) => r.work_id === SRC_WORK).map((r) => r.id);
      console.log('к переносу (с 422):', ids.length);
      if (APPLY && ids.length) {
        const u = await db.query(`UPDATE field_checkins SET work_id=$1, updated_at=NOW() WHERE id = ANY($2::int[]) AND work_id=$3`, [DST_WORK, ids, SRC_WORK]);
        fominaMoved = u.rowCount;
      } else if (ids.length) {
        const u = await db.query(`UPDATE field_checkins SET work_id=$1, updated_at=NOW() WHERE id = ANY($2::int[]) AND work_id=$3`, [DST_WORK, ids, SRC_WORK]);
        fominaMoved = u.rowCount;
      }
    } else {
      console.log('НЕ однозначно — Фомина пропущена');
    }

    // суточные Фоминой (если перенесли) — в транзакции (откат при dry-run)
    if (fominaEmp && fominaMoved) {
      const pd = await getPerDiemDays(db, fominaEmp, { from: FROM, to: TO, workId: DST_WORK, includeOrphans: false });
      const already = (await db.query(`SELECT count(*) n FROM worker_payments WHERE employee_id=$1 AND work_id=$2 AND type='per_diem' AND status IN ('paid','confirmed')`, [fominaEmp, DST_WORK])).rows[0].n;
      if (pd.days.length && !Number(already)) {
        const days = pd.days.map((d) => d.day).sort();
        const amount = Math.round(pd.total_accrued || pd.days.length * PER_DIEM);
        await db.query(`INSERT INTO worker_payments
            (employee_id, work_id, type, period_from, period_to, days, rate_per_day, amount,
             payment_method, paid_at, paid_by, status, comment, created_by, created_at)
          VALUES ($1,$2,'per_diem',$3,$4,$5,$6,$7,'cash',NOW(),$8,'paid',$9,$8,NOW())`,
          [fominaEmp, DST_WORK, days[0], days[days.length - 1], pd.days.length, PER_DIEM, amount, ADMIN_USER,
            'Суточные АО УММ-2 (перенос отметок из архива 422), ' + pd.days.length + ' дн.']);
        console.log('Фомина: суточные ' + pd.days.length + ' дн = ' + amount + ' ₽');
      } else {
        console.log('Фомина: суточные уже есть или нет дней (' + pd.days.length + ')');
      }
    }

    // ── B) пересчёт ФОТ-агрегатов на 422 ─────────────────────────────
    // затронутые сотрудники = у кого есть агрегат ФОТ на 1937 (+ Фомина после переноса)
    const affectedSet = new Set((await db.query(
      `SELECT DISTINCT split_part(source_key, ':', 2)::int AS emp
         FROM work_expenses WHERE source_table='field_checkins_agg' AND source_key LIKE $1`,
      [DST_WORK + ':%'])).rows.map((r) => r.emp));
    if (fominaEmp && fominaMoved) affectedSet.add(fominaEmp);
    const affected = [...affectedSet];
    console.log('\nзатронутых сотрудников:', affected.length);

    const stale = (await db.query(
      `SELECT source_key, amount, is_finalized FROM work_expenses
        WHERE source_table='field_checkins_agg' AND source_key = ANY($1::text[])`,
      [affected.map((e) => SRC_WORK + ':' + e)])).rows;
    console.log('текущие агрегаты на 422 у затронутых:', stale.length, '| сумма:', stale.reduce((a, b) => a + Number(b.amount), 0));

    // ВАЖНО: условие как в живом триггере sync_field_checkin_to_expense
    const TRIG_COND = `(status IN ('closed','confirmed','completed') OR checkout_at IS NOT NULL)`;
    let recalc = 0; let deleted = 0;
    for (const emp of affected) {
      const remain = (await db.query(
        `SELECT id FROM field_checkins WHERE work_id=$1 AND employee_id=$2 AND ${TRIG_COND}
         ORDER BY id DESC LIMIT 1`, [SRC_WORK, emp])).rows[0];
      if (remain) {
        // no-op UPDATE → срабатывает триггер и пересчитывает агрегат 422:emp
        await db.query(`UPDATE field_checkins SET updated_at = COALESCE(updated_at, NOW()) WHERE id=$1`, [remain.id]);
        recalc++;
      } else {
        const d = await db.query(`DELETE FROM work_expenses WHERE source_table='field_checkins_agg' AND source_key=$1 AND is_finalized=FALSE`, [SRC_WORK + ':' + emp]);
        deleted += d.rowCount;
      }
    }
    console.log('пересчитано (no-op update):', recalc, '| удалено пустых агрегатов:', deleted);

    // контроль
    const sums = (await db.query(
      `SELECT work_id, category, count(*) n, sum(amount) s FROM work_expenses
        WHERE work_id IN (422,1937) AND category IN ('fot','per_diem')
        GROUP BY work_id, category ORDER BY work_id, category`)).rows;
    console.log('\nПОСЛЕ work_expenses:');
    for (const r of sums) console.log('  work ' + r.work_id + ' ' + r.category + ': n=' + r.n + ' sum=' + r.s);

    const agg = (await db.query(
      `SELECT work_id, sum(amount_earned) s FROM field_checkins
        WHERE work_id IN (422,1937) AND (status IN ('closed','confirmed') OR checkout_at IS NOT NULL)
        GROUP BY work_id ORDER BY work_id`)).rows;
    console.log('агрегат по checkins (closed/confirmed):', JSON.stringify(agg));

    if (APPLY) { await db.query('COMMIT'); console.log('\nCOMMITTED: Фомина перенесено=' + fominaMoved + ', агрегатов пересчитано=' + recalc + ', удалено=' + deleted); }
    else { await db.query('ROLLBACK'); console.log('\nDRY-RUN: откатано. APPLY=1 для записи.'); }
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('ERR', e.message); process.exitCode = 1;
  } finally { db.release(); await pool.end(); }
})();
