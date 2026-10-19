'use strict';

/**
 * График отпусков офиса — API.
 * Префикс: /api/vacations (регистрация в src/index.js).
 *
 * Роли:
 *   читают и правят свои периоды — офисные роли (см. OFFICE_ROLES);
 *   согласуют — директора (DIRECTOR_GEN/COMM/DEV) + ADMIN;
 *   балансы дней вводит — BUH + ADMIN;
 *   полевые рабочие (FIELD_WORKER) — нет доступа вовсе.
 *
 * Все правила (лимиты, праздники ст.120 ТК, блокировки, пересечения) — в
 * services/vacation-rules.js: единый источник правды, тот же, что в UI.
 * Стык с графиком офиса — services/vacation-sync.js (статус «отп» в staff_plan).
 */

const rules = require('../services/vacation-rules');
const sync = require('../services/vacation-sync');
const { logError } = require('../lib/log-error');
const { sendHuman } = require('../lib/human-error');
const { staffExcludeTestSql } = require('../lib/user-filters');

// Офисные роли — те, кто участвует в графике отпусков (не полевые рабочие).
const OFFICE_ROLES = [
  'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'PROC', 'BUH', 'OFFICE_MANAGER', 'CHIEF_ENGINEER',
  'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'WAREHOUSE',
];
const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const READ_ROLES = ['ADMIN', ...OFFICE_ROLES];
const APPROVE_ROLES = ['ADMIN', ...DIRECTOR_ROLES];
const BALANCE_ROLES = ['ADMIN', 'BUH'];

module.exports = async function vacationsRoutes(fastify) {
  const db = fastify.db || fastify.pg;
  const readAuth = { preHandler: [fastify.requireRoles(READ_ROLES)] };
  const approveAuth = { preHandler: [fastify.requireRoles(APPROVE_ROLES)] };
  const balanceAuth = { preHandler: [fastify.requireRoles(BALANCE_ROLES)] };

  /* ── Внутренние помощники ───────────────────────────────────────────── */

  async function loadCalendar(year) {
    const { rows } = await db.query(
      `SELECT to_char(date,'YYYY-MM-DD') AS date, is_working, kind, COALESCE(title, note) AS title
         FROM work_calendar
        WHERE date >= $1::date AND date <= $2::date`,
      [`${year}-01-01`, `${year}-12-31`]);
    return rules.makeCalendar(rows);
  }

  /** staff.id по users.id (создаём при отсутствии — как в daily-presence). */
  async function ensureStaffId(userId, name, role) {
    const { rows } = await db.query('SELECT id FROM staff WHERE user_id = $1 ORDER BY id LIMIT 1', [userId]);
    if (rows.length) return rows[0].id;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [202, userId]);
      const re = await client.query('SELECT id FROM staff WHERE user_id = $1 ORDER BY id LIMIT 1', [userId]);
      if (re.rows.length) { await client.query('COMMIT'); return re.rows[0].id; }
      const ins = await client.query(
        `INSERT INTO staff (user_id, name, role_tag, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, true, NOW(), NOW()) RETURNING id`,
        [userId, name || ('user#' + userId), role || '']);
      await client.query('COMMIT');
      return ins.rows[0].id;
    } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} throw e; }
    finally { client.release(); }
  }

  /** Все офисные сотрудники (для Т-7, балансов, порядка групп).
      Исключаем неактивных, тестовых/системных и тех, у кого нет роли. */
  async function officeStaff() {
    const { rows } = await db.query(
      `SELECT s.id, s.user_id, s.name, s.role_tag, u.role, u.is_active, u.name AS user_name
         FROM staff s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE COALESCE(s.is_active, true) = true
          AND COALESCE(u.is_active, true) = true
          AND COALESCE(u.role, s.role_tag, '') <> 'FIELD_WORKER'
          AND COALESCE(u.role, s.role_tag, '') <> 'BOT'
          AND COALESCE(u.role, s.role_tag, '') <> 'ADMIN'
          AND COALESCE(u.role, s.role_tag, '') <> 'PENDING'
          AND u.login <> 'agpz'
          AND NOT (COALESCE(s.name,'') ~* '^(АГПЗ|ГПЗ)\\s*\\(')
          ${staffExcludeTestSql('s')}
        ORDER BY s.name`);
    // Дубли по user_id (несколько staff-строк на одного человека) склеиваем.
    const seen = new Set();
    return rows.filter((r) => {
      const key = r.user_id || ('s' + r.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Периоды за год (для всех — видно всем, правит владелец). */
  async function periodsYear(year, opts) {
    const o = opts || {};
    const args = [year];
    let where = 'v.year = $1';
    if (o.employeeId) { args.push(o.employeeId); where += ` AND v.employee_id = $${args.length}`; }
    if (o.status) { args.push(o.status); where += ` AND v.status = $${args.length}`; }
    const { rows } = await db.query(
      `SELECT v.*, s.name AS fio, s.user_id, u.role,
              to_char(v.date_from,'YYYY-MM-DD') AS date_from, to_char(v.date_to,'YYYY-MM-DD') AS date_to
         FROM office_vacations v
         LEFT JOIN staff s ON s.id = v.employee_id
         LEFT JOIN users u ON u.id = s.user_id
        WHERE ${where}
        ORDER BY v.date_from, s.name`, args);
    return rows;
  }

  /** Голоса по периодам — одним запросом (чтобы не плодить N+1). */
  async function votesByVacations(ids) {
    if (!ids.length) return {};
    const { rows } = await db.query(
      `SELECT vacation_id, director_user_id, decision, comment
         FROM office_vacation_approvals WHERE vacation_id = ANY($1::int[])`, [ids]);
    const map = {};
    rows.forEach((r) => {
      map[r.vacation_id] = map[r.vacation_id] || [];
      map[r.vacation_id].push(r);
    });
    return map;
  }

  /** Активные директора проекта (все согласуют).
      Правило заказчика: согласовывают ВСЕ директора — ровно три роли.
      Берём активных людей по этим ролям, без тестовых/системных, без дублей. */
  async function activeDirectors() {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (u.id) u.id, u.name, u.role
         FROM users u
        WHERE u.role = ANY($1::text[])
          AND COALESCE(u.is_active, true) = true
          AND u.login !~ '^test_'
          AND u.login <> 'mimir_bot'
          AND NOT (COALESCE(u.name,'') ~* '^(test|тест)\\s')
        ORDER BY u.id, u.name`,
      [DIRECTOR_ROLES]);
    return rows;
  }

  async function blockedDaysOf(employeeId, year) {
    // Только за запрошенный год: дни прошлых/будущих лет не должны влиять на планирование.
    const args = [employeeId];
    let where = 'employee_id = $1';
    if (year) { args.push(year); where += ` AND EXTRACT(YEAR FROM date) = $${args.length}`; }
    const { rows } = await db.query(
      `SELECT to_char(date,'YYYY-MM-DD') AS d FROM office_vacation_blocked_days WHERE ${where}`,
      args);
    return rows.map((r) => r.d);
  }

  async function daysRow(employeeId, year) {
    const { rows } = await db.query(
      `SELECT available_days, carry_over_days FROM office_vacation_days
        WHERE employee_id = $1 AND year = $2`, [employeeId, year]);
    return rows[0] || null;
  }

  async function audit(vacationId, employeeId, actorId, action, details) {
    try {
      await db.query(
        `INSERT INTO office_vacation_audit (vacation_id, employee_id, actor_id, action, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [vacationId || null, employeeId || null, actorId || null, action, details ? JSON.stringify(details) : null]);
    } catch (e) { fastify.log.warn('[vacations] audit failed: ' + e.message); }
  }

  /** Уведомление сотруднику в CRM (колокольчик) о решении по отпуску. */
  async function notifyEmployee(v, outcome) {
    try {
      const { rows } = await db.query('SELECT user_id FROM staff WHERE id = $1', [v.employee_id]);
      const userId = (rows[0] && rows[0].user_id) || v.user_id || null;
      if (!userId) return;
      const { createNotification } = require('../services/notify');
      const period = rules.fmtRange(
        String(v.date_from).slice(0, 10), String(v.date_to).slice(0, 10));
      const map = {
        approved: { title: 'Отпуск согласован', type: 'success', msg: `${period} — согласован всеми директорами. Напишите заявление.` },
        rejected: { title: 'Отпуск не согласован', type: 'error', msg: `${period} снят. ${v.reason || ''}`.trim() },
        cancelled: { title: 'Отпуск снят', type: 'error', msg: `${period} снят: директора не ответили на напоминания.` },
      };
      const m = map[outcome] || map.approved;
      await createNotification(db, {
        user_id: userId, title: m.title, message: m.msg,
        type: m.type, link: '#/vacation-schedule',
      });
    } catch (e) { fastify.log.warn('[vacations] notify failed: ' + e.message); }
  }

  async function isClosed(year) {
    const { rows } = await db.query('SELECT closed FROM office_vacation_periods WHERE year = $1', [year]);
    return !!(rows[0] && rows[0].closed);
  }

  /** Человеческое название должности по коду роли — для документов. */
  const ROLE_RU = {
    DIRECTOR_GEN: 'Генеральный директор',
    DIRECTOR_COMM: 'Коммерческий директор',
    DIRECTOR_DEV: 'Директор по развитию',
    PM: 'Руководитель проектов',
    HEAD_PM: 'Главный руководитель проектов',
    BUH: 'Главный бухгалтер',
    BUH_DEP: 'Бухгалтер',
    TO: 'Тендерный специалист',
    HEAD_TO: 'Руководитель тендерного отдела',
    HR: 'Специалист по кадрам',
    HR_MANAGER: 'Директор по кадрам',
    OFFICE_MANAGER: 'Офис-менеджер',
    PROC: 'Специалист по закупкам',
    WAREHOUSE: 'Кладовщик',
    CHIEF_ENGINEER: 'Главный инженер',
  };

  /** Должность на русском (в документах не должно быть кодов ролей). */
  function positionRu(row) {
    const code = String((row && (row.role || row.role_tag)) || '');
    return ROLE_RU[code] || (row && row.position) || 'Сотрудник';
  }

  /** Сдвиг даты на N лет (для рабочего периода «за период работы с … по …»). */
  function shiftYear(iso, delta) {
    const s = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const y = Number(s.slice(0, 4)) + Number(delta || 0);
    return `${y}${s.slice(4)}`;
  }

  /** Человеческое название отдела по роли — для документов. */
  function groupTitleOf(row) {
    const role = String((row && (row.role || row.role_tag)) || '');
    const map = {
      DIRECTOR_GEN: 'Дирекция', DIRECTOR_COMM: 'Дирекция', DIRECTOR_DEV: 'Дирекция',
      PM: 'Руководители проектов', HEAD_PM: 'Руководители проектов',
      BUH: 'Бухгалтерия', BUH_DEP: 'Бухгалтерия',
      TO: 'Тендерный отдел', HEAD_TO: 'Тендерный отдел',
      HR: 'Кадры', HR_MANAGER: 'Кадры',
      OFFICE_MANAGER: 'Офис и снабжение', PROC: 'Офис и снабжение', WAREHOUSE: 'Офис и снабжение',
      CHIEF_ENGINEER: 'Офис и снабжение',
    };
    return map[role] || 'Офис';
  }

  /* ── GET / — все периоды за год (видно всем офисным) ────────────────── */
  fastify.get('/', readAuth, async (request, reply) => {
    try {
      const year = Number(request.query.year) || new Date().getFullYear();
      const rows = await periodsYear(year);
      const votes = await votesByVacations(rows.map((r) => r.id));
      const directors = await activeDirectors();
      const dirIds = directors.map((d) => d.id);
      const out = rows.map((r) => ({
        ...r,
        approvals: votes[r.id] || [],
        progress: rules.approvalProgress(votes[r.id] || [], dirIds),
      }));
      return { year, closed: await isClosed(year), directors, vacations: out };
    } catch (err) {
      logError(fastify, '[vacations] GET /', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── GET /me — мои периоды, баланс, снятые дни, сроки ──────────────── */
  fastify.get('/me', readAuth, async (request, reply) => {
    try {
      const userId = request.user.id;
      const year = Number(request.query.year) || new Date().getFullYear();
      const employeeId = await ensureStaffId(userId, request.user.name, request.user.role);
      const [periods, blocked, days, cal] = await Promise.all([
        periodsYear(year, { employeeId }),
        blockedDaysOf(employeeId, year),
        daysRow(employeeId, year),
        loadCalendar(year),
      ]);
      const directors = await activeDirectors();
      const votes = await votesByVacations(periods.map((r) => r.id));
      const dirIds = directors.map((d) => d.id);
      const bal = rules.balance(days, periods);
      const today = new Date().toISOString().slice(0, 10);
      return {
        year, employee_id: employeeId,
        balance: bal,
        blocked_days: blocked,
        window_open: rules.windowOpen(year, today),
        days_to_deadline: rules.daysToDeadline(year, today),
        closed: await isClosed(year),
        rules: rules.RULES,
        vacations: periods.map((r) => ({
          ...r, approvals: votes[r.id] || [], progress: rules.approvalProgress(votes[r.id] || [], dirIds),
        })),
      };
    } catch (err) {
      logError(fastify, '[vacations] GET /me', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── GET /pending — очередь директора (с пересечениями и голосами) ─── */
  fastify.get('/pending', approveAuth, async (request, reply) => {
    try {
      const year = Number(request.query.year) || new Date().getFullYear();
      const all = await periodsYear(year);
      const pending = all.filter((r) => r.status === 'pending');
      const directors = await activeDirectors();
      const dirIds = directors.map((d) => d.id);
      const votes = await votesByVacations(pending.map((r) => r.id));
      const out = pending.map((r) => {
        const others = all.filter((x) => x.employee_id !== r.employee_id);
        return {
          ...r,
          approvals: votes[r.id] || [],
          progress: rules.approvalProgress(votes[r.id] || [], dirIds),
          clashes: rules.clashesWith([], others, r.date_from, r.date_to, r.employee_id),
        };
      });
      return { year, directors, pending: out };
    } catch (err) {
      logError(fastify, '[vacations] GET /pending', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── POST / — поставить свой период ────────────────────────────────── */
  fastify.post('/', readAuth, async (request, reply) => {
    const client = await db.pool.connect();
    try {
      const b = request.body || {};
      const year = Number(b.year) || (b.date_from ? Number(String(b.date_from).slice(0, 4)) : new Date().getFullYear());
      const employeeId = b.employee_id ? Number(b.employee_id) : await ensureStaffId(request.user.id, request.user.name, request.user.role);

      // Править можно только свои дни (кроме ADMIN)
      if (request.user.role !== 'ADMIN' && employeeId !== await ensureStaffId(request.user.id, request.user.name, request.user.role)) {
        reply.code(403);
        return { error: 'not_owner', message: 'Можно править только свои дни.' };
      }
      if (await isClosed(year)) {
        reply.code(409);
        return { error: 'closed', message: 'График закрыт — правки невозможны.' };
      }

      const [cal, periods, blocked, dred] = await Promise.all([
        loadCalendar(year), periodsYear(year, { employeeId }), blockedDaysOf(employeeId, year), daysRow(employeeId, year),
      ]);

      const v = rules.validatePeriod({
        calendar: cal, year, start: b.date_from, end: b.date_to,
        periods, blockedDays: blocked, daysRow: dred,
      });
      if (!v.ok) { reply.code(400); return { error: v.code, message: v.msg, days: v.days, holidays: v.holidays }; }

      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO office_vacations
           (employee_id, user_id, date_from, date_to, days, cal_days, holidays_count, kind, year,
            status, submitted_at, created_at, updated_at)
         VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,'pending',NOW(),NOW(),NOW())
         RETURNING *`,
        [employeeId, request.user.id, b.date_from, b.date_to, v.days, v.calDays, v.holidays,
          v.isMain ? 'main' : 'extra', year]);
      const row = ins.rows[0];
      await client.query('COMMIT');

      await sync.applyToStaffPlan(db, row, 'pending');
      await audit(row.id, employeeId, request.user.id, 'create', { days: v.days, from: b.date_from, to: b.date_to });

      const clashes = rules.clashesWith([], await periodsYear(year), b.date_from, b.date_to, employeeId);
      return { ok: true, vacation: row, days: v.days, holidays: v.holidays, extend_to: v.extendTo, clashes };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      logError(fastify, '[vacations] POST /', err, request);
      return sendHuman(reply, err);
    } finally { client.release(); }
  });

  /* ── PUT /:id — правка своего периода (только пока не решён) ───────── */
  fastify.put('/:id', readAuth, async (request, reply) => {
    try {
      const b = request.body || {};
      const { rows } = await db.query('SELECT * FROM office_vacations WHERE id = $1', [request.params.id]);
      const cur = rows[0];
      if (!cur) { reply.code(404); return { error: 'not_found', message: 'Период не найден.' }; }

      const myStaff = await ensureStaffId(request.user.id, request.user.name, request.user.role);
      if (request.user.role !== 'ADMIN' && cur.employee_id !== myStaff) {
        reply.code(403); return { error: 'not_owner', message: 'Можно править только свои дни.' };
      }
      if (cur.status === 'approved') {
        reply.code(409); return { error: 'already_approved', message: 'Период уже согласован — правка недоступна.' };
      }
      if (await isClosed(cur.year)) {
        reply.code(409); return { error: 'closed', message: 'График закрыт — правки невозможны.' };
      }

      const year = cur.year;
      const [cal, periods, blocked, dred] = await Promise.all([
        loadCalendar(year), periodsYear(year, { employeeId: cur.employee_id }),
        blockedDaysOf(cur.employee_id, year), daysRow(cur.employee_id, year),
      ]);
      const v = rules.validatePeriod({
        calendar: cal, year, start: b.date_from || cur.date_from, end: b.date_to || cur.date_to,
        periods, blockedDays: blocked, daysRow: dred, ignoreId: cur.id,
      });
      if (!v.ok) { reply.code(400); return { error: v.code, message: v.msg }; }

      const from = b.date_from || cur.date_from, to = b.date_to || cur.date_to;
      await db.query(
        `UPDATE office_vacations
            SET date_from=$2::date, date_to=$3::date, days=$4, cal_days=$5, holidays_count=$6,
                kind=$7, status='pending', submitted_at=NOW(), updated_at=NOW()
          WHERE id=$1`,
        [cur.id, from, to, v.days, v.calDays, v.holidays, v.isMain ? 'main' : 'extra']);
      await db.query('DELETE FROM office_vacation_approvals WHERE vacation_id = $1', [cur.id]);

      const upd = { ...cur, date_from: from, date_to: to, status: 'pending' };
      await sync.removeFromStaffPlan(db, cur);
      await sync.applyToStaffPlan(db, upd, 'pending');
      await audit(cur.id, cur.employee_id, request.user.id, 'update', { from, to, days: v.days });

      return { ok: true, days: v.days, holidays: v.holidays, extend_to: v.extendTo };
    } catch (err) {
      logError(fastify, '[vacations] PUT /:id', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── DELETE /:id — снять свой период ───────────────────────────────── */
  fastify.delete('/:id', readAuth, async (request, reply) => {
    try {
      const { rows } = await db.query('SELECT * FROM office_vacations WHERE id = $1', [request.params.id]);
      const cur = rows[0];
      if (!cur) { reply.code(404); return { error: 'not_found', message: 'Период не найден.' }; }
      const myStaff = await ensureStaffId(request.user.id, request.user.name, request.user.role);
      if (request.user.role !== 'ADMIN' && cur.employee_id !== myStaff) {
        reply.code(403); return { error: 'not_owner', message: 'Можно править только свои дни.' };
      }
      if (cur.status === 'approved') {
        reply.code(409); return { error: 'already_approved', message: 'Согласованный период снять нельзя — обратитесь к директору.' };
      }
      if (await isClosed(cur.year)) {
        reply.code(409); return { error: 'closed', message: 'График закрыт — правки невозможны.' };
      }
      await sync.removeFromStaffPlan(db, cur);
      await db.query('DELETE FROM office_vacation_approvals WHERE vacation_id = $1', [cur.id]);
      await db.query('DELETE FROM office_vacations WHERE id = $1', [cur.id]);
      await audit(cur.id, cur.employee_id, request.user.id, 'cancel', { from: cur.date_from, to: cur.date_to });
      return { ok: true };
    } catch (err) {
      logError(fastify, '[vacations] DELETE /:id', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── POST /:id/submit — «Готово и согласовать» ─────────────────────── */
  fastify.post('/:id/submit', readAuth, async (request, reply) => {
    try {
      const { rows } = await db.query('SELECT * FROM office_vacations WHERE id = $1', [request.params.id]);
      const cur = rows[0];
      if (!cur) { reply.code(404); return { error: 'not_found', message: 'Период не найден.' }; }
      const myStaff = await ensureStaffId(request.user.id, request.user.name, request.user.role);
      if (request.user.role !== 'ADMIN' && cur.employee_id !== myStaff) {
        reply.code(403); return { error: 'not_owner', message: 'Можно отправлять только свои периоды.' };
      }
      if (await isClosed(cur.year)) {
        reply.code(409); return { error: 'closed', message: 'График закрыт — отправлять нечего.' };
      }
      if (cur.status === 'rejected' || cur.status === 'cancelled') {
        reply.code(409);
        return { error: 'cant_submit', message: 'Этот период снят — поставьте новые даты, а не отправляйте старые.' };
      }
      if (cur.status === 'approved') {
        return { ok: true, already: true };
      }
      await db.query(
        `UPDATE office_vacations SET status='pending', submitted_at=NOW(), updated_at=NOW() WHERE id=$1`, [cur.id]);
      await sync.applyToStaffPlan(db, { ...cur, status: 'pending' }, 'pending');
      await audit(cur.id, cur.employee_id, request.user.id, 'submit', null);
      return { ok: true };
    } catch (err) {
      logError(fastify, '[vacations] POST /:id/submit', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── POST /:id/approve — голос директора «за» ──────────────────────── */
  fastify.post('/:id/approve', approveAuth, async (request, reply) => {
    try {
      const id = request.params.id;
      const { rows } = await db.query('SELECT * FROM office_vacations WHERE id = $1', [id]);
      const cur = rows[0];
      if (!cur) { reply.code(404); return { error: 'not_found', message: 'Период не найден.' }; }
      if (cur.status === 'rejected' || cur.status === 'cancelled') {
        reply.code(409); return { error: 'already_decided', message: 'Период уже снят.' };
      }
      if (cur.status === 'approved') {
        reply.code(409); return { error: 'already_approved', message: 'Период уже согласован.' };
      }
      if (await isClosed(cur.year)) {
        reply.code(409); return { error: 'closed', message: 'График закрыт — решения принимать нельзя.' };
      }

      await db.query(
        `INSERT INTO office_vacation_approvals (vacation_id, director_user_id, decision)
         VALUES ($1,$2,'approve')
         ON CONFLICT (vacation_id, director_user_id)
         DO UPDATE SET decision='approve', comment=NULL, decided_at=NOW()`, [id, request.user.id]);

      const directors = await activeDirectors();
      const votes = (await votesByVacations([Number(id)]))[Number(id)] || [];
      const pr = rules.approvalProgress(votes, directors.map((d) => d.id));

      if (pr.done >= pr.total) {
        await db.query(`UPDATE office_vacations SET status='approved', decided_by=$2, decided_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [id, request.user.id]);
        await sync.applyToStaffPlan(db, { ...cur, status: 'approved' }, 'approved');
        await audit(cur.id, cur.employee_id, request.user.id, 'approve', { all: true });
        // Уведомление сотруднику в CRM (колокольчик) — «согласован, пишите заявление».
        await notifyEmployee(cur, 'approved');
      }
      return { ok: true, progress: pr, approved: pr.done >= pr.total };
    } catch (err) {
      logError(fastify, '[vacations] POST /:id/approve', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── POST /:id/reject — отклонение (комментарий обязателен) ────────── */
  fastify.post('/:id/reject', approveAuth, async (request, reply) => {
    try {
      const id = request.params.id;
      const reason = String((request.body || {}).reason || '').trim();
      if (!reason) {
        reply.code(400);
        return { error: 'reason_required', message: 'Комментарий обязателен — сотрудник должен понять, когда взять отпуск.' };
      }
      const { rows } = await db.query('SELECT * FROM office_vacations WHERE id = $1', [id]);
      const cur = rows[0];
      if (!cur) { reply.code(404); return { error: 'not_found', message: 'Период не найден.' }; }
      // Согласованный период отклонять нельзя — только через /revoke (и только до закрытия).
      if (cur.status === 'approved') {
        reply.code(409);
        return { error: 'already_approved', message: 'Период уже согласован. Сначала отмените решение (если график не закрыт).' };
      }
      if (cur.status !== 'pending') {
        reply.code(409); return { error: 'already_decided', message: 'По этому периоду решение уже принято.' };
      }
      if (await isClosed(cur.year)) {
        reply.code(409); return { error: 'closed', message: 'График закрыт — решения принимать нельзя.' };
      }

      await db.query(
        `INSERT INTO office_vacation_approvals (vacation_id, director_user_id, decision, comment)
         VALUES ($1,$2,'reject',$3)
         ON CONFLICT (vacation_id, director_user_id)
         DO UPDATE SET decision='reject', comment=$3, decided_at=NOW()`, [id, request.user.id, reason]);

      // Снято — дни уходят в блокировку по сотруднику, «отп» убирается из графика офиса.
      const days = sync.rangeDays(cur.date_from, cur.date_to);
      for (const d of days) {
        await db.query(
          `INSERT INTO office_vacation_blocked_days (employee_id, date, vacation_id, reason, blocked_by)
           VALUES ($1,$2::date,$3,$4,$5)
           ON CONFLICT (employee_id, date) DO UPDATE
             SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by`, [cur.employee_id, d, cur.id, reason, request.user.id]);
      }
      await db.query(
        `UPDATE office_vacations SET status='rejected', reason=$2, decided_by=$3, decided_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [id, reason, request.user.id]);
      await sync.removeFromStaffPlan(db, { ...cur, status: 'rejected' });
      await audit(cur.id, cur.employee_id, request.user.id, 'reject', { reason, days: days.length });
      await notifyEmployee({ ...cur, reason }, 'rejected');

      return { ok: true, reason, blocked_days: days.length };
    } catch (err) {
      logError(fastify, '[vacations] POST /:id/reject', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── POST /:id/revoke — отменить ошибочное решение до закрытия ─────── */
  fastify.post('/:id/revoke', approveAuth, async (request, reply) => {
    try {
      const id = request.params.id;
      const { rows } = await db.query('SELECT * FROM office_vacations WHERE id = $1', [id]);
      const cur = rows[0];
      if (!cur) { reply.code(404); return { error: 'not_found', message: 'Период не найден.' }; }
      if (await isClosed(cur.year)) {
        reply.code(409); return { error: 'closed', message: 'График закрыт — решение изменить нельзя.' };
      }
      await db.query('DELETE FROM office_vacation_blocked_days WHERE vacation_id = $1', [id]);
      await db.query('DELETE FROM office_vacation_approvals WHERE vacation_id = $1', [id]);
      await db.query(`UPDATE office_vacations SET status='pending', reason=NULL, decided_by=NULL, decided_at=NULL, updated_at=NOW() WHERE id=$1`, [id]);
      await sync.removeFromStaffPlan(db, cur);
      await sync.applyToStaffPlan(db, { ...cur, status: 'pending' }, 'pending');
      await audit(cur.id, cur.employee_id, request.user.id, 'revoke', null);
      return { ok: true };
    } catch (err) {
      logError(fastify, '[vacations] POST /:id/revoke', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── POST /approve-all — согласовать всё отправленное ──────────────── */
  fastify.post('/approve-all', approveAuth, async (request, reply) => {
    try {
      const year = Number((request.body || {}).year) || new Date().getFullYear();
      if (await isClosed(year)) {
        reply.code(409); return { error: 'closed', message: 'График закрыт.' };
      }
      const directors = await activeDirectors();
      const pend = (await periodsYear(year)).filter((r) => r.status === 'pending');
      let n = 0;
      for (const r of pend) {
        for (const d of directors) {
          await db.query(
            `INSERT INTO office_vacation_approvals (vacation_id, director_user_id, decision)
             VALUES ($1,$2,'approve')
             ON CONFLICT (vacation_id, director_user_id) DO UPDATE SET decision='approve', decided_at=NOW()`,
            [r.id, d.id]);
        }
        await db.query(`UPDATE office_vacations SET status='approved', decided_by=$2, decided_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [r.id, request.user.id]);
        await sync.applyToStaffPlan(db, { ...r, status: 'approved' }, 'approved');
        await audit(r.id, r.employee_id, request.user.id, 'approve', { all: true, bulk: true });
        n++;
      }
      return { ok: true, approved: n };
    } catch (err) {
      logError(fastify, '[vacations] POST /approve-all', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── POST /close — закрыть график (директор) ───────────────────────── */
  fastify.post('/close', approveAuth, async (request, reply) => {
    try {
      const year = Number((request.body || {}).year) || new Date().getFullYear();
      const pend = (await periodsYear(year)).filter((r) => r.status === 'pending');
      if (pend.length) {
        reply.code(409);
        return { error: 'has_pending', message: `Ещё ${pend.length} период(ов) ждут решения — сначала согласуйте или отклоните.` };
      }
      await db.query(
        `INSERT INTO office_vacation_periods (year, closed, closed_by, closed_at, updated_at)
         VALUES ($1, true, $2, NOW(), NOW())
         ON CONFLICT (year) DO UPDATE SET closed=true, closed_by=$2, closed_at=NOW(), updated_at=NOW()`,
        [year, request.user.id]);
      await audit(null, null, request.user.id, 'close', { year });
      return { ok: true, year };
    } catch (err) {
      logError(fastify, '[vacations] POST /close', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── Балансы дней (бухгалтерия) ────────────────────────────────────── */
  fastify.get('/balances', readAuth, async (request, reply) => {
    try {
      const year = Number(request.query.year) || new Date().getFullYear();
      const staff = await officeStaff();
      const { rows: bal } = await db.query('SELECT * FROM office_vacation_days WHERE year = $1', [year]);
      const balMap = {};
      bal.forEach((b) => { balMap[b.employee_id] = b; });
      const all = await periodsYear(year);
      const out = staff.map((s) => {
        const own = all.filter((v) => v.employee_id === s.id);
        return {
          employee_id: s.id, fio: s.name, role: s.role || s.role_tag, user_id: s.user_id,
          available_days: balMap[s.id] ? balMap[s.id].available_days : 0,
          carry_over_days: balMap[s.id] ? balMap[s.id].carry_over_days : 0,
          balance: rules.balance(balMap[s.id], own),
          plans: own.map((v) => ({
            date_from: v.date_from, date_to: v.date_to, days: v.days, status: v.status,
            holidays: v.holidays_count, reason: v.reason,
          })),
        };
      });
      return { year, staff: out, carry_over_max: rules.RULES.CARRY_OVER_MAX };
    } catch (err) {
      logError(fastify, '[vacations] GET /balances', err, request);
      return sendHuman(reply, err);
    }
  });

  fastify.put('/balances', balanceAuth, async (request, reply) => {
    try {
      const b = request.body || {};
      const year = Number(b.year) || new Date().getFullYear();
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length) { reply.code(400); return { error: 'empty', message: 'Нет данных для сохранения.' }; }
      for (const it of items) {
        const emp = Number(it.employee_id);
        if (!emp) continue;
        const avail = Math.max(0, Math.min(365, Number(it.available_days) || 0));
        const carryRaw = Number(it.carry_over_days) || 0;
        // Ст. 124 ТК РФ: перенос не более 12 дней. Валидируем на сервере, а не только в UI.
        if (carryRaw > rules.RULES.CARRY_OVER_MAX) {
          reply.code(400);
          return {
            error: 'carry_over_too_big',
            message: `Перенос не может превышать ${rules.RULES.CARRY_OVER_MAX} дней (ст. 124 ТК РФ). Сотрудник #${emp}: указано ${carryRaw}.`,
          };
        }
        const carry = Math.max(0, carryRaw);
        await db.query(
          `INSERT INTO office_vacation_days (employee_id, year, available_days, carry_over_days, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (employee_id, year) DO UPDATE
             SET available_days=EXCLUDED.available_days, carry_over_days=EXCLUDED.carry_over_days,
                 updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
          [emp, year, avail, carry, request.user.id]);
      }
      await audit(null, null, request.user.id, 'balance', { year, count: items.length });
      return { ok: true, saved: items.length, carry_over_max: rules.RULES.CARRY_OVER_MAX };
    } catch (err) {
      logError(fastify, '[vacations] PUT /balances', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── GET /calendar — производственный календарь для фронта ─────────── */
  fastify.get('/calendar', readAuth, async (request, reply) => {
    try {
      const year = Number(request.query.year) || new Date().getFullYear();
      const { rows } = await db.query(
        `SELECT to_char(date,'YYYY-MM-DD') AS date, is_working, kind, COALESCE(title, note) AS title
           FROM work_calendar WHERE date >= $1::date AND date <= $2::date ORDER BY date`,
        [`${year}-01-01`, `${year}-12-31`]);
      return { year, days: rows };
    } catch (err) {
      logError(fastify, '[vacations] GET /calendar', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── Документы (заявление / Т-6 / Т-7) ─────────────────────────────── */
  fastify.get('/docs/:kind', readAuth, async (request, reply) => {
    try {
      const kind = request.params.kind;
      const year = Number(request.query.year) || new Date().getFullYear();
      const docs = require('../services/vacation-docx');
      const staff = await officeStaff();
      const all = await periodsYear(year);
      const org = { name: 'ООО «Асгард-Сервис»' };

      if (kind === 't7') {
        const employees = staff.map((s) => {
          const own = all.filter((v) => v.employee_id === s.id && v.status !== 'rejected' && v.status !== 'cancelled');
          return {
            full_name: s.name,
            position: positionRu(s),
            department: groupTitleOf({ role: s.role || s.role_tag }),
            personnel_number: 2300 + (s.id % 1000),
            periods: own,
          };
        });
        const buf = await docs.generateScheduleT7({ organization: org, year, employees });
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        reply.header('Content-Disposition', `attachment; filename="grafik-otpuskov-T7-${year}.docx"`);
        return reply.send(buf);
      }

      const v = all.find((x) => String(x.id) === String(request.query.vacation_id)) ||
                all.filter((x) => x.status === 'approved').sort((a, b) => (a.date_from < b.date_from ? 1 : -1))[0];
      if (!v) { reply.code(404); return { error: 'not_found', message: 'Нет согласованного отпуска для документа.' }; }

      // Сервис vacation-docx ждёт ВЛОЖЕННЫЙ контракт (employee/period/main/total),
      // а не плоские поля — иначе даты и ФИО остаются пустыми в документе.
      const data = {
        organization: org,
        employee: {
          full_name: v.fio,
          position: positionRu(v),
          department: groupTitleOf(v),
          personnel_number: 2300 + (v.employee_id % 1000),
        },
        period: { date_from: v.date_from, date_to: v.date_to, days: v.days },
        main: { days: v.days, date_from: v.date_from, date_to: v.date_to },
        total: { days: v.days, date_from: v.date_from, date_to: v.date_to },
        // «за период работы с … по …» — рабочий год, за который предоставлен отпуск
        // (12 месяцев до начала отпуска). Без этого строка в Т-6 оставалась пустой.
        work_period: { date_from: shiftYear(v.date_from, -1), date_to: v.date_from },
        manager: { position: 'Генеральный директор', full_name: 'Кудряшов О. С.' },
        hr: { position: 'Руководитель кадровой службы', full_name: 'Лебедева И. П.' },
        application_date: new Date().toISOString().slice(0, 10),
        // Блок «с приказом ознакомлен» — заполняем датой издания приказа.
        acknowledged: { date: new Date().toISOString().slice(0, 10) },
      };
      const buf = kind === 'prikaz' ? await docs.generateOrderT6(data)
        : kind === 't7xlsx' ? await docs.generateScheduleT7Xlsx({
          organization: org, year,
          employees: staff.map((s) => ({
            full_name: s.name, position: s.role,
            department: groupTitleOf({ role: s.role }),
            personnel_number: 2300 + (s.id % 1000),
            periods: all.filter((x) => x.employee_id === s.id),
          })),
        })
          : await docs.generateVacationApplication(data);
      // XLSX отдаём как XLSX (а не как DOCX) — иначе Excel не откроет файл.
      const isXlsx = kind === 't7xlsx';
      reply.header('Content-Type', isXlsx
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      reply.header('Content-Disposition',
        `attachment; filename="${isXlsx ? `grafik-otpuskov-T7-${year}.xlsx` : `${kind}-${v.date_from}.docx`}"`);
      return reply.send(buf);
    } catch (err) {
      logError(fastify, '[vacations] GET /docs/:kind', err, request);
      return sendHuman(reply, err);
    }
  });

  /* ── GET /office — отпуска для графика офиса (витрина) ─────────────── */
  fastify.get('/office', readAuth, async (request, reply) => {
    try {
      const year = Number(request.query.year) || new Date().getFullYear();
      const all = await periodsYear(year);
      const rows = all
        .filter((v) => v.status === 'pending' || v.status === 'approved')
        .map((v) => ({
          employee_id: v.employee_id, fio: v.fio, date_from: v.date_from, date_to: v.date_to,
          days: v.days, holidays: v.holidays_count, status: v.status,
        }));
      return { year, vacations: rows };
    } catch (err) {
      logError(fastify, '[vacations] GET /office', err, request);
      return sendHuman(reply, err);
    }
  });
};
