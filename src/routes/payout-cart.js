'use strict';

/**
 * Payout Cart — корзина выплат + согласование директором (V391).
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/payout-cart
 *
 * Поток (ТЗ заказчика 14–15.10.2026):
 *   Дима собирает корзину (draft) → «Отправить на согласование» (submit)
 *   → директор одобряет поштучно или всю списку (approve) ИЛИ возвращает с причиной
 *   (reject) → Дима выплачивает ТОЛЬКО одобренные (POST /api/payouts/pay).
 *
 * ПЕРЕСОГЛАСОВАНИЕ: если Дима правит уже одобренную позицию — одобрение
 * снимается (`reapprove`), выплата снова блокируется до нового решения директора.
 * Иначе после одобрения можно было бы подменить сумму, и контроль терялся.
 *
 * Доступ: корзину ведёт payout-менеджер (requirePayoutAccess, Дима/директора);
 * решения — по роли директора (DIRECTOR_COMM главный, см. APPROVER_ROLES).
 */

const { requirePayoutAccess } = require('../lib/payouts-access');
const { loadPayoutCalcSettings, calcPayout } = require('../lib/payout-calc');
const { logError } = require('../lib/log-error');
const { sendHuman } = require('../lib/human-error');

// Кто согласует выплаты: DIRECTOR_COMM (главный), backup — прочие директора.
const APPROVER_ROLES = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV', 'ADMIN'];

function isValidPeriod(y, m) {
  return Number.isInteger(y) && y >= 2020 && y <= 2099 && Number.isInteger(m) && m >= 1 && m <= 12;
}
function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

async function routes(fastify) {
  const db = fastify.db;
  const cartAuth = { preHandler: [requirePayoutAccess(fastify)] };

  /** Есть ли у пользователя право согласовывать выплаты (роль директора). */
  function canApprove(user) {
    return !!(user && APPROVER_ROLES.includes(user.role));
  }
  function requireApprover(fastify) {
    return async function (request, reply) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
      if (!canApprove(request.user)) {
        reply.code(403).send({ error: 'Forbidden', message: 'Согласовывать выплаты может только директор' });
      }
    };
  }
  const approverAuth = { preHandler: [requireApprover(fastify)] };

  // ─── GET /:year/:month — корзина (черновики) за период ────────────────────
  // Возвращает позиции текущего черновика Димы + списка на согласовании и
  // одобренные, чтобы фронт одним запросом отрисовал все состояния строк.
  fastify.get('/:year/:month', cartAuth, async (request, reply) => {
    const y = parseInt(request.params.year, 10);
    const m = parseInt(request.params.month, 10);
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    const userId = request.user.id;
    try {
      // Черновик текущего пользователя за период
      const { rows: drafts } = await db.query(`
        SELECT b.id AS batch_id, b.status, b.submitted_at, b.decision_comment,
               i.id AS item_id, i.employee_id, i.kind, i.pay_amount, i.transfer_amount,
               i.info_amount, i.tax_amount, i.approval_status, i.reject_reason,
               i.payee_employee_id, i.comment, i.reapproved, i.official_transfer,
               -- V391: способ нужен клиенту, чтобы показать ставку налога/сбора
               -- (СЗ → сбор+НДС 22%, НДФЛ → +15%, наличные → 1:1). Без этих
               -- полей корзина РП показывала «1:1» даже для самозанятых.
               e.is_self_employed,
               COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID '||e.id) AS fio
          FROM payout_batches b
          JOIN payout_batch_items i ON i.batch_id = b.id
          JOIN employees e ON e.id = i.employee_id
         WHERE b.period_year = $1 AND b.period_month = $2
           AND b.status <> 'cancelled'
         ORDER BY b.id DESC, i.id
      `, [y, m]);
      return reply.send({ year: y, month: m, items: drafts, my_user_id: userId });
    } catch (err) {
      logError(fastify, '[payout-cart] GET /:year/:month error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /draft — сохранить позицию в черновик ───────────────────────────
  // Тело: { employee_id, year, month, kind, pay_amount, payee_employee_id?,
  //         comment?, official_transfer? }
  // Идемпотентно: повторный вызов обновляет позицию того же сотрудника.
  // Если позиция была ОДОБРЕНА и сумма изменилась — снимаем одобрение
  // (reapproved=true) и возвращаем списку в очередь согласования (пересогласование).
  fastify.post('/draft', cartAuth, async (request, reply) => {
    const b = request.body || {};
    const empId = parseInt(b.employee_id, 10);
    const y = parseInt(b.year, 10);
    const m = parseInt(b.month, 10);
    const kind = b.kind === 'advance' ? 'advance' : 'salary';
    if (!Number.isInteger(empId) || empId <= 0) return reply.code(400).send({ error: 'employee_id обязателен' });
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    const payAmount = parseMoney(b.pay_amount);
    if (payAmount === null || payAmount <= 0) return reply.code(400).send({ error: 'invalid_amount', message: 'Сумма выплаты должна быть больше нуля.', hint: 'Введите сумму в рублях (например 15000) и повторите.' });

    const userId = request.user.id;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [empId, 9000000 + (y % 100) * 100 + m]);

      const { rows: empRows } = await client.query(
        `SELECT id, is_self_employed FROM employees WHERE id = $1`, [empId]);
      if (!empRows.length) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Сотрудник не найден' }); }
      const isSe = !!empRows[0].is_self_employed;

      // Ищем ОТКРЫТЫЙ черновик этого пользователя за период. Черновик один:
      // если его нет — создаём. Раньше INSERT ... ON CONFLICT без уникального
      // индекса всегда вставлял новую списку → позиции расходились по разным
      // списокм и пересогласование не срабатывало.
      let batchId = null;
      const { rows: draftRows } = await client.query(`
        SELECT id FROM payout_batches
         WHERE period_year=$1 AND period_month=$2 AND created_by=$3
           AND status IN ('draft','rejected','partially_approved','pending_approval','approved')
         ORDER BY (status = 'draft') DESC, id DESC
         LIMIT 1`, [y, m, userId]);
      if (draftRows[0]) batchId = draftRows[0].id;
      if (!batchId) {
        const { rows } = await client.query(`
          INSERT INTO payout_batches (period_year, period_month, status, created_by)
          VALUES ($1, $2, 'draft', $3) RETURNING id`, [y, m, userId]);
        batchId = rows[0].id;
      }

      const calcSettings = await loadPayoutCalcSettings(client);
      const calc = calcPayout({
        payAmount, isSelfEmployed: isSe,
        officialTransfer: b.official_transfer === true,
        transferAmountManual: b.transfer_amount != null ? parseMoney(b.transfer_amount) : null,
        settings: calcSettings,
      });

      // Была ли позиция уже одобрена? Тогда правка = пересогласование.
      const { rows: prev } = await client.query(
        `SELECT id, approval_status, pay_amount FROM payout_batch_items
          WHERE batch_id=$1 AND employee_id=$2`, [batchId, empId]);
      const wasApproved = prev[0] && prev[0].approval_status === 'approved';
      const amountChanged = prev[0] && Number(prev[0].pay_amount) !== payAmount;
      const needReapprove = wasApproved && amountChanged;

      const { rows: ins } = await client.query(`
        INSERT INTO payout_batch_items
          (batch_id, employee_id, kind, pay_amount, transfer_amount, info_amount, tax_amount,
           official_transfer, payout_platform, payee_employee_id, comment, approval_status, reapproved)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (batch_id, employee_id) DO UPDATE SET
          kind = EXCLUDED.kind,
          pay_amount = EXCLUDED.pay_amount,
          transfer_amount = EXCLUDED.transfer_amount,
          info_amount = EXCLUDED.info_amount,
          tax_amount = EXCLUDED.tax_amount,
          official_transfer = EXCLUDED.official_transfer,
          payout_platform = EXCLUDED.payout_platform,
          payee_employee_id = EXCLUDED.payee_employee_id,
          comment = EXCLUDED.comment,
          approval_status = EXCLUDED.approval_status,
          reapproved = EXCLUDED.reapproved,
          reject_reason = NULL
        RETURNING id, employee_id, pay_amount, approval_status, reapproved
      `, [batchId, empId, kind, payAmount, calc.transferAmount, calc.infoAmount, calc.taxAmount,
        calc.officialTransfer, isSe ? 'restaff' : (calc.officialTransfer ? 'bank' : 'cash'),
        b.payee_employee_id ? parseInt(b.payee_employee_id, 10) : null,
        b.comment || null, needReapprove ? 'pending' : (prev[0] ? prev[0].approval_status : 'pending'),
        !!needReapprove]);

      if (needReapprove) {        await client.query(`
          UPDATE payout_batches SET status='pending_approval', submitted_at=NOW(), updated_at=NOW()
           WHERE id=$1`, [batchId]);
      }

      await client.query('COMMIT');
      return reply.send({
        ok: true, batch_id: batchId, item: ins[0],
        reapproved: !!needReapprove,
        message: needReapprove ? 'Сумма изменена — требуется повторное согласование' : 'Сохранено в корзину',
      });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      logError(fastify, '[payout-cart] POST /draft error', err, request);
      return sendHuman(reply, err);
    } finally {
      client.release();
    }
  });

  // ─── DELETE /items/:id — убрать позицию из корзины ────────────────────────
  fastify.delete('/items/:id', cartAuth, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      const { rows } = await db.query(`
        DELETE FROM payout_batch_items i
         USING payout_batches b
         WHERE i.id = $1 AND b.id = i.batch_id AND b.status = 'draft'
        RETURNING i.id`, [id]);
      if (!rows.length) return reply.code(409).send({ error: 'Позиция не найдена или уже отправлена на согласование' });
      return reply.send({ ok: true });
    } catch (err) {
      logError(fastify, '[payout-cart] DELETE /items error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /submit — отправить корзину на согласование ─────────────────────
  // Тело: { batch_id?, year, month }
  // Отправляем ТОЛЬКО неодобренные позиции; уже одобренные не трогаем.
  fastify.post('/submit', cartAuth, async (request, reply) => {
    const b = request.body || {};
    const y = parseInt(b.year, 10), m = parseInt(b.month, 10);
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    const userId = request.user.id;
    try {
      let batchId = b.batch_id ? parseInt(b.batch_id, 10) : null;
      if (!batchId) {
        const { rows } = await db.query(`
          SELECT id FROM payout_batches
           WHERE period_year=$1 AND period_month=$2 AND status='draft' AND created_by=$3
           ORDER BY id DESC LIMIT 1`, [y, m, userId]);
        if (rows[0]) batchId = rows[0].id;
      }
      if (!batchId) return reply.code(404).send({ error: 'Черновик не найден' });

      const { rows: cnt } = await db.query(
        `SELECT count(*)::int AS n FROM payout_batch_items WHERE batch_id=$1`, [batchId]);
      if (!cnt[0].n) return reply.code(400).send({ error: 'Корзина пуста' });

      await db.query(`
        UPDATE payout_batches
           SET status='pending_approval', submitted_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND status IN ('draft','partially_approved','rejected')`, [batchId]);

      // Уведомляем директоров (канал — notify.js: DB + SSE + Telegram + push).
      try {
        const { rows: emps } = await db.query(
          `SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active IS NOT FALSE`, [APPROVER_ROLES]);
        const notify = require('../services/notify');
        const { rows: sumRows } = await db.query(
          `SELECT SUM(pay_amount)::numeric AS s, count(*)::int AS n FROM payout_batch_items WHERE batch_id=$1`, [batchId]);
        for (const d of emps) {
          await notify.createNotification(db, {
            user_id: d.id,
            title: 'Список выплат на согласование',
            message: `${sumRows[0].n} получателей · ${Math.round(Number(sumRows[0].s))} ₽`,
            type: 'approval',
            link: '#/approval-payment',
          });
        }
      } catch (e) { fastify.log.warn('[payout-cart] notify fail: ' + e.message); }

      return reply.send({ ok: true, batch_id: batchId, status: 'pending_approval' });
    } catch (err) {
      logError(fastify, '[payout-cart] POST /submit error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── GET /pending — очередь согласования для директора ─────────────────────────
  fastify.get('/pending', approverAuth, async (request, reply) => {
    try {
      const { rows } = await db.query(`
        SELECT b.id AS batch_id, b.period_year, b.period_month, b.status, b.submitted_at,
               COALESCE(NULLIF(TRIM(u.name),''), u.login, 'ID '||u.id) AS created_by_name,
               i.id AS item_id, i.employee_id, i.kind, i.pay_amount, i.transfer_amount,
               i.info_amount, i.tax_amount, i.approval_status, i.reject_reason, i.reapproved,
               i.comment, i.payee_employee_id, i.official_transfer,
               COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID '||e.id) AS fio,
               e.is_self_employed, e.is_officially_employed,
               COALESCE(NULLIF(TRIM(pe.fio),''), NULLIF(TRIM(pe.full_name),'')) AS payee_fio,
               -- V391: данные для карточки согласования (как в рендере) —
               -- остаток, начислено и свободный остаток лимита НПД.
               COALESCE(debt.carry_debt, 0)::numeric  AS carry_debt,
               COALESCE(debt.carry_adv, 0)::numeric  AS carry_advance,
               COALESCE(acc.accrued, 0)::numeric     AS accrued,
               CASE WHEN COALESCE(pe.can_exceed_limit, e.can_exceed_limit, false) THEN NULL
                    ELSE GREATEST(0, COALESCE(lim.monthly_limit, 350000)
                       - CASE WHEN (COALESCE(pe.se_monthly_used_initial, e.se_monthly_used_initial) ->> 'year')::int = b.period_year
                               AND (COALESCE(pe.se_monthly_used_initial, e.se_monthly_used_initial) ->> 'month')::int = b.period_month
                              THEN COALESCE((COALESCE(pe.se_monthly_used_initial, e.se_monthly_used_initial) ->> 'amount')::numeric, 0)
                              ELSE 0 END)
               END AS se_remaining
          FROM payout_batches b
          JOIN payout_batch_items i ON i.batch_id = b.id
          JOIN employees e ON e.id = i.employee_id
          LEFT JOIN users u ON u.id = b.created_by
          LEFT JOIN employees pe ON pe.id = i.payee_employee_id
          -- долг с прошлых периодов (pending-записи до целевого месяца)
          LEFT JOIN LATERAL (
            SELECT SUM(CASE WHEN wp.type IN ('salary','bonus','per_diem','carry_adjustment') THEN wp.amount
                            WHEN wp.type = 'penalty' THEN -wp.amount ELSE 0 END) AS carry_debt,
                   SUM(CASE WHEN wp.type = 'advance' THEN wp.amount ELSE 0 END) AS carry_adv
              FROM worker_payments wp
             WHERE wp.employee_id = i.employee_id AND wp.status = 'pending'
               AND (COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)::int) * 100
                    + COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int))
                   < (b.period_year * 100 + b.period_month)
          ) debt ON TRUE
          -- начислено за период (ФОТ месяца)
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(fc.amount_earned), 0) AS accrued
              FROM field_checkins fc
             WHERE fc.employee_id = i.employee_id AND fc.status = 'completed'
               AND EXTRACT(YEAR FROM fc.date)::int = b.period_year
               AND EXTRACT(MONTH FROM fc.date)::int = b.period_month
          ) acc ON TRUE
          -- лимит НПД из настроек (дефолт 350 000)
          LEFT JOIN LATERAL (
            SELECT COALESCE(NULLIF(REGEXP_REPLACE(value_json, '[^0-9.]', '', 'g'), '')::numeric, 350000) AS monthly_limit
              FROM settings WHERE key = 'self_employed_monthly_limit' LIMIT 1
          ) lim ON TRUE
         WHERE b.status IN ('pending_approval','partially_approved')
           AND i.approval_status = 'pending'
         ORDER BY b.submitted_at ASC NULLS LAST, b.id DESC, i.id
      `);
      return reply.send({ items: rows, count: rows.length });
    } catch (err) {
      logError(fastify, '[payout-cart] GET /pending error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── GET /to-pay — одобрено, но ещё НЕ выплачено ─────────────────────────
  // 19.10.2026: виджет «К исполнению» считает именно эти позиции (см.
  // director-summary/queues → toExecute.payouts). Раньше мобильная вкладка
  // «Выплаты» показывала только pending, поэтому цифры расходились: на главной
  // «3 к выплате», а в списке — пусто. Теперь вкладка тянет этот же срез.
  // Условие 1:1 как в виджете — approved + факт перевода ещё не записан.
  fastify.get('/to-pay', approverAuth, async (request, reply) => {
    try {
      const { rows } = await db.query(`
        SELECT i.id AS item_id, i.batch_id, i.employee_id, i.kind, i.pay_amount,
               i.transfer_amount, i.info_amount, i.tax_amount, i.payee_employee_id,
               i.official_transfer, i.comment, i.approved_at,
               b.period_year, b.period_month,
               COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID '||e.id) AS fio,
               e.is_self_employed
          FROM payout_batch_items i
          JOIN payout_batches b ON b.id = i.batch_id
          JOIN employees e ON e.id = i.employee_id
         WHERE i.approval_status = 'approved' AND b.status <> 'cancelled'
           AND NOT EXISTS (
             SELECT 1 FROM worker_payments wp
              WHERE wp.employee_id = i.employee_id
                AND wp.status IN ('paid','confirmed')
                AND COALESCE(wp.pay_year,  EXTRACT(YEAR  FROM wp.created_at)::int) = b.period_year
                AND COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) = b.period_month)
         ORDER BY i.approved_at ASC NULLS LAST, i.id`);
      return reply.send({ items: rows, count: rows.length });
    } catch (err) {
      logError(fastify, '[payout-cart] GET /to-pay error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /items/:id/approve — одобрить позицию ──────────────────────────
  fastify.post('/items/:id/approve', approverAuth, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      // ─── V392: принцип «четыре глаза» (SoD) ──────────────────────────────
      // Нельзя одобрять список, который создал сам: DIRECTOR_COMM владеет и
      // cartAuth, и approverAuth — иначе он утверждает сам себе
      // (F5, верификатор 16.10.2026). ADMIN — исключение (техническая роль).
      if (request.user.role !== 'ADMIN') {
        const { rows: own } = await db.query(`
          SELECT b.created_by FROM payout_batch_items i
            JOIN payout_batches b ON b.id = i.batch_id
           WHERE i.id = $1`, [id]);
        if (own.length && Number(own[0].created_by) === Number(request.user.id)) {
          return reply.code(409).send({
            error: 'self_approval_forbidden',
            message: 'Нельзя согласовать список, который вы сами создали — нужен другой согласующий.',
            requires_approval: true,
          });
        }
      }
      const { rows } = await db.query(`
        UPDATE payout_batch_items
           SET approval_status='approved', approved_by=$1, approved_at=NOW(), reapproved=false, reject_reason=NULL
         WHERE id=$2 AND approval_status='pending'
         RETURNING id, batch_id, employee_id`, [request.user.id, id]);
      if (!rows.length) return reply.code(404).send({ error: 'Позиция не найдена или уже решена' });
      await syncBatchStatus(db, rows[0].batch_id);
      return reply.send({ ok: true, item: rows[0] });
    } catch (err) {
      logError(fastify, '[payout-cart] approve item error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /items/:id/reject — вернуть позицию Диме с причиной ────────────
  fastify.post('/items/:id/reject', approverAuth, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const reason = ((request.body || {}).reason || '').toString().trim();
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    if (!reason) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину возврата' });
    try {
      const { rows } = await db.query(`
        UPDATE payout_batch_items
           SET approval_status='rejected', reject_reason=$1, approved_by=$2, approved_at=NOW(), reapproved=false
         WHERE id=$3 AND approval_status='pending'
         RETURNING id, batch_id, employee_id`, [reason, request.user.id, id]);
      if (!rows.length) return reply.code(404).send({ error: 'Позиция не найдена или уже решена' });
      await syncBatchStatus(db, rows[0].batch_id);
      return reply.send({ ok: true, item: rows[0] });
    } catch (err) {
      logError(fastify, '[payout-cart] reject item error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /batch/:id/approve-all — утвердить список целиком ───────────────
  fastify.post('/batch/:id/approve-all', approverAuth, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      // V392: SoD — нельзя утвердить список, созданный самим (кроме ADMIN).
      if (request.user.role !== 'ADMIN') {
        const { rows: own } = await db.query(`SELECT created_by FROM payout_batches WHERE id=$1`, [id]);
        if (own.length && Number(own[0].created_by) === Number(request.user.id)) {
          return reply.code(409).send({
            error: 'self_approval_forbidden',
            message: 'Нельзя согласовать список, который вы сами создали — нужен другой согласующий.',
            requires_approval: true,
          });
        }
      }
      const { rows } = await db.query(`
        UPDATE payout_batch_items
           SET approval_status='approved', approved_by=$1, approved_at=NOW(), reapproved=false, reject_reason=NULL
         WHERE batch_id=$2 AND approval_status='pending'
         RETURNING id`, [request.user.id, id]);
      await db.query(`
        UPDATE payout_batches SET status='approved', decided_by=$1, decided_at=NOW(), updated_at=NOW()
         WHERE id=$2 AND status IN ('pending_approval','partially_approved')`, [request.user.id, id]);
      return reply.send({ ok: true, approved: rows.length });
    } catch (err) {
      logError(fastify, '[payout-cart] approve-all error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /batch/:id/reject — вернуть весь список Диме ─────────────────────
  fastify.post('/batch/:id/reject', approverAuth, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const reason = ((request.body || {}).reason || 'вернул всю списку').toString().trim();
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      const { rows } = await db.query(`
        UPDATE payout_batch_items
           SET approval_status='rejected', reject_reason=$1, approved_by=$2, approved_at=NOW()
         WHERE batch_id=$3 AND approval_status='pending'
         RETURNING id`, [reason, request.user.id, id]);
      await db.query(`
        UPDATE payout_batches SET status='rejected', decided_by=$1, decided_at=NOW(),
               decision_comment=$2, updated_at=NOW()
         WHERE id=$3`, [request.user.id, reason, id]);
      return reply.send({ ok: true, rejected: rows.length });
    } catch (err) {
      logError(fastify, '[payout-cart] reject-batch error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /reapprove/:employeeId — снять одобрение после правки ──────────
  // Явная ручка для фронта: Дима нажал «Поправить» и сохранил новую сумму.
  fastify.post('/reapprove/:employeeId', cartAuth, async (request, reply) => {
    const empId = parseInt(request.params.employeeId, 10);
    const y = parseInt((request.body || {}).year, 10);
    const m = parseInt((request.body || {}).month, 10);
    if (!Number.isInteger(empId) || empId <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    try {
      const { rows } = await db.query(`
        UPDATE payout_batch_items i
           SET approval_status='pending', reapproved=true, approved_by=NULL, approved_at=NULL
          FROM payout_batches b
         WHERE i.batch_id = b.id AND i.employee_id = $1
           AND b.period_year = $2 AND b.period_month = $3
           AND i.approval_status = 'approved'
        RETURNING i.id, i.batch_id`, [empId, y, m]);
      if (!rows.length) return reply.code(404).send({ error: 'Одобренная позиция не найдена' });
      await syncBatchStatus(db, rows[0].batch_id, 'pending_approval');
      return reply.send({ ok: true, reapproved: rows.length });
    } catch (err) {
      logError(fastify, '[payout-cart] reapprove error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── GET /approved/:year/:month — что уже можно выплачивать ──────────────
  fastify.get('/approved/:year/:month', cartAuth, async (request, reply) => {
    const y = parseInt(request.params.year, 10);
    const m = parseInt(request.params.month, 10);
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    try {
      const { rows } = await db.query(`
        SELECT i.id AS item_id, i.batch_id, i.employee_id, i.kind, i.pay_amount,
               i.transfer_amount, i.info_amount, i.tax_amount, i.payee_employee_id,
               i.official_transfer, i.comment, i.approved_at,
               COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID '||e.id) AS fio,
               (SELECT count(*)::int FROM worker_payments wp
                 WHERE wp.employee_id = i.employee_id AND wp.status IN ('paid','confirmed')
                   AND COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)::int)=$1
                   AND COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int)=$2) AS paid_count
          FROM payout_batch_items i
          JOIN payout_batches b ON b.id = i.batch_id
          JOIN employees e ON e.id = i.employee_id
         WHERE b.period_year=$1 AND b.period_month=$2 AND i.approval_status='approved'
         ORDER BY i.id`, [y, m]);
      return reply.send({ year: y, month: m, items: rows });
    } catch (err) {
      logError(fastify, '[payout-cart] GET /approved error', err, request);
      return sendHuman(reply, err);
    }
  });
}

/** Пересчёт статуса списка по решениям по позициям. */
async function syncBatchStatus(db, batchId, force) {
  const { rows } = await db.query(`
    SELECT count(*) FILTER (WHERE approval_status='pending')::int AS pending,
           count(*) FILTER (WHERE approval_status='approved')::int AS approved,
           count(*) FILTER (WHERE approval_status='rejected')::int AS rejected
      FROM payout_batch_items WHERE batch_id=$1`, [batchId]);
  const s = rows[0] || { pending: 0, approved: 0, rejected: 0 };
  let status;
  if (force) status = force;
  else if (s.pending > 0) status = 'partially_approved';
  else if (s.approved > 0 && s.rejected === 0) status = 'approved';
  else if (s.rejected > 0 && s.approved === 0) status = 'rejected';
  else status = 'partially_approved';
  await db.query(`UPDATE payout_batches SET status=$1, updated_at=NOW() WHERE id=$2`, [status, batchId]);
}

module.exports = routes;
