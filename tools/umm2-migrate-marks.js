'use strict';
/**
 * Переносит отметки табеля по работе 1937 «Обезжиривание…АО УММ-2» (= Святогор)
 * с архивной работы 422 «Архив начислений 2020–2026» и начисляет/выплачивает
 * суточные (worker_payments.per_diem, status=paid → триггер V259 создаёт
 * work_expenses(category='per_diem')).
 *
 * Гарантии: ничего не удаляем; часы/баллы/суммы отметок НЕ трогаем (только work_id);
 * общее число отметок и общий ФОТ не меняются. DRY-RUN по умолчанию.
 *
 * Usage (на проде в /var/www/asgard-crm):
 *   node tools/umm2-migrate-marks.js           # dry-run
 *   APPLY=1 node tools/umm2-migrate-marks.js   # запись
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { getPerDiemDays } = require('../src/lib/worker-per-diem-days');

const APPLY = process.env.APPLY === '1';
const SRC_WORK = 422;      // «Архив начислений 2020–2026»
const DST_WORK = 1937;     // «Обезжиривание кислородопровода АО УММ-2»
const PER_DIEM = 1000;
const ADMIN_USER = 1;
const FROM = '2025-10-01';
const TO = '2026-06-30';

function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function abbr(fio) { const p = norm(fio).split(' ').filter(Boolean); return p.length ? p[0] + ' ' + p.slice(1).map((x) => x[0] || '').join('') : ''; }

(async () => {
  const marksPath = path.join(__dirname, 'umm2-marks.json');
  const marks = JSON.parse(fs.readFileSync(marksPath, 'utf8'));
  const pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'asgard', password: process.env.PGPASSWORD || '123456789',
    database: process.env.PGDATABASE || 'asgard_crm'
  });
  const db = await pool.connect();
  let fail = 0;
  try {
    const emps = (await db.query('SELECT id, full_name FROM employees')).rows;
    const byNorm = new Map(); const byAbbr = new Map();
    for (const e of emps) { byNorm.set(norm(e.full_name), e); byAbbr.set(abbr(e.full_name), e); }
    const resolve = (fio) => byNorm.get(norm(fio)) || byAbbr.get(abbr(fio)) || null;

    const ids = []; const empIds = new Set(); const noEmp = new Set();
    for (const m of marks) {
      const e = resolve(m.fio);
      if (!e) { noEmp.add(m.fio); continue; }
      const q = await db.query('SELECT id FROM field_checkins WHERE employee_id=$1 AND date=$2 ORDER BY id', [e.id, m.day]);
      for (const r of q.rows) { ids.push(r.id); empIds.add(e.id); }
    }
    console.log('отметок в файле:', marks.length, '| id checkins к переносу:', ids.length,
      '| сотрудников:', empIds.size, '| без сотрудника:', JSON.stringify([...noEmp]));

    const before = {
      total: (await db.query('SELECT count(*) n, sum(amount_earned) earned FROM field_checkins')).rows[0],
      w422: (await db.query(`SELECT count(*) n FROM field_checkins WHERE work_id=${SRC_WORK}`)).rows[0],
      w1937: (await db.query(`SELECT count(*) n FROM field_checkins WHERE work_id=${DST_WORK}`)).rows[0],
    };
    console.log('ДО: всего checkins', JSON.stringify(before.total), '| 422:', before.w422.n, '| 1937:', before.w1937.n);

    await db.query('BEGIN');

    const upd = await db.query('UPDATE field_checkins SET work_id=$1, updated_at=NOW() WHERE id = ANY($2::int[]) AND work_id=$3',
      [DST_WORK, ids, SRC_WORK]);
    console.log('[txn] перенесено отметок:', upd.rowCount);

    const ex = await db.query('SELECT work_id, per_diem FROM field_project_settings WHERE work_id=$1', [DST_WORK]);
    if (ex.rows.length) {
      await db.query('UPDATE field_project_settings SET per_diem=$2 WHERE work_id=$1', [DST_WORK, PER_DIEM]);
      console.log('[txn] fps 1937: UPDATE per_diem=' + PER_DIEM + ' (было ' + ex.rows[0].per_diem + ')');
    } else {
      await db.query("INSERT INTO field_project_settings (work_id, per_diem, is_active, site_category) VALUES ($1,$2,true,'ground')", [DST_WORK, PER_DIEM]);
      console.log('[txn] fps 1937: INSERT per_diem=' + PER_DIEM);
    }

    let totalDays = 0; let totalAmt = 0; let payCount = 0; let skipped = 0;
    for (const emp of empIds) {
      const pd = await getPerDiemDays(db, emp, { from: FROM, to: TO, workId: DST_WORK, includeOrphans: false });
      const n = pd.days.length;
      if (!n) continue;
      const amount = Math.round(pd.total_accrued || n * PER_DIEM);
      const days = pd.days.map((d) => d.day).sort();
      totalDays += n; totalAmt += amount; payCount++;
      // Идемпотентность: если этому сотруднику по этой работе уже выплачены суточные — не дублируем.
      const already = (await db.query(
        `SELECT count(*) n FROM worker_payments WHERE employee_id=$1 AND work_id=$2 AND type='per_diem' AND status IN ('paid','confirmed')`,
        [emp, DST_WORK])).rows[0].n;
      if (Number(already) > 0) { skipped++; continue; }
      if (APPLY) {
        await db.query(`INSERT INTO worker_payments
            (employee_id, work_id, type, period_from, period_to, days, rate_per_day, amount,
             payment_method, paid_at, paid_by, status, comment, created_by, created_at)
          VALUES ($1,$2,'per_diem',$3,$4,$5,$6,$7,'cash',NOW(),$8,'paid',$9,$8,NOW())`,
          [emp, DST_WORK, days[0], days[days.length - 1], n, PER_DIEM, amount, ADMIN_USER,
            'Суточные АО УММ-2 (перенос отметок из архива 422), ' + n + ' дн.']);
      }
    }
    console.log('[txn] суточные: сотрудников=' + payCount + ' дней=' + totalDays + ' сумма=' + totalAmt + ' ₽'
      + (skipped ? (' | пропущено (уже выплачено): ' + skipped) : ''));

    const after = {
      total: (await db.query('SELECT count(*) n, sum(amount_earned) earned FROM field_checkins')).rows[0],
      w422: (await db.query(`SELECT count(*) n FROM field_checkins WHERE work_id=${SRC_WORK}`)).rows[0],
      w1937: (await db.query(`SELECT count(*) n, sum(amount_earned) earned FROM field_checkins WHERE work_id=${DST_WORK}`)).rows[0],
    };
    console.log('[txn] ПОСЛЕ: всего checkins', JSON.stringify(after.total), '| 422:', after.w422.n, '| 1937:', JSON.stringify(after.w1937));
    if (Number(after.total.n) !== Number(before.total.n)) { console.log('FAIL: изменилось число checkins!'); fail++; }
    if (Number(after.total.earned) !== Number(before.total.earned)) { console.log('FAIL: изменился общий ФОТ!'); fail++; }
    if (Number(after.w422.n) !== Number(before.w422.n) - upd.rowCount) { console.log('FAIL: 422 сдвинулся не на число переноса'); fail++; }

    if (APPLY && fail === 0) {
      await db.query('COMMIT');
      const exp = (await db.query(`SELECT count(*) n, sum(amount) s FROM work_expenses WHERE work_id=${DST_WORK} AND category='per_diem'`)).rows[0];
      console.log('\nCOMMITTED. work_expenses(per_diem, 1937):', JSON.stringify(exp));
      console.log('ИТОГ: перенесено ' + upd.rowCount + ' отметок; суточные ' + totalDays + ' дн. = ' + totalAmt + ' ₽ выплачено');
    } else {
      await db.query('ROLLBACK');
      console.log('\nDRY-RUN: откатано' + (fail ? ' (есть FAIL!)' : '') + '. APPLY=1 для записи.');
    }
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('ERR', e.message); fail++;
  } finally { db.release(); await pool.end(); }
  process.exit(fail ? 1 : 0);
})();
