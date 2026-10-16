'use strict';

/**
 * Payout Plan & Payment Schedule — план на 1-е число + график платежей (V391).
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/payout-plan
 *
 * Поток (ТЗ заказчика 15.10.2026):
 *   1-го числа директор открывает «Планирование выплат»: таблица рабочих с остатком
 *   к выплате, остаток месячного лимита НПД (350k), суммы к переводу и дата
 *   («не раньше этой даты»). Директор проставляет суммы (или «применить ко всем»),
 *   согласовывает → Дима получает их в корзину.
 *
 *   График платежей — сколько денег нужно в каждый день месяца, разбито по
 *   категориям (СЗ / наличка / НДФЛ) + «кому платим в этот день» по клику.
 *
 * Доступ: план правит и согласует директор (APPROVER_ROLES); читать может
 * payout-менеджер. Агрегат графика — payout-менеджер/директор.
 */

const { requirePayoutAccess } = require('../lib/payouts-access');
const { loadPayoutCalcSettings } = require('../lib/payout-calc');
const { buildPayoutRows } = require('../lib/payout-row');
const { logError } = require('../lib/log-error');
const { sendHuman } = require('../lib/human-error');

const APPROVER_ROLES = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV', 'ADMIN'];
const ND = (v) => (v === null || v === undefined ? null : v);

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
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

async function routes(fastify) {
  const db = fastify.db;
  const payAuth = { preHandler: [requirePayoutAccess(fastify)] };

  function requireApprover(fastify) {
    return async function (request, reply) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
      if (!(request.user && APPROVER_ROLES.includes(request.user.role))) {
        reply.code(403).send({ error: 'Forbidden', message: 'Планировать выплаты может только директор' });
      }
    };
  }
  const dirAuth = { preHandler: [requireApprover(fastify)] };

  /** Настройки лимита НПД (settings.self_employed_monthly_limit, дефолт 350000). */
  async function getMonthlyLimit() {
    try {
      const { rows } = await db.query(
        `SELECT value_json FROM settings WHERE key = 'self_employed_monthly_limit'`);
      if (rows[0]) {
        const v = parseFloat(String(rows[0].value_json).replace(/[^\d.\-]/g, ''));
        if (Number.isFinite(v) && v > 0) return v;
      }
    } catch (_) {}
    return 350000;
  }

  /** Остаток месячного лимита НПД по получателю (se_payee_id или сам рабочий).
   *  se_monthly_used_initial — jsonb {year, month, amount} — считаем в JS:
   *  если запись не на целевой месяц, расход за него = 0. */
  async function seRemainingMap(limit, y, m) {
    try {
      const { rows } = await db.query(`
        SELECT e.id AS employee_id,
               COALESCE(e.se_payee_id, e.id) AS limit_emp_id,
               COALESCE(pe.se_monthly_used_initial, e.se_monthly_used_initial) AS used_json,
               COALESCE(pe.can_exceed_limit, e.can_exceed_limit, false) AS can_exceed
          FROM employees e
          LEFT JOIN employees pe ON pe.id = e.se_payee_id
         WHERE COALESCE(e.is_active, true) = true`);
      const map = new Map();
      for (const r of rows) {
        let used = 0;
        const sm = r.used_json;
        if (sm && typeof sm === 'object' && sm.year === y && sm.month === m && typeof sm.amount === 'number') {
          used = sm.amount;
        }
        map.set(r.employee_id, {
          limit_emp_id: r.limit_emp_id,
          can_exceed: !!r.can_exceed,
          remaining: r.can_exceed ? null : Math.max(0, Math.round((limit - used) * 100) / 100),
        });
      }
      return map;
    } catch (e) { fastify.log.warn('[payout-plan] seRemainingMap: ' + e.message); return new Map(); }
  }

  // ─── GET /:year/:month — таблица планирования ─────────────────────────────
  fastify.get('/:year/:month', payAuth, async (request, reply) => {
    const y = parseInt(request.params.year, 10);
    const m = parseInt(request.params.month, 10);
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    try {
      const [list, limit, calcSettings] = await Promise.all([
        buildPayoutRows(db, y, m), getMonthlyLimit(), loadPayoutCalcSettings(db),
      ]);
      // Остаток НПД считаем от РЕАЛЬНОГО лимита (350 000). Раньше здесь стоял
      // seRemainingMap(0, …) — лимит=0 обнулял max_amount и через «по максимуму»
      // записывал самозанятым 0 ₽ (найдено независимым верификатором).
      const seMap = await seRemainingMap(limit, y, m);

      // существующий план (если уже сохранён)
      const { rows: planRows } = await db.query(
        `SELECT id, status FROM payout_plans WHERE period_year=$1 AND period_month=$2`, [y, m]);
      const planId = planRows[0] ? planRows[0].id : null;
      let items = [];
      if (planId) {
        const r = await db.query(`
          SELECT i.employee_id, i.to_transfer, i.max_amount, i.pay_date, i.payee_employee_id, i.approved, i.comment
            FROM payout_plan_items i WHERE i.plan_id=$1`, [planId]);
        items = r.rows;
      }
      const itemMap = new Map(items.map((i) => [i.employee_id, i]));

      const rows = list.rows.filter((r) => !r.overpaid || r.to_pay > 0).map((r) => {
        const se = seMap.get(r.employee_id) || {};
        const maxAmount = r.is_self_employed
          ? (se.can_exceed ? Math.max(0, r.to_pay) : Math.round(Math.min(r.to_pay, se.remaining || 0) * 100) / 100)
          : Math.max(0, r.to_pay);
        const saved = itemMap.get(r.employee_id);
        return {
          employee_id: r.employee_id,
          fio: r.fio,
          is_self_employed: !!r.is_self_employed,
          is_officially_employed: !!r.is_officially_employed,
          to_pay: r.to_pay,
          carry: r.carry,
          carry_debt: r.carry_debt,
          carry_advance: r.carry_advance,
          max_amount: saved ? num(saved.max_amount) : maxAmount,
          se_limit: r.is_self_employed ? limit : null,
          se_remaining: r.is_self_employed ? (se.can_exceed ? null : se.remaining) : null,
          se_can_exceed: !!se.can_exceed,
          to_transfer: saved ? num(saved.to_transfer) : 0,
          pay_date: saved && saved.pay_date ? new Date(saved.pay_date).toISOString().slice(0, 10) : null,
          payee_employee_id: saved ? saved.payee_employee_id : (r.se_payee_id || null),
          approved: saved ? !!saved.approved : false,
          comment: saved ? saved.comment : null,
        };
      });

      const totals = rows.reduce((a, r) => {
        a.to_pay += r.to_pay; a.plan += r.to_transfer; if (r.approved) a.approved += r.to_transfer;
        return a;
      }, { to_pay: 0, plan: 0, approved: 0, employees: rows.length });

      return reply.send({
        year: y, month: m, plan_id: planId, status: planRows[0] ? planRows[0].status : 'draft',
        monthly_limit: limit, rows, totals,
        // Коэффициенты расчёта — фронт не дублирует формулы (единый источник
        // payout-calc.js). Нужны для колонок «налог/сбор» и «человеку придёт».
        calc: {
          se_info_coef: calcSettings.seInfoCoef,
          se_transfer_coef: calcSettings.seTransferCoef,
          official_markup_rate: calcSettings.officialMarkupRate,
        },
      });
    } catch (err) {
      logError(fastify, '[payout-plan] GET /:year/:month error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /save — сохранить план (директор) ──────────────────────────────
  // Тело: { year, month, items: [{employee_id, to_transfer, pay_date?, payee_employee_id?, comment?}] }
  fastify.post('/save', dirAuth, async (request, reply) => {
    const b = request.body || {};
    const y = parseInt(b.year, 10), m = parseInt(b.month, 10);
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    const items = Array.isArray(b.items) ? b.items : [];
    const userId = request.user.id;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      let planId;
      const { rows: pr } = await client.query(
        `SELECT id FROM payout_plans WHERE period_year=$1 AND period_month=$2`, [y, m]);
      if (pr[0]) planId = pr[0].id;
      else {
        const { rows } = await client.query(
          `INSERT INTO payout_plans (period_year, period_month, status, created_by)
           VALUES ($1,$2,'draft',$3) RETURNING id`, [y, m, userId]);
        planId = rows[0].id;
      }

      // Максимумы — считаем сами, чтобы директор не мог «выдумать» сумму сверх
      // лимита НПД (лимит = священная величина: превышение → разбор с ФНС).
      const limit = await getMonthlyLimit();
      const seMap = await seRemainingMap(limit, y, m);
      const list = await buildPayoutRows(db, y, m);
      const rowMap = new Map(list.rows.map((r) => [r.employee_id, r]));

      let saved = 0, capped = 0;
      for (const it of items) {
        const empId = parseInt(it.employee_id, 10);
        const r = rowMap.get(empId);
        if (!Number.isInteger(empId) || !r) continue;
        let toTransfer = parseMoney(it.to_transfer);
        if (toTransfer === null || toTransfer < 0) toTransfer = 0;
        const se = seMap.get(empId) || {};
        const maxAmount = r.is_self_employed
          ? (se.can_exceed ? Math.max(0, r.to_pay) : Math.min(r.to_pay, se.remaining || 0))
          : Math.max(0, r.to_pay);
        if (toTransfer > maxAmount) { toTransfer = Math.round(maxAmount * 100) / 100; capped++; }

        const payDate = it.pay_date ? String(it.pay_date).slice(0, 10) : null;
        await client.query(`
          INSERT INTO payout_plan_items (plan_id, employee_id, to_transfer, max_amount, pay_date, payee_employee_id, comment, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
          ON CONFLICT (plan_id, employee_id) DO UPDATE SET
            to_transfer = EXCLUDED.to_transfer, max_amount = EXCLUDED.max_amount,
            pay_date = EXCLUDED.pay_date, payee_employee_id = EXCLUDED.payee_employee_id,
            comment = EXCLUDED.comment, updated_at = NOW()`,
          [planId, empId, toTransfer, Math.round(maxAmount * 100) / 100, payDate,
            it.payee_employee_id ? parseInt(it.payee_employee_id, 10) : (r.se_payee_id || null),
            it.comment || null]);
        saved++;
      }
      await client.query(`UPDATE payout_plans SET updated_at=NOW() WHERE id=$1`, [planId]);
      await client.query('COMMIT');
      return reply.send({ ok: true, plan_id: planId, saved, capped, message: capped ? `${capped} сумм(ы) ограничены лимитом НПД` : 'План сохранён' });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      logError(fastify, '[payout-plan] POST /save error', err, request);
      return sendHuman(reply, err);
    } finally { client.release(); }
  });

  // ─── POST /:year/:month/approve — согласовать план (директор) ────────────
  // Тело: { employee_ids?: number[] } — согласовать выбранные (или все с суммой).
  fastify.post('/:year/:month/approve', dirAuth, async (request, reply) => {
    const y = parseInt(request.params.year, 10);
    const m = parseInt(request.params.month, 10);
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    const ids = Array.isArray((request.body || {}).employee_ids) ? request.body.employee_ids.map((x) => parseInt(x, 10)) : null;
    try {
      const { rows: pr } = await db.query(
        `SELECT id FROM payout_plans WHERE period_year=$1 AND period_month=$2`, [y, m]);
      if (!pr[0]) return reply.code(404).send({ error: 'План не найден' });
      const planId = pr[0].id;
      const params = [planId];
      let where = `plan_id=$1 AND to_transfer > 0`;
      if (ids && ids.length) { params.push(ids); where += ` AND employee_id = ANY($2::int[])`; }
      const { rows } = await db.query(
        `UPDATE payout_plan_items SET approved=true, updated_at=NOW() WHERE ${where} RETURNING employee_id`, params);

      const { rows: cnt } = await db.query(`
        SELECT count(*) FILTER (WHERE approved)::int AS appr, count(*) FILTER (WHERE to_transfer > 0)::int AS total
          FROM payout_plan_items WHERE plan_id=$1`, [planId]);
      const full = cnt[0].total > 0 && cnt[0].appr >= cnt[0].total;
      await db.query(`
        UPDATE payout_plans SET status=$1, approved_by=$2, approved_at=NOW(), updated_at=NOW() WHERE id=$3`,
        [full ? 'approved' : 'partially_approved', request.user.id, planId]);
      return reply.send({ ok: true, approved: rows.length, status: full ? 'approved' : 'partially_approved' });
    } catch (err) {
      logError(fastify, '[payout-plan] approve error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /:year/:month/unapprove — снять согласование (директор) ────────
  // Нужно, если директор согласовал, а затем понял, что сумму/дату надо поправить.
  fastify.post('/:year/:month/unapprove', dirAuth, async (request, reply) => {
    const y = parseInt(request.params.year, 10);
    const m = parseInt(request.params.month, 10);
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    const ids = Array.isArray((request.body || {}).employee_ids) ? request.body.employee_ids.map((x) => parseInt(x, 10)) : null;
    try {
      const { rows: pr } = await db.query(
        `SELECT id FROM payout_plans WHERE period_year=$1 AND period_month=$2`, [y, m]);
      if (!pr[0]) return reply.code(404).send({ error: 'План не найден' });
      const planId = pr[0].id;
      const params = [planId];
      let where = `plan_id=$1 AND approved = true`;
      if (ids && ids.length) { params.push(ids); where += ` AND employee_id = ANY($2::int[])`; }
      const { rows } = await db.query(
        `UPDATE payout_plan_items SET approved=false, updated_at=NOW() WHERE ${where} RETURNING employee_id`, params);
      await db.query(`UPDATE payout_plans SET status='draft', updated_at=NOW() WHERE id=$1`, [planId]);
      return reply.send({ ok: true, unapproved: rows.length });
    } catch (err) {
      logError(fastify, '[payout-plan] unapprove error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── GET /schedule/:year/:month — график платежей ────────────────────────
  // Что «нужно в каждый день». Источник — согласованные позиции пачек с датой
  // перевода из плана; без даты — по факту выплат месяца (paid/confirmed).
  fastify.get('/schedule/:year/:month', payAuth, async (request, reply) => {
    const y = parseInt(request.params.year, 10);
    const m = parseInt(request.params.month, 10);
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    try {
      // 1) Плановые суммы по дням (approved-позиции с pay_date)
      const { rows: planned } = await db.query(`
        SELECT i.pay_date,
               i.employee_id,
               COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID '||e.id) AS fio,
               e.is_self_employed, e.is_officially_employed,
               i.to_transfer,
               COALESCE(NULLIF(TRIM(pe.fio),''), NULLIF(TRIM(pe.full_name),'')) AS payee_fio
          FROM payout_plan_items i
          JOIN payout_plans p ON p.id = i.plan_id
          JOIN employees e ON e.id = i.employee_id
          LEFT JOIN employees pe ON pe.id = i.payee_employee_id
         WHERE p.period_year=$1 AND p.period_month=$2 AND i.approved = true
           AND i.pay_date IS NOT NULL`, [y, m]);

      // 2) Факт выплат месяца по дням (для сверки «план/факт»)
      const { rows: paid } = await db.query(`
        SELECT EXTRACT(DAY FROM COALESCE(wp.paid_at, wp.created_at))::int AS day,
               COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID '||e.id) AS fio,
               e.is_self_employed, e.is_officially_employed,
               wp.amount, wp.transfer_amount, wp.type, wp.status
          FROM worker_payments wp
          JOIN employees e ON e.id = wp.employee_id
         WHERE COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)::int) = $1
           AND COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) = $2
           AND wp.status IN ('paid','confirmed')
           AND wp.type IN ('salary','advance')`, [y, m]);

      const daysInMonth = new Date(y, m, 0).getDate();
      const byDay = new Map();
      const bucket = (d) => { if (!byDay.has(d)) byDay.set(d, { day: d, se: 0, cash: 0, ndfl: 0, people: [] }); return byDay.get(d); };

      function catOf(isSe, isOff) { return isSe ? 'se' : (isOff ? 'ndfl' : 'cash'); }
      for (const p of planned) {
        const d = new Date(p.pay_date).getDate();
        const b = bucket(d);
        const amt = num(p.to_transfer);
        b[catOf(p.is_self_employed, p.is_officially_employed)] += amt;
        b.people.push({ employee_id: p.employee_id, fio: p.fio, amount: amt, payee_fio: p.payee_fio, source: 'plan' });
      }
      // Факт без плана на этот день — добавляем, чтобы график не терял реальные выплаты
      for (const p of paid) {
        const b = bucket(p.day);
        const plannedHere = b.people.some((x) => x.fio === p.fio);
        if (plannedHere) continue;
        const amt = num(p.amount);
        const cat = catOf(p.is_self_employed, p.is_officially_employed);
        b[cat] += amt;
        b.people.push({ fio: p.fio, amount: amt, source: 'fact' });
      }

      const days = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const b = byDay.get(d);
        days.push(b
          ? { day: d, se: Math.round(b.se * 100) / 100, cash: Math.round(b.cash * 100) / 100, ndfl: Math.round(b.ndfl * 100) / 100, people: b.people }
          : { day: d, se: 0, cash: 0, ndfl: 0, people: [] });
      }
      const totals = days.reduce((a, d) => { a.se += d.se; a.cash += d.cash; a.ndfl += d.ndfl; return a; },
        { se: 0, cash: 0, ndfl: 0, total: 0, days_with_payments: 0 });
      totals.total = Math.round((totals.se + totals.cash + totals.ndfl) * 100) / 100;
      totals.days_with_payments = days.filter((d) => d.se + d.cash + d.ndfl > 0).length;

      return reply.send({ year: y, month: m, days, totals });
    } catch (err) {
      logError(fastify, '[payout-plan] GET /schedule error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── GET /day/:year/:month/:day — «кому платим в этот день» ──────────────
  fastify.get('/day/:year/:month/:day', payAuth, async (request, reply) => {
    const y = parseInt(request.params.year, 10);
    const m = parseInt(request.params.month, 10);
    const d = parseInt(request.params.day, 10);
    if (!isValidPeriod(y, m) || !Number.isInteger(d) || d < 1 || d > 31) {
      return reply.code(400).send({ error: 'Некорректная дата' });
    }
    try {
      const { rows } = await db.query(`
        SELECT i.employee_id,
               COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID '||e.id) AS fio,
               e.is_self_employed, e.is_officially_employed,
               i.to_transfer, i.comment,
               COALESCE(NULLIF(TRIM(pe.fio),''), NULLIF(TRIM(pe.full_name),'')) AS payee_fio
          FROM payout_plan_items i
          JOIN payout_plans p ON p.id = i.plan_id
          JOIN employees e ON e.id = i.employee_id
          LEFT JOIN employees pe ON pe.id = i.payee_employee_id
         WHERE p.period_year=$1 AND p.period_month=$2
           AND i.approved = true AND EXTRACT(DAY FROM i.pay_date)::int = $3
         ORDER BY i.to_transfer DESC`, [y, m, d]);
      const items = rows.map((r) => {
        const cat = r.is_self_employed ? 'se' : (r.is_officially_employed ? 'ndfl' : 'cash');
        return {
          employee_id: r.employee_id, fio: r.fio, category: cat,
          to_transfer: num(r.to_transfer), payee_fio: r.payee_fio, comment: r.comment,
        };
      });
      const totals = items.reduce((a, i) => { a[i.category] += i.to_transfer; a.all += i.to_transfer; return a; },
        { se: 0, cash: 0, ndfl: 0, all: 0 });
      return reply.send({ year: y, month: m, day: d, items, totals, count: items.length });
    } catch (err) {
      logError(fastify, '[payout-plan] GET /day error', err, request);
      return sendHuman(reply, err);
    }
  });
}

module.exports = routes;
