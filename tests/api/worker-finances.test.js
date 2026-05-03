'use strict';

/**
 * Worker Finances SSoT — 14 тестов по контракту v1.3
 *
 * Тестирует getWorkerFinances() напрямую через db (unit)
 * + SSoT-инвариант через HTTP endpoints (integration).
 *
 * Фикстуры создаются в setup, удаляются в teardown.
 * Используются employee_id 99901-99910 (безопасный диапазон).
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { assert, skip } = require('../config');

// DB import — same pool used by the server
let db;
try {
  db = require('../../src/services/db');
} catch (e) {
  // If running from server directory
  db = require('/var/www/asgard-crm/src/services/db');
}

const { getWorkerFinances } = require('../../src/lib/worker-finances');

const FIELD_JWT_SECRET = process.env.FIELD_JWT_SECRET || process.env.JWT_SECRET;
if (!FIELD_JWT_SECRET) throw new Error('FIELD_JWT_SECRET or JWT_SECRET env var required for tests');

// ── Test fixture IDs (safe range, no conflicts) ────────────────────────────
const EMP = {
  EMPTY:       99901,  // no checkins, no payments
  ONE_WORK:    99902,  // checkins + assignment, no payments
  FULLY_PAID:  99903,  // fully paid worker
  ADVANCE:     99904,  // advance paid, no salary
  PENALTY:     99905,  // penalty applied
  NULL_PD:     99906,  // per_diem IS NULL in assignment
  ZERO_PD:     99907,  // per_diem = 0 (legit)
  PENDING:     99908,  // pending payments (should not count)
  YEAR_FILTER: 99909,  // checkins in 2025 and 2026
  REASSIGN:    99910,  // two assignments, different per_diem
};
const WORK_ID_A = 99801;
const WORK_ID_B = 99802;

const silentLogger = { error: () => {}, warn: () => {}, info: () => {} };

// ── Setup & Teardown ───────────────────────────────────────────────────────

async function setup() {
  // Clean first (idempotent)
  await teardown();

  const empIds = Object.values(EMP);

  // Create test employees
  for (const id of empIds) {
    await db.query(`
      INSERT INTO employees (id, fio, phone, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (id) DO NOTHING
    `, [id, `TEST_FINANCE_${id}`, `+7999${id}`]);
  }

  // Create test works
  for (const [wid, title] of [[WORK_ID_A, 'TEST_FIN_WorkA'], [WORK_ID_B, 'TEST_FIN_WorkB']]) {
    await db.query(`
      INSERT INTO works (id, work_title, customer_name, work_status)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO NOTHING
    `, [wid, title, 'TEST_Customer', 'Новая']);
  }

  // ── EMP.ONE_WORK: 3 checkins on work A, per_diem=1500, no payments ───
  const aOneWork = await createAssignment(EMP.ONE_WORK, WORK_ID_A, 1500);
  await createCheckins(EMP.ONE_WORK, WORK_ID_A, aOneWork, [
    { date: '2026-03-01', amount: 5000 },
    { date: '2026-03-02', amount: 5000 },
    { date: '2026-03-03', amount: 5000 },
  ]);

  // ── EMP.FULLY_PAID: 2 checkins, fully paid ───
  const aFullyPaid = await createAssignment(EMP.FULLY_PAID, WORK_ID_A, 1000);
  await createCheckins(EMP.FULLY_PAID, WORK_ID_A, aFullyPaid, [
    { date: '2026-03-01', amount: 10000 },
    { date: '2026-03-02', amount: 10000 },
  ]);
  // earned = 20000 fot + 2*1000 per_diem = 22000
  await createPayment(EMP.FULLY_PAID, WORK_ID_A, 'salary', 20000, 'paid', 2026);
  await createPayment(EMP.FULLY_PAID, WORK_ID_A, 'per_diem', 2000, 'paid', 2026);

  // ── EMP.ADVANCE: advance paid, salary not yet ───
  const aAdvance = await createAssignment(EMP.ADVANCE, WORK_ID_A, 1000);
  await createCheckins(EMP.ADVANCE, WORK_ID_A, aAdvance, [
    { date: '2026-04-01', amount: 30000 },
  ]);
  // earned = 30000 + 1*1000 = 31000. advance=10000 paid.
  await createPayment(EMP.ADVANCE, WORK_ID_A, 'advance', 10000, 'paid', 2026);

  // ── EMP.PENALTY: penalty reduces earned ───
  const aPenalty = await createAssignment(EMP.PENALTY, WORK_ID_A, 1000);
  await createCheckins(EMP.PENALTY, WORK_ID_A, aPenalty, [
    { date: '2026-04-01', amount: 20000 },
  ]);
  // earned before penalty = 20000 + 1000 = 21000, penalty = 3000 → earned = 18000
  await createPayment(EMP.PENALTY, WORK_ID_A, 'penalty', 3000, 'paid', 2026);

  // ── EMP.NULL_PD: per_diem IS NULL → 422 ───
  const aNullPd = await createAssignment(EMP.NULL_PD, WORK_ID_A, null);
  await createCheckins(EMP.NULL_PD, WORK_ID_A, aNullPd, [
    { date: '2026-04-01', amount: 5000 },
  ]);

  // ── EMP.ZERO_PD: per_diem = 0 → legit, not error ───
  const aZeroPd = await createAssignment(EMP.ZERO_PD, WORK_ID_A, 0);
  await createCheckins(EMP.ZERO_PD, WORK_ID_A, aZeroPd, [
    { date: '2026-04-01', amount: 8000 },
  ]);

  // ── EMP.PENDING: pending payment should not count ───
  const aPending = await createAssignment(EMP.PENDING, WORK_ID_A, 1000);
  await createCheckins(EMP.PENDING, WORK_ID_A, aPending, [
    { date: '2026-04-01', amount: 15000 },
  ]);
  await createPayment(EMP.PENDING, WORK_ID_A, 'salary', 5000, 'paid', 2026);
  await createPayment(EMP.PENDING, WORK_ID_A, 'salary', 3000, 'pending', 2026);  // should NOT count

  // ── EMP.YEAR_FILTER: checkins in 2025 and 2026 ───
  const aYearFilter = await createAssignment(EMP.YEAR_FILTER, WORK_ID_A, 1000);
  await createCheckins(EMP.YEAR_FILTER, WORK_ID_A, aYearFilter, [
    { date: '2025-12-15', amount: 7000 },
    { date: '2025-12-16', amount: 7000 },
    { date: '2026-01-10', amount: 9000 },
  ]);
  await createPayment(EMP.YEAR_FILTER, WORK_ID_A, 'salary', 5000, 'paid', 2025);
  await createPayment(EMP.YEAR_FILTER, WORK_ID_A, 'salary', 3000, 'paid', 2026);

  // ── EMP.REASSIGN: two assignments, per_diem 1000 then 1500 ───
  await createAssignment(EMP.REASSIGN, WORK_ID_A, 1000, false); // old, inactive
  const aReassignActive = await createAssignment(EMP.REASSIGN, WORK_ID_A, 1500, true);  // new, active
  await createCheckins(EMP.REASSIGN, WORK_ID_A, aReassignActive, [
    { date: '2026-04-01', amount: 6000 },
    { date: '2026-04-02', amount: 6000 },
  ]);
}

async function teardown() {
  const empIds = Object.values(EMP);
  const workIds = [WORK_ID_A, WORK_ID_B];

  await db.query(`DELETE FROM worker_payments WHERE employee_id = ANY($1)`, [empIds]);
  await db.query(`DELETE FROM field_checkins WHERE employee_id = ANY($1)`, [empIds]);
  await db.query(`DELETE FROM employee_assignments WHERE employee_id = ANY($1)`, [empIds]);
  await db.query(`DELETE FROM field_sessions WHERE employee_id = ANY($1)`, [empIds]);
  await db.query(`DELETE FROM employees WHERE id = ANY($1)`, [empIds]);
  await db.query(`DELETE FROM works WHERE id = ANY($1)`, [workIds]);
}

// ── Fixture helpers ────────────────────────────────────────────────────────

async function createAssignment(empId, workId, perDiem, isActive = true) {
  const { rows } = await db.query(`
    INSERT INTO employee_assignments (employee_id, work_id, per_diem, is_active)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [empId, workId, perDiem, isActive]);
  return rows[0].id;
}

async function createCheckins(empId, workId, assignmentId, days) {
  for (const d of days) {
    await db.query(`
      INSERT INTO field_checkins (employee_id, work_id, assignment_id, date, amount_earned, status, checkin_at)
      VALUES ($1, $2, $3, $4, $5, 'completed', $4::date + TIME '08:00')
    `, [empId, workId, assignmentId, d.date, d.amount]);
  }
}

async function createPayment(empId, workId, type, amount, status, payYear) {
  await db.query(`
    INSERT INTO worker_payments (employee_id, work_id, type, amount, status, pay_year, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
  `, [empId, workId, type, amount, status, payYear]);
}

// ── Tests ──────────────────────────────────────────────────────────────────

module.exports = {
  name: 'WORKER FINANCES SSoT (contract v1.3)',
  tests: [
    // ── 0. Setup fixtures ───────────────────────────────────────────────
    {
      name: '0. Setup test fixtures',
      run: async () => { await setup(); },
    },
    // ── 1. Empty worker ─────────────────────────────────────────────────
    {
      name: '1. Empty worker → all zeros, by_work: []',
      run: async () => {
        const r = await getWorkerFinances(db, EMP.EMPTY, { logger: silentLogger });
        assert(!r.error, `unexpected error: ${r.error}`);
        assert(r.fot === 0, `fot should be 0, got ${r.fot}`);
        assert(r.per_diem_accrued === 0, `per_diem_accrued should be 0, got ${r.per_diem_accrued}`);
        assert(r.total_earned === 0, `total_earned should be 0, got ${r.total_earned}`);
        assert(r.total_paid === 0, `total_paid should be 0, got ${r.total_paid}`);
        assert(r.total_pending === 0, `total_pending should be 0, got ${r.total_pending}`);
        assert(Array.isArray(r.by_work) && r.by_work.length === 0, 'by_work should be empty array');
      },
    },

    // ── 2. One work, no payments ────────────────────────────────────────
    {
      name: '2. One work, no payments → total_earned = FOT + per_diem, total_paid = 0',
      run: async () => {
        const r = await getWorkerFinances(db, EMP.ONE_WORK, { logger: silentLogger });
        assert(!r.error, `unexpected error: ${r.error}`);
        // 3 checkins × 5000 = 15000 FOT, 3 days × 1500 = 4500 per_diem
        assert(r.fot === 15000, `fot should be 15000, got ${r.fot}`);
        assert(r.per_diem_accrued === 4500, `per_diem_accrued should be 4500, got ${r.per_diem_accrued}`);
        assert(r.total_earned === 19500, `total_earned should be 19500, got ${r.total_earned}`);
        assert(r.total_paid === 0, `total_paid should be 0, got ${r.total_paid}`);
        assert(r.total_pending === 19500, `total_pending should be 19500, got ${r.total_pending}`);
        assert(r.by_work.length === 1, `by_work should have 1 entry, got ${r.by_work.length}`);
        assert(r.by_work[0].work_id === WORK_ID_A, 'by_work[0].work_id mismatch');
        assert(r.by_work[0].days_worked === 3, `days should be 3, got ${r.by_work[0].days_worked}`);
        assert(r.by_work[0].per_diem_rate === 1500, `rate should be 1500, got ${r.by_work[0].per_diem_rate}`);
      },
    },

    // ── 3. Fully paid ───────────────────────────────────────────────────
    {
      name: '3. Fully paid → total_pending = 0',
      run: async () => {
        const r = await getWorkerFinances(db, EMP.FULLY_PAID, { logger: silentLogger });
        assert(!r.error, `unexpected error: ${r.error}`);
        // FOT = 20000, per_diem = 2×1000 = 2000, earned = 22000
        // paid: salary 20000 + per_diem 2000 = 22000
        assert(r.total_earned === 22000, `total_earned should be 22000, got ${r.total_earned}`);
        assert(r.total_paid === 22000, `total_paid should be 22000, got ${r.total_paid}`);
        assert(r.total_pending === 0, `total_pending should be 0, got ${r.total_pending}`);
      },
    },

    // ── 4. Advance paid, no salary ──────────────────────────────────────
    {
      name: '4. Advance paid, no salary → advance in total_paid, pending = earned − advance',
      run: async () => {
        const r = await getWorkerFinances(db, EMP.ADVANCE, { logger: silentLogger });
        assert(!r.error, `unexpected error: ${r.error}`);
        // earned = 30000 + 1000 = 31000. advance = 10000.
        assert(r.total_earned === 31000, `total_earned should be 31000, got ${r.total_earned}`);
        assert(r.advance_paid === 10000, `advance_paid should be 10000, got ${r.advance_paid}`);
        assert(r.salary_paid === 0, `salary_paid should be 0, got ${r.salary_paid}`);
        assert(r.total_paid === 10000, `total_paid should be 10000, got ${r.total_paid}`);
        assert(r.total_pending === 21000, `total_pending should be 21000, got ${r.total_pending}`);
      },
    },

    // ── 5. Penalty applied ──────────────────────────────────────────────
    {
      name: '5. Penalty → reduces total_earned, NOT total_paid',
      run: async () => {
        const r = await getWorkerFinances(db, EMP.PENALTY, { logger: silentLogger });
        assert(!r.error, `unexpected error: ${r.error}`);
        // FOT=20000 + pd=1000 + bonus=0 − penalty=3000 = 18000
        assert(r.penalty === 3000, `penalty should be 3000, got ${r.penalty}`);
        assert(r.total_earned === 18000, `total_earned should be 18000, got ${r.total_earned}`);
        assert(r.total_paid === 0, `total_paid should be 0, got ${r.total_paid}`);
        assert(r.total_pending === 18000, `total_pending should be 18000, got ${r.total_pending}`);
      },
    },

    // ── 6. per_diem NULL → 422 ──────────────────────────────────────────
    {
      name: '6. per_diem IS NULL → error per_diem_not_set',
      run: async () => {
        const r = await getWorkerFinances(db, EMP.NULL_PD, { logger: silentLogger });
        assert(r.error === 'per_diem_not_set', `expected per_diem_not_set, got ${r.error}`);
        assert(r.work_id === WORK_ID_A, `work_id should be ${WORK_ID_A}, got ${r.work_id}`);
        assert(typeof r.message === 'string' && r.message.length > 0, 'message should be non-empty string');
      },
    },

    // ── 7. per_diem = 0 → legit ────────────────────────────────────────
    {
      name: '7. per_diem = 0 → 200 OK, per_diem_accrued = 0',
      run: async () => {
        const r = await getWorkerFinances(db, EMP.ZERO_PD, { logger: silentLogger });
        assert(!r.error, `unexpected error: ${r.error}`);
        assert(r.fot === 8000, `fot should be 8000, got ${r.fot}`);
        assert(r.per_diem_accrued === 0, `per_diem_accrued should be 0, got ${r.per_diem_accrued}`);
        assert(r.total_earned === 8000, `total_earned should be 8000, got ${r.total_earned}`);
        assert(r.by_work[0].per_diem_rate === 0, `rate should be 0, got ${r.by_work[0].per_diem_rate}`);
      },
    },

    // ── 8. Pending payments excluded ────────────────────────────────────
    {
      name: '8. Pending payments do NOT count in total_paid',
      run: async () => {
        const r = await getWorkerFinances(db, EMP.PENDING, { logger: silentLogger });
        assert(!r.error, `unexpected error: ${r.error}`);
        // paid: only 5000 (status=paid). pending 3000 excluded.
        assert(r.salary_paid === 5000, `salary_paid should be 5000 (excl pending 3000), got ${r.salary_paid}`);
        assert(r.total_paid === 5000, `total_paid should be 5000, got ${r.total_paid}`);
      },
    },

    // ── 9. Year filter ──────────────────────────────────────────────────
    {
      name: '9. Year filter → 2025 data excluded from year=2026 result',
      run: async () => {
        const r2026 = await getWorkerFinances(db, EMP.YEAR_FILTER, { year: 2026, logger: silentLogger });
        assert(!r2026.error, `unexpected error: ${r2026.error}`);
        // 2026: 1 checkin × 9000 FOT, 1 day × 1000 per_diem = 10000 earned
        assert(r2026.fot === 9000, `2026 fot should be 9000, got ${r2026.fot}`);
        assert(r2026.per_diem_accrued === 1000, `2026 per_diem should be 1000, got ${r2026.per_diem_accrued}`);
        assert(r2026.salary_paid === 3000, `2026 salary_paid should be 3000, got ${r2026.salary_paid}`);

        const r2025 = await getWorkerFinances(db, EMP.YEAR_FILTER, { year: 2025, logger: silentLogger });
        assert(!r2025.error, `unexpected error: ${r2025.error}`);
        // 2025: 2 checkins × 7000 = 14000 FOT, 2 days × 1000 = 2000 per_diem
        assert(r2025.fot === 14000, `2025 fot should be 14000, got ${r2025.fot}`);
        assert(r2025.salary_paid === 5000, `2025 salary_paid should be 5000, got ${r2025.salary_paid}`);

        // All-time should include both
        const rAll = await getWorkerFinances(db, EMP.YEAR_FILTER, { logger: silentLogger });
        assert(rAll.fot === 23000, `all fot should be 23000, got ${rAll.fot}`);
      },
    },

    // ── 10. Reassignment → one by_work entry with MAX per_diem ─────────
    {
      name: '10. Reassignment (1000→1500) → one by_work entry, per_diem_rate=1500 (MAX)',
      run: async () => {
        const r = await getWorkerFinances(db, EMP.REASSIGN, { logger: silentLogger });
        assert(!r.error, `unexpected error: ${r.error}`);
        assert(r.by_work.length === 1, `should be 1 by_work entry, got ${r.by_work.length}`);
        // MAX(1000, 1500) = 1500. 2 days × 1500 = 3000
        assert(r.by_work[0].per_diem_rate === 1500, `rate should be 1500 (MAX), got ${r.by_work[0].per_diem_rate}`);
        assert(r.per_diem_accrued === 3000, `per_diem_accrued should be 3000, got ${r.per_diem_accrued}`);
        assert(r.by_work[0].is_active === true, `is_active should be true (active assignment exists)`);
      },
    },

    // ── 11. assignment_id FK → per_diem via INNER JOIN ──────────────────
    {
      name: '11. assignment_id FK → per_diem counted via INNER JOIN',
      run: async () => {
        // assignment_id is NOT NULL (V088). INNER JOIN on ea.id = fc.assignment_id.
        // ONE_WORK: 3 days × 1500 per_diem = 4500
        const r = await getWorkerFinances(db, EMP.ONE_WORK, { logger: silentLogger });
        assert(r.per_diem_accrued === 4500, `per_diem via FK should be 4500, got ${r.per_diem_accrued}`);
        assert(r.by_work[0].per_diem_rate === 1500, `rate should be 1500, got ${r.by_work[0].per_diem_rate}`);
      },
    },

    // ── 12. Unallocated payment (work_id NULL) ─────────────────────────
    {
      name: '12. Payment with work_id=NULL → in root total, not in by_work',
      run: async () => {
        // Create an unallocated bonus
        await db.query(`
          INSERT INTO worker_payments (employee_id, work_id, type, amount, status, pay_year, created_at)
          VALUES ($1, NULL, 'bonus', 2000, 'paid', 2026, NOW())
        `, [EMP.ONE_WORK]);

        const r = await getWorkerFinances(db, EMP.ONE_WORK, { logger: silentLogger });
        assert(!r.error, `unexpected error: ${r.error}`);
        assert(r.bonus_paid === 2000, `root bonus_paid should be 2000, got ${r.bonus_paid}`);
        // by_work[0] should not have this bonus
        assert(r.by_work[0].bonus_paid === 0, `by_work bonus_paid should be 0, got ${r.by_work[0].bonus_paid}`);
        // Root total_paid includes it
        assert(r.total_paid === 2000, `root total_paid should include unallocated bonus`);

        // Cleanup
        await db.query(`DELETE FROM worker_payments WHERE employee_id = $1 AND work_id IS NULL`, [EMP.ONE_WORK]);
      },
    },

    // ── 13. invalid_year ────────────────────────────────────────────────
    {
      name: '13. Year < 2020 → error invalid_year',
      run: async () => {
        const r = await getWorkerFinances(db, EMP.EMPTY, { year: 2019, logger: silentLogger });
        assert(r.error === 'invalid_year', `expected invalid_year, got ${JSON.stringify(r)}`);
      },
    },

    // ── 14. SSoT invariant: both endpoints return identical data ────────
    {
      name: '14. SSoT invariant: /worker/finances ≡ /worker-payments/my/balance',
      run: async () => {
        // Create a field session for EMP.ONE_WORK
        const token = jwt.sign(
          { employee_id: EMP.ONE_WORK, type: 'field' },
          FIELD_JWT_SECRET,
          { expiresIn: '1h' }
        );
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        await db.query(`
          INSERT INTO field_sessions (employee_id, token_hash, expires_at)
          VALUES ($1, $2, NOW() + interval '1 hour')
        `, [EMP.ONE_WORK, tokenHash]);

        const BASE_URL = process.env.TEST_BASE_URL || 'https://92.242.61.184';
        const https = require('https');
        const agent = new https.Agent({ rejectUnauthorized: false });

        const fetchEndpoint = async (path) => {
          const resp = await fetch(`${BASE_URL}${path}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            agent,
          });
          const data = await resp.json();
          return data;
        };

        try {
          const r1 = await fetchEndpoint('/api/field/worker/finances');
          const r2 = await fetchEndpoint('/api/worker-payments/my/balance');

          if (r1.error || r2.error) {
            throw new Error(
              `SSoT test setup failed:\n  /finances: ${JSON.stringify(r1)}\n  /balance:  ${JSON.stringify(r2)}\nCheck deployed code and FIELD_JWT_SECRET.`
            );
          }

          const j1 = JSON.stringify(r1);
          const j2 = JSON.stringify(r2);
          assert(j1 === j2, `SSoT invariant broken!\n  /finances: ${j1.slice(0, 200)}\n  /balance:  ${j2.slice(0, 200)}`);
        } finally {
          await db.query(`DELETE FROM field_sessions WHERE employee_id = $1`, [EMP.ONE_WORK]);
        }
      },
    },

    // ── 15. Teardown fixtures ───────────────────────────────────────────
    {
      name: '15. Teardown test fixtures',
      run: async () => { await teardown(); },
    },
  ],
};
