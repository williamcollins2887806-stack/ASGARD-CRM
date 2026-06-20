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
 *   POST   /se-transfers                             — создать операцию
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

const { getCashBalance } = require('../services/approvalService');

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
             se_payee_id
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

    // Загрузим инфо payee'ев (can_exceed_limit, fio) — для тех, кто не в emps.
    const payeeInfoById = {};
    const payeesToLoad = Array.from(payeeIdsSet).filter(pid => !emps.find(e => e.id === pid));
    if (payeesToLoad.length > 0) {
      const { rows: pRows } = await db.query(`
        SELECT id, COALESCE(fio, full_name) AS fio, COALESCE(can_exceed_limit, false) AS can_exceed_limit
          FROM employees WHERE id = ANY($1::int[])
      `, [payeesToLoad]);
      for (const r of pRows) payeeInfoById[r.id] = { id: r.id, fio: r.fio, can_exceed_limit: !!r.can_exceed_limit };
    }
    for (const e of emps) {
      if (payeeIdsSet.has(e.id)) {
        payeeInfoById[e.id] = { id: e.id, fio: e.fio, can_exceed_limit: !!e.can_exceed_limit };
      }
    }

    const { rows: yearlySum } = await db.query(`
      SELECT employee_id, COALESCE(SUM(transfer_amount), 0) AS yr_sum
      FROM se_transfers
      WHERE employee_id = ANY($1::int[]) AND year = $2 AND status != 'cancelled'
      GROUP BY employee_id
    `, [limitsIds, year]);
    const yearlyByEmp = {};
    for (const r of yearlySum) yearlyByEmp[r.employee_id] = Number(r.yr_sum || 0);

    // Q-4 (19.06.2026): SUM месячных снимков из se_monthly_history за год.
    // Накопительный годовой расход НПД-лимита: история Excel-импортов + переводы.
    // Без этого «прошлые месяцы» забывались между импортами.
    const yearlyHistoryByEmp = {};
    try {
      const { rows: hRows } = await db.query(`
        SELECT employee_id, COALESCE(SUM(monthly_used), 0) AS year_history_used
        FROM se_monthly_history
        WHERE employee_id = ANY($1::int[]) AND year = $2
        GROUP BY employee_id
      `, [limitsIds, year]);
      for (const r of hRows) yearlyHistoryByEmp[r.employee_id] = Number(r.year_history_used) || 0;
    } catch (_) { /* таблица отсутствует — оставляем 0 */ }

    // B2 (19.06.2026): добавлен SELECT уже-переведённого за этот месяц по СЗ.
    // Раньше transfer = monthlyLimit (фиксированное), без учёта что часть уже
    // переведена → дублировали суммы и превышали месячный лимит на UI.
    // Контракт TIMESHEET_V2_CONTRACT_PHASE1.md: формула как в timesheet-v2.js.
    const { rows: monthlySum } = await db.query(`
      SELECT employee_id, COALESCE(SUM(transfer_amount), 0) AS m_sum
      FROM se_transfers
      WHERE employee_id = ANY($1::int[]) AND year = $2 AND month = $3 AND status != 'cancelled'
      GROUP BY employee_id
    `, [limitsIds, year, month]);
    const monthByEmp = {};
    for (const r of monthlySum) monthByEmp[r.employee_id] = Number(r.m_sum || 0);

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
        const limitsHolder = (payeeId && payeeInfoById[payeeId]) ? payeeInfoById[payeeId] : emp;
        const limitsHolderId = limitsHolder.id;
        // B2: формула как в timesheet-v2.js (контракт PHASE1).
        // transfer = min(earned, moRem, yrRem), где moRem учитывает уже-переведённое.
        // can_exceed_limit снимает месячный потолок, но НЕ годовой.
        const moTransferred = monthByEmp[limitsHolderId] || 0;
        let moRem = Math.max(0, monthlyLimit - moTransferred);
        if (limitsHolder.can_exceed_limit) moRem = Math.max(moRem, earned);
        // Q-4: yrUsed = переводы + история месячных импортов.
        const yrUsed = (yearlyByEmp[limitsHolderId] || 0) + (yearlyHistoryByEmp[limitsHolderId] || 0);
        const yrRem = Math.max(0, yearlyLimit - yrUsed);
        const transfer = Math.max(0, Math.min(earned, moRem, yrRem));
        const cashReturn = 0;  // Phase 1: cash_return всегда 0
        const cashPayout = Math.max(0, earned - transfer);
        total_transfer    += transfer;
        total_cash_return += cashReturn;
        total_cash_needed += cashPayout;
        // Q-4: накапливаем общекомпанейские остатки. moRem без can_exceed_buff
        // (для остатка показываем «честный» лимит, как в timesheet-v2 monthly_remaining).
        const moRemHonest = Math.max(0, monthlyLimit - moTransferred);
        month_remaining_company += moRemHonest;
        year_remaining_company  += yrRem;
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
        COALESCE(SUM(t.transfer_amount) FILTER (WHERE t.status != 'cancelled'), 0) AS transferred_year
      FROM employees e
      LEFT JOIN se_transfers t ON t.employee_id = e.id AND t.year = $1
      WHERE e.is_self_employed = true AND e.is_active = true
      GROUP BY e.id, e.fio
      ORDER BY transferred_year DESC, e.fio
    `, [year]);
    return {
      year,
      yearly_limit: yearlyLimit,
      employees: rows.map(r => ({
        ...r,
        transferred_year: Number(r.transferred_year || 0),
        remaining: yearlyLimit - Number(r.transferred_year || 0),
      })),
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
    const { employee_id, year, month, operation_type, transfer_amount, earned_amount, work_id, comment } = request.body || {};
    if (!employee_id || !year || !month || !operation_type) {
      return reply.code(400).send({ error: 'employee_id, year, month, operation_type обязательны' });
    }
    if (!['work_transfer', 'agreement_transfer'].includes(operation_type)) {
      return reply.code(400).send({ error: 'Недопустимый operation_type' });
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

    // Годовой лимит
    const yearlyLimit = await getSettingNumber(db, 'self_employed_yearly_limit', 2400000);
    const { rows: [sum] } = await db.query(`
      SELECT COALESCE(SUM(transfer_amount), 0) AS yr_sum
      FROM se_transfers WHERE employee_id = $1 AND year = $2 AND status != 'cancelled'
    `, [employee_id, year]);
    const yrSum = Number(sum.yr_sum || 0);
    const remaining = Math.max(0, yearlyLimit - yrSum);
    const transferNum = Number(transfer_amount);
    if (transferNum + yrSum > yearlyLimit) {
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
         status, comment, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'planned', $12, $13)
      RETURNING *
    `, [employee_id, year, month, operation_type, earnedNum, transferNum,
        cashReturn, cashPayout, work_id || null, pmUserId, se.inn,
        comment || null, request.user.id]);

    return { transfer: created };
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
    const { rows: [t] } = await db.query('SELECT status FROM se_transfers WHERE id = $1', [id]);
    if (!t) return reply.code(404).send({ error: 'Операция не найдена' });
    if (t.status !== 'transferred') return reply.code(409).send({ error: 'Можно только из transferred' });

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
             city
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

    const payeeInfoById = {};
    const payeesToLoad = Array.from(payeeIdsSet).filter(pid => !emps.find(e => e.id === pid));
    if (payeesToLoad.length > 0) {
      const { rows: pRows } = await db.query(`
        SELECT id, COALESCE(fio, full_name) AS fio, COALESCE(can_exceed_limit, false) AS can_exceed_limit
          FROM employees WHERE id = ANY($1::int[])
      `, [payeesToLoad]);
      for (const r of pRows) payeeInfoById[r.id] = { id: r.id, fio: r.fio, can_exceed_limit: !!r.can_exceed_limit };
    }
    for (const e of emps) {
      if (payeeIdsSet.has(e.id)) {
        payeeInfoById[e.id] = { id: e.id, fio: e.fio, can_exceed_limit: !!e.can_exceed_limit };
      }
    }

    const { rows: yearlySum } = await db.query(`
      SELECT employee_id, COALESCE(SUM(transfer_amount), 0) AS yr_sum
      FROM se_transfers
      WHERE employee_id = ANY($1::int[]) AND year = $2 AND status != 'cancelled'
      GROUP BY employee_id
    `, [limitsIds, year]);
    const yearlyByEmp = {};
    for (const r of yearlySum) yearlyByEmp[r.employee_id] = Number(r.yr_sum || 0);

    // Q-4 (19.06.2026): SUM месячных снимков из se_monthly_history за год.
    // Накопительный годовой расход НПД-лимита: история Excel-импортов + переводы.
    const yearlyHistoryByEmp = {};
    try {
      const { rows: hRows } = await db.query(`
        SELECT employee_id, COALESCE(SUM(monthly_used), 0) AS year_history_used
        FROM se_monthly_history
        WHERE employee_id = ANY($1::int[]) AND year = $2
        GROUP BY employee_id
      `, [limitsIds, year]);
      for (const r of hRows) yearlyHistoryByEmp[r.employee_id] = Number(r.year_history_used) || 0;
    } catch (_) { /* таблица отсутствует — оставляем 0 */ }

    // B2 (19.06.2026): monthByEmp — уже-переведённое за этот месяц.
    // Без этого SELECT transfer = monthlyLimit (фиксированное) дублировал суммы.
    const { rows: monthlySum } = await db.query(`
      SELECT employee_id, COALESCE(SUM(transfer_amount), 0) AS m_sum
      FROM se_transfers
      WHERE employee_id = ANY($1::int[]) AND year = $2 AND month = $3 AND status != 'cancelled'
      GROUP BY employee_id
    `, [limitsIds, year, month]);
    const monthByEmp = {};
    for (const r of monthlySum) monthByEmp[r.employee_id] = Number(r.m_sum || 0);

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
        const limitsHolder = (payeeId && payeeInfoById[payeeId]) ? payeeInfoById[payeeId] : emp;
        const limitsHolderId = limitsHolder.id;
        if (payeeId && payeeInfoById[payeeId]) {
          pay_type = 'self_employed_payee';
          payee_fio = payeeInfoById[payeeId].fio;
          payee_id  = payeeId;
        } else {
          pay_type = 'self_employed';
        }
        // B2: формула как в timesheet-v2.js (контракт PHASE1).
        // transfer = min(earned, moRem, yrRem), где moRem учитывает уже-переведённое.
        const moTransferred = monthByEmp[limitsHolderId] || 0;
        let moRem = Math.max(0, monthlyLimit - moTransferred);
        if (limitsHolder.can_exceed_limit) moRem = Math.max(moRem, earned);
        // Q-4: yrUsed = переводы + история месячных импортов.
        const yrUsed = (yearlyByEmp[limitsHolderId] || 0) + (yearlyHistoryByEmp[limitsHolderId] || 0);
        const yrRem = Math.max(0, yearlyLimit - yrUsed);
        transfer = Math.max(0, Math.min(earned, moRem, yrRem));
        cash_return = 0;  // Phase 1: cash_return всегда 0
        cash_payout = Math.max(0, earned - transfer);
        // Q-4: «честный» месячный остаток без can_exceed_buff.
        const moRemHonest = Math.max(0, monthlyLimit - moTransferred);
        month_remaining_company += moRemHonest;
        year_remaining_company  += yrRem;
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
  // Stage W: добавлены handovers_received / handovers_pending (передачи от
  // рабочих к РП — нал, который рабочий должен отдать РП после СЗ-перевода).
  // Формула баланса: cash_in + se_cash + handovers_received − cash_exp − cash_ret − sal_cash.
  fastify.get('/pm-balance', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    try {
      const { rows } = await db.query(`
        WITH pms AS (
          SELECT id, name FROM users WHERE role IN ('PM','HEAD_PM') AND COALESCE(is_active, true) = true
        ),
        cash_in AS (
          SELECT user_id, COALESCE(SUM(amount), 0) AS amt
          FROM cash_requests
          WHERE status IN ('received','reporting')
          GROUP BY user_id
        ),
        se_cash AS (
          SELECT pm_user_id AS user_id, COALESCE(SUM(cash_return_amount), 0) AS amt
          FROM se_transfers
          WHERE status IN ('completed','returned')
          GROUP BY pm_user_id
        ),
        cash_exp AS (
          SELECT cr.user_id, COALESCE(SUM(ce.amount), 0) AS amt
          FROM cash_expenses ce
          JOIN cash_requests cr ON cr.id = ce.request_id
          GROUP BY cr.user_id
        ),
        cash_ret AS (
          SELECT cr.user_id, COALESCE(SUM(crt.amount), 0) AS amt
          FROM cash_returns crt
          JOIN cash_requests cr ON cr.id = crt.request_id
          WHERE crt.confirmed_at IS NOT NULL
          GROUP BY cr.user_id
        ),
        sal_cash AS (
          SELECT w.pm_id AS user_id, COALESCE(SUM(wp.amount), 0) AS amt
          FROM worker_payments wp
          JOIN works w ON w.id = wp.work_id
          WHERE wp.payment_method = 'cash' AND wp.status = 'paid'
          GROUP BY w.pm_id
        ),
        handovers_received AS (
          SELECT pm_user_id, COALESCE(SUM(received_amount), 0) AS amt
          FROM worker_to_pm_handovers
          WHERE status IN ('received','partial')
          GROUP BY pm_user_id
        ),
        handovers_pending AS (
          SELECT pm_user_id,
                 COUNT(*)::int AS cnt,
                 COALESCE(SUM(expected_amount), 0) AS sum_expected
          FROM worker_to_pm_handovers
          WHERE status = 'pending'
          GROUP BY pm_user_id
        )
        SELECT
          p.id AS pm_id, p.name AS pm_name,
          COALESCE(ci.amt, 0)  AS cash_in,
          COALESCE(sc.amt, 0)  AS se_cash_in,
          COALESCE(ce.amt, 0)  AS cash_out_expenses,
          COALESCE(cr.amt, 0)  AS cash_out_returns,
          COALESCE(sl.amt, 0)  AS cash_out_salaries,
          COALESCE(hr.amt, 0)  AS handovers_received,
          COALESCE(hp.cnt, 0)  AS handovers_pending_count,
          COALESCE(hp.sum_expected, 0) AS handovers_pending_sum,
          (COALESCE(ci.amt,0) + COALESCE(sc.amt,0) + COALESCE(hr.amt,0)
           - COALESCE(ce.amt,0) - COALESCE(cr.amt,0) - COALESCE(sl.amt,0)) AS balance
        FROM pms p
        LEFT JOIN cash_in            ci ON ci.user_id = p.id
        LEFT JOIN se_cash            sc ON sc.user_id = p.id
        LEFT JOIN cash_exp           ce ON ce.user_id = p.id
        LEFT JOIN cash_ret           cr ON cr.user_id = p.id
        LEFT JOIN sal_cash           sl ON sl.user_id = p.id
        LEFT JOIN handovers_received hr ON hr.pm_user_id = p.id
        LEFT JOIN handovers_pending  hp ON hp.pm_user_id = p.id
        ORDER BY p.name
      `);
      return { pms: rows };
    } catch (e) {
      fastify.log.warn('[pm-balance] fallback: ' + e.message);
      // Простой фолбэк: только PM-список без cash-таблиц (например, если
      // worker_to_pm_handovers ещё не существует на свежей БД).
      const { rows: pms } = await db.query(`
        SELECT id AS pm_id, name AS pm_name, 0 AS cash_in, 0 AS se_cash_in,
               0 AS cash_out_expenses, 0 AS cash_out_returns, 0 AS cash_out_salaries,
               0 AS handovers_received, 0 AS handovers_pending_count, 0 AS handovers_pending_sum,
               0 AS balance
        FROM users WHERE role IN ('PM','HEAD_PM') AND COALESCE(is_active, true) = true
        ORDER BY name
      `);
      return { pms, note: 'cash_* / worker_payments / handovers недоступны: ' + e.message };
    }
  });

  // ─── GET /pm-balance/:pm_id — детализация ─────────────────────────────────
  fastify.get('/pm-balance/:pm_id', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request) => {
    const pmId = parseInt(request.params.pm_id, 10);
    const out = { pm_id: pmId, items: { cash_requests: [], se_transfers: [], cash_expenses: [], cash_returns: [], worker_payments: [] } };

    try {
      const { rows: cr } = await db.query(`SELECT id, amount, status, created_at FROM cash_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [pmId]);
      out.items.cash_requests = cr;
    } catch (_) {}

    try {
      const { rows: sr } = await db.query(`SELECT id, employee_id, transfer_amount, cash_return_amount, status, created_at FROM se_transfers WHERE pm_user_id = $1 ORDER BY created_at DESC LIMIT 100`, [pmId]);
      out.items.se_transfers = sr;
    } catch (_) {}

    return out;
  });
}

module.exports = routes;
