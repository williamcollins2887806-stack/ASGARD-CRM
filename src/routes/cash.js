'use strict';

/**
 * Cash Routes — Модуль "Касса" (M2)
 *
 * Авансовые отчёты и расчёты с РП:
 * - РП создаёт заявку на выдачу наличных
 * - Директор согласовывает / отклоняет / задаёт вопрос
 * - Бухгалтер фактически выдаёт деньги
 * - РП подтверждает получение (дедлайн 12ч)
 * - РП прикладывает чеки расходов
 * - РП возвращает остаток
 * - Директор закрывает заявку
 *
 * Flow: requested → approved → money_issued → received → reporting → closed
 */

const path = require('path');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');
const { calcPmBalance } = require('../lib/pm-balance');
const pmStatementXlsx = require('../services/pm-statement-xlsx');

module.exports = async function(fastify) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  // ─────────────────────────────────────────────────────────────────
  // Хелперы
  // ─────────────────────────────────────────────────────────────────
  const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const BUH_AND_DIRECTOR_ROLES = ['BUH', ...DIRECTOR_ROLES];

  // Stage W: согласовывать заявки имеет право DIRECTOR_COMM (главный),
  // ADMIN/DIRECTOR_GEN/DIRECTOR_DEV — backup. БУХ только выдаёт, не одобряет.
  const APPROVE_ROLES = ['DIRECTOR_COMM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

  // Stage W: 12 категорий + 'other' с обязательным описанием.
  const CASH_CATEGORIES = [
    'fuel_service', 'fuel_personal', 'taxi', 'accommodation',
    'food_brigade', 'materials', 'tool', 'tech_rent',
    'communication', 'representational', 'urgent_repair', 'other'
  ];

  // Главная касса — advisory-lock константа (защита от гонок в issue/adjust/return).
  const CASH_ADVISORY_LOCK_KEY = 42;

  function isDirector(role) {
    return DIRECTOR_ROLES.includes(role);
  }

  function isBuhOrDirector(role) {
    return BUH_AND_DIRECTOR_ROLES.includes(role);
  }

  function canApprove(role) {
    return APPROVE_ROLES.includes(role);
  }

  // Подсчёт баланса заявки
  async function calcRequestBalance(requestId) {
    const req = await db.query('SELECT amount FROM cash_requests WHERE id = $1', [requestId]);
    if (!req.rows[0]) return null;

    const approved = parseFloat(req.rows[0].amount) || 0;

    const exp = await db.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM cash_expenses WHERE request_id = $1',
      [requestId]
    );
    const spent = parseFloat(exp.rows[0].total) || 0;

    // Stage W (баг #3): остаток считаем только по ПОДТВЕРЖДЁННЫМ возвратам.
    // Неподтверждённые в баланс не идут — иначе РП может «вернуть» 100k неподтверждённо
    // и формально закрыть заявку с remainder=0, без реального движения денег.
    const ret = await db.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM cash_returns WHERE request_id = $1 AND confirmed_at IS NOT NULL',
      [requestId]
    );
    const returned = parseFloat(ret.rows[0].total) || 0;

    return {
      approved,
      spent,
      returned,
      remainder: approved - spent - returned
    };
  }

  // Получить текущий баланс кассы
  async function getCurrentCashBalance() {
    const result = await db.query(`
      SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1
    `);
    return result.rows[0] ? parseFloat(result.rows[0].amount) : 0;
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash — root list (alias for /my)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.requirePermission('cash', 'read')]
  }, async (request) => {
    const userId = request.user.id;
    const { rows } = await db.query(`
      SELECT cr.*, w.work_title
      FROM cash_requests cr
      LEFT JOIN works w ON w.id = cr.work_id
      WHERE cr.user_id = $1
      ORDER BY cr.created_at DESC
    `, [userId]);
    return rows;
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/my — Мои заявки (для РП)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/my', {
    preHandler: [fastify.requirePermission('cash', 'read')]
  }, async (request) => {
    const userId = request.user.id;

    const { rows } = await db.query(`
      SELECT cr.*,
             w.work_title,
             u.name as director_name,
             ib.name as issued_by_name
      FROM cash_requests cr
      LEFT JOIN works w ON w.id = cr.work_id
      LEFT JOIN users u ON u.id = cr.director_id
      LEFT JOIN users ib ON ib.id = cr.issued_by
      WHERE cr.user_id = $1
      ORDER BY cr.created_at DESC
    `, [userId]);

    // Добавим баланс к каждой заявке
    for (const row of rows) {
      const bal = await calcRequestBalance(row.id);
      row.balance = bal;
      // Флаг просрочки
      if (row.status === 'money_issued' && row.receipt_deadline) {
        row.is_overdue = new Date(row.receipt_deadline) < new Date();
      }
    }

    return rows;
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/all — Все заявки (для директоров и BUH)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/all', {
    preHandler: [fastify.requirePermission('cash_admin', 'read')]
  }, async (request) => {
    const { status, user_id } = request.query;

    let sql = `
      SELECT cr.*,
             w.work_title,
             u.name as user_name,
             u.role as user_role,
             d.name as director_name,
             ib.name as issued_by_name
      FROM cash_requests cr
      LEFT JOIN works w ON w.id = cr.work_id
      LEFT JOIN users u ON u.id = cr.user_id
      LEFT JOIN users d ON d.id = cr.director_id
      LEFT JOIN users ib ON ib.id = cr.issued_by
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (status) {
      sql += ` AND cr.status = $${idx++}`;
      params.push(status);
    }
    if (user_id) {
      sql += ` AND cr.user_id = $${idx++}`;
      params.push(parseInt(user_id));
    }

    sql += ' ORDER BY cr.created_at DESC';

    const { rows } = await db.query(sql, params);

    for (const row of rows) {
      const bal = await calcRequestBalance(row.id);
      row.balance = bal;
      // Флаг просрочки
      if (row.status === 'money_issued' && row.receipt_deadline) {
        row.is_overdue = new Date(row.receipt_deadline) < new Date();
      }
    }

    return rows;
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/summary — Сводка по всем пользователям (для директоров)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/summary', {
    preHandler: [fastify.requirePermission('cash_admin', 'read')]
  }, async () => {
    // Суммы по пользователям: выдано, потрачено, возвращено, остаток
    const { rows } = await db.query(`
      SELECT
        u.id as user_id,
        u.name as user_name,
        u.role as user_role,
        COALESCE(SUM(cr.amount) FILTER (WHERE cr.status IN ('received', 'reporting', 'closed', 'money_issued')), 0) as total_issued,
        COALESCE((
          SELECT SUM(ce.amount) FROM cash_expenses ce
          JOIN cash_requests cr2 ON cr2.id = ce.request_id
          WHERE cr2.user_id = u.id
        ), 0) as total_spent,
        COALESCE((
          SELECT SUM(cret.amount) FROM cash_returns cret
          JOIN cash_requests cr3 ON cr3.id = cret.request_id
          WHERE cr3.user_id = u.id AND cret.confirmed_at IS NOT NULL
        ), 0) as total_returned
      FROM users u
      LEFT JOIN cash_requests cr ON cr.user_id = u.id
      WHERE u.is_active = true
      GROUP BY u.id, u.name, u.role
      HAVING COALESCE(SUM(cr.amount) FILTER (WHERE cr.status IN ('received', 'reporting', 'closed', 'money_issued')), 0) > 0
         OR EXISTS (SELECT 1 FROM cash_requests WHERE user_id = u.id)
      ORDER BY u.name
    `);

    return rows.map(r => ({
      ...r,
      total_issued: parseFloat(r.total_issued) || 0,
      total_spent: parseFloat(r.total_spent) || 0,
      total_returned: parseFloat(r.total_returned) || 0,
      balance: (parseFloat(r.total_issued) || 0) - (parseFloat(r.total_spent) || 0) - (parseFloat(r.total_returned) || 0)
    }));
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/my-balance — Мой текущий баланс (для виджета)
  //
  // С июня 2026 формула учитывает handovers (Stage W) + worker_payments cash/card,
  // которые РП реально выдал. См. src/lib/pm-balance.js (единый источник правды).
  // Backwards-compat: поля issued/spent/returned/balance/active_requests сохранены,
  // дополнительно отдаём handovers_received, se_cash_legacy, cash_payouts_workers.
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/my-balance', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;
    const b = await calcPmBalance(db, userId);
    return {
      // backwards-compat (старые виджеты)
      issued:          b.cash_advances_issued,
      spent:           b.cash_expenses,
      returned:        b.cash_returns_confirmed,
      balance:         b.balance,
      active_requests: b.active_requests,
      // новые поля
      handovers_received:    b.handovers_received,
      se_cash_legacy:        b.se_cash_legacy,
      cash_payouts_workers:  b.cash_payouts_workers,
      cash_returns_confirmed: b.cash_returns_confirmed,
      cash_returns_pending:  b.cash_returns_pending
    };
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/statement — Выписка РП (банковский стиль)
  //
  // Полная хронологическая выписка движений подотчёта РП за период:
  //  · приходы (handover от СЗ, аванс из кассы Асгарда)
  //  · расходы (возврат в кассу, выплаты рабочим, прямые расходы по проектам,
  //             расходы по подотчёту с чеком)
  //  · running balance (накопительный остаток после каждой операции)
  //
  // RBAC:
  //  · PM / HEAD_PM           — только свой, ?pm_id игнорируется
  //  · ADMIN / DIRECTOR_*     — любой через ?pm_id (обязателен)
  //  · BUH                    — любой через ?pm_id (обязателен)
  //
  // Query:
  //  · pm_id  — int (обязателен для admin/director/buh)
  //  · from   — YYYY-MM-DD (default = первый день текущего месяца)
  //  · to     — YYYY-MM-DD (default = сегодня)
  //  · format — json | xlsx | pdf (default 'json'; pdf пока 501)
  //
  // Источник правды формул: src/lib/pm-balance.js — здесь повторяем
  // те же CTE-фильтры, расширив их датой.
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/statement', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const role = request.user.role;
    const isPmRole       = role === 'PM' || role === 'HEAD_PM';
    const isPrivilegedFn = isBuhOrDirector(role); // ADMIN/DIRECTOR_*/BUH

    // ── pm_id resolution ─────────────────────────────────────────
    let pmId = null;
    if (isPmRole) {
      pmId = parseInt(request.user.id, 10);
    } else if (isPrivilegedFn) {
      const raw = request.query.pm_id;
      pmId = parseInt(raw, 10);
      if (!Number.isFinite(pmId)) {
        return reply.code(400).send({ error: 'Параметр pm_id обязателен для ADMIN/DIRECTOR/BUH' });
      }
    } else {
      return reply.code(403).send({ error: 'Нет доступа к выписке' });
    }

    // ── period ───────────────────────────────────────────────────
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const defFrom = `${yyyy}-${mm}-01`;
    const defTo   = `${yyyy}-${mm}-${dd}`;
    const from = (request.query.from && dateRe.test(request.query.from)) ? request.query.from : defFrom;
    const to   = (request.query.to   && dateRe.test(request.query.to))   ? request.query.to   : defTo;
    if (from > to) {
      return reply.code(400).send({ error: '"from" не может быть позже "to"' });
    }

    // ── format ───────────────────────────────────────────────────
    const format = String(request.query.format || 'json').toLowerCase();
    if (!['json', 'xlsx', 'pdf'].includes(format)) {
      return reply.code(400).send({ error: 'format должен быть json | xlsx | pdf' });
    }
    if (format === 'pdf') {
      return reply.code(501).send({ error: 'PDF-выгрузка пока не реализована. Используйте format=xlsx.' });
    }

    // ── PM info ──────────────────────────────────────────────────
    const { rows: pmRows } = await db.query(
      'SELECT id, name FROM users WHERE id = $1',
      [pmId]
    );
    if (!pmRows[0]) {
      return reply.code(404).send({ error: 'РП не найден' });
    }
    const pm = { id: pmRows[0].id, name: pmRows[0].name };

    // ── 1) Operations в периоде (UNION ALL) ──────────────────────
    // Колонки строго в одном порядке для всех веток:
    //   d, type, source, amount, category, description, counterparty,
    //   work_id, work_title, ref_id, source_kind, is_from_pm_cash
    // amount: для income > 0, для outflow < 0, для info > 0 (но не меняет running).
    // source_kind/is_from_pm_cash (V264) — для UI и XLSX, см. worker_payment_source_v.
    const opsSql = `
      WITH ops AS (
        -- 1) handovers_received (приход от СЗ)
        SELECT
          h.received_at::date          AS d,
          'income'::text               AS type,
          'handover'::text             AS source,
          h.received_amount::numeric   AS amount,
          'Передача от СЗ'::text       AS category,
          COALESCE(e.fio, '—')::text   AS description,
          COALESCE(e.fio, '—')::text   AS counterparty,
          h.work_id                    AS work_id,
          w.work_title                 AS work_title,
          h.id                         AS ref_id,
          'pm_cash'::text              AS source_kind,
          true                         AS is_from_pm_cash
        FROM worker_to_pm_handovers h
        LEFT JOIN employees e ON e.id = h.worker_id
        LEFT JOIN works w     ON w.id = h.work_id
        WHERE h.pm_user_id = $1
          AND h.status IN ('received','partial')
          AND h.received_at IS NOT NULL
          AND h.received_at::date BETWEEN $2 AND $3

        UNION ALL
        -- 2) cash_requests issued (приход — аванс из кассы Асгарда)
        SELECT
          cr.issued_at::date,
          'income',
          'cash_request',
          cr.amount::numeric,
          'Аванс из кассы',
          LEFT(COALESCE(cr.purpose, ''), 200),
          'Касса Асгарда',
          cr.work_id,
          w.work_title,
          cr.id,
          'pm_cash'::text,
          true
        FROM cash_requests cr
        LEFT JOIN works w ON w.id = cr.work_id
        WHERE cr.user_id = $1
          AND cr.status IN ('money_issued','received','reporting','closed')
          AND cr.issued_at IS NOT NULL
          AND cr.issued_at::date BETWEEN $2 AND $3

        UNION ALL
        -- 3) cash_returns confirmed (расход — возврат в кассу)
        SELECT
          crt.confirmed_at::date,
          'outflow',
          'cash_return',
          (-crt.amount)::numeric,
          'Возврат в кассу Асгарда',
          LEFT(COALESCE(crt.note, ''), 200),
          'Касса Асгарда',
          cr.work_id,
          w.work_title,
          crt.id,
          'pm_cash'::text,
          true
        FROM cash_returns crt
        JOIN cash_requests cr ON cr.id = crt.request_id
        LEFT JOIN works w ON w.id = cr.work_id
        WHERE cr.user_id = $1
          AND crt.confirmed_at IS NOT NULL
          AND crt.confirmed_at::date BETWEEN $2 AND $3

        UNION ALL
        -- 4) cash_expenses (расход по подотчёту — отчётность с чеком)
        SELECT
          ce.expense_date::date,
          'outflow',
          'cash_expense',
          (-ce.amount)::numeric,
          COALESCE(ce.category, 'other'),
          LEFT(COALESCE(ce.description, ''), 200),
          NULL,
          cr.work_id,
          w.work_title,
          ce.id,
          'pm_cash'::text,
          true
        FROM cash_expenses ce
        JOIN cash_requests cr ON cr.id = ce.request_id
        LEFT JOIN works w ON w.id = cr.work_id
        WHERE cr.user_id = $1
          AND ce.expense_date IS NOT NULL
          AND ce.expense_date::date BETWEEN $2 AND $3

        UNION ALL
        -- 5) worker_payments через view worker_payment_source_v (V264).
        --    Строки is_from_pm_cash=true → 'outflow' (списываются с кассы РП).
        --    Строки is_from_pm_cash=false → 'info'   (bank/se/auto — деньги
        --    компании; в журнале нужны справочно, но баланс РП не трогают).
        SELECT
          v.paid_at::date,
          CASE WHEN v.is_from_pm_cash THEN 'outflow' ELSE 'info' END AS type,
          'worker_payment',
          (CASE WHEN v.is_from_pm_cash THEN -v.amount ELSE v.amount END)::numeric,
          v.type,
          LEFT(COALESCE(v.comment, e.fio, ''), 200),
          COALESCE(e.fio, ''),
          v.work_id,
          w.work_title,
          v.id,
          v.source_kind::text,
          v.is_from_pm_cash
        FROM worker_payment_source_v v
        LEFT JOIN employees e ON e.id = v.employee_id
        LEFT JOIN works w     ON w.id = v.work_id
        WHERE v.status IN ('paid','confirmed')
          AND v.type IN ('salary','bonus','per_diem','advance','penalty')
          AND v.paid_at IS NOT NULL
          AND v.paid_at::date BETWEEN $2 AND $3
          AND (
            -- "Моя касса РП": is_from_pm_cash=true ВСЕГДА для paid_by=$1 (через view).
            -- Дополнительно: paid_by IS NULL + work.pm_id=$1 + cash/card (legacy).
            v.paid_by = $1
            OR (v.paid_by IS NULL AND w.pm_id = $1 AND v.payment_method IN ('cash','card'))
            -- info-строки: показываем только если они относятся к работе PM
            -- (работнику были выплачены деньги компании на работе этого PM).
            OR (NOT v.is_from_pm_cash AND w.pm_id = $1)
          )

        UNION ALL
        -- 6) work_expenses (прямые расходы РП по проектам)
        SELECT
          we.date::date,
          'outflow',
          'work_expense',
          (-we.amount)::numeric,
          COALESCE(we.category, 'other'),
          LEFT(COALESCE(we.description, we.supplier, ''), 200),
          we.supplier,
          we.work_id,
          w.work_title,
          we.id,
          'pm_cash'::text AS source_kind,
          true             AS is_from_pm_cash
        FROM work_expenses we
        LEFT JOIN works w ON w.id = we.work_id
        WHERE COALESCE(we.source_table, '') NOT IN ('worker_payments')
          AND we.date IS NOT NULL
          AND we.date::date BETWEEN $2 AND $3
          AND (
            (we.paid_by = $1 AND we.payment_method IN ('cash','card','transfer'))
            OR (we.paid_by IS NULL AND w.pm_id = $1 AND we.payment_method IN ('cash','card'))
          )
      )
      SELECT * FROM ops
      ORDER BY d ASC, (CASE WHEN type = 'income' THEN 0 WHEN type = 'outflow' THEN 1 ELSE 2 END), ref_id ASC
    `;

    let rows;
    try {
      const r = await db.query(opsSql, [pmId, from, to]);
      rows = r.rows;
    } catch (e) {
      fastify.log.error({ err: e }, '[cash] /statement query error');
      return reply.code(500).send({ error: 'Не удалось получить операции', detail: e.message });
    }

    // ── 2) Opening balance ───────────────────────────────────────
    // Используем те же CTE что в calcPmBalance, но фильтр "до from".
    // Граница: всё что date < from (строго раньше) идёт в opening.
    let openingBalance = 0;
    try {
      const openSql = `
        WITH
          h AS (
            SELECT COALESCE(SUM(received_amount),0)::numeric AS amt
            FROM worker_to_pm_handovers
            WHERE pm_user_id = $1
              AND status IN ('received','partial')
              AND received_at IS NOT NULL
              AND received_at::date < $2
          ),
          sl AS (
            SELECT COALESCE(SUM(st.cash_return_amount),0)::numeric AS amt
            FROM se_transfers st
            LEFT JOIN worker_to_pm_handovers wh ON wh.source_se_transfer_id = st.id
            WHERE st.pm_user_id = $1
              AND st.status IN ('completed','returned')
              AND wh.id IS NULL
              AND COALESCE(st.updated_at, st.created_at)::date < $2
          ),
          ci AS (
            SELECT COALESCE(SUM(amount),0)::numeric AS amt
            FROM cash_requests
            WHERE user_id = $1
              AND status IN ('money_issued','received','reporting','closed')
              AND issued_at IS NOT NULL
              AND issued_at::date < $2
          ),
          ce AS (
            SELECT COALESCE(SUM(ce.amount),0)::numeric AS amt
            FROM cash_expenses ce
            JOIN cash_requests cr ON cr.id = ce.request_id
            WHERE cr.user_id = $1
              AND ce.expense_date IS NOT NULL
              AND ce.expense_date::date < $2
          ),
          cr_ret AS (
            SELECT COALESCE(SUM(crt.amount),0)::numeric AS amt
            FROM cash_returns crt
            JOIN cash_requests cr ON cr.id = crt.request_id
            WHERE cr.user_id = $1
              AND crt.confirmed_at IS NOT NULL
              AND crt.confirmed_at::date < $2
          ),
          po AS (
            SELECT COALESCE(SUM(wp.amount),0)::numeric AS amt
            FROM worker_payments wp
            LEFT JOIN works w ON w.id = wp.work_id
            WHERE wp.status IN ('paid','confirmed')
              AND wp.type IN ('salary','bonus','per_diem','advance','penalty')
              AND wp.paid_at IS NOT NULL
              AND wp.paid_at::date < $2
              AND (
                wp.paid_by = $1
                OR (wp.paid_by IS NULL AND w.pm_id = $1 AND wp.payment_method IN ('cash','card'))
              )
          ),
          we_d AS (
            SELECT COALESCE(SUM(we.amount),0)::numeric AS amt
            FROM work_expenses we
            LEFT JOIN works w ON w.id = we.work_id
            WHERE COALESCE(we.source_table,'') NOT IN ('worker_payments')
              AND we.date IS NOT NULL
              AND we.date::date < $2
              AND (
                (we.paid_by = $1 AND we.payment_method IN ('cash','card','transfer'))
                OR (we.paid_by IS NULL AND w.pm_id = $1 AND we.payment_method IN ('cash','card'))
              )
          )
        SELECT
          (SELECT amt FROM h)      AS handovers_received,
          (SELECT amt FROM sl)     AS se_cash_legacy,
          (SELECT amt FROM ci)     AS cash_advances_issued,
          (SELECT amt FROM ce)     AS cash_expenses,
          (SELECT amt FROM cr_ret) AS cash_returns_confirmed,
          (SELECT amt FROM po)     AS cash_payouts_workers,
          (SELECT amt FROM we_d)   AS work_expenses_direct
      `;
      const op = await db.query(openSql, [pmId, from]);
      const o = op.rows[0] || {};
      const n = (v) => {
        if (v == null) return 0;
        const x = typeof v === 'number' ? v : parseFloat(v);
        return Number.isFinite(x) ? x : 0;
      };
      openingBalance =
        n(o.handovers_received) + n(o.se_cash_legacy) + n(o.cash_advances_issued)
        - n(o.cash_expenses) - n(o.cash_returns_confirmed)
        - n(o.cash_payouts_workers) - n(o.work_expenses_direct);
    } catch (e) {
      fastify.log.error({ err: e }, '[cash] /statement opening-balance error');
      return reply.code(500).send({ error: 'Не удалось получить opening_balance', detail: e.message });
    }

    // ── 3) Running balance + breakdown ───────────────────────────
    const nn = (v) => {
      if (v == null) return 0;
      const x = typeof v === 'number' ? v : parseFloat(v);
      return Number.isFinite(x) ? x : 0;
    };

    const breakdownIn = {
      handovers_received: 0,
      cash_advances_issued: 0,
    };
    const breakdownOut = {
      cash_returns_confirmed: 0,
      worker_payments: 0,
      work_expenses_direct: 0,
      cash_expenses: 0,
    };
    // V264: info-выплаты (bank/se/auto) — деньги КОМПАНИИ, не из кассы РП.
    // Идут в журнал ТОЛЬКО справочно, баланс РП не трогают.
    const breakdownInfo = {
      info_company_bank: 0,
      info_company_se:   0,
      info_auto_fot:     0,
    };

    let running = openingBalance;
    const operations = rows.map((r) => {
      const amount = nn(r.amount); // income > 0, outflow < 0, info > 0 (не меняет running)
      const isInfo = (r.type === 'info');

      // running balance: info-строки НЕ меняют running
      if (!isInfo) {
        running += amount;
      }

      // breakdown
      if (isInfo) {
        // V264: справочный учёт денег компании по работнику
        const sk = r.source_kind || 'other';
        if (sk === 'company_bank')      breakdownInfo.info_company_bank += amount;
        else if (sk === 'company_se')   breakdownInfo.info_company_se   += amount;
        else if (sk === 'auto_fot')     breakdownInfo.info_auto_fot     += amount;
      } else if (r.type === 'income') {
        if (r.source === 'handover')      breakdownIn.handovers_received   += amount;
        else if (r.source === 'cash_request') breakdownIn.cash_advances_issued += amount;
      } else {
        const abs = -amount; // делаем положительной для разбивки
        if (r.source === 'cash_return')        breakdownOut.cash_returns_confirmed += abs;
        else if (r.source === 'worker_payment') breakdownOut.worker_payments        += abs;
        else if (r.source === 'work_expense')   breakdownOut.work_expenses_direct   += abs;
        else if (r.source === 'cash_expense')   breakdownOut.cash_expenses          += abs;
      }

      // ISO date
      let dateIso = null;
      if (r.d instanceof Date) {
        const yy = r.d.getFullYear();
        const mm2 = String(r.d.getMonth() + 1).padStart(2, '0');
        const dd2 = String(r.d.getDate()).padStart(2, '0');
        dateIso = `${yy}-${mm2}-${dd2}`;
      } else if (typeof r.d === 'string') {
        dateIso = r.d.slice(0, 10);
      }

      return {
        date: dateIso,
        type: r.type,
        source: r.source,
        amount: amount,
        balance_after: running,
        category: r.category || null,
        description: r.description || null,
        counterparty: r.counterparty || null,
        work_id: r.work_id == null ? null : Number(r.work_id),
        work_title: r.work_title || null,
        ref_id: r.ref_id == null ? null : Number(r.ref_id),
        // V264: для UI и XLSX
        source_kind: r.source_kind || null,
        is_from_pm_cash: r.is_from_pm_cash == null ? null : !!r.is_from_pm_cash,
      };
    });

    // total_in/total_out считаем ТОЛЬКО по реальным income/outflow,
    // info-строки исключаем (они в running не учитывались).
    const totalIn  = operations.reduce((s, o) => s + (o.type === 'income' ? o.amount : 0), 0);
    const totalOut = operations.reduce((s, o) => s + (o.type === 'outflow' ? -o.amount : 0), 0);

    // by_work агрегат (для XLSX-листа «По проектам»).
    // info-строки в in/out НЕ учитываются (это деньги компании, не кассы РП),
    // но отдельно учитываются в info-агрегате для справки.
    const byWorkMap = new Map();
    for (const op of operations) {
      const key = op.work_id == null ? '__none__' : String(op.work_id);
      let w = byWorkMap.get(key);
      if (!w) {
        w = {
          work_id: op.work_id,
          work_title: op.work_title || (op.work_id == null ? 'Без привязки' : `#${op.work_id}`),
          ops: 0, in: 0, out: 0, info: 0,
        };
        byWorkMap.set(key, w);
      }
      w.ops += 1;
      if (op.type === 'info') {
        w.info += op.amount;
      } else if (op.amount >= 0) {
        w.in += op.amount;
      } else {
        w.out += -op.amount;
      }
    }
    const by_work = [...byWorkMap.values()]
      .map(w => ({ ...w, net: w.in - w.out }))
      .sort((a, b) => (b.in + b.out + b.info) - (a.in + a.out + a.info));

    const summary = {
      opening_balance: openingBalance,
      total_in: totalIn,
      total_out: totalOut,
      closing_balance: openingBalance + totalIn - totalOut,
      breakdown_in: breakdownIn,
      breakdown_out: breakdownOut,
      // V264: справочный учёт денег компании работникам (bank/se/auto)
      // — НЕ влияют на closing_balance, идут только для информации.
      breakdown_info: breakdownInfo,
      by_work,
    };

    const payload = {
      pm,
      period: { from, to },
      summary,
      operations,
    };

    // ── 4) Output ────────────────────────────────────────────────
    if (format === 'json') {
      return payload;
    }

    // xlsx
    if (!pmStatementXlsx.isAvailable()) {
      return reply.code(500).send({
        error: 'XLSX-генератор недоступен. Установите exceljs: npm install exceljs'
      });
    }
    try {
      const buf = await pmStatementXlsx.generateStatementXlsx(payload);
      const safeName = String(pm.name || `pm_${pm.id}`)
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_');
      const fname = encodeURIComponent(`Выписка_${safeName}_${from}_${to}.xlsx`);
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);
      reply.header('Content-Length', String(buf.length));
      return reply.send(buf);
    } catch (e) {
      fastify.log.error({ err: e }, '[cash] /statement xlsx generation error');
      if (e.code === 'EXCELJS_MISSING') {
        return reply.code(500).send({ error: e.message });
      }
      return reply.code(500).send({ error: 'Не удалось сформировать XLSX', detail: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/balance — Баланс кассы (для BUH и директоров)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/balance', {
    preHandler: [fastify.requirePermission('cash_admin', 'read')]
  }, async () => {
    const currentBalance = await getCurrentCashBalance();

    const { rows: operations } = await db.query(`
      SELECT cbl.*, u.name as user_name
      FROM cash_balance_log cbl
      LEFT JOIN users u ON u.id = cbl.user_id
      ORDER BY cbl.created_at DESC, cbl.id DESC
      LIMIT 20
    `);

    return {
      balance: currentBalance,
      operations
    };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/cash/balance/adjust — Корректировка баланса кассы (BUH)
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/balance/adjust', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const { amount, description } = request.body || {};

    if (amount === undefined || amount === null) {
      return reply.code(400).send({ error: 'Укажите сумму' });
    }
    if (!description || !description.trim()) {
      return reply.code(400).send({ error: 'Укажите описание' });
    }

    const changeAmount = parseFloat(amount);

    // Stage W (баг #1): обёрнуто в advisory_xact_lock — гонка между двумя
    // параллельными adjust привела бы к потере одного из обновлений.
    let newBalance;
    let operationRow;
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock($1)', [CASH_ADVISORY_LOCK_KEY]);

      const { rows: [bal] } = await db.query(
        'SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1'
      );
      const currentBalance = bal ? parseFloat(bal.amount) : 0;
      newBalance = currentBalance + changeAmount;

      const { rows } = await db.query(`
        INSERT INTO cash_balance_log (amount, change_amount, change_type, description, user_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [newBalance, changeAmount, changeAmount >= 0 ? 'income' : 'expense', description.trim(), request.user.id]);

      operationRow = rows[0];
      await db.query('COMMIT');
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch (_) {}
      fastify.log.error({ err: e }, '[cash] /balance/adjust error');
      return reply.code(500).send({ error: 'Не удалось скорректировать баланс', detail: e.message });
    }

    return { success: true, balance: newBalance, operation: operationRow };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/cash — Создать заявку на выдачу
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const {
      work_id, type = 'advance', amount, purpose, cover_letter,
      category, category_other_desc,
      use_se_payee, se_payee_employee_id
    } = request.body;
    const userId = request.user.id;

    // Stage W: тип loan полностью убран. Только advance/office/other.
    const ALLOWED_TYPES = ['advance', 'office', 'other'];
    if (!ALLOWED_TYPES.includes(type)) {
      return reply.code(400).send({
        error: `type должен быть одним из: ${ALLOWED_TYPES.join(', ')}. Тип "loan" убран.`
      });
    }

    if (!amount || amount <= 0) {
      return reply.code(400).send({ error: 'Сумма должна быть больше 0' });
    }
    if (!purpose || !purpose.trim()) {
      return reply.code(400).send({ error: 'Укажите цель' });
    }

    // Если advance — work_id обязателен
    if (type === 'advance' && !work_id) {
      return reply.code(400).send({ error: 'Для аванса укажите проект' });
    }

    // Stage W: category из закрытого набора (если передана).
    // Если category='other' — требуем category_other_desc.
    let categoryNorm = null;
    let categoryOtherDescNorm = null;
    if (category !== undefined && category !== null && category !== '') {
      if (!CASH_CATEGORIES.includes(category)) {
        return reply.code(400).send({
          error: `category должен быть одним из: ${CASH_CATEGORIES.join(', ')}`
        });
      }
      categoryNorm = category;
      if (category === 'other') {
        if (!category_other_desc || !String(category_other_desc).trim()) {
          return reply.code(400).send({
            error: 'Для category="other" обязательно укажите category_other_desc'
          });
        }
        categoryOtherDescNorm = String(category_other_desc).trim();
      }
    }

    // Stage W: use_se_payee → требуется se_payee_employee_id (СЗ-получатель).
    const useSePayee = !!use_se_payee;
    let sePayeeEmployeeId = null;
    if (useSePayee) {
      sePayeeEmployeeId = parseInt(se_payee_employee_id, 10);
      if (!Number.isFinite(sePayeeEmployeeId)) {
        return reply.code(400).send({
          error: 'При use_se_payee=true укажите se_payee_employee_id'
        });
      }
      // Проверка что employee существует и является СЗ
      const { rows: [emp] } = await db.query(
        'SELECT id, is_self_employed FROM employees WHERE id = $1',
        [sePayeeEmployeeId]
      );
      if (!emp) {
        return reply.code(404).send({ error: 'СЗ-получатель не найден' });
      }
      if (!emp.is_self_employed) {
        return reply.code(400).send({
          error: 'Указанный сотрудник не является самозанятым'
        });
      }
    }

    const { rows } = await db.query(`
      INSERT INTO cash_requests (
        user_id, work_id, type, amount, purpose, cover_letter, status,
        category, category_other_desc, use_se_payee, se_payee_employee_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'requested', $7, $8, $9, $10)
      RETURNING *
    `, [
      userId, work_id || null, type, amount, purpose.trim(), cover_letter || null,
      categoryNorm, categoryOtherDescNorm, useSePayee, sePayeeEmployeeId
    ]);

    // Notify directors about new cash request
    const directors = await db.query(
      `SELECT id FROM users WHERE role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV') AND is_active = true`
    );
    for (const dir of directors.rows) {
      if (dir.id !== userId) {
        createNotification(db, {
          user_id: dir.id,
          title: '💰 Новая заявка на аванс',
          message: `${request.user.name || 'РП'} запрашивает ${amount} ₽: ${purpose.trim().substring(0, 100)}`,
          type: 'cash',
          link: `#/cash?id=${rows[0].id}`
        });
      }
    }

    return rows[0];
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/:id — Детали заявки
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { rows } = await db.query(`
      SELECT cr.*,
             w.work_title,
             u.name as user_name,
             u.role as user_role,
             d.name as director_name,
             ib.name as issued_by_name
      FROM cash_requests cr
      LEFT JOIN works w ON w.id = cr.work_id
      LEFT JOIN users u ON u.id = cr.user_id
      LEFT JOIN users d ON d.id = cr.director_id
      LEFT JOIN users ib ON ib.id = cr.issued_by
      WHERE cr.id = $1
    `, [id]);

    if (!rows[0]) {
      return reply.code(404).send({ error: 'Заявка не найдена' });
    }

    const req = rows[0];

    // IDOR: только владелец, директор или BUH может смотреть
    if (req.user_id !== request.user.id && !isBuhOrDirector(request.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    // Расходы
    const expenses = await db.query(
      'SELECT * FROM cash_expenses WHERE request_id = $1 ORDER BY expense_date, id',
      [id]
    );
    req.expenses = expenses.rows;

    // Возвраты
    const returns = await db.query(`
      SELECT cret.*, u.name as confirmed_by_name
      FROM cash_returns cret
      LEFT JOIN users u ON u.id = cret.confirmed_by
      WHERE cret.request_id = $1
      ORDER BY cret.created_at
    `, [id]);
    req.returns = returns.rows;

    // Сообщения
    const messages = await db.query(`
      SELECT cm.*, u.name as user_name, u.role as user_role
      FROM cash_messages cm
      LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.request_id = $1
      ORDER BY cm.created_at
    `, [id]);
    req.messages = messages.rows;

    // Баланс
    req.balance = await calcRequestBalance(id);

    // Флаг просрочки
    if (req.status === 'money_issued' && req.receipt_deadline) {
      req.is_overdue = new Date(req.receipt_deadline) < new Date();
    }

    return req;
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/approve — Директор согласовывает
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/approve', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    // Stage W (баг #6): согласование — ТОЛЬКО директор (главный DIRECTOR_COMM,
    // backup ADMIN/DIRECTOR_GEN/DIRECTOR_DEV). БУХ имеет cash_admin:write для
    // выдачи денег, но НЕ для согласования.
    if (!canApprove(request.user.role)) {
      return reply.code(403).send({
        error: 'Согласовывать заявки могут только директор (DIRECTOR_COMM) и админ'
      });
    }

    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { comment } = request.body || {};

    const check = await db.query('SELECT status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (check.rows[0].status !== 'requested') {
      return reply.code(400).send({ error: 'Заявку можно согласовать только в статусе "requested"' });
    }

    await db.query(`
      UPDATE cash_requests
      SET status = 'approved',
          director_id = $1,
          director_comment = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [request.user.id, comment || null, id]);

    // Notify requesting user about approval
    const { rows: [req] } = await db.query('SELECT * FROM cash_requests WHERE id = $1', [id]);
    if (req && req.user_id && req.user_id !== request.user.id) {
      createNotification(db, {
        user_id: req.user_id,
        title: '✅ Заявка на аванс согласована',
        message: `${request.user.name || 'Директор'} согласовал вашу заявку на ${req.amount || 0} ₽`,
        type: 'cash',
        link: `#/cash?id=${id}`
      });
    }

    // Notify BUH about approved request (needs to issue money)
    const buhUsers = await db.query(
      `SELECT id FROM users WHERE role = 'BUH' AND is_active = true`
    );
    for (const buh of buhUsers.rows) {
      createNotification(db, {
        user_id: buh.id,
        title: '💰 Заявка согласована — ожидает выдачи',
        message: `${request.user.name || 'Директор'} согласовал заявку на ${req.amount || 0} ₽ для ${req.user_id === request.user.id ? 'себя' : 'РП'}`,
        type: 'cash',
        link: `#/cash-admin?id=${id}`
      });
    }

    return { success: true, message: 'Заявка согласована' };
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/issue — BUH/Директор выдаёт деньги
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/issue', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const check = await db.query('SELECT * FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (check.rows[0].status !== 'approved') {
      return reply.code(400).send({ error: 'Выдать деньги можно только для согласованных заявок' });
    }

    const req = check.rows[0];
    const amount = parseFloat(req.amount) || 0;

    // Stage W: если заявка с use_se_payee=true — выдача идёт через СЗ-перевод,
    //   касса не трогается, создаётся se_transfers(operation_type='agreement_transfer').
    if (req.use_se_payee && req.se_payee_employee_id) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // Получаем pm_user_id заявки (для трекинга в se_transfers.pm_user_id)
      const pmUserId = Number(req.user_id);

      try {
        await db.query('BEGIN');

        const { rows: [t] } = await db.query(`
          INSERT INTO se_transfers (
            employee_id, year, month, operation_type,
            earned_amount, transfer_amount,
            cash_return_amount, cash_payout_amount,
            status, created_by, comment, pm_user_id, work_id
          )
          VALUES ($1, $2, $3, 'agreement_transfer',
                  0, $4, $4, 0,
                  'planned', $5, $6, $7, $8)
          RETURNING id
        `, [
          req.se_payee_employee_id, year, month,
          amount, request.user.id,
          `Аванс РП через СЗ (заявка #${id}): ${req.purpose || ''}`,
          pmUserId, req.work_id || null
        ]);

        await db.query(`
          UPDATE cash_requests
          SET status = 'money_issued',
              issued_by = $1,
              issued_at = NOW(),
              receipt_deadline = NOW() + INTERVAL '12 hours',
              overdue_notified = false,
              se_transfer_id = $2,
              updated_at = NOW()
          WHERE id = $3
        `, [request.user.id, t.id, id]);

        await db.query('COMMIT');

        // Уведомления (тот же блок, что и для нал. варианта)
        if (req.user_id && req.user_id !== request.user.id) {
          createNotification(db, {
            user_id: req.user_id,
            title: '💰 Аванс оформлен через СЗ-перевод',
            message: `${request.user.name || 'Бухгалтер'} оформил ${amount} ₽ через СЗ. Дождитесь подтверждения получения от рабочего.`,
            type: 'cash',
            link: `#/cash?id=${id}`
          });
        }
        return { success: true, message: 'Деньги оформлены через СЗ-перевод', se_transfer_id: t.id };
      } catch (e) {
        try { await db.query('ROLLBACK'); } catch (_) {}
        fastify.log.error({ err: e }, '[cash] /issue (SE-route) error');
        return reply.code(500).send({ error: 'Не удалось оформить СЗ-перевод', detail: e.message });
      }
    }

    // ── Старая логика: выдача из главной кассы налом ──
    // Stage W (баг #1): SELECT+INSERT в кассовый лог обёрнут в транзакцию
    // с pg_advisory_xact_lock(CASH_ADVISORY_LOCK_KEY). Без этого два
    // параллельных issue читали один и тот же currentBalance → второй
    // INSERT перетирал балансом из устаревшего SELECT'а.
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock($1)', [CASH_ADVISORY_LOCK_KEY]);

      const { rows: [bal] } = await db.query(
        'SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1'
      );
      const currentBalance = bal ? parseFloat(bal.amount) : 0;
      const newBalance = currentBalance - amount;

      await db.query(`
        INSERT INTO cash_balance_log (amount, change_amount, change_type, description, related_request_id, user_id)
        VALUES ($1, $2, 'cash_issued', $3, $4, $5)
      `, [newBalance, -amount, `Выдача по заявке #${id}`, id, request.user.id]);

      await db.query(`
        UPDATE cash_requests
        SET status = 'money_issued',
            issued_by = $1,
            issued_at = NOW(),
            receipt_deadline = NOW() + INTERVAL '12 hours',
            overdue_notified = false,
            updated_at = NOW()
        WHERE id = $2
      `, [request.user.id, id]);

      await db.query('COMMIT');
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch (_) {}
      fastify.log.error({ err: e }, '[cash] /issue (cash-route) error');
      return reply.code(500).send({ error: 'Не удалось выдать средства', detail: e.message });
    }

    // Уведомление РП
    if (req.user_id && req.user_id !== request.user.id) {
      createNotification(db, {
        user_id: req.user_id,
        title: '💰 Деньги выданы — подтвердите получение',
        message: `${request.user.name || 'Бухгалтер'} выдал ${amount} ₽. Подтвердите получение в течение 12 часов.`,
        type: 'cash',
        link: `#/cash?id=${id}`
      });
    }

    // Уведомление директорам
    const directors = await db.query(
      `SELECT id FROM users WHERE role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV') AND is_active = true`
    );
    for (const dir of directors.rows) {
      if (dir.id !== request.user.id) {
        createNotification(db, {
          user_id: dir.id,
          title: '💰 Деньги выданы из кассы',
          message: `${request.user.name || 'Бухгалтер'} выдал ${amount} ₽ по заявке #${id}`,
          type: 'cash',
          link: `#/cash-admin?id=${id}`
        });
      }
    }

    return { success: true, message: 'Деньги выданы' };
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/reject — Директор отклоняет
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/reject', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { comment } = request.body || {};
    if (!comment || !comment.trim()) {
      return reply.code(400).send({ error: 'Укажите причину отклонения' });
    }

    const check = await db.query('SELECT status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (!['requested', 'approved'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Заявку нельзя отклонить в текущем статусе' });
    }

    await db.query(`
      UPDATE cash_requests
      SET status = 'rejected',
          director_id = $1,
          director_comment = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [request.user.id, comment.trim(), id]);

    // Notify requesting user about rejection
    const { rows: [rejReq] } = await db.query('SELECT * FROM cash_requests WHERE id = $1', [id]);
    if (rejReq && rejReq.user_id && rejReq.user_id !== request.user.id) {
      createNotification(db, {
        user_id: rejReq.user_id,
        title: '❌ Заявка на аванс отклонена',
        message: `${request.user.name || 'Директор'} отклонил заявку. Причина: ${comment.trim()}`,
        type: 'cash',
        link: `#/cash?id=${id}`
      });
    }

    return { success: true, message: 'Заявка отклонена' };
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/question — Директор задаёт вопрос
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/question', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { message } = request.body || {};
    if (!message || !message.trim()) {
      return reply.code(400).send({ error: 'Напишите вопрос' });
    }

    const check = await db.query('SELECT status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    // Переводим в статус question и добавляем сообщение
    await db.query(`
      UPDATE cash_requests
      SET status = 'question',
          director_id = $1,
          updated_at = NOW()
      WHERE id = $2
    `, [request.user.id, id]);

    await db.query(`
      INSERT INTO cash_messages (request_id, user_id, message)
      VALUES ($1, $2, $3)
    `, [id, request.user.id, message.trim()]);

    // Notify requesting user about question
    const { rows: [qReq] } = await db.query('SELECT user_id FROM cash_requests WHERE id = $1', [id]);
    if (qReq && qReq.user_id && qReq.user_id !== request.user.id) {
      createNotification(db, {
        user_id: qReq.user_id,
        title: '❓ Вопрос по заявке на аванс',
        message: `${request.user.name || 'Директор'} задал вопрос: ${message.trim().substring(0, 100)}`,
        type: 'cash',
        link: `#/cash?id=${id}`
      });
    }

    return { success: true, message: 'Вопрос отправлен' };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/cash/:id/reply — РП отвечает на вопрос
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/:id/reply', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { message } = request.body || {};
    if (!message || !message.trim()) {
      return reply.code(400).send({ error: 'Напишите ответ' });
    }

    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    // IDOR: только владелец
    if (check.rows[0].user_id !== request.user.id) {
      return reply.code(403).send({ error: 'Это не ваша заявка' });
    }

    // Добавляем сообщение и возвращаем в requested
    await db.query(`
      INSERT INTO cash_messages (request_id, user_id, message)
      VALUES ($1, $2, $3)
    `, [id, request.user.id, message.trim()]);

    if (check.rows[0].status === 'question') {
      await db.query(`
        UPDATE cash_requests SET status = 'requested', updated_at = NOW() WHERE id = $1
      `, [id]);
    }

    // Notify director about reply
    const { rows: [rReq] } = await db.query('SELECT director_id FROM cash_requests WHERE id = $1', [id]);
    if (rReq && rReq.director_id && rReq.director_id !== request.user.id) {
      createNotification(db, {
        user_id: rReq.director_id,
        title: '💬 Ответ по заявке на аванс',
        message: `${request.user.name || 'РП'} ответил на вопрос: ${message.trim().substring(0, 100)}`,
        type: 'cash',
        link: `#/cash?id=${id}`
      });
    }

    return { success: true, message: 'Ответ отправлен' };
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/receive — РП подтверждает получение денег
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/receive', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (Number(check.rows[0].user_id) !== Number(request.user.id)) {
      return reply.code(403).send({ error: 'Это не ваша заявка' });
    }

    // Обратная совместимость: принимаем approved и money_issued
    if (!['approved', 'money_issued'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Подтвердить получение можно только после согласования или выдачи' });
    }

    await db.query(`
      UPDATE cash_requests
      SET status = 'received',
          received_at = NOW(),
          receipt_deadline = NULL,
          updated_at = NOW()
      WHERE id = $1
    `, [id]);

    return { success: true, message: 'Получение подтверждено' };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/cash/:id/expense — Добавить расход (с чеком)
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/:id/expense', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    // Проверка заявки
    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (check.rows[0].user_id !== request.user.id) {
      return reply.code(403).send({ error: 'Это не ваша заявка' });
    }

    if (!['received', 'reporting'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Добавлять расходы можно только после получения денег' });
    }

    // Парсим multipart
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'Загрузите чек' });
    }

    const fields = {};
    for (const [key, val] of Object.entries(data.fields)) {
      fields[key] = val.value;
    }

    const amount = parseFloat(fields.amount);
    const description = fields.description;
    const expense_date = fields.expense_date || null;
    const category = fields.category || 'other';

    if (!amount || amount <= 0) {
      return reply.code(400).send({ error: 'Сумма должна быть больше 0' });
    }
    if (!description || !description.trim()) {
      return reply.code(400).send({ error: 'Укажите описание расхода' });
    }

    // Сохраняем файл
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const ext = path.extname(data.filename) || '.jpg';
    const filename = `receipt_${randomUUID()}${ext}`;
    const filepath = path.join(uploadDir, filename);

    await fs.mkdir(uploadDir, { recursive: true });
    const buffer = await data.toBuffer();
    await fs.writeFile(filepath, buffer);

    // Записываем в БД
    const { rows } = await db.query(`
      INSERT INTO cash_expenses (request_id, amount, description, category, receipt_file, receipt_original_name, expense_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, amount, description.trim(), category, filename, data.filename, expense_date]);

    // Переводим в reporting если был received
    if (check.rows[0].status === 'received') {
      await db.query(`UPDATE cash_requests SET status = 'reporting', updated_at = NOW() WHERE id = $1`, [id]);
    }

    return rows[0];
  });

  // ─────────────────────────────────────────────────────────────────
  // DELETE /api/cash/:id/expense/:expenseId — Удалить расход
  // ─────────────────────────────────────────────────────────────────
  fastify.delete('/:id/expense/:expenseId', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const expenseId = parseInt(request.params.expenseId);
    if (isNaN(id) || isNaN(expenseId)) return reply.code(400).send({ error: 'Invalid id' });

    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (check.rows[0].user_id !== request.user.id && !isDirector(request.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    if (!['received', 'reporting'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Удалять расходы можно только в статусах received/reporting' });
    }

    // Получаем файл для удаления
    const exp = await db.query('SELECT receipt_file FROM cash_expenses WHERE id = $1 AND request_id = $2', [expenseId, id]);
    if (!exp.rows[0]) return reply.code(404).send({ error: 'Расход не найден' });

    // Удаляем файл
    if (exp.rows[0].receipt_file) {
      const uploadDir = process.env.UPLOAD_DIR || './uploads';
      const filepath = path.join(uploadDir, exp.rows[0].receipt_file);
      try {
        await fs.unlink(filepath);
      } catch (e) {
        // Файл мог быть удалён ранее
      }
    }

    await db.query('DELETE FROM cash_expenses WHERE id = $1', [expenseId]);

    return { success: true, message: 'Расход удалён' };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/cash/:id/return — РП возвращает остаток
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/:id/return', {
    preHandler: [fastify.requirePermission('cash', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { amount, note } = request.body || {};

    if (!amount || amount <= 0) {
      return reply.code(400).send({ error: 'Сумма возврата должна быть больше 0' });
    }

    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (check.rows[0].user_id !== request.user.id) {
      return reply.code(403).send({ error: 'Это не ваша заявка' });
    }

    if (!['received', 'reporting'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Возврат возможен только после получения денег' });
    }

    // Проверяем что не возвращаем больше чем остаток
    const balance = await calcRequestBalance(id);
    if (amount > balance.remainder) {
      return reply.code(400).send({ error: `Остаток: ${balance.remainder}. Нельзя вернуть больше.` });
    }

    const { rows } = await db.query(`
      INSERT INTO cash_returns (request_id, amount, note)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, amount, note || null]);

    return rows[0];
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/return/:returnId/confirm — Директор подтверждает возврат
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/return/:returnId/confirm', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const returnId = parseInt(request.params.returnId);
    if (isNaN(id) || isNaN(returnId)) return reply.code(400).send({ error: 'Invalid id' });

    const ret = await db.query(
      'SELECT * FROM cash_returns WHERE id = $1 AND request_id = $2',
      [returnId, id]
    );
    if (!ret.rows[0]) return reply.code(404).send({ error: 'Возврат не найден' });

    if (ret.rows[0].confirmed_at) {
      return reply.code(400).send({ error: 'Возврат уже подтверждён' });
    }

    // Stage W (баг #1): подтверждение возврата (увеличивает баланс) обёрнуто
    // в advisory_xact_lock — без него параллельные подтверждения теряли бы суммы.
    const returnAmount = parseFloat(ret.rows[0].amount) || 0;
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock($1)', [CASH_ADVISORY_LOCK_KEY]);

      // Внутри блокировки повторно убеждаемся, что возврат ещё не подтверждён
      // (race-safe: между первой проверкой и BEGIN могла пройти другая транзакция).
      const { rows: [retFresh] } = await db.query(
        'SELECT confirmed_at FROM cash_returns WHERE id = $1 FOR UPDATE',
        [returnId]
      );
      if (retFresh && retFresh.confirmed_at) {
        await db.query('ROLLBACK');
        return reply.code(409).send({ error: 'Возврат уже подтверждён (race)' });
      }

      await db.query(`
        UPDATE cash_returns
        SET confirmed_by = $1, confirmed_at = NOW()
        WHERE id = $2
      `, [request.user.id, returnId]);

      const { rows: [bal] } = await db.query(
        'SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1'
      );
      const currentBalance = bal ? parseFloat(bal.amount) : 0;
      const newBalance = currentBalance + returnAmount;

      await db.query(`
        INSERT INTO cash_balance_log (amount, change_amount, change_type, description, related_request_id, user_id)
        VALUES ($1, $2, 'return', $3, $4, $5)
      `, [newBalance, returnAmount, `Возврат по заявке #${id}`, id, request.user.id]);

      await db.query('COMMIT');
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch (_) {}
      fastify.log.error({ err: e }, '[cash] return/confirm error');
      return reply.code(500).send({ error: 'Не удалось подтвердить возврат', detail: e.message });
    }

    return { success: true, message: 'Возврат подтверждён' };
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/submit-report — PM подаёт авансовый отчёт
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/submit-report', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const check = await db.query('SELECT user_id, status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (check.rows[0].user_id !== request.user.id) {
      return reply.code(403).send({ error: 'Только автор заявки может подать отчёт' });
    }

    if (!['received', 'reporting'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Отчитаться можно только по полученным средствам' });
    }

    // Change status to reporting
    await db.query(
      `UPDATE cash_requests SET status = 'reporting', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    // Notify directors
    const { rows: directors } = await db.query(
      "SELECT id FROM users WHERE role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_FIN') AND active = true"
    );
    for (const d of directors) {
      createNotification(db, {
        user_id: d.id,
        title: 'Авансовый отчёт подан',
        message: (request.user.name || 'Сотрудник') + ' подал авансовый отчёт по заявке #' + id,
        type: 'cash',
        link: '#/cash?id=' + id
      });
    }

    return { success: true, message: 'Отчёт подан' };
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/cash/:id/close — Директор закрывает заявку
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id/close', {
    preHandler: [fastify.requirePermission('cash_admin', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { comment, force } = request.body || {};

    const check = await db.query('SELECT status FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (!['received', 'reporting'].includes(check.rows[0].status)) {
      return reply.code(400).send({ error: 'Закрыть можно только заявки в статусе received/reporting' });
    }

    // Проверяем баланс
    const balance = await calcRequestBalance(id);
    if (balance.remainder > 0 && !force) {
      return reply.code(400).send({
        error: `Остаток ${balance.remainder}. Используйте force=true для принудительного закрытия.`,
        remainder: balance.remainder
      });
    }

    await db.query(`
      UPDATE cash_requests
      SET status = 'closed',
          director_id = $1,
          director_comment = COALESCE(director_comment, '') || $2,
          closed_at = NOW(),
          updated_at = NOW()
      WHERE id = $3
    `, [request.user.id, comment ? '\n' + comment : '', id]);

    // Notify requesting user about closure
    const { rows: [closeReq] } = await db.query('SELECT user_id FROM cash_requests WHERE id = $1', [id]);
    if (closeReq && closeReq.user_id && closeReq.user_id !== request.user.id) {
      createNotification(db, {
        user_id: closeReq.user_id,
        title: '🔒 Заявка на аванс закрыта',
        message: `${request.user.name || 'Директор'} закрыл заявку${comment ? ': ' + comment : ''}`,
        type: 'cash',
        link: `#/cash?id=${id}`
      });
    }

    return { success: true, message: 'Заявка закрыта' };
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/cash/:id/receipt/:filename — Получить файл чека
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/:id/receipt/:filename', {
    preHandler: [
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate
    ]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const filename = request.params.filename;

    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    // Проверяем доступ
    const check = await db.query('SELECT user_id FROM cash_requests WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });

    if (check.rows[0].user_id !== request.user.id && !isBuhOrDirector(request.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    // Проверяем что файл принадлежит этой заявке
    const exp = await db.query(
      'SELECT receipt_file FROM cash_expenses WHERE request_id = $1 AND receipt_file = $2',
      [id, filename]
    );
    if (!exp.rows[0]) return reply.code(404).send({ error: 'Файл не найден' });

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const filepath = path.join(uploadDir, filename);

    try {
      const stat = await fs.stat(filepath);
      const file = await fs.readFile(filepath);

      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf',
        '.webp': 'image/webp'
      };

      reply.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      reply.header('Content-Length', stat.size);
      return reply.send(file);
    } catch (e) {
      return reply.code(404).send({ error: 'Файл не найден' });
    }
  });
};
