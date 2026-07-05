/**
 * Payroll Dashboard API
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/payroll-dashboard
 *
 * GET  /summary/:year/:month                  — сводка (заработано/перевод/возврат/касса)
 * GET  /cash-coverage/:year/:month             — хватает ли в кассе денег на ЗП (баланс/потребность/возвраты/авансы)
 * GET  /self-employed-limits                  — годовой остаток лимита по СЗ
 * GET  /official-employees                    — таблица официальных
 * PUT  /official-employees/:id                — обновить оклад/статус
 *
 * Операции с самозанятыми:
 *   GET    /se-transfers/:year/:month                — список операций
 *   POST   /se-transfers                             — создать операцию (single)
 *   POST   /se-transfers/bulk                        — массовая выдача СЗ-переводов
 *   PUT    /se-transfers/:id/confirm-transfer        — деньги переведены
 *   PUT    /se-transfers/:id/confirm-return          — наличные получены
 *   PUT    /se-transfers/:id/cancel                  — отменить
 *   GET    /se-transfers/employee/:id/year/:year     — операции рабочего за год
 *
 * GET /cash-flow/:year/:month                 — детально по каждому рабочему
 * GET /pm-balance                             — баланс всех РП
 * GET /pm-balance/:pm_id                      — детально по РП
 *
 * Доступ: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH
 */

const ACCESS_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];

const crypto = require('crypto');
const { getCashBalance } = require('../services/approvalService');
const { calcAllPmBalances, calcPmBalance } = require('../lib/pm-balance');
const {
  computeSeLimits,
  loadSeLimitsAggregates,
  loadLimitHolderProfiles,
  computeYearlyUsedForEmployee,
  resolveLimitsHolderId
} = require('../lib/se-limits');

// Cash advisory lock key — должен совпадать с CASH_ADVISORY_LOCK_KEY в cash.js,
// чтобы bulk-вставки в cash_balance_log не конфликтовали с параллельными
// списаниями/возвратами кассы (race-safe для destination='company').
const CASH_ADVISORY_LOCK_KEY = 42;

async function getSettingNumber(db, key, fallback) {
  const { rows: [r] } = await db.query('SELECT value_json FROM settings WHERE key = $1', [key]);
  if (!r) return fallback;
  const v = parseFloat(String(r.value_json).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(v) ? v : fallback;
}

async function routes(fastify, options) {
  const db = fastify.db;

  // ─── GET /summary/:year/:month ────────────────────────────────────────────
  fastify.get('/summary/:year/:month', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const year  = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return reply.code(400).send({ error: 'Bad year/month' });

    const monthlyLimit = await getSettingNumber(db, 'self_employed_monthly_limit', 350000);
    const yearlyLimit  = await getSettingNumber(db, 'self_employed_yearly_limit', 2400000);

    // Заработано всеми за месяц (checkins + stages)
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEnd   = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

    // B4 (19.06.2026): фильтр status строго 'completed' — соответствует timesheet-v2.
    // Раньше != 'cancelled' пропускал active-чекины в ФОТ, а это противоречит
    // SSoT worker-finances.js (только completed считается «закрытым»).
    // См. feedback_field_checkins_status (15.06.2026).
    const { rows: ciSum } = await db.query(`
      SELECT
        fc.employee_id,
        COALESCE(SUM(fc.amount_earned), 0) AS earned
      FROM field_checkins fc
      WHERE fc.date BETWEEN $1 AND $2
        AND fc.status = 'completed'
      GROUP BY fc.employee_id
    `, [periodStart, periodEnd]);

    // B4: для stages — NOT IN ('rejected','cancelled'). Раньше !='rejected'
    // пропускал отменённые. Дефолт = 'active' для NULL.
    const { rows: stSum } = await db.query(`
      SELECT
        fts.employee_id,
        COALESCE(SUM(fts.amount_earned), 0) AS earned
      FROM field_trip_stages fts
      WHERE fts.date_from <= $2 AND COALESCE(fts.date_to, fts.date_from) >= $1
        AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
      GROUP BY fts.employee_id
    `, [periodStart, periodEnd]);

    const earnedByEmp = {};
    for (const r of ciSum) earnedByEmp[r.employee_id] = Number(r.earned || 0);
    for (const r of stSum) earnedByEmp[r.employee_id] = (earnedByEmp[r.employee_id] || 0) + Number(r.earned || 0);

    // PHASE 1B+ (UNIFIED earned): bonus/penalty за месяц по worker_payments —
    // унификация с timesheet-v2. Бух теперь видит ту же сумму, что и рабочий в мобилке.
    //   employees, у которых ТОЛЬКО премия/штраф (без смен), тоже попадают в результат:
    //   их id вливаются в earnedByEmp через ту же мапу (если они уже там — добавляем,
    //   если нет — заводим).
    // B3 (19.06.2026): COALESCE pay_year/pay_month — записи без явных
    // pay_year/pay_month попадают в bucket по created_at.
    const bonusByEmp   = {};
    const penaltyByEmp = {};
    try {
      const { rows: bpRows } = await db.query(`
        SELECT employee_id,
          COALESCE(SUM(CASE WHEN type='bonus'   AND status != 'cancelled' THEN amount END), 0) AS bonus_total,
          COALESCE(SUM(CASE WHEN type='penalty' AND status != 'cancelled' THEN amount END), 0) AS penalty_total
        FROM worker_payments
        WHERE COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $1
          AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $2
        GROUP BY employee_id
      `, [year, month]);
      for (const r of bpRows) {
        const eid = Number(r.employee_id);
        const bonus = Number(r.bonus_total) || 0;
        const penalty = Number(r.penalty_total) || 0;
        bonusByEmp[eid]   = bonus;
        penaltyByEmp[eid] = penalty;
        const net = bonus - penalty;
        // объединяем с earned со смен (Math.max(0,...) применим ниже в цикле,
        // а не сейчас — иначе сотрудник со штрафом > смен исчезнет из totals).
        earnedByEmp[eid] = (earnedByEmp[eid] || 0) + net;
      }
    } catch (_) { /* worker_payments отсутствует — оставляем как было */ }

    // ── Stage S (20.06.2026): paid-агрегаты per emp за месяц ──
    // SSoT с timesheet-v2.js (тот же SQL): worker_payments status IN ('paid','confirmed'),
    // type IN ('per_diem','salary','advance','bonus'), payment_method:
    //   cash         → paid_cash
    //   transfer/card/auto/NULL → paid_transfer (NULL — бэк-совместимость старых записей)
    // Цель: бух/директор видят сколько РП в поле УЖЕ выдал; для /cash-coverage
    // вычитаем из cash_needed чтобы не дублировать оплату.
    // Также подтягиваем employee_id'ы у которых ТОЛЬКО paid-записи без смен/бонусов:
    // их не было в earnedByEmp → вливаем в общий список (через INSERT в paidByEmp,
    // потом merge ниже).
    const paidByEmp = {};
    try {
      const { rows: paidRows } = await db.query(`
        SELECT employee_id,
          SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END)::numeric AS paid_cash,
          SUM(CASE WHEN payment_method IN ('transfer','card','auto')
                    OR payment_method IS NULL THEN amount ELSE 0 END)::numeric AS paid_transfer,
          SUM(CASE WHEN type='per_diem' THEN amount ELSE 0 END)::numeric AS paid_per_diem,
          SUM(CASE WHEN type='salary'   THEN amount ELSE 0 END)::numeric AS paid_salary,
          SUM(CASE WHEN type='advance'  THEN amount ELSE 0 END)::numeric AS paid_advance,
          SUM(CASE WHEN type='bonus'    THEN amount ELSE 0 END)::numeric AS paid_bonus
        FROM worker_payments
        WHERE status IN ('paid','confirmed')
          AND type IN ('per_diem','salary','advance','bonus')
          AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $1
          AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $2
        GROUP BY employee_id
      `, [year, month]);
      for (const r of paidRows) {
        const eid = Number(r.employee_id);
        paidByEmp[eid] = {
          paid_cash:     Number(r.paid_cash)     || 0,
          paid_transfer: Number(r.paid_transfer) || 0,
          paid_per_diem: Number(r.paid_per_diem) || 0,
          paid_salary:   Number(r.paid_salary)   || 0,
          paid_advance:  Number(r.paid_advance)  || 0,
          paid_bonus:    Number(r.paid_bonus)    || 0
        };
        // Сотрудник мог получить выплату БЕЗ смен/бонусов в месяце —
        // включим его в выборку (с earned=0), иначе paid_* потеряется
        // в total_paid_* и UI занизит сумму уже выплаченного.
        if (earnedByEmp[eid] === undefined) earnedByEmp[eid] = 0;
      }
    } catch (_) { /* worker_payments отсутствует — paidByEmp пуст */ }

    const empIds = Object.keys(earnedByEmp).map(x => parseInt(x, 10));
    if (!empIds.length) {
      return {
        year, month,
        total_earned: 0, total_bonus: 0, total_penalty: 0,
        total_transfer: 0, total_cash_return: 0, total_cash_needed: 0,
        net_cash: 0, agreement_transfers_count: 0, agreement_transfers_sum: 0,
        by_mode: { self_employed: 0, official: 0, cash: 0 },
        // Stage S: дефолты, чтобы фронт не падал на undefined.
        total_paid_cash: 0, total_paid_transfer: 0, total_paid_total: 0,
        total_cash_needed_remaining: 0, total_transfer_remaining: 0,
        // Stage U: дефолты официального блока.
        total_official_count: 0, total_official_to_pay_by_buh: 0,
        total_official_paid_by_buh: 0, total_official_remaining_by_buh: 0,
      };
    }

    const { rows: emps } = await db.query(`
      SELECT id, fio, is_self_employed, is_officially_employed, can_exceed_limit,
             official_salary, official_status, official_non_burnable,
             se_payee_id,
             COALESCE(se_yearly_used_initial, 0) AS se_yearly_used_initial,
             se_monthly_used_initial
      FROM employees WHERE id = ANY($1::int[])
    `, [empIds]);

    // V240: лимиты считаем не только для empIds, но и для их payee'ев.
    // Payee может НЕ иметь смен → его нет в empIds, но он держит лимиты НПД.
    const payeeIdsSet = new Set();
    const payeeIdByEmp = {};   // emp.id -> payee.id
    for (const e of emps) {
      if (e.is_self_employed && e.se_payee_id) {
        payeeIdsSet.add(Number(e.se_payee_id));
        payeeIdByEmp[e.id] = Number(e.se_payee_id);
      }
    }
    const limitsIds = Array.from(new Set([...empIds, ...payeeIdsSet]));

    const payeeInfoById = await loadLimitHolderProfiles(db, limitsIds);
    for (const e of emps) {
      if (!payeeInfoById[e.id]) {
        payeeInfoById[e.id] = {
          id: e.id,
          fio: e.fio,
          can_exceed_limit: !!e.can_exceed_limit,
          se_yearly_used_initial: Number(e.se_yearly_used_initial || 0),
          se_monthly_used_initial: e.se_monthly_used_initial || null
        };
      }
    }

    const {
      transfersYearMap: yearlyByEmp,
      transfersMonthMap: monthByEmp,
      yearlyHistoryByEmp,
      monthlyImportMap
    } = await loadSeLimitsAggregates(db, limitsIds, year, month);

    const { rows: agreementSum } = await db.query(`
      SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(transfer_amount), 0) AS sum
      FROM se_transfers
      WHERE year = $1 AND month = $2 AND operation_type = 'agreement_transfer' AND status != 'cancelled'
    `, [year, month]);

    let total_earned = 0, total_bonus = 0, total_penalty = 0;
    let total_transfer = 0, total_cash_return = 0, total_cash_needed = 0;
    let mode_self = 0, mode_off = 0, mode_cash = 0;
    // Q-4: аккумуляторы остатков компании (только по СЗ).
    let month_remaining_company = 0;
    let year_remaining_company  = 0;
    // Stage S: аккумуляторы УЖЕ ВЫПЛАЧЕННОГО (нал + перевод). Используются
    // в /cash-coverage для вычитания из cash_needed (не дублируем оплату).
    let total_paid_cash = 0;
    let total_paid_transfer = 0;

    for (const emp of emps) {
      // earned уже включает bonus/penalty (см. сборку earnedByEmp выше),
      // но финальный earned для расчёта выплат не может быть отрицательным.
      const earned = Math.max(0, Number(earnedByEmp[emp.id] || 0));
      total_earned += earned;
      total_bonus   += Number(bonusByEmp[emp.id]   || 0);
      total_penalty += Number(penaltyByEmp[emp.id] || 0);
      // Stage S: paid-агрегаты per emp в total_paid_*.
      // Stage W (баг #7): если у рабочего привязан se_payee_id, СЗ-выплаты
      // могут быть записаны на payee (employee_id=payee), а не на самого
      // рабочего. Для PER-EMP цифры суммируем emp+payee, чтобы paid_breakdown
      // отражал «сколько за рабочего выплачено». В TOTAL_* — добавляем только
      // paidEmp (payee, если он отдельный сотрудник, получит свой total в своей
      // итерации; если payee НЕ в emps — добавим явно, чтобы не потерять).
      const paidEmp = paidByEmp[emp.id] || null;
      if (paidEmp) {
        total_paid_cash     += Number(paidEmp.paid_cash     || 0);
        total_paid_transfer += Number(paidEmp.paid_transfer || 0);
      }
      const payeeIdForPaid = payeeIdByEmp[emp.id];
      const payeeInEmps = payeeIdForPaid
        ? emps.some(x => Number(x.id) === Number(payeeIdForPaid))
        : false;
      const paidPayee = payeeIdForPaid ? (paidByEmp[payeeIdForPaid] || null) : null;
      // Если payee не входит в emps — никто его paid_* в total не добавит,
      // тогда учитываем здесь (один раз).
      if (paidPayee && !payeeInEmps) {
        total_paid_cash     += Number(paidPayee.paid_cash     || 0);
        total_paid_transfer += Number(paidPayee.paid_transfer || 0);
      }

      if (emp.is_self_employed) {
        mode_self += 1;
        // V240: если есть se_payee_id — лимиты у payee, иначе у emp.
        const payeeId = payeeIdByEmp[emp.id];
        const limitsHolder = (payeeId && payeeInfoById[payeeId]) ? payeeInfoById[payeeId] : payeeInfoById[emp.id];
        const limitsHolderId = limitsHolder.id;
        const lim = computeSeLimits({
          monthlyLimit,
          yearlyLimit,
          trYear: yearlyByEmp[limitsHolderId] || 0,
          trMonth: monthByEmp[limitsHolderId] || 0,
          yrInitial: limitsHolder.se_yearly_used_initial || 0,
          seMonthlyUsedInitial: limitsHolder.se_monthly_used_initial,
          yrHistory: yearlyHistoryByEmp[limitsHolderId] || 0,
          hasImportForMonth: !!monthlyImportMap[limitsHolderId],
          year,
          month,
          canExceedLimit: !!limitsHolder.can_exceed_limit,
          earned
        });
        const transfer = lim.transfer;
        const cashReturn = 0;
        const cashPayout = Math.max(0, earned - transfer);
        total_transfer    += transfer;
        total_cash_return += cashReturn;
        total_cash_needed += cashPayout;
        month_remaining_company += lim.monthly_remaining;
        year_remaining_company  += lim.yearly_remaining;
      } else if (emp.is_officially_employed) {
        // Stage U (20.06.2026): SSoT с timesheet-v2.js — бух vs директор.
        // deductSalary = nonBurnable > 0 ? nonBurnable : salary; transfer = deduct; cash = max(0,earned-deduct).
        // unpaid_leave → deduct=0, transfer=0, cash=0.
        // Источники emp: official_salary, official_non_burnable, official_status.
        mode_off += 1;
        const nonBurnable = Number(emp.official_non_burnable || 0);
        const salary      = Number(emp.official_salary || 0);
        let deductSalary = 0;
        let transferAmount = 0;
        let cashPayout = 0;
        if (emp.official_status !== 'unpaid_leave') {
          deductSalary    = nonBurnable > 0 ? nonBurnable : salary;
          transferAmount  = deductSalary;
          cashPayout      = Math.max(0, earned - deductSalary);
        }
        // mutate emp для последующего расчёта Stage U-summary (deduct_official).
        emp._deduct_official = deductSalary;
        total_transfer    += transferAmount;
        total_cash_needed += cashPayout;
      } else {
        mode_cash += 1;
        total_cash_needed += earned;
      }
    }

    const net_cash = total_cash_return - total_cash_needed;
    // Q-4: количество СЗ и общекомпанейская ёмкость лимитов.
    const seCount = mode_self;
    const r2 = (x) => Math.round(Number(x || 0) * 100) / 100;

    // ── Stage U (20.06.2026): официальный блок (бух vs директор) ──
    // SSoT с timesheet-v2.js summary.
    //   total_official_to_pay_by_buh — Σ deduct_official по оф-сотрудникам.
    //   total_official_paid_by_buh   — Σ worker_payments type='salary' status IN paid,confirmed.
    //   total_official_remaining_by_buh — max(0, to_pay − paid).
    const officialEmps = emps.filter(e => e.is_officially_employed);
    const totalOfficialToPay = officialEmps.reduce((s, e) => s + Number(e._deduct_official || 0), 0);
    let totalOfficialPaid = 0;
    if (officialEmps.length > 0) {
      const { rows: bhPaid } = await db.query(`
        SELECT COALESCE(SUM(amount), 0)::numeric AS sum
        FROM worker_payments
        WHERE employee_id = ANY($1::int[])
          AND type = 'salary' AND status IN ('paid','confirmed')
          AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $2
          AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $3
      `, [officialEmps.map(e => e.id), year, month]);
      totalOfficialPaid = Number(bhPaid[0]?.sum || 0);
    }

    return {
      year, month,
      monthly_limit: monthlyLimit,
      yearly_limit:  yearlyLimit,
      total_earned, total_bonus, total_penalty,
      total_transfer, total_cash_return, total_cash_needed,
      net_cash,
      agreement_transfers_count: Number(agreementSum[0]?.cnt || 0),
      agreement_transfers_sum:   Number(agreementSum[0]?.sum || 0),
      by_mode: { self_employed: mode_self, official: mode_off, cash: mode_cash },
      // Q-4: компанейские лимиты и остатки.
      se_count: seCount,
      total_monthly_capacity: seCount * monthlyLimit,
      total_yearly_capacity:  seCount * yearlyLimit,
      month_remaining_company: r2(month_remaining_company),
      year_remaining_company:  r2(year_remaining_company),
      // ── Stage S (20.06.2026): УЖЕ ВЫПЛАЧЕНО (per_diem/salary/advance/bonus) ──
      // SSoT с timesheet-v2.js summary. Используется в дашборде блоком
      // «📤 УЖЕ ВЫПЛАЧЕНО В ПОЛЕ» и в /cash-coverage для уменьшения cashNeeded.
      //   *_remaining — сколько ОСТАЛОСЬ выплатить (clamp >= 0).
      total_paid_cash:              r2(total_paid_cash),
      total_paid_transfer:          r2(total_paid_transfer),
      total_paid_total:             r2(total_paid_cash + total_paid_transfer),
      total_cash_needed_remaining:  r2(Math.max(0, total_cash_needed - total_paid_cash)),
      total_transfer_remaining:     r2(Math.max(0, total_transfer    - total_paid_transfer)),
      // ── Stage U (20.06.2026): официально устроены (бух vs директор) ──
      total_official_count:            officialEmps.length,
      total_official_to_pay_by_buh:    r2(totalOfficialToPay),
      total_official_paid_by_buh:      r2(totalOfficialPaid),
      total_official_remaining_by_buh: r2(Math.max(0, totalOfficialToPay - totalOfficialPaid)),
    };
  });

  // ─── GET /cash-coverage/:year/:month ──────────────────────────────────────
  // Дашборд директора: хватает ли в кассе денег на ЗП за месяц.
  //   cash_balance         — текущий баланс кассы (cash_balance_log → последняя запись).
  //   cash_needed          — суммарная потребность налом (total_cash_payout из /summary).
  //   pending_returns      — ожидаемые возвраты от РП (cash_returns.confirmed_at IS NULL).
  //   advances_outstanding — авансы у РП (cash_requests money_issued/received/reporting).
  //   effective_balance    — cash_balance + pending_returns (после получения возвратов).
  //   status: ok | ok_with_returns | tight | shortage.
  fastify.get('/cash-coverage/:year/:month', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const year  = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return reply.code(400).send({ error: 'Bad year/month' });

    // 1. Текущий баланс кассы (последняя запись cash_balance_log).
    let cashBalance = 0;
    try {
      cashBalance = Number(await getCashBalance(db)) || 0;
    } catch (_) {
      try {
        const { rows: [r] } = await db.query(
          `SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1`
        );
        cashBalance = Number(r?.amount) || 0;
      } catch (_) { cashBalance = 0; }
    }

    // 2. Зарплатная потребность за месяц — реюзаем /summary через fastify.inject,
    //    чтобы формула total_cash_payout была СЕДИНСТВЕННОЙ (SSoT).
    // Stage S (20.06.2026): из /summary также берём total_paid_cash/transfer/total
    // — РЕАЛЬНАЯ потребность в кассе = total_cash_payout − total_paid_cash
    // (то, что РП в поле УЖЕ выдал из аванса, не нужно заводить заново).
    let cashNeededRaw = 0;       // полная потребность из /summary (без вычета paid)
    let totalTransfer = 0, totalEarned = 0;
    let totalPaidCash = 0, totalPaidTransfer = 0, totalPaidTotal = 0;
    try {
      const sumResp = await fastify.inject({
        method: 'GET',
        url: `/api/payroll-dashboard/summary/${year}/${month}`,
        headers: { authorization: request.headers.authorization || '' }
      });
      if (sumResp.statusCode === 200) {
        const summary = JSON.parse(sumResp.body || '{}');
        // /summary возвращает total_cash_needed (см. ключ выше в этом файле);
        // принимаем оба варианта на случай рефакторинга — total_cash_payout/total_cash_needed.
        cashNeededRaw     = Number(summary.total_cash_payout ?? summary.total_cash_needed ?? 0);
        totalTransfer     = Number(summary.total_transfer || 0);
        totalEarned       = Number(summary.total_earned || 0);
        totalPaidCash     = Number(summary.total_paid_cash     || 0);
        totalPaidTransfer = Number(summary.total_paid_transfer || 0);
        totalPaidTotal    = Number(summary.total_paid_total    || 0);
      }
    } catch (e) {
      fastify.log.warn('[cash-coverage] summary inject failed: ' + e.message);
    }
    // Stage S: cashNeeded = total_cash_payout − total_paid_cash (clamp >= 0).
    // Раньше cashNeeded == cashNeededRaw — но РП в поле уже мог раздать часть
    // суточных/премий cash, эту сумму ВТОРОЙ раз заводить в кассу не нужно.
    const cashNeeded = Math.max(0, cashNeededRaw - totalPaidCash);

    // 3. Ожидаемые возвраты от РП (не подтверждённые БУХом).
    let pendingReturns = 0;
    try {
      const { rows: [pr] } = await db.query(`
        SELECT COALESCE(SUM(cr.amount), 0)::numeric AS sum
        FROM cash_returns cr
        WHERE cr.confirmed_at IS NULL
      `);
      pendingReturns = Number(pr?.sum) || 0;
    } catch (_) { pendingReturns = 0; }

    // 4. Авансы у РП — выдано, но ещё не закрыто.
    //    money_issued — деньги отправлены РП; received — РП принял;
    //    reporting   — РП собирает чеки (всё ещё «висит» на нём).
    let advancesOutstanding = 0;
    let advancesCount = 0;
    try {
      const { rows: [ao] } = await db.query(`
        SELECT COALESCE(SUM(amount), 0)::numeric AS sum, COUNT(*)::int AS cnt
        FROM cash_requests
        WHERE status IN ('money_issued', 'received', 'reporting')
      `);
      advancesOutstanding = Number(ao?.sum) || 0;
      advancesCount = Number(ao?.cnt) || 0;
    } catch (_) { advancesOutstanding = 0; advancesCount = 0; }

    // 5. Прогноз: баланс ПОСЛЕ получения ожидаемых возвратов от РП.
    const effectiveBalance = cashBalance + pendingReturns;
    const diff = effectiveBalance - cashNeeded;

    // 6. Статус-цвет для UI.
    let status, status_label;
    if (cashBalance >= cashNeeded) {
      status = 'ok';
      status_label = 'Хватает в кассе сейчас';
    } else if (effectiveBalance >= cashNeeded) {
      status = 'ok_with_returns';
      status_label = 'Хватит после возвратов от РП';
    } else if (cashNeeded > 0 && effectiveBalance >= cashNeeded * 0.5) {
      status = 'tight';
      status_label = 'Дефицит — нужно пополнение';
    } else if (cashNeeded === 0) {
      status = 'ok';
      status_label = 'Нет потребности налом';
    } else {
      status = 'shortage';
      status_label = 'Большой дефицит — срочно пополнить';
    }

    const r2 = (x) => Math.round(Number(x || 0) * 100) / 100;

    return {
      year, month,
      cash_balance:         r2(cashBalance),
      cash_needed:          r2(cashNeeded),
      pending_returns:      r2(pendingReturns),
      advances_outstanding: r2(advancesOutstanding),
      advances_count:       advancesCount,
      effective_balance:    r2(effectiveBalance),
      diff:                 r2(diff),
      coverage_pct:         cashNeeded > 0 ? Math.round((effectiveBalance / cashNeeded) * 100) : 100,
      status,
      status_label,
      // Доп. контекст для UI-карточки.
      total_transfer:       r2(totalTransfer),
      total_earned:         r2(totalEarned),
      // ── Stage S (20.06.2026): УЖЕ ВЫПЛАЧЕНО — для блока в UI ──
      // total_paid_in_field — общая сумма уже выданного в поле (нал + перевод),
      //   используется фронтом дашборда (блок «📤 УЖЕ ВЫПЛАЧЕНО В ПОЛЕ»).
      // total_already_paid_cash — отдельно нал, чтобы было видно почему
      //   cash_needed уменьшен (cash_needed = cashNeededRaw − total_already_paid_cash).
      // cash_needed_raw — исходная полная потребность ДО вычета (для контекста).
      total_paid_in_field:    r2(totalPaidTotal),
      total_already_paid_cash: r2(totalPaidCash),
      total_paid_transfer:    r2(totalPaidTransfer),
      cash_needed_raw:        r2(cashNeededRaw)
    };
  });

  // ─── GET /self-employed-limits ────────────────────────────────────────────
  fastify.get('/self-employed-limits', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async () => {
    const yearlyLimit = await getSettingNumber(db, 'self_employed_yearly_limit', 2400000);
    const year = new Date().getFullYear();
    const { rows } = await db.query(`
      SELECT
        e.id, e.fio,
        COALESCE(e.se_yearly_used_initial, 0) AS se_yearly_used_initial,
        COALESCE(SUM(t.transfer_amount) FILTER (WHERE t.status != 'cancelled'), 0) AS transferred_year
      FROM employees e
      LEFT JOIN se_transfers t ON t.employee_id = e.id AND t.year = $1
      WHERE e.is_self_employed = true AND e.is_active = true
      GROUP BY e.id, e.fio, e.se_yearly_used_initial
      ORDER BY transferred_year DESC, e.fio
    `, [year]);

    const empIds = rows.map(r => r.id);
    const historyByEmp = {};
    if (empIds.length) {
      try {
        const { rows: hRows } = await db.query(`
          SELECT employee_id, COALESCE(SUM(monthly_used), 0) AS hist_sum
            FROM se_monthly_history
           WHERE employee_id = ANY($1::int[]) AND year = $2
           GROUP BY employee_id
        `, [empIds, year]);
        for (const r of hRows) historyByEmp[r.employee_id] = Number(r.hist_sum) || 0;
      } catch (_) {}
    }

    return {
      year,
      yearly_limit: yearlyLimit,
      employees: rows.map(r => {
        const yrUsed = Number(r.transferred_year || 0)
          + (historyByEmp[r.id] || 0)
          + Number(r.se_yearly_used_initial || 0);
        const remaining = Math.max(0, yearlyLimit - yrUsed);
        return {
          ...r,
          transferred_year: Number(r.transferred_year || 0),
          yearly_used: yrUsed,
          remaining
        };
      }),
    };
  });

  // ─── GET /official-employees ──────────────────────────────────────────────
  // M3-3 (20.06.2026): company_debt — сколько компания ДОЛЖНА рабочему за текущий месяц.
  //   ожидание = max(official_salary, official_non_burnable, фактически выплачено)
  //              — но как простая база: official_salary (т.е. оклад месяца);
  //   фактически = SUM(worker_payments type='salary' status IN ('paid','confirmed')) за текущий месяц.
  //   company_debt = official_salary − paid_this_month
  //   • > 0  — компания ещё должна (не доплатили)
  //   • = 0  — расчёт сошёлся
  //   • < 0  — переплата (компания «должна себе»)
  // Бакет периода: COALESCE(pay_year, EXTRACT(YEAR FROM created_at)) — старые записи
  // без явных pay_year/pay_month попадают по created_at (как в /summary и timesheet-v2).
  fastify.get('/official-employees', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async () => {
    const now = new Date();
    const curYear  = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const { rows } = await db.query(`
      WITH paid AS (
        SELECT employee_id, COALESCE(SUM(amount), 0)::numeric AS sum_paid
        FROM worker_payments
        WHERE type = 'salary'
          AND status IN ('paid', 'confirmed')
          AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $1
          AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $2
        GROUP BY employee_id
      )
      SELECT
        e.id, e.fio, e.phone, e.role_tag,
        e.official_salary, e.official_non_burnable, e.official_hire_date,
        e.official_status, e.official_leave_from, e.official_leave_to,
        COALESCE(p.sum_paid, 0)::numeric                                AS paid_this_month,
        (COALESCE(e.official_salary, 0) - COALESCE(p.sum_paid, 0))::numeric AS company_debt
      FROM employees e
      LEFT JOIN paid p ON p.employee_id = e.id
      WHERE e.is_officially_employed = true AND e.is_active = true
      ORDER BY e.fio
    `, [curYear, curMonth]);
    return {
      employees: rows.map(r => ({
        ...r,
        paid_this_month: Number(r.paid_this_month) || 0,
        company_debt:    Number(r.company_debt)    || 0
      })),
      period: { year: curYear, month: curMonth }
    };
  });

  // ─── PUT /official-employees/:id ──────────────────────────────────────────
  fastify.put('/official-employees/:id', { preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'])] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const allowed = ['official_salary', 'official_non_burnable', 'official_hire_date',
                     'official_status', 'official_leave_from', 'official_leave_to',
                     'is_officially_employed', 'is_self_employed'];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [k, v] of Object.entries(request.body || {})) {
      if (!allowed.includes(k)) continue;
      updates.push(`${k} = $${idx}`); values.push(v); idx++;
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });

    // Взаимоисключение
    const body = request.body || {};
    if (body.is_officially_employed === true && body.is_self_employed !== false) {
      updates.push(`is_self_employed = false`);
    }
    if (body.is_self_employed === true && body.is_officially_employed !== false) {
      updates.push(`is_officially_employed = false`);
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    try {
      const { rows } = await db.query(
        `UPDATE employees SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Не найден' });
      return { employee: rows[0] };
    } catch (e) {
      if (e.code === '23514') {
        return reply.code(400).send({ error: 'Рабочий не может быть одновременно самозанятым и официально устроенным' });
      }
      throw e;
    }
  });

  // ─── GET /se-transfers/:year/:month ───────────────────────────────────────
  fastify.get('/se-transfers/:year/:month', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request) => {
    const year  = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    const { rows } = await db.query(`
      SELECT
        t.*,
        e.fio,
        w.work_title,
        cb.name AS created_by_name,
        cf.name AS confirmed_by_name
      FROM se_transfers t
      LEFT JOIN employees e ON e.id = t.employee_id
      LEFT JOIN works w     ON w.id = t.work_id
      LEFT JOIN users cb    ON cb.id = t.created_by
      LEFT JOIN users cf    ON cf.id = t.confirmed_by
      WHERE t.year = $1 AND t.month = $2
      ORDER BY t.created_at DESC
    `, [year, month]);
    return { transfers: rows };
  });

  // ─── POST /se-transfers ───────────────────────────────────────────────────
  fastify.post('/se-transfers', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const {
      employee_id, year, month, operation_type, transfer_amount, earned_amount,
      work_id, comment, remainder_destination
    } = request.body || {};
    if (!employee_id || !year || !month || !operation_type) {
      return reply.code(400).send({ error: 'employee_id, year, month, operation_type обязательны' });
    }
    if (!['work_transfer', 'agreement_transfer'].includes(operation_type)) {
      return reply.code(400).send({ error: 'Недопустимый operation_type' });
    }

    // remainder_destination: 'pm' (default) | 'company'
    // Поведение single НЕ меняется: handover здесь не создаётся (это делает bulk
    // или ручная регистрация). Поле сохраняется в se_transfers как метаданные.
    const destination = remainder_destination || 'pm';
    if (!['pm', 'company'].includes(destination)) {
      return reply.code(400).send({ error: "remainder_destination должен быть 'pm' или 'company'" });
    }

    const { rows: [emp] } = await db.query(
      'SELECT is_self_employed, is_officially_employed FROM employees WHERE id = $1',
      [employee_id]
    );
    if (!emp) return reply.code(404).send({ error: 'Сотрудник не найден' });
    if (!emp.is_self_employed) {
      return reply.code(400).send({ error: 'Рабочий не самозанятый' });
    }
    if (emp.is_officially_employed) {
      return reply.code(400).send({ error: 'Рабочий официально устроен — переводы СЗ невозможны' });
    }

    // ИНН
    const { rows: [se] } = await db.query('SELECT inn FROM self_employed WHERE employee_id = $1', [employee_id]);
    if (!se || !se.inn) {
      return reply.code(400).send({ error: 'У рабочего не заполнен ИНН самозанятого' });
    }

    // Годовой лимит — SSoT с timesheet-v2 (transfers + history + yrInitial на payee).
    const yearlyLimit = await getSettingNumber(db, 'self_employed_yearly_limit', 2400000);
    const limitsHolderId = await resolveLimitsHolderId(db, employee_id);
    if (!limitsHolderId) return reply.code(404).send({ error: 'Сотрудник не найден' });
    const yrUsed = await computeYearlyUsedForEmployee(db, limitsHolderId, year);
    const remaining = Math.max(0, yearlyLimit - yrUsed);
    const transferNum = Number(transfer_amount);
    if (transferNum + yrUsed > yearlyLimit) {
      return reply.code(400).send({ error: 'Превышен годовой лимит НПД', remaining });
    }

    // Сценарий — поля
    const earnedNum = Number(earned_amount || 0);
    if (operation_type === 'agreement_transfer' && earnedNum !== 0) {
      return reply.code(400).send({ error: 'Для agreement_transfer earned_amount должен быть 0' });
    }
    if (operation_type === 'work_transfer' && earnedNum <= 0) {
      return reply.code(400).send({ error: 'Для work_transfer earned_amount должен быть > 0' });
    }
    const cashReturn = operation_type === 'agreement_transfer'
      ? transferNum
      : Math.max(0, transferNum - earnedNum);
    const cashPayout = operation_type === 'work_transfer'
      ? Math.max(0, earnedNum - transferNum)
      : 0;

    // pm_user_id из works
    let pmUserId = null;
    if (work_id) {
      const { rows: [w] } = await db.query('SELECT pm_id FROM works WHERE id = $1', [work_id]);
      pmUserId = w?.pm_id || null;
    }

    const { rows: [created] } = await db.query(`
      INSERT INTO se_transfers
        (employee_id, year, month, operation_type, earned_amount, transfer_amount,
         cash_return_amount, cash_payout_amount, work_id, pm_user_id, inn,
         status, comment, created_by, remainder_destination)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'planned', $12, $13, $14)
      RETURNING *
    `, [employee_id, year, month, operation_type, earnedNum, transferNum,
        cashReturn, cashPayout, work_id || null, pmUserId, se.inn,
        comment || null, request.user.id, destination]);

    return { transfer: created };
  });

  // ─── POST /se-transfers/bulk ──────────────────────────────────────────────
  // Массовая выдача СЗ-переводов (RBAC: ACCESS_ROLES = ADMIN/DIRECTOR/BUH).
  //
  // Поведение:
  //   - se_transfers создаётся сразу status='transferred', transferred_at=NOW()
  //   - destination='pm' + cash_return>0 → INSERT handover (status='pending',
  //     expected_amount=cash_return, source_se_transfer_id=st.id)
  //   - destination='company' + cash_return>0 → INSERT cash_balance_log (income,
  //     race-safe через pg_advisory_xact_lock(CASH_ADVISORY_LOCK_KEY))
  //
  // Транзакция: ОДНА на весь bulk. При критической ошибке БД — ROLLBACK всего.
  // Per-item ошибки (валидация, лимит НПД, ИНН) собираются в errors[],
  // НЕ валят bulk; такие позиции просто не вставляются.
  //
  // pm-balance.js не ломается:
  //   - Bulk создаёт se_transfers со status='transferred'; se_legacy CTE
  //     фильтрует IN ('completed','returned') — поэтому bulk-записи туда
  //     не попадают, двойного учёта нет.
  //   - Для destination='pm' pending handover не входит в pm-balance
  //     (handovers CTE фильтрует status IN ('received','partial')) — войдёт
  //     только когда PM подтвердит.
  fastify.post('/se-transfers/bulk', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const { year, month, transfers } = request.body || {};

    // ── Pre-flight валидация запроса целиком ──────────────────────────────
    const yr = parseInt(year, 10);
    const mo = parseInt(month, 10);
    if (!Number.isFinite(yr) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
      return reply.code(400).send({ error: 'year/month обязательны и валидны (month 1..12)' });
    }
    if (!Array.isArray(transfers) || transfers.length === 0) {
      return reply.code(400).send({ error: 'transfers[] обязателен и не пустой' });
    }
    if (transfers.length > 100) {
      return reply.code(400).send({ error: 'Не более 100 переводов за один bulk' });
    }

    // Idempotency-Key header — если повтор запроса с тем же ключом и батч уже
    // существует в se_transfers → возвращаем 409, а не дублируем записи.
    // Клиент может вытащить результат через GET /se-transfers/:year/:month
    // с фильтром по bulk_batch_id (или просто из локального стейта).
    const idemHeader = request.headers['idempotency-key'];
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const batchId = (idemHeader && UUID_RE.test(idemHeader)) ? idemHeader : crypto.randomUUID();

    if (idemHeader && UUID_RE.test(idemHeader)) {
      const { rows: existed } = await db.query(
        'SELECT id FROM se_transfers WHERE bulk_batch_id = $1 LIMIT 1',
        [batchId]
      );
      if (existed.length > 0) {
        return reply.code(409).send({
          error: 'batch_already_exists',
          batch_id: batchId,
          message: `Bulk с этим Idempotency-Key уже создан (batch_id=${batchId}). ` +
                   `Результат доступен через GET /api/payroll-dashboard/se-transfers/${yr}/${mo}.`
        });
      }
    }

    // Аккумулируем приращения yearly_sum в рамках самого запроса
    // (если в одном bulk два перевода одному сотруднику — суммируем).
    const yearlySumByEmp = new Map();

    const result = {
      batch_id: batchId,
      summary: {
        se_transfers: 0,
        handovers: 0,
        cash_log_income: 0,
        total_transferred: 0,
        total_remainder_to_pm: 0,
        total_remainder_to_company: 0
      },
      transfers: [],
      errors: []
    };

    // ── ОДНА транзакция на весь bulk через pool.connect()-helper ──────────
    // ВСЕ запросы внутри идут через `client`, а не через `db` (pool.query),
    // иначе BEGIN/COMMIT/ROLLBACK уходят на случайные соединения пула,
    // advisory_xact_lock не работает, и при ошибке частичные сайд-эффекты
    // не откатываются. Per-item SAVEPOINT защищает от того, чтобы одна
    // Postgres-ошибка (FK violation и т.п.) не отравила транзакцию для
    // следующих item'ов.
    try {
      await db.transaction(async (client) => {
        // Настройка с проверкой лимита — внутри tx (на client), чтобы вместе
        // с advisory lock жить в одном соединении.
        const yearlyLimit = await getSettingNumber(client, 'self_employed_yearly_limit', 2400000);

        let cashLockAcquired = false;

        for (let i = 0; i < transfers.length; i++) {
          const t = transfers[i] || {};
          const itemIdx = i;
          const spName = `item_${itemIdx}`;
          const empId = parseInt(t.employee_id, 10);
          const wId = t.work_id != null ? parseInt(t.work_id, 10) : null;
          const opType = t.operation_type;
          const transferNum = Number(t.transfer_amount);
          const earnedNum = Number(t.earned_amount || 0);
          const destination = t.remainder_destination || 'pm';
          const itemComment = (t.comment != null) ? String(t.comment) : null;

          // SAVEPOINT per item — изоляция Postgres-ошибок (FK/check/unique).
          await client.query(`SAVEPOINT ${spName}`);

          try {
            // ── Per-item валидация ──────────────────────────────────────
            if (!Number.isFinite(empId)) throw new Error('employee_id обязателен');
            if (!['work_transfer', 'agreement_transfer'].includes(opType)) {
              throw new Error("operation_type должен быть 'work_transfer' или 'agreement_transfer'");
            }
            if (!Number.isFinite(transferNum) || transferNum <= 0) {
              throw new Error('transfer_amount должен быть > 0');
            }
            if (!['pm', 'company'].includes(destination)) {
              throw new Error("remainder_destination должен быть 'pm' или 'company'");
            }
            if (opType === 'agreement_transfer' && earnedNum !== 0) {
              throw new Error('Для agreement_transfer earned_amount должен быть 0');
            }
            if (opType === 'work_transfer' && earnedNum <= 0) {
              throw new Error('Для work_transfer earned_amount должен быть > 0');
            }

            // employee
            const { rows: [emp] } = await client.query(
              'SELECT id, fio, is_self_employed, is_officially_employed FROM employees WHERE id = $1',
              [empId]
            );
            if (!emp) throw new Error('Сотрудник не найден');
            if (!emp.is_self_employed) throw new Error('Рабочий не самозанятый');
            if (emp.is_officially_employed) {
              throw new Error('Рабочий официально устроен — переводы СЗ невозможны');
            }

            // ИНН
            const { rows: [se] } = await client.query(
              'SELECT inn FROM self_employed WHERE employee_id = $1', [empId]
            );
            if (!se || !se.inn) throw new Error('У рабочего не заполнен ИНН самозанятого');

            // Годовой лимит: SSoT с timesheet-v2 (payee + history + yrInitial).
            const limitsHolderId = await resolveLimitsHolderId(client, empId);
            if (!limitsHolderId) throw new Error('Сотрудник не найден');
            const dbYr = await computeYearlyUsedForEmployee(client, limitsHolderId, yr);
            const accum = yearlySumByEmp.get(limitsHolderId) || 0;
            if (dbYr + accum + transferNum > yearlyLimit) {
              throw new Error('Превышен годовой лимит НПД');
            }

            // pm_user_id из works
            let pmUserId = null;
            if (wId != null) {
              if (!Number.isFinite(wId)) throw new Error('work_id невалиден');
              const { rows: [w] } = await client.query(
                'SELECT id, pm_id FROM works WHERE id = $1', [wId]
              );
              if (!w) throw new Error('Работа не найдена');
              pmUserId = w.pm_id || null;
            }

            // Расчёт остатка/доплаты
            const cashReturn = opType === 'agreement_transfer'
              ? transferNum
              : Math.max(0, transferNum - earnedNum);
            const cashPayout = opType === 'work_transfer'
              ? Math.max(0, earnedNum - transferNum)
              : 0;

            // destination='pm' + есть остаток → нужен pm_user_id
            if (destination === 'pm' && cashReturn > 0 && !pmUserId) {
              throw new Error('Для destination=pm нужен work_id с заполненным pm_id (некому отдать остаток)');
            }

            // ── INSERT se_transfers ────────────────────────────────────
            const { rows: [created] } = await client.query(`
              INSERT INTO se_transfers (
                employee_id, year, month, operation_type, earned_amount, transfer_amount,
                cash_return_amount, cash_payout_amount, work_id, pm_user_id, inn,
                status, comment, created_by, remainder_destination, bulk_batch_id,
                transferred_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                'transferred', $12, $13, $14, $15,
                NOW()
              )
              RETURNING *
            `, [
              empId, yr, mo, opType, earnedNum, transferNum,
              cashReturn, cashPayout, wId, pmUserId, se.inn,
              itemComment, request.user.id, destination, batchId
            ]);

            // ── Сайд-эффект остатка ────────────────────────────────────
            if (cashReturn > 0) {
              if (destination === 'pm') {
                // pm_user_id уже валидирован выше
                await client.query(`
                  INSERT INTO worker_to_pm_handovers (
                    worker_id, pm_user_id, work_id, year, month,
                    source_se_transfer_id,
                    expected_amount, received_amount, status, note
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'pending', $8)
                `, [
                  empId, pmUserId, wId, yr, mo,
                  created.id, cashReturn,
                  `Bulk #${batchId.slice(0, 8)}: ожидается передача от СЗ`
                ]);
                result.summary.handovers++;
                result.summary.total_remainder_to_pm += cashReturn;
              } else {
                // destination='company' → cash_balance_log income
                // Advisory lock держится до конца транзакции (xact_lock),
                // race-safe относительно других cash-роутов.
                if (!cashLockAcquired) {
                  await client.query('SELECT pg_advisory_xact_lock($1)', [CASH_ADVISORY_LOCK_KEY]);
                  cashLockAcquired = true;
                }
                const { rows: [bal] } = await client.query(
                  'SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1'
                );
                const currentBalance = bal ? parseFloat(bal.amount) : 0;
                const newBalance = currentBalance + cashReturn;
                await client.query(`
                  INSERT INTO cash_balance_log
                    (amount, change_amount, change_type, description, user_id)
                  VALUES ($1, $2, 'se_remainder_income', $3, $4)
                `, [
                  newBalance, cashReturn,
                  `Остаток СЗ-перевода #${created.id} (bulk ${batchId.slice(0, 8)})`,
                  request.user.id
                ]);
                result.summary.cash_log_income++;
                result.summary.total_remainder_to_company += cashReturn;
              }
            }

            // Учёт суммы по владельцу лимита для последующих позиций bulk
            yearlySumByEmp.set(limitsHolderId, accum + transferNum);

            result.summary.se_transfers++;
            result.summary.total_transferred += transferNum;
            result.transfers.push(created);

            // Успех item'а — RELEASE savepoint.
            await client.query(`RELEASE SAVEPOINT ${spName}`);
          } catch (perItemErr) {
            // Per-item ошибка — откатываем SAVEPOINT (иначе tx в aborted-state
            // и все последующие client.query() свалятся "current transaction
            // is aborted"). Per-item ошибки НЕ роняют bulk.
            try {
              await client.query(`ROLLBACK TO SAVEPOINT ${spName}`);
              await client.query(`RELEASE SAVEPOINT ${spName}`);
            } catch (_) { /* savepoint мог не существовать если упало до создания */ }

            result.errors.push({
              index: itemIdx,
              employee_id: t.employee_id ?? null,
              error: perItemErr.message || String(perItemErr)
            });
          }
        }
      });
    } catch (criticalErr) {
      // db.transaction уже сделал ROLLBACK и release клиента.
      fastify.log.error({ err: criticalErr, batchId }, '[payroll] /se-transfers/bulk critical error');
      return reply.code(500).send({
        error: 'Bulk прерван из-за критической ошибки БД',
        detail: criticalErr.message,
        batch_id: batchId
      });
    }

    return result;
  });

  // ─── PUT /se-transfers/:id/confirm-transfer ───────────────────────────────
  fastify.put('/se-transfers/:id/confirm-transfer', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [t] } = await db.query('SELECT status FROM se_transfers WHERE id = $1', [id]);
    if (!t) return reply.code(404).send({ error: 'Операция не найдена' });
    if (t.status !== 'planned') return reply.code(409).send({ error: 'Можно только из planned' });

    await db.query(`
      UPDATE se_transfers SET status = 'transferred', transferred_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [id]);
    return { ok: true };
  });

  // ─── PUT /se-transfers/:id/confirm-return ─────────────────────────────────
  fastify.put('/se-transfers/:id/confirm-return', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [t] } = await db.query(
      'SELECT status, remainder_destination FROM se_transfers WHERE id = $1', [id]
    );
    if (!t) return reply.code(404).send({ error: 'Операция не найдена' });
    if (t.status !== 'transferred') return reply.code(409).send({ error: 'Можно только из transferred' });

    // V262 guard: если destination='company' — остаток уже в кассе Асгарда,
    // переход в 'completed' дал бы двойной учёт в pm-balance.se_legacy CTE
    // (status IN ('completed','returned')). PM физически нал не получал.
    if (t.remainder_destination === 'company') {
      return reply.code(409).send({
        error: 'Остаток ушёл в главную кассу — РП наличку не получал, confirm-return не применим'
      });
    }

    await db.query(`
      UPDATE se_transfers SET
        status = 'completed', returned_at = NOW(), confirmed_by = $1, updated_at = NOW()
      WHERE id = $2
    `, [request.user.id, id]);
    return { ok: true };
  });

  // ─── PUT /se-transfers/:id/cancel ─────────────────────────────────────────
  fastify.put('/se-transfers/:id/cancel', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    await db.query(`
      UPDATE se_transfers SET status = 'cancelled', updated_at = NOW() WHERE id = $1
    `, [id]);
    return { ok: true };
  });

  // ─── GET /se-transfers/employee/:id/year/:year ────────────────────────────
  fastify.get('/se-transfers/employee/:id/year/:year', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request) => {
    const empId = parseInt(request.params.id, 10);
    const year  = parseInt(request.params.year, 10);
    const { rows } = await db.query(`
      SELECT t.*, w.work_title
      FROM se_transfers t
      LEFT JOIN works w ON w.id = t.work_id
      WHERE t.employee_id = $1 AND t.year = $2
      ORDER BY t.month DESC, t.created_at DESC
    `, [empId, year]);
    return { transfers: rows };
  });

  // ─── GET /cash-flow/:year/:month ──────────────────────────────────────────
  fastify.get('/cash-flow/:year/:month', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request) => {
    const year  = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    const { rows } = await db.query(`
      SELECT
        t.employee_id, e.fio,
        SUM(t.transfer_amount)     AS transfer_total,
        SUM(t.cash_return_amount)  AS cash_return_total,
        SUM(t.cash_payout_amount)  AS cash_payout_total
      FROM se_transfers t
      JOIN employees e ON e.id = t.employee_id
      WHERE t.year = $1 AND t.month = $2 AND t.status != 'cancelled'
      GROUP BY t.employee_id, e.fio
      ORDER BY e.fio
    `, [year, month]);
    return { year, month, items: rows };
  });

  // ─── GET /cash-calc/:year/:month — расчёт кассы по каждому рабочему ────────
  // Возвращает строки для экрана «Расчёт кассы» (4 вкладки на фронте):
  // pay_type = self_employed | official | cash, earned/transfer/cash_return/cash_payout.
  fastify.get('/cash-calc/:year/:month', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const year  = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return reply.code(400).send({ error: 'Bad year/month' });

    const monthlyLimit = await getSettingNumber(db, 'self_employed_monthly_limit', 350000);
    const yearlyLimit  = await getSettingNumber(db, 'self_employed_yearly_limit', 2400000);

    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEnd   = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

    // B4 (19.06.2026): fc.status = 'completed' (строго) — синхронно с timesheet-v2
    // и SSoT worker-finances.js. До фикса попадали active-чекины.
    const { rows: ciSum } = await db.query(`
      SELECT fc.employee_id, COALESCE(SUM(fc.amount_earned), 0) AS earned
      FROM field_checkins fc
      WHERE fc.date BETWEEN $1 AND $2 AND fc.status = 'completed'
      GROUP BY fc.employee_id
    `, [periodStart, periodEnd]);
    // B4: NOT IN ('rejected','cancelled') — раньше !='rejected' пропускал cancelled.
    const { rows: stSum } = await db.query(`
      SELECT fts.employee_id, COALESCE(SUM(fts.amount_earned), 0) AS earned
      FROM field_trip_stages fts
      WHERE fts.date_from <= $2 AND COALESCE(fts.date_to, fts.date_from) >= $1
        AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
      GROUP BY fts.employee_id
    `, [periodStart, periodEnd]);

    const earnedByEmp = {};
    for (const r of ciSum) earnedByEmp[r.employee_id] = Number(r.earned || 0);
    for (const r of stSum) earnedByEmp[r.employee_id] = (earnedByEmp[r.employee_id] || 0) + Number(r.earned || 0);

    // PHASE 1B+ (UNIFIED earned): bonus/penalty за месяц — та же формула, что в timesheet-v2.
    // earned = смены + bonus − penalty, clamp(>=0).
    // B3 (19.06.2026): COALESCE pay_year/pay_month — старые записи без явных
    // pay_year/pay_month попадают в bucket по created_at.
    const bonusByEmpCC   = {};
    const penaltyByEmpCC = {};
    try {
      const { rows: bpRows } = await db.query(`
        SELECT employee_id,
          COALESCE(SUM(CASE WHEN type='bonus'   AND status != 'cancelled' THEN amount END), 0) AS bonus_total,
          COALESCE(SUM(CASE WHEN type='penalty' AND status != 'cancelled' THEN amount END), 0) AS penalty_total
        FROM worker_payments
        WHERE COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $1
          AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $2
        GROUP BY employee_id
      `, [year, month]);
      for (const r of bpRows) {
        const eid = Number(r.employee_id);
        const bonus = Number(r.bonus_total) || 0;
        const penalty = Number(r.penalty_total) || 0;
        bonusByEmpCC[eid]   = bonus;
        penaltyByEmpCC[eid] = penalty;
        earnedByEmp[eid] = (earnedByEmp[eid] || 0) + (bonus - penalty);
      }
    } catch (_) { /* worker_payments отсутствует — пропускаем */ }

    // ── Stage S (20.06.2026): paid-агрегаты per emp для /cash-calc ──
    // SSoT с timesheet-v2.js / payroll-dashboard /summary. Цель — в строке
    // каждого рабочего на экране «Расчёт кассы» показать сколько ему УЖЕ
    // выплачено в поле, чтобы бух не дублировал оплату.
    const paidByEmpCC = {};
    try {
      const { rows: paidRows } = await db.query(`
        SELECT employee_id,
          SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END)::numeric AS paid_cash,
          SUM(CASE WHEN payment_method IN ('transfer','card','auto')
                    OR payment_method IS NULL THEN amount ELSE 0 END)::numeric AS paid_transfer,
          SUM(CASE WHEN type='per_diem' THEN amount ELSE 0 END)::numeric AS paid_per_diem,
          SUM(CASE WHEN type='salary'   THEN amount ELSE 0 END)::numeric AS paid_salary,
          SUM(CASE WHEN type='advance'  THEN amount ELSE 0 END)::numeric AS paid_advance,
          SUM(CASE WHEN type='bonus'    THEN amount ELSE 0 END)::numeric AS paid_bonus
        FROM worker_payments
        WHERE status IN ('paid','confirmed')
          AND type IN ('per_diem','salary','advance','bonus')
          AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $1
          AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $2
        GROUP BY employee_id
      `, [year, month]);
      for (const r of paidRows) {
        const eid = Number(r.employee_id);
        paidByEmpCC[eid] = {
          paid_cash:     Number(r.paid_cash)     || 0,
          paid_transfer: Number(r.paid_transfer) || 0,
          paid_per_diem: Number(r.paid_per_diem) || 0,
          paid_salary:   Number(r.paid_salary)   || 0,
          paid_advance:  Number(r.paid_advance)  || 0,
          paid_bonus:    Number(r.paid_bonus)    || 0
        };
        // Сотрудник мог получить выплату БЕЗ смен/бонусов — включим в выборку.
        if (earnedByEmp[eid] === undefined) earnedByEmp[eid] = 0;
      }
    } catch (_) { /* worker_payments отсутствует — paidByEmpCC пуст */ }

    const empIds = Object.keys(earnedByEmp).map(x => parseInt(x, 10));
    if (!empIds.length) {
      return { year, month, monthly_limit: monthlyLimit, yearly_limit: yearlyLimit, items: [],
        // Stage U: дефолты официального блока.
        total_official_count: 0, total_official_to_pay_by_buh: 0,
        total_official_paid_by_buh: 0, total_official_remaining_by_buh: 0,
        totals: { earned: 0, bonus: 0, penalty: 0, transfer: 0, cash_return: 0, cash_payout: 0, net_cash: 0,
                  // Stage S: дефолты для total_paid_*.
                  paid_cash: 0, paid_transfer: 0, paid_total: 0 } };
    }

    const { rows: emps } = await db.query(`
      SELECT id, fio, is_self_employed, is_officially_employed, can_exceed_limit,
             official_salary, official_non_burnable, official_status, se_payee_id,
             city,
             COALESCE(se_yearly_used_initial, 0) AS se_yearly_used_initial,
             se_monthly_used_initial
      FROM employees WHERE id = ANY($1::int[])
    `, [empIds]);

    // V240: payees могут быть НЕ в empIds (у них нет смен) — догрузим их.
    const payeeIdsSet = new Set();
    const payeeIdByEmp = {};
    for (const e of emps) {
      if (e.is_self_employed && e.se_payee_id) {
        payeeIdsSet.add(Number(e.se_payee_id));
        payeeIdByEmp[e.id] = Number(e.se_payee_id);
      }
    }
    const limitsIds = Array.from(new Set([...empIds, ...payeeIdsSet]));

    const payeeInfoById = await loadLimitHolderProfiles(db, limitsIds);
    for (const e of emps) {
      if (!payeeInfoById[e.id]) {
        payeeInfoById[e.id] = {
          id: e.id,
          fio: e.fio,
          can_exceed_limit: !!e.can_exceed_limit,
          se_yearly_used_initial: Number(e.se_yearly_used_initial || 0),
          se_monthly_used_initial: e.se_monthly_used_initial || null
        };
      }
    }

    const {
      transfersYearMap: yearlyByEmp,
      transfersMonthMap: monthByEmp,
      yearlyHistoryByEmp,
      monthlyImportMap
    } = await loadSeLimitsAggregates(db, limitsIds, year, month);

    const items = [];
    const totals = { earned: 0, bonus: 0, penalty: 0,
                     transfer: 0, cash_return: 0, cash_payout: 0, net_cash: 0,
                     // Stage S: paid-итоги.
                     paid_cash: 0, paid_transfer: 0, paid_total: 0 };
    // Q-4: общекомпанейские остатки и счётчик СЗ.
    let seCount = 0;
    let month_remaining_company = 0;
    let year_remaining_company  = 0;

    for (const emp of emps) {
      // earned уже включает bonus − penalty; clamp >=0 для расчётов выплат
      const earned = Math.max(0, Number(earnedByEmp[emp.id] || 0));
      const bonus   = Number(bonusByEmpCC[emp.id]   || 0);
      const penalty = Number(penaltyByEmpCC[emp.id] || 0);
      let pay_type, transfer = 0, cash_return = 0, cash_payout = 0;
      let payee_fio = null, payee_id = null;

      if (emp.is_self_employed) {
        seCount += 1;
        // V240: если есть se_payee_id — лимиты у payee, pay_type='self_employed_payee'.
        const payeeId = payeeIdByEmp[emp.id];
        const limitsHolder = (payeeId && payeeInfoById[payeeId]) ? payeeInfoById[payeeId] : payeeInfoById[emp.id];
        const limitsHolderId = limitsHolder.id;
        if (payeeId && payeeInfoById[payeeId]) {
          pay_type = 'self_employed_payee';
          payee_fio = payeeInfoById[payeeId].fio;
          payee_id  = payeeId;
        } else {
          pay_type = 'self_employed';
        }
        const lim = computeSeLimits({
          monthlyLimit,
          yearlyLimit,
          trYear: yearlyByEmp[limitsHolderId] || 0,
          trMonth: monthByEmp[limitsHolderId] || 0,
          yrInitial: limitsHolder.se_yearly_used_initial || 0,
          seMonthlyUsedInitial: limitsHolder.se_monthly_used_initial,
          yrHistory: yearlyHistoryByEmp[limitsHolderId] || 0,
          hasImportForMonth: !!monthlyImportMap[limitsHolderId],
          year,
          month,
          canExceedLimit: !!limitsHolder.can_exceed_limit,
          earned
        });
        transfer = lim.transfer;
        cash_return = 0;
        cash_payout = Math.max(0, earned - transfer);
        month_remaining_company += lim.monthly_remaining;
        year_remaining_company  += lim.yearly_remaining;
      } else if (emp.is_officially_employed) {
        // Stage U (20.06.2026): SSoT с timesheet-v2.js — бух vs директор.
        // deductSalary = nonBurnable > 0 ? nonBurnable : salary.
        // transfer = deduct; cash = max(0, earned − deduct). unpaid_leave → 0/0/0.
        pay_type = 'official';
        const nonBurnable = Number(emp.official_non_burnable || 0);
        const salary      = Number(emp.official_salary || 0);
        let deductSalary = 0;
        if (emp.official_status === 'unpaid_leave') {
          transfer = 0;
          cash_payout = 0;
        } else {
          deductSalary = nonBurnable > 0 ? nonBurnable : salary;
          transfer     = deductSalary;
          cash_payout  = Math.max(0, earned - deductSalary);
        }
        // mutate emp для Stage U-summary внизу.
        emp._deduct_official = deductSalary;
      } else {
        pay_type = 'cash';
        cash_payout = earned;
      }

      // Stage S: paid-поля per emp (для строки в таблице «Расчёт кассы»).
      // Stage W (баг #7): если рабочий имеет se_payee_id, СЗ-перевод мог быть
      // зарегистрирован на employee_id=payee. Если payee НЕ в emps — сумма
      // emp+payee показывается в строке рабочего. Если payee есть в emps —
      // у payee своя строка, поэтому в emp кладём только сам paid (без задвоения).
      const paidEmp   = paidByEmpCC[emp.id] || null;
      const payeeIdForPaidCC = payeeIdByEmp[emp.id];
      const payeeInEmps_item = payeeIdForPaidCC
        ? emps.some(x => Number(x.id) === Number(payeeIdForPaidCC))
        : false;
      const paidPayee = (payeeIdForPaidCC && !payeeInEmps_item)
        ? (paidByEmpCC[payeeIdForPaidCC] || null) : null;
      const sumPaidCC = (key) => Number(paidEmp?.[key] || 0) + Number(paidPayee?.[key] || 0);
      const paidCash     = sumPaidCC('paid_cash');
      const paidTransfer = sumPaidCC('paid_transfer');
      const paidTotal    = paidCash + paidTransfer;
      const paidBreakdown = {
        per_diem: sumPaidCC('paid_per_diem'),
        salary:   sumPaidCC('paid_salary'),
        advance:  sumPaidCC('paid_advance'),
        bonus:    sumPaidCC('paid_bonus')
      };

      // Рабочий без заработка и без операций не участвует в расчёте.
      // Stage S: ВКЛЮЧАЕМ если есть paid-выплаты — рабочему уже выдали в поле,
      // строка должна быть видна в «Расчёт кассы» (иначе бух не поймёт «куда
      // делись эти 70k из кассы»).
      if (earned <= 0 && transfer <= 0 && bonus <= 0 && penalty <= 0 && paidTotal <= 0) continue;

      // Q-4 / Q-3: payment_source_label — текстовая подпись «откуда платим».
      //   sync с timesheet-v2 (та же карта).
      let payment_source_label;
      if (pay_type === 'self_employed_payee') {
        payment_source_label = payee_fio ? `через ${payee_fio}` : 'через получателя';
      } else if (pay_type === 'self_employed') {
        payment_source_label = 'сам';
      } else if (pay_type === 'official') {
        payment_source_label = 'оклад';
      } else {
        payment_source_label = 'наличка';
      }

      items.push({ employee_id: emp.id, fio: emp.fio, pay_type,
                   // Q-4: расширенные поля для UI «Расчёт кассы».
                   city: emp.city || null,
                   payment_source_label,
                   payee_id, payee_fio,
                   earned, bonus, penalty,
                   transfer, cash_return, cash_payout,
                   // ── Stage U: deduct_official — что бух платит банком (для UI).
                   //   у не-оф = 0, у оф = deductSalary.
                   deduct_salary:   pay_type === 'official' ? Number(emp._deduct_official || 0) : 0,
                   deduct_official: pay_type === 'official' ? Number(emp._deduct_official || 0) : 0,
                   pay_responsibility: pay_type === 'official'
                     ? (Number(emp._deduct_official || 0) > 0 && cash_payout > 0 ? 'mixed'
                        : (Number(emp._deduct_official || 0) > 0 ? 'buh' : 'director'))
                     : undefined,
                   // ── Stage S: paid-агрегаты per item (нал + перевод + разбивка)
                   paid_cash:     paidCash,
                   paid_transfer: paidTransfer,
                   paid_total:    paidTotal,
                   paid_breakdown: paidBreakdown });
      totals.earned     += earned;
      totals.bonus      += bonus;
      totals.penalty    += penalty;
      totals.transfer   += transfer;
      totals.cash_return += cash_return;
      totals.cash_payout += cash_payout;
      // Stage S: paid-итоги.
      // Stage W (баг #7): сумма totals.paid_* считается ТОЛЬКО по самому emp,
      // чтобы payee, имеющий свою строку, не задвоился. В item.paid_* у emp
      // лежит сумма emp+payee для PER-EMP отображения — это OK.
      totals.paid_cash     += Number(paidEmp?.paid_cash     || 0);
      totals.paid_transfer += Number(paidEmp?.paid_transfer || 0);
      totals.paid_total    += Number(paidEmp?.paid_cash || 0) + Number(paidEmp?.paid_transfer || 0);
      // Если payee нет в emps (нет своих смен/выплат) — учтём его paid здесь
      // (один раз), чтобы totals не теряли «передачу через получателя».
      // (payeeInEmps_item уже определён выше: false если payee не в emps,
      //  paidPayee NULL если payee в emps — дополнительная страховка.)
      if (paidPayee && !payeeInEmps_item) {
        totals.paid_cash     += Number(paidPayee.paid_cash     || 0);
        totals.paid_transfer += Number(paidPayee.paid_transfer || 0);
        totals.paid_total    += Number(paidPayee.paid_cash || 0) + Number(paidPayee.paid_transfer || 0);
      }
    }
    totals.net_cash = totals.cash_return - totals.cash_payout;
    items.sort((a, b) => (a.fio || '').localeCompare(b.fio || '', 'ru'));
    const r2cc = (x) => Math.round(Number(x || 0) * 100) / 100;

    // ── Stage U (20.06.2026): официальный блок (бух vs директор) ──
    // SSoT с timesheet-v2.js summary и /summary.
    const officialEmpsCC = emps.filter(e => e.is_officially_employed);
    const totalOfficialToPayCC = officialEmpsCC.reduce(
      (s, e) => s + Number(e._deduct_official || 0), 0
    );
    let totalOfficialPaidCC = 0;
    if (officialEmpsCC.length > 0) {
      const { rows: bhPaidCC } = await db.query(`
        SELECT COALESCE(SUM(amount), 0)::numeric AS sum
        FROM worker_payments
        WHERE employee_id = ANY($1::int[])
          AND type = 'salary' AND status IN ('paid','confirmed')
          AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $2
          AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $3
      `, [officialEmpsCC.map(e => e.id), year, month]);
      totalOfficialPaidCC = Number(bhPaidCC[0]?.sum || 0);
    }

    return {
      year, month,
      monthly_limit: monthlyLimit,
      yearly_limit: yearlyLimit,
      // Q-4: общекомпанейские лимиты и остатки.
      se_count: seCount,
      total_monthly_capacity: seCount * monthlyLimit,
      total_yearly_capacity:  seCount * yearlyLimit,
      month_remaining_company: r2cc(month_remaining_company),
      year_remaining_company:  r2cc(year_remaining_company),
      // ── Stage S (20.06.2026): УЖЕ ВЫПЛАЧЕНО — top-level для удобства UI ──
      // Дублируем из totals чтобы фронт мог взять и оттуда (по аналогии с
      // /summary, где такие поля на верхнем уровне).
      total_paid_cash:              r2cc(totals.paid_cash),
      total_paid_transfer:          r2cc(totals.paid_transfer),
      total_paid_total:             r2cc(totals.paid_total),
      total_cash_needed_remaining:  r2cc(Math.max(0, totals.cash_payout - totals.paid_cash)),
      total_transfer_remaining:     r2cc(Math.max(0, totals.transfer    - totals.paid_transfer)),
      // ── Stage U (20.06.2026): официально устроены (бух vs директор) ──
      total_official_count:            officialEmpsCC.length,
      total_official_to_pay_by_buh:    r2cc(totalOfficialToPayCC),
      total_official_paid_by_buh:      r2cc(totalOfficialPaidCC),
      total_official_remaining_by_buh: r2cc(Math.max(0, totalOfficialToPayCC - totalOfficialPaidCC)),
      items, totals
    };
  });

  // ─── GET /pm-balance — баланс всех РП ────────────────────────────────────
  // Единый источник правды: src/lib/pm-balance.js (calcAllPmBalances).
  //
  // Формула (см. подробности в lib/pm-balance.js):
  //   balance = handovers_received                            (V243 СЗ-передачи)
  //           + se_cash_legacy                                (se_transfers без handover — backwards-compat)
  //           + cash_advances_issued                          (cash_requests money_issued/received/reporting)
  //           − cash_expenses
  //           − cash_returns_confirmed
  //           − cash_payouts_workers                          (worker_payments cash/card, PM выдал)
  //
  // Backwards-compat: поля cash_in, se_cash_in, cash_out_* сохранены для старых фронтов.
  fastify.get('/pm-balance', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    try {
      const balances = await calcAllPmBalances(db);
      const pms = balances.map(b => ({
        pm_id:                   b.pm_id,
        pm_name:                 b.pm_name,
        holder_role:             b.holder_role || null,
        // canonical (новые) поля
        handovers_received:      b.handovers_received,
        se_cash_legacy:          b.se_cash_legacy,
        cash_advances_issued:    b.cash_advances_issued,
        cash_expenses:           b.cash_expenses,
        cash_returns_confirmed:  b.cash_returns_confirmed,
        cash_payouts_workers:    b.cash_payouts_workers,
        handovers_pending_count: b.handovers_pending_count,
        handovers_pending_sum:   b.handovers_pending_sum,
        balance:                 b.balance,
        work_expenses_direct:    b.work_expenses_direct,
        // backwards-compat (фронт читает эти имена)
        cash_in:                 b.cash_advances_issued,
        se_cash_in:              b.se_cash_legacy + b.handovers_received, // суммарный приход от СЗ
        cash_out_expenses:       b.cash_expenses,
        cash_out_returns:        b.cash_returns_confirmed,
        cash_out_salaries:       b.cash_payouts_workers,
        // единый отток (расходы подотчёт + выплаты рабочим + прямые расходы РП);
        // возвраты в кассу — ОТДЕЛЬНО (иначе двойной счёт). Симметрично формуле balance.
        cash_out:                b.cash_expenses + b.cash_payouts_workers + b.work_expenses_direct,
        cash_returned:           b.cash_returns_confirmed
      }));
      return { pms };
    } catch (e) {
      fastify.log.warn('[pm-balance] fallback: ' + e.message);
      // Простой фолбэк если что-то совсем сломалось.
      const { rows: pms } = await db.query(`
        SELECT id AS pm_id, name AS pm_name, 0 AS cash_in, 0 AS se_cash_in,
               0 AS cash_out_expenses, 0 AS cash_out_returns, 0 AS cash_out_salaries,
               0 AS handovers_received, 0 AS handovers_pending_count, 0 AS handovers_pending_sum,
               0 AS balance
        FROM users WHERE role IN ('PM','HEAD_PM','HEAD_TO') AND COALESCE(is_active, true) = true
        ORDER BY name
      `);
      return { pms, note: 'pm-balance fallback: ' + e.message };
    }
  });

  // ─── GET /pm-balance/:pm_id — детализация ─────────────────────────────────
  // Плоская структура: фронт (pm_balance.js renderDetail) читает поля верхнего
  // уровня (data.cash_requests, data.se_returns, data.worker_payments,
  // data.cash_expenses, data.cash_returns) + summary (balance, pm_name, cash_in,
  // se_cash_in, cash_out, cash_returned, handovers_pending_*).
  // JOIN'ы зеркалят SSoT src/lib/pm-balance.js (иначе детали не сходятся с балансом).
  fastify.get('/pm-balance/:pm_id', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request) => {
    const pmId = parseInt(request.params.pm_id, 10);
    if (!Number.isFinite(pmId)) return { error: 'Bad pm id' };

    // Summary из единой формулы (тот же источник, что список).
    const b = await calcPmBalance(db, pmId);
    const out = {
      pm_id:         pmId,
      cash_in:       b.cash_advances_issued,
      se_cash_in:    b.se_cash_legacy + b.handovers_received,
      cash_out:      b.cash_expenses + b.cash_payouts_workers + b.work_expenses_direct,
      cash_returned: b.cash_returns_confirmed,
      balance:       b.balance,
      // секции (плоско, как читает фронт)
      cash_requests: [], se_returns: [], handovers: [], worker_payments: [], cash_expenses: [], cash_returns: []
    };

    try {
      const { rows } = await db.query(`SELECT id, name FROM users WHERE id = $1`, [pmId]);
      out.pm_name = rows[0] ? rows[0].name : `РП #${pmId}`;
    } catch (_) { out.pm_name = `РП #${pmId}`; }

    // handovers_pending (ожидают передачи от рабочих)
    try {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(expected_amount),0)::numeric AS sum
         FROM worker_to_pm_handovers WHERE pm_user_id = $1 AND status = 'pending'`, [pmId]);
      out.handovers_pending_count = rows[0] ? parseInt(rows[0].cnt, 10) : 0;
      out.handovers_pending_sum   = rows[0] ? Number(rows[0].sum) : 0;
    } catch (_) {}

    // 💵 Получено из кассы — cash_requests (фронт: created_at, amount, purpose, status)
    try {
      const { rows } = await db.query(
        `SELECT id, amount, purpose, status, created_at
         FROM cash_requests
         WHERE user_id = $1 AND status IN ('money_issued','received','reporting','closed')
         ORDER BY created_at DESC LIMIT 200`, [pmId]);
      out.cash_requests = rows;
    } catch (_) {}

    // 🔄 От самозанятых — se_transfers legacy (без handover), фронт: returned_at, cash_return_amount, employee_name, comment
    try {
      const { rows } = await db.query(
        `SELECT st.id, st.returned_at, st.cash_return_amount, st.comment,
                COALESCE(e.fio, e.full_name) AS employee_name
         FROM se_transfers st
         LEFT JOIN worker_to_pm_handovers h ON h.source_se_transfer_id = st.id
         LEFT JOIN employees e ON e.id = st.employee_id
         WHERE st.pm_user_id = $1 AND st.status IN ('completed','returned') AND h.id IS NULL
         ORDER BY st.returned_at DESC NULLS LAST, st.id DESC LIMIT 200`, [pmId]);
      out.se_returns = rows;
    } catch (_) {}

    // 📥 Передачи от рабочих — worker_to_pm_handovers (V243, приход нала РП от рабочих).
    // Это раскрытие карточки «От самозанятых» (handovers_received часть se_cash_in).
    // Фильтр зеркалит SSoT: status IN ('received','partial').
    try {
      const { rows } = await db.query(
        `SELECT h.id, h.received_amount AS amount, h.received_at, h.note,
                COALESCE(e.fio, e.full_name) AS employee_name
         FROM worker_to_pm_handovers h
         LEFT JOIN employees e ON e.id = h.worker_id
         WHERE h.pm_user_id = $1 AND h.status IN ('received','partial')
         ORDER BY h.received_at DESC NULLS LAST, h.id DESC LIMIT 200`, [pmId]);
      out.handovers = rows;
    } catch (_) {}

    // 💳 Выплаты наличкой — worker_payments (фронт: created_at, amount, employee_name, type)
    try {
      const { rows } = await db.query(
        `SELECT wp.id, wp.amount, wp.type, wp.created_at,
                COALESCE(e.fio, e.full_name) AS employee_name
         FROM worker_payments wp
         LEFT JOIN works w ON w.id = wp.work_id
         LEFT JOIN employees e ON e.id = wp.employee_id
         WHERE wp.status IN ('paid','confirmed')
           AND wp.type IN ('salary','bonus','per_diem','advance','penalty')
           AND (wp.paid_by = $1 OR (wp.paid_by IS NULL AND w.pm_id = $1 AND wp.payment_method IN ('cash','card')))
         ORDER BY wp.created_at DESC LIMIT 200`, [pmId]);
      out.worker_payments = rows;
    } catch (_) {}

    // 🧾 Расходы — cash_expenses (чеки по подотчёту) + work_expenses_direct (прямые наличные)
    try {
      const { rows: podotchet } = await db.query(
        `SELECT ce.id, ce.amount, ce.description, ce.created_at
         FROM cash_expenses ce JOIN cash_requests cr ON cr.id = ce.request_id
         WHERE cr.user_id = $1`, [pmId]);
      const { rows: direct } = await db.query(
        `SELECT we.id, we.amount, COALESCE(we.description, we.category) AS description, we.created_at
         FROM work_expenses we LEFT JOIN works w ON w.id = we.work_id
         WHERE COALESCE(we.source_table,'') NOT IN ('worker_payments')
           AND ((we.paid_by = $1 AND we.payment_method IN ('cash','card','transfer'))
             OR (we.paid_by IS NULL AND w.pm_id = $1 AND we.payment_method IN ('cash','card')))`, [pmId]);
      out.cash_expenses = podotchet.concat(direct)
        .sort((a, z) => new Date(z.created_at) - new Date(a.created_at)).slice(0, 300);
    } catch (_) {}

    // ↩️ Возвраты в кассу — cash_returns confirmed (фронт: created_at, amount, comment)
    try {
      const { rows } = await db.query(
        `SELECT crt.id, crt.amount, crt.note AS comment, crt.created_at
         FROM cash_returns crt JOIN cash_requests cr ON cr.id = crt.request_id
         WHERE cr.user_id = $1 AND crt.confirmed_at IS NOT NULL
         ORDER BY crt.created_at DESC LIMIT 200`, [pmId]);
      out.cash_returns = rows;
    } catch (_) {}

    return out;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // V264: разделение выплат по ИСТОЧНИКАМ ДЕНЕГ
  // (касса РП / банк компании / СЗ-сервис / Авто-ФОТ)
  // SSoT: migrations/V264__worker_payment_source_view.sql + src/lib/pm-balance.js
  // ═══════════════════════════════════════════════════════════════════════════

  const SOURCE_KINDS = ['pm_cash', 'pm_cash_legacy', 'company_bank', 'company_se', 'auto_fot', 'other'];
  const ALL_ACCESS_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

  function isPmRole(role) {
    return role === 'PM' || role === 'HEAD_PM';
  }
  function isFullAccess(role) {
    return ALL_ACCESS_ROLES.includes(role);
  }

  // ─── GET /worker/:id/breakdown ─────────────────────────────────────────────
  // Возвращает разбивку начислений/выплат конкретного работника по источникам.
  // Доступ: PM/HEAD_PM (только свои строки), ADMIN/DIRECTOR_*/BUH (все).
  //
  // Query:
  //   work_id (optional) — фильтр по работе
  //   from   (optional)  — YYYY-MM-DD; default = без нижней границы
  //   to     (optional)  — YYYY-MM-DD; default = без верхней границы
  //   pm_id  (optional)  — фильтр по PM (для full-access ролей; PM игнорируют)
  fastify.get('/worker/:id/breakdown', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const role = request.user.role;
    const userId = parseInt(request.user.id, 10);
    if (!isPmRole(role) && !isFullAccess(role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const empId = parseInt(request.params.id, 10);
    if (!Number.isFinite(empId)) {
      return reply.code(400).send({ error: 'Bad employee id' });
    }

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const workId = request.query.work_id ? parseInt(request.query.work_id, 10) : null;
    const from = (request.query.from && dateRe.test(request.query.from)) ? request.query.from : null;
    const to   = (request.query.to   && dateRe.test(request.query.to))   ? request.query.to   : null;
    // pm_id фильтр: PM/HEAD_PM ВСЕГДА фильтруют по себе; full-access — по query
    let pmFilter = null;
    if (isPmRole(role)) {
      pmFilter = userId;
    } else if (request.query.pm_id) {
      const q = parseInt(request.query.pm_id, 10);
      if (Number.isFinite(q)) pmFilter = q;
    }

    // ── 1) Сведения о работнике
    let employee = null;
    try {
      const { rows } = await db.query(
        `SELECT id, fio, is_officially_employed, is_self_employed
         FROM employees WHERE id = $1`,
        [empId]
      );
      if (!rows[0]) {
        return reply.code(404).send({ error: 'Работник не найден' });
      }
      employee = rows[0];
    } catch (e) {
      fastify.log.error({ err: e }, '[breakdown] employee lookup');
      return reply.code(500).send({ error: 'Не удалось получить работника', detail: e.message });
    }

    // ── 2) Сведения о работе (если задана)
    let workInfo = { id: workId, title: null, pm_id: null, pm_name: null };
    if (workId != null && Number.isFinite(workId)) {
      try {
        const { rows } = await db.query(
          `SELECT w.id, w.work_title, w.pm_id, u.name AS pm_name
           FROM works w LEFT JOIN users u ON u.id = w.pm_id
           WHERE w.id = $1`,
          [workId]
        );
        if (rows[0]) {
          workInfo.title = rows[0].work_title;
          workInfo.pm_id = rows[0].pm_id;
          workInfo.pm_name = rows[0].pm_name;
        }
      } catch (_) {}
    }

    // RBAC для PM: разрешаем только если работа принадлежит PM или paid_by=PM
    // существует хотя бы по одной строке. Реализуем через WHERE-фильтр в SQL.

    // ── 3) Строим WHERE
    const params = [empId];
    const where = ['v.employee_id = $1'];
    if (workId != null && Number.isFinite(workId)) {
      params.push(workId);
      where.push(`v.work_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      where.push(`COALESCE(v.paid_at, v.created_at)::date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`COALESCE(v.paid_at, v.created_at)::date <= $${params.length}`);
    }
    // PM/HEAD_PM видит только: свои выплаты (paid_by=user) ИЛИ свои работы (work.pm_id=user).
    // Full-access роли могут фильтровать через pm_id (по тому же критерию).
    if (pmFilter != null) {
      params.push(pmFilter);
      where.push(`(v.paid_by = $${params.length} OR w.pm_id = $${params.length})`);
    }

    // ── 4) Запрос
    let rows = [];
    try {
      const sql = `
        SELECT
          v.id, v.amount, v.type, v.status, v.payment_method, v.paid_by,
          v.work_id, v.comment, v.created_at, v.paid_at,
          v.source_kind, v.is_from_pm_cash,
          w.work_title,
          w.pm_id AS work_pm_id,
          uw.name AS work_pm_name,
          ub.name AS paid_by_name
        FROM worker_payment_source_v v
        LEFT JOIN works w ON w.id = v.work_id
        LEFT JOIN users uw ON uw.id = w.pm_id
        LEFT JOIN users ub ON ub.id = v.paid_by
        WHERE ${where.join(' AND ')}
          AND v.status IN ('paid', 'confirmed')
        ORDER BY COALESCE(v.paid_at, v.created_at) ASC, v.id ASC
      `;
      const r = await db.query(sql, params);
      rows = r.rows;
    } catch (e) {
      fastify.log.error({ err: e }, '[breakdown] query');
      return reply.code(500).send({ error: 'Не удалось получить данные', detail: e.message });
    }

    // ── 5) Считаем agg
    const accrued = { salary: 0, bonus: 0, per_diem: 0, advance: 0, penalty: 0, total: 0 };
    const paid = {};
    for (const k of SOURCE_KINDS) paid[k] = 0;
    paid.total = 0;
    let pmKassaImpact = 0;

    const operations = rows.map(r => {
      const amt = Number(r.amount) || 0;
      // accrued по типу (penalty уменьшает total)
      if (r.type === 'salary')   accrued.salary   += amt;
      else if (r.type === 'bonus')    accrued.bonus    += amt;
      else if (r.type === 'per_diem') accrued.per_diem += amt;
      else if (r.type === 'advance')  accrued.advance  += amt;
      else if (r.type === 'penalty')  accrued.penalty  += amt;

      // paid по source_kind (penalty тоже идёт как выплата = удержание из ФОТ
      // фактически забрано из кассы РП; считаем модуль)
      const sk = r.source_kind || 'other';
      const bucket = SOURCE_KINDS.includes(sk) ? sk : 'other';
      paid[bucket] += amt;
      paid.total   += amt;
      if (r.is_from_pm_cash) pmKassaImpact += amt;

      // ISO date
      let dateIso = null;
      const d = r.paid_at || r.created_at;
      if (d instanceof Date) {
        const yy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        dateIso = `${yy}-${mm}-${dd}`;
      } else if (typeof d === 'string') {
        dateIso = d.slice(0, 10);
      }

      return {
        id: r.id,
        date: dateIso,
        type: r.type,
        amount: amt,
        payment_method: r.payment_method,
        paid_by: r.paid_by == null ? null : Number(r.paid_by),
        paid_by_name: r.paid_by_name || (r.payment_method === 'bank' ? 'Бухгалтерия' :
                                          r.payment_method === 'self' ? 'СЗ-сервис' :
                                          r.payment_method === 'auto' ? 'Авто-ФОТ' : null),
        source_kind: sk,
        is_from_pm_cash: !!r.is_from_pm_cash,
        comment: r.comment || null,
        work_id: r.work_id == null ? null : Number(r.work_id),
        work_title: r.work_title || null
      };
    });

    accrued.total = accrued.salary + accrued.bonus + accrued.per_diem + accrued.advance - accrued.penalty;
    const balance = accrued.total - paid.total;

    return {
      employee_id: employee.id,
      employee_fio: employee.fio,
      is_officially_employed: !!employee.is_officially_employed,
      is_self_employed: !!employee.is_self_employed,
      period: { from, to },
      work_id: workInfo.id,
      work_title: workInfo.title,
      pm_id: pmFilter != null ? pmFilter : workInfo.pm_id,
      pm_name: workInfo.pm_name,
      accrued,
      paid,
      balance,
      pm_kassa_impact: -pmKassaImpact, // отрицательное число — сколько ушло из кассы РП
      operations
    };
  });

  // ─── GET /payouts-by-source ────────────────────────────────────────────────
  // Агрегаты выплат по источникам для дашборда payroll.
  // Возвращает summary (по источникам) + workers (помесячный/попериодный список).
  fastify.get('/payouts-by-source', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const role = request.user.role;
    const userId = parseInt(request.user.id, 10);
    if (!isPmRole(role) && !isFullAccess(role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const workId = request.query.work_id ? parseInt(request.query.work_id, 10) : null;
    const from = (request.query.from && dateRe.test(request.query.from)) ? request.query.from : null;
    const to   = (request.query.to   && dateRe.test(request.query.to))   ? request.query.to   : null;

    let pmFilter = null;
    if (isPmRole(role)) {
      pmFilter = userId;
    } else if (request.query.pm_id) {
      const q = parseInt(request.query.pm_id, 10);
      if (Number.isFinite(q)) pmFilter = q;
    }

    // ── WHERE
    const params = [];
    const where = [`v.status IN ('paid', 'confirmed')`];
    if (workId != null && Number.isFinite(workId)) {
      params.push(workId);
      where.push(`v.work_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      where.push(`COALESCE(v.paid_at, v.created_at)::date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`COALESCE(v.paid_at, v.created_at)::date <= $${params.length}`);
    }
    if (pmFilter != null) {
      params.push(pmFilter);
      where.push(`(v.paid_by = $${params.length} OR w.pm_id = $${params.length})`);
    }

    let rows = [];
    try {
      const sql = `
        SELECT
          v.employee_id,
          e.fio,
          e.is_officially_employed,
          e.is_self_employed,
          v.type,
          v.amount,
          v.source_kind,
          v.is_from_pm_cash
        FROM worker_payment_source_v v
        LEFT JOIN employees e ON e.id = v.employee_id
        LEFT JOIN works w ON w.id = v.work_id
        WHERE ${where.join(' AND ')}
      `;
      const r = await db.query(sql, params);
      rows = r.rows;
    } catch (e) {
      fastify.log.error({ err: e }, '[payouts-by-source] query');
      return reply.code(500).send({ error: 'Не удалось получить данные', detail: e.message });
    }

    // ── summary aggregate
    const summary = {
      pm_cash:      { amount: 0, count: 0 },
      company_bank: { amount: 0, count: 0 },
      company_se:   { amount: 0, count: 0 },
      auto_fot:     { amount: 0, count: 0 },
      pm_cash_legacy: { amount: 0, count: 0 },
      other:        { amount: 0, count: 0 },
      total: 0
    };

    // ── workers aggregate
    const workerMap = new Map();
    for (const r of rows) {
      const amt = Number(r.amount) || 0;
      const sk = r.source_kind || 'other';
      if (summary[sk]) {
        summary[sk].amount += amt;
        summary[sk].count += 1;
      } else {
        summary.other.amount += amt;
        summary.other.count += 1;
      }
      summary.total += amt;

      const eid = r.employee_id;
      if (eid == null) continue;
      let w = workerMap.get(eid);
      if (!w) {
        w = {
          employee_id: eid,
          fio: r.fio || `#${eid}`,
          is_officially_employed: !!r.is_officially_employed,
          is_self_employed: !!r.is_self_employed,
          accrued_total: 0,
          by_source: { pm_cash: 0, pm_cash_legacy: 0, company_bank: 0, company_se: 0, auto_fot: 0, other: 0 },
          to_pay_remainder: 0
        };
        workerMap.set(eid, w);
      }
      // accrued_total: salary+bonus+per_diem+advance минус penalty
      if (r.type === 'penalty') w.accrued_total -= amt;
      else w.accrued_total += amt;
      // by_source: paid (penalty считается со знаком +, как «удержание из кассы»)
      if (w.by_source[sk] != null) w.by_source[sk] += amt;
      else w.by_source.other += amt;
    }
    for (const w of workerMap.values()) {
      const totalPaid = Object.values(w.by_source).reduce((s, v) => s + v, 0);
      w.to_pay_remainder = w.accrued_total - totalPaid;
    }
    const workers = [...workerMap.values()].sort((a, b) => b.accrued_total - a.accrued_total);

    return { summary, workers };
  });
}

module.exports = routes;
