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
    // «нп» — НЕ подтверждён: машинный статус, ставится когда снят ложный «оф»
    // (статус «в офисе» без прохода СКУД). В ручном выборе его нет — как «отп».
    { code: 'нп', label: 'Не подтверждён',     emoji: '❔', machine: true }
  ];
  const VALID_CODES = new Set(STATUS_DEFS.map(s => s.code));
  // Что можно выбрать в ответ на вопрос «где ты был»: всё, кроме «оф» и «нп».
  const DISPUTE_ALLOWED = new Set(['уд', 'об', 'км', 'пг', 'уч', 'ск', 'бн', 'сс', 'вх']);

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

  // UPSERT отметки в staff_plan.
  // ВАЖНО: dateIso обязателен. Раньше функция всегда писала в CURRENT_DATE —
  // из-за этого ответ на вопрос «где ты был 29.10» ложился в сегодняшний день,
  // а вчерашний оставался «нп» (верификатор 03.11.2026, P1-1).
  async function upsertPlan(staffId, code, workId, userId, dateIso) {
    const targetDate = String(dateIso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw new Error('upsertPlan: не передана дата отметки');
    }
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [203, staffId]); // namespace 203 = staff_plan
      const ex = await client.query(
        'SELECT id FROM staff_plan WHERE staff_id = $1 AND date = $2::date ORDER BY id DESC LIMIT 1',
        [staffId, targetDate]);
      let row;
      if (ex.rows.length) {
        const r = await client.query(
          `UPDATE staff_plan SET status_code = $2, work_id = $3, updated_at = NOW()
           WHERE id = $1 RETURNING id, status_code, work_id`, [ex.rows[0].id, code, workId]);
        row = r.rows[0];
      } else {
        const r = await client.query(
          `INSERT INTO staff_plan (staff_id, date, status_code, work_id, created_at, updated_at)
           VALUES ($1, $2::date, $3, $4, NOW(), NOW())
           RETURNING id, status_code, work_id`, [staffId, targetDate, code, workId]);
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

/**
 * Существует ли такая календарная дата в допустимом диапазоне.
 * Та же граница, что в generic CRUD (`data.js`: MIN_YEAR/MAX_YEAR), чтобы
 * правила не расходились между ручками (верификатор 03.11.2026).
 */
const DP_MIN_YEAR = 1900;
const DP_MAX_YEAR = 2100;
function isValidIsoDate(iso) {
  const s = String(iso || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1]; const mo = +m[2]; const d = +m[3];
  if (y < DP_MIN_YEAR || y > DP_MAX_YEAR) return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y
    && probe.getUTCMonth() === mo - 1
    && probe.getUTCDate() === d;
}

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

  /**
   * Дни, где снят ложный «оф» и сотрудник ещё не ответил.
   * Гейт «где ты был» блокирующий: пока есть хотя бы один такой день,
   * вход в CRM закрыт вопросом. Источник — office_presence_flags (V453).
   */
  async function openDisputes(staffId, fromIso, toIso) {
    try {
      const { rows } = await db.query(
        `SELECT f.date::text AS date, f.reason,
                (SELECT COUNT(*)::int FROM office_presence_flags f2
                  WHERE f2.staff_id = f.staff_id AND f2.resolved_at IS NULL) AS office_attempts
           FROM office_presence_flags f
          WHERE f.staff_id = $1
            AND f.resolved_at IS NULL
            AND ($2::date IS NULL OR f.date >= $2::date)
            AND ($3::date IS NULL OR f.date <= $3::date)
          ORDER BY f.date`,
        [staffId, fromIso || null, toIso || null]
      );
      return rows.map((r) => ({
        date: String(r.date).slice(0, 10),
        reason: r.reason,
        office_attempts: r.office_attempts
      }));
    } catch (e) {
      // Таблицы может не быть до накатки V453 — гейт просто не показываем.
      return [];
    }
  }

  /**
   * Проверка «можно ли поставить оф». Возвращает { ok, reason }.
   * Правило заказчика: если отчёт СКУД покрывает этот день и проходов нет —
   * «в офисе» поставить нельзя ни через UI, ни прямым запросом к API.
   */
  async function canMarkOffice(staffId, iso) {
    try {
      const { rows } = await db.query(
        `SELECT office_minutes FROM office_hours_daily WHERE staff_id = $1 AND date = $2::date`,
        [staffId, iso]
      );
      if (rows.length) {
        // Данные СКУД за день есть: разрешаем только при реальных проходах.
        if (Number(rows[0].office_minutes) > 0) return { ok: true };
        return { ok: false, reason: 'office_not_confirmed', message: 'В этот день СКУД не зафиксировал вход' };
      }
      // Дня нет в office_hours_daily. Проверяем, покрыт ли он импортом вообще:
      // если покрыт — значит проходов не было; если нет — данных ещё нет, не мешаем.
      const { rows: cov } = await db.query(
        `SELECT 1 FROM skud_imports
          WHERE deleted_at IS NULL AND period_from <= $1::date AND period_to >= $1::date
          LIMIT 1`, [iso]
      );
      if (cov.length) {
        return { ok: false, reason: 'office_not_confirmed', message: 'В этот день СКУД не зафиксировал вход' };
      }
      return { ok: true, noData: true };
    } catch (e) {
      return { ok: true, noData: true };
    }
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
        `SELECT DISTINCT ON (date) to_char(date,'YYYY-MM-DD') AS date, status_code, work_id
           FROM staff_plan
          WHERE staff_id = $1 AND date >= $2::date AND date <= ($2::date + 6)
          ORDER BY date, id DESC`, [staffId, monday]);
      const planMap = {};
      plan.forEach((p) => { planMap[p.date] = p; });

      const days = [];
      for (const w of wd) {
        const vac = await onVacation(staffId, w.date);
        // День, где СКУД не видел человека, не должен предлагать «в офисе»:
        // иначе пользователь выберет его, а сохранение упадёт на 409.
        let officeBlocked = false;
        if (!vac) {
          const chk = await canMarkOffice(staffId, w.date);
          officeBlocked = !chk.ok;
        }
        days.push({
          date: w.date,
          is_past: w.date < todayIso,
          is_today: w.date === todayIso,
          status_code: vac ? 'отп' : (planMap[w.date] ? planMap[w.date].status_code : null),
          work_id: planMap[w.date] ? planMap[w.date].work_id : null,
          on_vacation: vac,
          office_blocked: officeBlocked,
        });
      }
      const filled = days.filter((d) => d.status_code).length;
      // Гейт «где ты был»: снятые ложные «оф» блокируют вход, пока не отвечено.
      const disputes = await openDisputes(staffId, null, null);
      return {
        // D-330: неделя считается заполненной только когда отмечены ВСЕ
        // рабочие дни, иначе гейт продолжает спрашивать.
        required: filled < days.length || disputes.length > 0,
        disputes,
        filled,
        total: days.length,
        week_start: monday,
        server_date: todayIso,
        statuses: STATUS_DEFS.filter(s => s.code !== 'нп'),
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

      // Календарная валидация дат недели.
      // ВАЖНО (верификатор 03.11.2026, D-3/D-4): раньше дата резалась
      // `slice(0,10)` и уходила в SQL как есть — неделя за 1899 или 2999 год
      // сохранялась с 200, а `2026-02-31` давал 500 на `new Date(...)`.
      // Теперь та же граница, что в generic CRUD (1900–2100) и реальный календарь.
      const weekIso = items.map((i) => String(i.date).slice(0, 10));
      for (const iso of weekIso) {
        if (!isValidIsoDate(iso)) {
          reply.code(400);
          return {
            error: 'bad_date',
            date: iso,
            message: 'Дата не распознана или не существует в календаре (допустимы годы 1900–2100).'
          };
        }
      }

      const dates = weekIso.slice().sort();
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

        // «нп» — машинный статус: руками через недельный гейт не ставится.
        if (code === 'нп') {
          await client.query('ROLLBACK');
          reply.code(400);
          return { error: 'machine_status', date: iso, message: 'Статус «Не подтверждён» ставится системой' };
        }

        // Запрет «оф» без прохода СКУД — и в недельном гейте тоже.
        if (code === 'оф') {
          const chk = await canMarkOffice(staffId, iso);
          if (!chk.ok) {
            await client.query('ROLLBACK');
            reply.code(409);
            return {
              error: chk.reason,
              date: iso,
              message: `В этот день (${iso}) СКУД не зафиксировал вход. Выберите другой статус.`
            };
          }
        }

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
          'SELECT id FROM staff_plan WHERE staff_id = $1 AND date = $2::date ORDER BY id DESC LIMIT 1', [staffId, iso]);
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

      // «На объекте» доступно только если есть активные работы.
      // «нп» в дневном гейте не предлагается: это машинный статус.
      const statuses = STATUS_DEFS.filter(s => (!s.needsWork || works.length > 0) && s.code !== 'нп');

      // День, где СКУД не видел человека: «в офисе» убираем из выбора заранее,
      // чтобы не ловить 409 при сохранении.
      let officeBlocked = false;
      if (statuses.some(s => s.code === 'оф')) {
        const chk = await canMarkOffice(staffId, sd);
        officeBlocked = !chk.ok;
      }
      const dayStatuses = officeBlocked ? statuses.filter(s => s.code !== 'оф') : statuses;

      // D-327: спрашиваем каждый день, даже если статус пришёл из недельного
      // графика. Отметка считается «сегодняшней», только если её реально
      // трогали сегодня (updated_at::date = CURRENT_DATE). Если понедельник
      // проставил неделю — во вторник спросим подтверждение этой отметки.
      const confirmedToday = !!(current && current.touched_today);

      // Гейт «где ты был»: снятые ложные «оф» показываются отдельным блоком
      // и блокируют вход, пока сотрудник не ответил статусом, отличным от «оф».
      const disputes = await openDisputes(staffId, null, null);

      return {
        required: !confirmedToday || disputes.length > 0,
        disputes,
        is_weekend: isWeekend,
        current: current ? { status_code: current.status_code, work_id: current.work_id } : null,
        statuses: dayStatuses,
        office_blocked: officeBlocked,
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
      // «нп» — машинный статус, руками не ставится (как «отп»).
      if (code === 'нп') {
        reply.code(400);
        return { error: 'machine_status', message: 'Статус «Не подтверждён» ставится системой' };
      }

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

      // Запрет «оф» без подтверждения СКУД — на уровне API, а не только UI.
      // Иначе отметку можно поставить прямым запросом в обход графика.
      if (code === 'оф') {
        const chk = await canMarkOffice(staffId, await serverDate());
        if (!chk.ok) {
          reply.code(409);
          return { error: chk.reason, message: chk.message };
        }
      }

      const row = await upsertPlan(staffId, code, workId, userId, await serverDate());
      return { ok: true, presence: { status_code: row.status_code, work_id: row.work_id } };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'presence_save_failed', message: e.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/daily-presence/dispute-response — ответ на «где ты был»
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/dispute-response', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user && request.user.id;
      const role = request.user && request.user.role;
      const name = request.user && request.user.name;
      if (!userId) { reply.code(401); return { error: 'no_user' }; }

      const body = request.body || {};
      const date = String(body.date || '').slice(0, 10);
      const code = body.status_code;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { reply.code(400); return { error: 'bad_date' }; }
      if (!DISPUTE_ALLOWED.has(code)) {
        reply.code(400);
        return {
          error: 'office_not_allowed',
          message: 'В этот день «в офисе» поставить нельзя — СКУД не зафиксировал вход. Выберите другой статус.'
        };
      }

      const staffId = await ensureStaffId(userId, name, role);

      // Флаг должен существовать и быть неотвеченным.
      const { rows: flags } = await db.query(
        `SELECT id, resolved_at FROM office_presence_flags
          WHERE staff_id = $1 AND date = $2::date ORDER BY id DESC LIMIT 1`,
        [staffId, date]
      );
      if (!flags.length) {
        reply.code(404);
        return { error: 'no_dispute', message: 'По этой дате вопросов нет' };
      }
      if (flags[0].resolved_at) {
        reply.code(409);
        return { error: 'already_resolved', message: 'Ответ по этой дате уже дан' };
      }

      let workId = null;
      if (code === 'об') {
        workId = parseInt(body.work_id, 10) || null;
        if (!workId) { reply.code(400); return { error: 'work_required' }; }
        const { rows: own } = await db.query(
          `SELECT id FROM works WHERE id = $1 AND pm_id = $2 AND deleted_at IS NULL AND ${notClosedSql('work_status')}`,
          [workId, userId]);
        if (!own.length) { reply.code(400); return { error: 'work_not_yours_or_closed' }; }
      }

      // Пишем ответ ИМЕННО в тот день, о котором спросили (верификатор P1-1).
      await upsertPlan(staffId, code, workId, userId, date);
      await db.query(
        `UPDATE office_presence_flags
            SET resolved_at = NOW(), resolved_status = $2, resolved_comment = $3
          WHERE id = $1`,
        [flags[0].id, code, String(body.comment || '').slice(0, 500) || null]
      );

      // Аудит обязателен: это ответ вместо снятой отметки, его должны видеть.
      try {
        const { writeAudit } = require('../lib/crm-audit');
        await writeAudit(db, {
          actorUserId: userId,
          entityType: 'office_presence_flags',
          entityId: flags[0].id,
          action: 'dispute_response',
          payload: { date, status_code: code, comment: body.comment || null }
        });
      } catch (_) { /* аудит не должен валить ответ */ }

      return {
        ok: true,
        date,
        status_code: code,
        resolved: true,
        remaining: (await openDisputes(staffId, null, null)).length
      };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'dispute_failed', message: e.message };
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
