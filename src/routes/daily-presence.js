'use strict';

/**
 * Daily Presence — обязательная ежедневная отметка «где я сегодня» для ОФИСНЫХ сотрудников.
 *
 * ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ — таблица staff_plan (та же, что у «Графика офиса»):
 *   staff.user_id = users.id → staff.id = staff_plan.staff_id, дата = CURRENT_DATE, status_code.
 * Поэтому отметка в гейте СРАЗУ появляется в Графике офиса и наоборот.
 *
 * Статусы — коды графика офиса (оф/уд/бн/сс/км/пг/уч/ск/вх) + «об» (на объекте) с привязкой к работе.
 * «На объекте» доступно только если у пользователя есть активные работы (показываем ТОЛЬКО его работы).
 *
 * Полевые рабочие отмечаются через field_checkins (мобилка) — сюда не попадают.
 */

const { notClosedSql } = require('../helpers/work-status');
const activity = require('../services/presence-activity');

module.exports = async function (fastify, options) {
  const db = fastify.db;
  try { activity.attachDb(db); } catch (_) { /* ignore */ }

  // ─────────────────────────────────────────────────────────────────
  // POST /api/daily-presence/heartbeat — пульс активности для «живого офиса» (Фаза 3)
  //   body: { page?:string, act?:'coffee'|'smoke'|'lunch'|null }. Эфемерно (in-memory).
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/heartbeat', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user && request.user.id;
    if (!userId) { reply.code(401); return { error: 'no_user' }; }
    const b = request.body || {};
    activity.beat(userId, b.page, b.act);
    return { ok: true };
  });

  // POST /api/daily-presence/self-act — самоотметка ☕/💨/🍖 (или снять: act=null)
  fastify.post('/self-act', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user && request.user.id;
    if (!userId) { reply.code(401); return { error: 'no_user' }; }
    const act = (request.body || {}).act || null;
    activity.setSelfAct(userId, act);
    return { ok: true, act };
  });

  // офисные роли, которым ОБЯЗАТЕЛЬНО отмечаться.
  // ADMIN намеренно исключён: это техническая/системная учётка (единственный админ в СРМ,
  // у неё стоит ФИО владельца) — она не «ходит в офис» как сотрудник и не должна плодить
  // фантомную отметку в «Графике офиса» параллельно рабочему аккаунту человека.
  const OFFICE_ROLES = [
    'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'PROC', 'BUH', 'OFFICE_MANAGER', 'CHIEF_ENGINEER',
    'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
  ];
  const BOARD_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'HR_MANAGER', 'HEAD_PM', 'HEAD_TO'];

  // Статусы (коды как в «Графике офиса» + «об» на объекте). needsWork → требуется выбор работы.
  const STATUS_DEFS = [
    { code: 'оф', label: 'В офисе',            emoji: '🏢' },
    { code: 'уд', label: 'Удалёнка',           emoji: '🏠' },
    { code: 'об', label: 'На объекте',         emoji: '🚧', needsWork: true },
    { code: 'км', label: 'Командировка',       emoji: '🚗' },
    { code: 'пг', label: 'Встреча/переговоры', emoji: '🤝' },
    { code: 'уч', label: 'Учёба',              emoji: '📚' },
    { code: 'ск', label: 'Склад',              emoji: '📦' },
    { code: 'бн', label: 'Больничный',         emoji: '🤒' },
    { code: 'сс', label: 'За свой счёт',       emoji: '🌴' },
    { code: 'вх', label: 'Выходной',           emoji: '🛌' },
  ];
  const VALID_CODES = new Set(STATUS_DEFS.map(s => s.code));

  // Найти staff_id по users.id или создать (под advisory-локом — без дублей при гонке).
  async function ensureStaffId(userId, name, role) {
    const { rows } = await db.query('SELECT id FROM staff WHERE user_id = $1 ORDER BY id LIMIT 1', [userId]);
    if (rows.length) return rows[0].id;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [202, userId]); // namespace 202 = staff-by-user
      const re = await client.query('SELECT id FROM staff WHERE user_id = $1 ORDER BY id LIMIT 1', [userId]);
      if (re.rows.length) { await client.query('COMMIT'); return re.rows[0].id; }
      const ins = await client.query(
        `INSERT INTO staff (user_id, name, role_tag, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, true, NOW(), NOW()) RETURNING id`,
        [userId, name || ('user#' + userId), role || '']
      );
      await client.query('COMMIT');
      return ins.rows[0].id;
    } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} throw e; }
    finally { client.release(); }
  }

  // Прочитать отметку за сегодня (status_code + work_id) по staff_id
  async function todayPlan(staffId, dateIso) {
    const { rows } = await db.query(
      `SELECT id, status_code, work_id, updated_at,
              (updated_at::date = $2::date) AS touched_today
         FROM staff_plan
        WHERE staff_id = $1 AND date = $2::date AND status_code IS NOT NULL AND status_code <> ''
        ORDER BY id DESC LIMIT 1`, [staffId, dateIso || null]);
    return rows[0] || null;
  }

  // Мои активные работы (для статуса «На объекте») — ТОЛЬКО где я РП и работа не закрыта
  async function myActiveWorks(userId) {
    const { rows } = await db.query(
      `SELECT id, work_title, work_status, city, object_name FROM works
       WHERE pm_id = $1 AND deleted_at IS NULL AND ${notClosedSql('work_status')}
       ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 50`, [userId]);
    return rows.map(r => ({
      id: r.id,
      title: r.work_title || ('Работа #' + r.id),
      place: r.object_name || r.city || '',
      status: r.work_status
    }));
  }

  // UPSERT отметки в staff_plan за сегодня (под advisory-локом по staff_id)
  async function upsertPlan(staffId, code, workId, userId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [203, staffId]); // namespace 203 = staff_plan today
      const ex = await client.query(
        'SELECT id FROM staff_plan WHERE staff_id = $1 AND date = CURRENT_DATE ORDER BY id LIMIT 1', [staffId]);
      let row;
      if (ex.rows.length) {
        const r = await client.query(
          `UPDATE staff_plan SET status_code = $2, work_id = $3, updated_at = NOW()
           WHERE id = $1 RETURNING id, status_code, work_id`, [ex.rows[0].id, code, workId]);
        row = r.rows[0];
      } else {
        const r = await client.query(
          `INSERT INTO staff_plan (staff_id, date, status_code, work_id, created_at, updated_at)
           VALUES ($1, CURRENT_DATE, $2, $3, NOW(), NOW())
           RETURNING id, status_code, work_id`, [staffId, code, workId]);
        row = r.rows[0];
      }
      await client.query('COMMIT');
      return row;
    } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} throw e; }
    finally { client.release(); }
  }

  async function serverDate() {
    const { rows: [d] } = await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`);
    return d.d;
  }

  // ─────────────────────────────────────────────────────────────────
  // Недельный режим (заказчик 18.10.2026):
  //   сотрудник заполняет РАБОЧУЮ неделю (пн–пт) целиком; в другие дни система
  //   спрашивает «ты в офисе?» и правка уходит в staff_plan (график офиса меняется).
  //   Выходные и праздники для отметки недоступны.
  // ─────────────────────────────────────────────────────────────────

  /** Праздники/переносы за диапазон из производственного календаря. */
  async function calendarRange(fromIso, toIso) {
    const { rows } = await db.query(
      `SELECT to_char(date,'YYYY-MM-DD') AS date, is_working, kind, COALESCE(title, note) AS title
         FROM work_calendar WHERE date >= $1::date AND date <= $2::date`, [fromIso, toIso]);
    const map = {};
    rows.forEach((r) => { map[r.date] = r; });
    return map;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function isoOf(dt) { return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`; }

  /** Рабочие дни недели (пн–пт), исключая праздники/переносы. */
  function weekWorkdays(mondayIso, cal) {
    const [y, m, d] = mondayIso.split('-').map(Number);
    const out = [];
    for (let i = 0; i < 5; i++) {
      const dt = new Date(Date.UTC(y, m - 1, d + i));
      const iso = isoOf(dt);
      const c = cal[iso];
      const nonWorking = c && (c.kind === 'working' ? false : (c.is_working === false));
      if (nonWorking) continue;
      out.push({ date: iso, holiday: false });
    }
    return out;
  }

  /** Понедельник недели, в которую попадает дата. */
  function mondayOf(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay();              // 0=вс
    const shift = dow === 0 ? -6 : 1 - dow;  // к понедельнику
    dt.setUTCDate(dt.getUTCDate() + shift);
    return isoOf(dt);
  }

  /** Отпуск сотрудника на дату (из графика отпусков) — в отпуске не спрашиваем. */
  async function onVacation(staffId, iso) {
    const { rows } = await db.query(
      `SELECT id FROM office_vacations
        WHERE employee_id = $1 AND $2::date BETWEEN date_from AND date_to
          AND status IN ('pending','approved') LIMIT 1`, [staffId, iso]);
    return rows.length > 0;
  }

  // GET /api/daily-presence/week — состояние недели: что заполнено, что нет
  fastify.get('/week', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user && request.user.id;
      const role = request.user && request.user.role;
      const name = request.user && request.user.name;
      if (!userId) { reply.code(401); return { error: 'no_user' }; }
      const isOffice = OFFICE_ROLES.includes(role);
      if (!isOffice) return { required: false, days: [], server_date: await serverDate() };

      const todayIso = request.query.date || await serverDate();
      const monday = mondayOf(todayIso);
      const staffId = await ensureStaffId(userId, name, role);
      const cal = await calendarRange(monday, (() => {
        const [y, m, d] = monday.split('-').map(Number);
        return isoOf(new Date(Date.UTC(y, m - 1, d + 6)));
      })());
      const wd = weekWorkdays(monday, cal);

      const { rows: plan } = await db.query(
        `SELECT to_char(date,'YYYY-MM-DD') AS date, status_code, work_id FROM staff_plan
          WHERE staff_id = $1 AND date >= $2::date AND date <= ($2::date + 6)`, [staffId, monday]);
      const planMap = {};
      plan.forEach((p) => { planMap[p.date] = p; });

      const days = [];
      for (const w of wd) {
        const vac = await onVacation(staffId, w.date);
        days.push({
          date: w.date,
          is_past: w.date < todayIso,
          is_today: w.date === todayIso,
          status_code: vac ? 'отп' : (planMap[w.date] ? planMap[w.date].status_code : null),
          work_id: planMap[w.date] ? planMap[w.date].work_id : null,
          on_vacation: vac,
        });
      }
      const filled = days.filter((d) => d.status_code).length;
      return {
        // D-330: неделя считается заполненной только когда отмечены ВСЕ
        // рабочие дни, иначе гейт продолжает спрашивать.
        required: filled < days.length,
        filled,
        total: days.length,
        week_start: monday,
        server_date: todayIso,
        statuses: STATUS_DEFS,
        days,
        works: await myActiveWorks(userId),
      };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'week_failed', message: e.message };
    }
  });

  // POST /api/daily-presence/week — принять заполнение пн–пт разом
  fastify.post('/week', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const client = await db.pool.connect();
    try {
      const userId = request.user && request.user.id;
      const role = request.user && request.user.role;
      const name = request.user && request.user.name;
      if (!userId) { reply.code(401); return { error: 'no_user' }; }
      const body = request.body || {};
      const items = Array.isArray(body.days) ? body.days : [];
      if (!items.length) { reply.code(400); return { error: 'empty', message: 'Нет дней для сохранения.' }; }

      const staffId = await ensureStaffId(userId, name, role);
      const dates = items.map((i) => String(i.date).slice(0, 10)).sort();
      const cal = await calendarRange(dates[0], dates[dates.length - 1]);

      let saved = 0;
      await client.query('BEGIN');
      for (const it of items) {
        const iso = String(it.date).slice(0, 10);
        const code = it.status_code;
        if (!VALID_CODES.has(code)) { await client.query('ROLLBACK'); reply.code(400); return { error: 'bad_status', date: iso }; }

        // только рабочие дни (пн–пт, не праздник/перенос)
        const c = cal[iso];
        const p = new Date(iso + 'T00:00:00Z');
        const dow = p.getUTCDay();
        const nonWorking = c && (c.kind === 'working' ? false : c.is_working === false);
        if (dow === 0 || dow === 6 || nonWorking) {
          await client.query('ROLLBACK');
          reply.code(400);
          return { error: 'non_working_day', date: iso, message: 'Заполняются только рабочие дни (пн–пт, без праздников).' };
        }
        if (await onVacation(staffId, iso)) continue;   // в отпуске не перезаписываем

        let workId = null;
        if (code === 'об') {
          workId = parseInt(it.work_id, 10) || null;
          if (!workId) { await client.query('ROLLBACK'); reply.code(400); return { error: 'work_required', date: iso }; }
          const own = await client.query(
            `SELECT id FROM works WHERE id = $1 AND pm_id = $2 AND deleted_at IS NULL AND ${notClosedSql('work_status')}`,
            [workId, userId]);
          if (!own.rows.length) { await client.query('ROLLBACK'); reply.code(400); return { error: 'work_not_yours', date: iso }; }
        }

        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [203, staffId]);
        const ex = await client.query(
          'SELECT id FROM staff_plan WHERE staff_id = $1 AND date = $2::date ORDER BY id LIMIT 1', [staffId, iso]);
        if (ex.rows.length) {
          await client.query(
            `UPDATE staff_plan SET status_code = $2, work_id = $3, updated_at = NOW() WHERE id = $1`,
            [ex.rows[0].id, code, workId]);
        } else {
          await client.query(
            `INSERT INTO staff_plan (staff_id, date, status_code, work_id, created_at, updated_at)
             VALUES ($1, $2::date, $3, $4, NOW(), NOW())`, [staffId, iso, code, workId]);
        }
        saved++;
      }

      // D-330: нельзя сохранить НЕПОЛНУЮ неделю — иначе гейт закрывался,
      // оставляя пустые дни. Проверяем ПОСЛЕ валидации статусов и работ,
      // чтобы не перекрывать более точные ошибки (bad_status и т.п.).
      const mondayW = mondayOf(dates[0]);
      const workdaysW = weekWorkdays(mondayW, cal).filter((w) => !w.holiday).map((w) => w.date);
      const providedW = new Set(dates);
      const missingW = workdaysW.filter((d) => !providedW.has(d));
      if (missingW.length) {
        await client.query('ROLLBACK');
        reply.code(400);
        return {
          error: 'week_incomplete',
          message: 'Отметь все рабочие дни недели — осталось ' + missingW.length + '.',
          missing: missingW,
        };
      }

      await client.query('COMMIT');
      return { ok: true, saved };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      request.log.error(e);
      reply.code(500);
      return { error: 'week_save_failed', message: e.message };
    } finally { client.release(); }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/daily-presence/today — нужна ли отметка + статусы + мои работы
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/today', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user && request.user.id;
      const role = request.user && request.user.role;
      const name = request.user && request.user.name;
      if (!userId) { reply.code(401); return { error: 'no_user' }; }

      const isOffice = OFFICE_ROLES.includes(role);
      // Дата: по умолчанию сегодня на сервере. Параметр `date` нужен для
      // проверки конкретного дня (тесты, предпросмотр) — раньше он игнорировался,
      // и праздник можно было проверить только случайно, когда он совпадёт с сегодня.
      const reqDate = String(request.query.date || '').slice(0, 10);
      const sd = /^\d{4}-\d{2}-\d{2}$/.test(reqDate) ? reqDate : await serverDate();
      if (!isOffice) {
        // полевые/прочие — гейт не нужен
        return { required: false, server_date: sd, statuses: STATUS_DEFS, works: [], current: null };
      }

      const staffId = await ensureStaffId(userId, name, role);

      // В отпуске «где ты» не спрашиваем — система уже знает ответ.
      const vac = await onVacation(staffId, sd);
      if (vac) {
        return { required: false, server_date: sd, statuses: STATUS_DEFS, works: [], current: { status_code: 'отп', work_id: null }, on_vacation: true };
      }
      // D-329: в субботу/воскресенье ТОЖЕ спрашиваем — люди заходят в CRM
      // и по выходным (дежурства, подряд, срочные заявки). Раньше гейт молчал
      // и отметиться было негде. Праздник РФ по-прежнему не спрашиваем:
      // это не рабочий день по закону, и статуса «в отпуске/больничном» там нет.
      const calToday = await calendarRange(sd, sd);
      const c = calToday[sd];
      const isHolidayToday = !!(c && c.kind === 'holiday');
      const isWorkingShift = !!(c && c.kind === 'working');
      if (isHolidayToday) {
        return { required: false, server_date: sd, statuses: STATUS_DEFS, works: [], current: null, non_working: true, holiday: true };
      }
      // Обычный выходной (сб/вс) — спрашиваем, но помечаем, чтобы UI мог подписать.
      const p = new Date(sd + 'T00:00:00Z');
      const dow = p.getUTCDay();
      const isWeekend = (dow === 0 || dow === 6) && !isWorkingShift;

      const current = await todayPlan(staffId, sd);
      const works = await myActiveWorks(userId);

      // «На объекте» доступно только если есть активные работы
      const statuses = STATUS_DEFS.filter(s => !s.needsWork || works.length > 0);

      // D-327: спрашиваем каждый день, даже если статус пришёл из недельного
      // графика. Отметка считается «сегодняшней», только если её реально
      // трогали сегодня (updated_at::date = CURRENT_DATE). Если понедельник
      // проставил неделю — во вторник спросим подтверждение этой отметки.
      const confirmedToday = !!(current && current.touched_today);

      return {
        required: !confirmedToday,
        is_weekend: isWeekend,
        current: current ? { status_code: current.status_code, work_id: current.work_id } : null,
        statuses,
        works,
        server_date: sd
      };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'presence_today_failed', message: e.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/daily-presence — поставить/обновить отметку (пишет в staff_plan)
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user && request.user.id;
      const role = request.user && request.user.role;
      const name = request.user && request.user.name;
      if (!userId) { reply.code(401); return { error: 'no_user' }; }

      const body = request.body || {};
      const code = body.status_code;
      if (!VALID_CODES.has(code)) { reply.code(400); return { error: 'bad_status' }; }

      let workId = null;
      if (code === 'об') {
        workId = parseInt(body.work_id, 10) || null;
        if (!workId) { reply.code(400); return { error: 'work_required' }; }
        // защита: работа должна быть СВОЕЙ и активной
        const { rows } = await db.query(
          `SELECT id FROM works WHERE id = $1 AND pm_id = $2 AND deleted_at IS NULL AND ${notClosedSql('work_status')}`,
          [workId, userId]);
        if (!rows.length) { reply.code(400); return { error: 'work_not_yours_or_closed' }; }
      }

      const staffId = await ensureStaffId(userId, name, role);
      const row = await upsertPlan(staffId, code, workId, userId);
      return { ok: true, presence: { status_code: row.status_code, work_id: row.work_id } };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'presence_save_failed', message: e.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/daily-presence/board?date= — кто где сегодня (из staff_plan)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/board', { preHandler: [fastify.requireRoles(BOARD_ROLES)] }, async (request, reply) => {
    try {
      const date = request.query.date || null;
      const { rows } = await db.query(`
        SELECT s.user_id, u.name AS user_name, u.role,
               sp.status_code, sp.work_id, w.work_title, sp.date
        FROM staff_plan sp
        JOIN staff s ON s.id = sp.staff_id
        JOIN users u ON u.id = s.user_id
        LEFT JOIN works w ON w.id = sp.work_id
        WHERE sp.date = COALESCE($1::date, CURRENT_DATE)
          AND sp.status_code IS NOT NULL AND sp.status_code <> ''
        ORDER BY sp.status_code, u.name
      `, [date]);
      return { date: date || null, board: rows, statuses: STATUS_DEFS };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'presence_board_failed', message: e.message };
    }
  });
};
