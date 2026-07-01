'use strict';

/**
 * pm-balance.js — единая формула подсчёта баланса РП (наличные на руках).
 *
 * Источник правды для двух endpoint'ов:
 *   - GET /api/cash/my-balance          (для самого РП)
 *   - GET /api/payroll-dashboard/pm-balance  (для BUH/директора по всем РП)
 *
 * Раньше формулы расходились:
 *   - /my-balance считала ТОЛЬКО cash_requests (без handovers, без worker_payments)
 *   - /pm-balance считала handovers И se_transfers (двойной учёт для V243 agreement_transfer,
 *     потому что handover ссылается на se_transfer через source_se_transfer_id)
 *
 * Эта функция объединяет всё в одну корректную формулу:
 *
 *   balance = handovers_received                            (приход от СЗ через V243)
 *           + se_cash_legacy                                (приход от СЗ для старой схемы
 *                                                            без handover — backwards-compat)
 *           + cash_advances_issued                          (приход из кассы Асгарда)
 *           − cash_expenses                                 (траты по подотчёту с чеком)
 *           − cash_returns_confirmed                        (возвраты в кассу)
 *           − cash_payouts_workers                          (выплаты ЗП/суточных рабочим
 *                                                            наличкой/картой из подотчёта)
 *
 * Ключевые отличия от старых формул:
 *
 * 1. handovers_received берётся из worker_to_pm_handovers WHERE status IN ('received','partial').
 *    Это финальный факт «РП получил нал». ОДИН ИСТОЧНИК.
 *
 * 2. se_cash_legacy — это se_transfers.cash_return_amount ТОЛЬКО для тех,
 *    у которых НЕТ соответствующего handover (LEFT JOIN ... WHERE handover IS NULL).
 *    Это для старой схемы (до V243), когда handover'ов не было.
 *    Для V243-схемы (agreement_transfer + handover) — se_transfers НЕ учитывается,
 *    учитывается только handover. Это убирает двойной учёт.
 *
 * 3. cash_payouts_workers — наличные/карточные выплаты ЗП/суточных рабочим,
 *    которые РП выдал из своей кассы. Включаем:
 *      payment_method IN ('cash','card')
 *      AND status IN ('paid','confirmed')
 *      AND type IN ('salary','bonus','per_diem','advance')
 *      AND (paid_by = PM_user_id OR (paid_by IS NULL AND work.pm_id = PM_user_id))
 *    Гибридный фильтр для backfill — историические записи с paid_by=NULL
 *    но на работе этого PM тоже учитываются (физически их выдал РП).
 *
 * 4. cash_returns_confirmed — БЕЗ фильтра по статусу cash_request.
 *    Старая формула фильтровала по cr.status IN ('received','reporting'),
 *    что игнорировало возвраты на 'closed' заявках. Теперь учитываем все confirmed.
 *
 * Возвращает разбивку:
 *   {
 *     handovers_received,         // V243 handovers
 *     se_cash_legacy,             // se_transfers без handover (старая схема)
 *     cash_advances_issued,       // cash_requests money_issued/received/reporting
 *     cash_expenses,              // cash_expenses по заявкам PM
 *     cash_returns_confirmed,     // cash_returns confirmed по заявкам PM
 *     cash_payouts_workers,       // worker_payments cash/card paid/confirmed PM/PM-work
 *     active_requests,            // cash_requests не closed/rejected
 *     balance                     // итоговая сумма
 *   }
 *
 * Backwards-compatibility:
 *   Старые поля /my-balance (issued, spent, returned) маппятся:
 *     issued   = cash_advances_issued
 *     spent    = cash_expenses
 *     returned = cash_returns_confirmed
 */

async function calcPmBalance(db, pmUserId) {
  if (!pmUserId) {
    return zeroBalance();
  }

  const { rows } = await db.query(`
    WITH
      handovers AS (
        SELECT COALESCE(SUM(received_amount), 0)::numeric AS amt
        FROM worker_to_pm_handovers
        WHERE pm_user_id = $1
          AND status IN ('received', 'partial')
      ),
      se_legacy AS (
        SELECT COALESCE(SUM(st.cash_return_amount), 0)::numeric AS amt
        FROM se_transfers st
        LEFT JOIN worker_to_pm_handovers h ON h.source_se_transfer_id = st.id
        WHERE st.pm_user_id = $1
          AND st.status IN ('completed', 'returned')
          AND h.id IS NULL
      ),
      cash_iss AS (
        -- Включаем 'closed' тоже: при закрытом подотчёте сумма уже зашла РП
        -- (приход +X), а cash_expenses/cash_returns по тому же request_id уходят
        -- из его баланса как расход. Без 'closed' получаем двойной счёт: расход
        -- учтён, а приход — нет. Симметрия с opening_balance в /statement.
        SELECT COALESCE(SUM(amount), 0)::numeric AS amt
        FROM cash_requests
        WHERE user_id = $1
          AND status IN ('money_issued', 'received', 'reporting', 'closed')
      ),
      cash_exp AS (
        SELECT COALESCE(SUM(ce.amount), 0)::numeric AS amt
        FROM cash_expenses ce
        JOIN cash_requests cr ON cr.id = ce.request_id
        WHERE cr.user_id = $1
      ),
      cash_ret AS (
        SELECT COALESCE(SUM(crt.amount), 0)::numeric AS amt
        FROM cash_returns crt
        JOIN cash_requests cr ON cr.id = crt.request_id
        WHERE cr.user_id = $1
          AND crt.confirmed_at IS NOT NULL
      ),
      cash_ret_pending AS (
        SELECT COALESCE(SUM(crt.amount), 0)::numeric AS amt
        FROM cash_returns crt
        JOIN cash_requests cr ON cr.id = crt.request_id
        WHERE cr.user_id = $1
          AND crt.confirmed_at IS NULL
      ),
      payouts AS (
        -- Выплаты рабочим которые УМЕНЬШАЮТ баланс РП:
        --  1) paid_by = PM_user_id     → ЛЮБОЙ payment_method (cash/card/transfer).
        --     РП лично выдал — наличкой или переводом со своей карты на карту рабочего.
        --     Источник денег у РП один (handover'ы/авансы), не важно как он их передал.
        --  2) paid_by IS NULL AND work.pm_id = PM → только cash/card.
        --     Автоматические записи без paid_by (триггер V076 из field_checkins) на работе PM.
        --     Для transfer без paid_by — это безнал компании, не списываем.
        -- penalty тоже списывается из кассы РП (РП реально удержал из ФОТ
        -- наличкой/картой). Симметрия с outflow в /statement.
        SELECT COALESCE(SUM(wp.amount), 0)::numeric AS amt
        FROM worker_payments wp
        LEFT JOIN works w ON w.id = wp.work_id
        WHERE wp.status IN ('paid', 'confirmed')
          AND wp.type IN ('salary', 'bonus', 'per_diem', 'advance', 'penalty')
          AND (
            wp.paid_by = $1
            OR (wp.paid_by IS NULL AND w.pm_id = $1 AND wp.payment_method IN ('cash', 'card'))
          )
      ),
      work_exp_direct AS (
        -- Прямые расходы РП по проектам (материалы/такси/проживание/представительские
        -- /субподряд наличкой или картой). Списываются с баланса РП наравне с worker_payments.
        --  1) paid_by = PM_user_id → ЛЮБОЙ cash/card/transfer (РП лично оплатил)
        --  2) paid_by IS NULL AND work.pm_id = PM → cash/card (legacy/импорт без paid_by)
        -- Исключаем source_table='worker_payments' (уже посчитано в payouts через wp).
        -- Не включаем payment_method='bank' (безнал с р/с компании) и 'self' (НПД оплата
        -- от компании — налог 55% начисляется отдельно, но из кассы РП деньги НЕ уходят).
        -- 'auto' исключается автоматически (source_table='worker_payments').
        SELECT COALESCE(SUM(we.amount), 0)::numeric AS amt
        FROM work_expenses we
        LEFT JOIN works w ON w.id = we.work_id
        WHERE COALESCE(we.source_table, '') NOT IN ('worker_payments')
          AND (
            (we.paid_by = $1 AND we.payment_method IN ('cash', 'card', 'transfer'))
            OR (we.paid_by IS NULL AND w.pm_id = $1 AND we.payment_method IN ('cash', 'card'))
          )
      ),
      active AS (
        SELECT COUNT(*)::int AS cnt
        FROM cash_requests
        WHERE user_id = $1
          AND status NOT IN ('closed', 'rejected')
      )
    SELECT
      (SELECT amt FROM handovers)       AS handovers_received,
      (SELECT amt FROM se_legacy)       AS se_cash_legacy,
      (SELECT amt FROM cash_iss)        AS cash_advances_issued,
      (SELECT amt FROM cash_exp)        AS cash_expenses,
      (SELECT amt FROM cash_ret)         AS cash_returns_confirmed,
      (SELECT amt FROM cash_ret_pending) AS cash_returns_pending,
      (SELECT amt FROM payouts)         AS cash_payouts_workers,
      (SELECT amt FROM work_exp_direct) AS work_expenses_direct,
      (SELECT cnt FROM active)          AS active_requests
  `, [pmUserId]);

  const r = rows[0] || {};
  const handovers       = num(r.handovers_received);
  const seLegacy        = num(r.se_cash_legacy);
  const advances        = num(r.cash_advances_issued);
  const expenses        = num(r.cash_expenses);
  const returns         = num(r.cash_returns_confirmed);
  const returnsPending  = num(r.cash_returns_pending);
  const payouts         = num(r.cash_payouts_workers);
  const workExp     = num(r.work_expenses_direct);
  const active      = parseInt(r.active_requests, 10) || 0;

  const balance = handovers + seLegacy + advances - expenses - returns - payouts - workExp;

  return {
    handovers_received:     handovers,
    se_cash_legacy:         seLegacy,
    cash_advances_issued:   advances,
    cash_expenses:          expenses,
    cash_returns_confirmed: returns,
    cash_returns_pending:   returnsPending,
    cash_payouts_workers:   payouts,
    work_expenses_direct:   workExp,
    active_requests:        active,
    balance:                balance
  };
}

/**
 * Считает балансы для всех PM сразу (для /pm-balance).
 * Возвращает массив объектов с pm_id, pm_name + поля calcPmBalance().
 * Один SQL вместо N — для эффективности.
 */
async function calcAllPmBalances(db) {
  const { rows } = await db.query(`
    WITH pms AS (
      SELECT id, name FROM users
      WHERE role IN ('PM', 'HEAD_PM') AND COALESCE(is_active, true) = true
    ),
    handovers AS (
      SELECT pm_user_id, COALESCE(SUM(received_amount), 0)::numeric AS amt
      FROM worker_to_pm_handovers
      WHERE status IN ('received', 'partial')
      GROUP BY pm_user_id
    ),
    handovers_pending AS (
      SELECT pm_user_id,
             COUNT(*)::int AS cnt,
             COALESCE(SUM(expected_amount), 0)::numeric AS sum_expected
      FROM worker_to_pm_handovers
      WHERE status = 'pending'
      GROUP BY pm_user_id
    ),
    se_legacy AS (
      SELECT st.pm_user_id, COALESCE(SUM(st.cash_return_amount), 0)::numeric AS amt
      FROM se_transfers st
      LEFT JOIN worker_to_pm_handovers h ON h.source_se_transfer_id = st.id
      WHERE st.status IN ('completed', 'returned')
        AND h.id IS NULL
        AND st.pm_user_id IS NOT NULL
      GROUP BY st.pm_user_id
    ),
    cash_iss AS (
      -- Симметрично calcPmBalance: 'closed' тоже даёт приход +amount.
      SELECT user_id, COALESCE(SUM(amount), 0)::numeric AS amt
      FROM cash_requests
      WHERE status IN ('money_issued', 'received', 'reporting', 'closed')
      GROUP BY user_id
    ),
    cash_exp AS (
      SELECT cr.user_id, COALESCE(SUM(ce.amount), 0)::numeric AS amt
      FROM cash_expenses ce
      JOIN cash_requests cr ON cr.id = ce.request_id
      GROUP BY cr.user_id
    ),
    cash_ret AS (
      SELECT cr.user_id, COALESCE(SUM(crt.amount), 0)::numeric AS amt
      FROM cash_returns crt
      JOIN cash_requests cr ON cr.id = crt.request_id
      WHERE crt.confirmed_at IS NOT NULL
      GROUP BY cr.user_id
    ),
    payouts AS (
      -- Симметрично calcPmBalance (см. описание выше):
      --  paid_by IS NOT NULL    → любой payment_method (РП лично выдал)
      --  paid_by IS NULL        → только cash/card на работе PM (автоматика)
      -- Симметрично calcPmBalance: penalty тоже учитывается как расход.
      SELECT
        COALESCE(wp.paid_by, w.pm_id) AS pm_id,
        COALESCE(SUM(wp.amount), 0)::numeric AS amt
      FROM worker_payments wp
      LEFT JOIN works w ON w.id = wp.work_id
      WHERE wp.status IN ('paid', 'confirmed')
        AND wp.type IN ('salary', 'bonus', 'per_diem', 'advance', 'penalty')
        AND (
          wp.paid_by IS NOT NULL
          OR (w.pm_id IS NOT NULL AND wp.payment_method IN ('cash', 'card'))
        )
      GROUP BY COALESCE(wp.paid_by, w.pm_id)
    ),
    work_exp_direct AS (
      -- Симметрично calcPmBalance: прямые наличные расходы РП на проектах.
      -- Исключаем синхронизированные из worker_payments (чтобы не дублировать).
      SELECT
        COALESCE(we.paid_by, w.pm_id) AS pm_id,
        COALESCE(SUM(we.amount), 0)::numeric AS amt
      FROM work_expenses we
      LEFT JOIN works w ON w.id = we.work_id
      WHERE COALESCE(we.source_table, '') NOT IN ('worker_payments')
        AND (
          (we.paid_by IS NOT NULL AND we.payment_method IN ('cash', 'card', 'transfer'))
          OR (we.paid_by IS NULL AND w.pm_id IS NOT NULL AND we.payment_method IN ('cash', 'card'))
        )
      GROUP BY COALESCE(we.paid_by, w.pm_id)
    )
    SELECT
      p.id AS pm_id,
      p.name AS pm_name,
      COALESCE(h.amt, 0)::numeric  AS handovers_received,
      COALESCE(sl.amt, 0)::numeric AS se_cash_legacy,
      COALESCE(ci.amt, 0)::numeric AS cash_advances_issued,
      COALESCE(ce.amt, 0)::numeric AS cash_expenses,
      COALESCE(cr.amt, 0)::numeric AS cash_returns_confirmed,
      COALESCE(po.amt, 0)::numeric AS cash_payouts_workers,
      COALESCE(wed.amt, 0)::numeric AS work_expenses_direct,
      COALESCE(hp.cnt, 0)::int     AS handovers_pending_count,
      COALESCE(hp.sum_expected, 0)::numeric AS handovers_pending_sum,
      (COALESCE(h.amt, 0) + COALESCE(sl.amt, 0) + COALESCE(ci.amt, 0)
       - COALESCE(ce.amt, 0) - COALESCE(cr.amt, 0) - COALESCE(po.amt, 0)
       - COALESCE(wed.amt, 0))::numeric AS balance
    FROM pms p
    LEFT JOIN handovers         h   ON h.pm_user_id = p.id
    LEFT JOIN handovers_pending hp  ON hp.pm_user_id = p.id
    LEFT JOIN se_legacy         sl  ON sl.pm_user_id = p.id
    LEFT JOIN cash_iss          ci  ON ci.user_id = p.id
    LEFT JOIN cash_exp          ce  ON ce.user_id = p.id
    LEFT JOIN cash_ret          cr  ON cr.user_id = p.id
    LEFT JOIN payouts           po  ON po.pm_id = p.id
    LEFT JOIN work_exp_direct   wed ON wed.pm_id = p.id
    ORDER BY p.name
  `);

  return rows.map(r => ({
    pm_id:                  r.pm_id,
    pm_name:                r.pm_name,
    handovers_received:     num(r.handovers_received),
    se_cash_legacy:         num(r.se_cash_legacy),
    cash_advances_issued:   num(r.cash_advances_issued),
    cash_expenses:          num(r.cash_expenses),
    cash_returns_confirmed: num(r.cash_returns_confirmed),
    cash_payouts_workers:   num(r.cash_payouts_workers),
    work_expenses_direct:   num(r.work_expenses_direct),
    handovers_pending_count: parseInt(r.handovers_pending_count, 10) || 0,
    handovers_pending_sum:  num(r.handovers_pending_sum),
    balance:                num(r.balance)
  }));
}

function num(v) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function zeroBalance() {
  return {
    handovers_received: 0, se_cash_legacy: 0, cash_advances_issued: 0,
    cash_expenses: 0, cash_returns_confirmed: 0, cash_payouts_workers: 0,
    active_requests: 0, balance: 0
  };
}

module.exports = { calcPmBalance, calcAllPmBalances };
