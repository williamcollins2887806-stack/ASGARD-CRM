'use strict';
/**
 * Корректная (помесячная) выплата суточных УММ-2 + устранение осиротевших
 * [AUTO-MONTH] pending.
 *
 * Контекст: система ведёт суточные по календарным месяцам ([AUTO-MONTH]),
 * а предыдущий шаг заплатил одной суммой за весь период — это дало фантомный
 * pending у Фоминой и неверную месячную атрибуцию.
 *
 * Делает:
 *  1) удаляет 18 «bulk»-выплат (comment «Суточные АО УММ-2 (перенос отметок…)»);
 *  2) вставляет помесячные выплаты (paid, pay_year/pay_month, period_from/to) —
 *     по дням работы 1937 в каждом месяце;
 *  3) прогоняет канонический recalc_per_diem_auto_months по затронутым
 *     сотрудникам/месяцам → остаток (accrued − paid) = 0 → pending отменяются.
 *
 * DRY-RUN по умолчанию; APPLY=1 — запись.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { getPerDiemDays } = require('../src/lib/worker-per-diem-days');

const APPLY = process.env.APPLY === '1';
const DST_WORK = 1937;
const PER_DIEM = 1000;
const ADMIN_USER = 1;
const BULK_MARK = 'Суточные АО УММ-2 (перенос отметок из архива 422)%';
const MONTHS = [];
for (let y = 2025, m = 10; ; ) {
  MONTHS.push({ y, m });
  if (y === 2026 && m === 6) break;
  m++; if (m > 12) { m = 1; y++; }
}

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

    // 1) удалить bulk-выплаты (созданные мной ранее) — внутри транзакции (dry-run откатит)
    const del = await db.query(`DELETE FROM worker_payments WHERE work_id=$1 AND type='per_diem' AND status='paid' AND comment LIKE $2`, [DST_WORK, BULK_MARK]);
    console.log('bulk-выплат удалено:', del.rowCount);

    // сотрудники, у кого есть отметки УММ-2 (резолв: norm → abbr → если только фамилия, по фамилии)
    const emps = (await db.query('SELECT id, full_name FROM employees')).rows;
    const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    const abbr = (fio) => { const p = norm(fio).split(' ').filter(Boolean); return p.length ? p[0] + ' ' + p.slice(1).map((x) => x[0] || '').join('') : ''; };
    const byNorm = new Map(); const byAbbr = new Map();
    for (const e of emps) { byNorm.set(norm(e.full_name), e); byAbbr.set(abbr(e.full_name), e); }
    const resolveEmp = (fio) => {
      const parts = norm(fio).split(' ').filter(Boolean);
      if (parts.length === 1) return emps.find((e) => norm(e.full_name).split(' ')[0] === parts[0]) || null;
      return byNorm.get(norm(fio)) || byAbbr.get(abbr(fio)) || null;
    };
    const empSet = new Set();
    for (const m of marks) { const e = resolveEmp(m.fio); if (e) empSet.add(e.id); }
    const affected = [...empSet];
    console.log('сотрудников УММ-2:', affected.length);

    // 2) помесячные выплаты
    let payCount = 0; let payDays = 0; let paySum = 0;
    for (const emp of affected) {
      for (const { y, m } of MONTHS) {
        const from = `${y}-${String(m).padStart(2, '0')}-01`;
        const to = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
        const pd = await getPerDiemDays(db, emp, { from, to, workId: DST_WORK, includeOrphans: false });
        const n = pd.days.length;
        if (!n) continue;
        const days = pd.days.map((d) => d.day).sort();
        const amount = Math.round(n * PER_DIEM);
        payCount++; payDays += n; paySum += amount;
        // всё исполняем внутри транзакции (dry-run откатывает целиком)
        await db.query(`INSERT INTO worker_payments
            (employee_id, work_id, type, period_from, period_to, pay_month, pay_year, days, rate_per_day, amount,
             payment_method, paid_at, paid_by, status, comment, created_by, created_at)
          VALUES ($1,$2,'per_diem',$3,$4,$5,$6,$7,$8,$9,'cash',NOW(),$10,'paid',$11,$10,NOW())`,
          [emp, DST_WORK, days[0], days[days.length - 1], m, y, n, PER_DIEM, amount, ADMIN_USER,
            'Суточные АО УММ-2 (перенос отметок из архива 422), ' + n + ' дн.']);
      }
    }
    console.log('помесячных выплат:', payCount, '| дней:', payDays, '| сумма:', paySum);

    // 3) канонический recalc по затронутым (employee, month) → снимет осиротевшие pending
    let recalcMonths = 0;
    for (const emp of affected) {
      for (const { y, m } of MONTHS) {
        const from = `${y}-${String(m).padStart(2, '0')}-01`;
        const to = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
        await db.query(`SELECT recalc_per_diem_auto_months(ARRAY[$1]::int[], $2::date, $3::date)`, [emp, from, to]);
        recalcMonths++;
      }
    }
    console.log('вызван recalc по месяцам:', recalcMonths);

    // контроль
    const paid = (await db.query(`SELECT count(*) n, sum(days) d, sum(amount) s FROM worker_payments WHERE work_id=$1 AND type='per_diem' AND status IN ('paid','confirmed')`, [DST_WORK])).rows[0];
    const pend = (await db.query(`SELECT count(*) n, sum(amount) s FROM worker_payments WHERE work_id=$1 AND type='per_diem' AND status='pending'`, [DST_WORK])).rows[0];
    const canc = (await db.query(`SELECT count(*) n FROM worker_payments WHERE work_id=$1 AND type='per_diem' AND status='cancelled'`, [DST_WORK])).rows[0];
    console.log('ПОСЛЕ: paid', JSON.stringify(paid), '| pending', JSON.stringify(pend), '| cancelled', canc.n);

    if (APPLY) { await db.query('COMMIT'); console.log('\nCOMMITTED'); }
    else { await db.query('ROLLBACK'); console.log('\nDRY-RUN: откатано. APPLY=1 для записи.'); }
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('ERR', e.message); process.exitCode = 1;
  } finally { db.release(); await pool.end(); }
})();
