/**
 * Staff Routes (employees, schedule, rating)
 */

const { closedSql, notClosedSql } = require('../helpers/work-status');

// SECURITY: Allowlist of columns
const EMPLOYEE_COLS = new Set([
  'fio', 'role_tag', 'phone', 'position', 'passport_number',
  'rating_avg', 'is_active', 'created_at', 'updated_at',
  'email', 'city', 'full_name', 'inn', 'snils', 'birth_date',
  'address', 'employment_date', 'dismissal_date', 'salary', 'rate',
  // 23.06.2026 KNOWN-ISSUE (🟡 Staff-4, D-06): дублирующиеся пары серий/номеров паспорта.
  // pass_series/pass_number  — историческое (старое) именование.
  // passport_series/passport_number — новое каноническое именование.
  // Миграции единого слияния НЕ применено (V234 — placeholder no-op). Часть рабочих хранит
  // данные в pass_*, часть в passport_*. UI читает оба (EditEmployeeModal:90-91).
  // НЕ удалять старую пару до полной миграции данных — иначе рабочие со старым набором
  // потеряют видимость серии/номера паспорта в карточке.
  'gender', 'grade', 'hire_date', 'pass_series', 'pass_number',
  'passport_series', 'passport_number', 'contract_type', 'department',
  'registration_address', 'birth_place', 'passport_date', 'passport_issued',
  'passport_code', 'naks', 'naks_number', 'naks_stamp', 'naks_date',
  'naks_expiry', 'fsb_pass', 'score_index', 'qualification_name',
  'qualification_grade', 'brigade', 'notes', 'day_rate',
  'bank_name', 'bik', 'account_number', 'card_number',
  'is_self_employed', 'docs_url', 'skills', 'comment',
  'imt_number', 'imt_expires', 'permits', 'rating_count',
  'is_officially_employed',
  // V217 (16.06.2026): доп. поля анкеты — экстренные контакты + образование + медицина + одежда.
  // Источник: vanilla employee.js блоки «Экстренные контакты» (269-294) и «Дополнительно» (296-337).
  // React v2: public/desktop-v2-src/src/pages/Personnel/EmployeeExtraFields.jsx.
  'phone2', 'telegram',
  'spouse_name', 'spouse_phone',
  'relative_name', 'relative_relation', 'relative_phone',
  'education', 'specialty',
  'marital_status', 'children_count',
  'shoe_size', 'height', 'blood_type', 'medical_notes',
  // M2-A Phase 2 (19.06.2026): редактирование СЗ/Оф полей с карточки рабочего.
  // V143: финансовые поля СЗ/Оф. V239: НПД-«стартовая корректировка».
  // RBAC и логика INN — в handler PUT /employees/:id (см. ниже).
  'can_exceed_limit',
  'official_salary', 'official_non_burnable', 'official_hire_date',
  'official_status', 'official_leave_from', 'official_leave_to',
  'se_yearly_used_initial', 'se_monthly_used_initial',
  // V240 (19.06.2026): СЗ-получатель (родственник, на которого идут НПД-выплаты).
  // is_se_payee — это «помощник», не работающий сам.
  // se_payee_id  — ссылка от рабочего на получателя его НПД-выплат.
  // Финансово важное поле (только FIN_ROLES могут менять привязку).
  'se_payee_id', 'is_se_payee'
]);

// M2-A: финансовые поля — менять могут только ADMIN/DIRECTOR_GEN/BUH.
// B5+ (19.06.2026): расширено — official_status (увольнение/декрет),
// official_hire_date, official_leave_from/_to — это финансовые решения,
// PM/HR_MANAGER не должны их править.
const FIN_RESTRICTED_FIELDS = new Set([
  'can_exceed_limit',
  'official_salary', 'official_non_burnable',
  'se_yearly_used_initial', 'se_monthly_used_initial',
  'official_status', 'official_hire_date',
  'official_leave_from', 'official_leave_to',
  // V240: привязка рабочего к СЗ-получателю — финансовое решение,
  // PM/HR_MANAGER не должны её менять (могут случайно сломать выплаты).
  'se_payee_id'
]);
const FIN_ROLES = new Set(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH']);
const FIN_ROLES_ARRAY = Array.from(FIN_ROLES);

// SE-limits import (Ozon-Bank weekly Excel) — нормализация телефона/ФИО для матчинга
// 8XXXXXXXXXX → 7XXXXXXXXXX, +7XXXXXXXXXX → 7XXXXXXXXXX, прочее → только цифры начиная с 7.
// Возвращает 11-значную строку или null если меньше 10 цифр.
function normalizeSePhone(raw) {
  if (raw == null) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;        // без кода страны
  if (d.length === 11 && !d.startsWith('7')) return null;
  if (d.length !== 11) return null;
  return d;
}

function normalizeSeFio(raw) {
  if (raw == null) return '';
  return String(raw).toLowerCase().replace(/\s+/g, ' ').replace(/ё/g, 'е').trim();
}

// «373 000,00» / «373000.00» / «373000» → 373000 (число) или null.
function parseSeRemaining(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).replace(/\s| /g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Распознавание заголовков Excel: «телефон», «фио»/«фамилия», «лимит»/«остаток».
function classifySeHeader(h) {
  const s = String(h || '').toLowerCase().trim();
  if (!s) return null;
  if (/телефон|phone|номер/.test(s))                                return 'phone';
  if (/фио|фамилия|name|сотруд|плательщ|получ|самозан/.test(s))     return 'fio';
  if (/лимит|остат|доступ|свобод|remaining|остаток/.test(s))        return 'remaining';
  return null;
}
const REVIEW_COLS = new Set([
  'employee_id', 'rating', 'comment', 'pm_id', 'created_at', 'score'
]);
const SCHEDULE_COLS = new Set([
  'employee_id', 'date', 'work_id', 'note', 'created_at',
  'kind', 'source', 'staff_request_id', 'locked', 'updated_at'
]);

function filterData(data, allowedSet) {
  const filtered = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowedSet.has(k) && v !== undefined) filtered[k] = v;
  }
  return filtered;
}

async function routes(fastify, options) {
  // Format PostgreSQL date columns to yyyy-MM-dd strings
  function formatDates(row) {
    if (!row) return row;
    const dateFields = ['birth_date', 'hire_date', 'employment_date', 'dismissal_date',
                        'naks_date', 'naks_expiry', 'imt_expires'];
    for (const f of dateFields) {
      if (row[f] instanceof Date) {
        row[f] = row[f].toISOString().slice(0, 10);
      } else if (row[f] && typeof row[f] === 'string' && row[f].includes('T')) {
        row[f] = row[f].slice(0, 10);
      }
    }
    return row;
  }
  const db = fastify.db;

  // GET /api/staff — root list (alias for /employees)
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { rows } = await db.query('SELECT * FROM employees ORDER BY id DESC LIMIT 100');
    return { employees: rows.map(formatDates) };
  });

  // Employees
  fastify.get('/employees', { preHandler: [fastify.authenticate] }, async (request) => {
    const { role_tag, search, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT * FROM employees WHERE 1=1';
    const params = [];
    let idx = 1;
    if (role_tag) { sql += ` AND role_tag = $${idx}`; params.push(role_tag); idx++; }
    if (search) { sql += ` AND LOWER(fio) LIKE $${idx}`; params.push(`%${search.toLowerCase()}%`); idx++; }
    sql += ` ORDER BY fio ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { employees: result.rows.map(formatDates) };
  });

  // GET /api/staff/employees/available?work_id=X
  // Возвращает список employees с пометкой занятости относительно дат указанной работы
  // Каждый сотрудник: { ...employee, is_busy, busy_with: [{work_id, work_title, end_date}] }
  // 23.06.2026 BUG-FIX (Staff S-11): handler принимал только `request`, без `reply`.
  // Внутри использовался `reply.code(400)` и `reply.code(404)` → ReferenceError → 500
  // вместо ожидаемых 400/404 при отсутствии work_id или ненайденной работе.
  fastify.get('/employees/available', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { work_id, role_tag, search } = request.query;
    if (!work_id) return reply.code(400).send({ error: 'work_id обязателен' });

    // Берём даты целевой работы
    const { rows: [targetWork] } = await db.query(
      'SELECT id, work_title, start_in_work_date, start_plan, end_plan, end_fact FROM works WHERE id = $1',
      [work_id]
    );
    if (!targetWork) return reply.code(404).send({ error: 'Работа не найдена' });

    // Effective range целевой работы: используем максимум планов и факта
    const targetStart = targetWork.start_in_work_date || targetWork.start_plan || new Date().toISOString().slice(0,10);
    const targetEnd = targetWork.end_plan || targetWork.end_fact || targetStart;

    // Список employees с фильтрами
    let sql = 'SELECT * FROM employees WHERE 1=1';
    const params = [];
    let idx = 1;
    if (role_tag) { sql += ` AND role_tag = $${idx}`; params.push(role_tag); idx++; }
    if (search) { sql += ` AND LOWER(fio) LIKE $${idx}`; params.push('%' + search.toLowerCase() + '%'); idx++; }
    // Без LIMIT: иначе фамилии на Щ/Э/Ю/Я отсекаются (всего 500-1000 employees)
    sql += ' ORDER BY fio ASC';
    const { rows: employees } = await db.query(sql, params);

    if (!employees.length) return { employees: [], target_work: targetWork };

    // Конфликты: все assignments этих employees на ДРУГИХ активных работах
    // с пересечением по датам (используем effective_end = max(end_plan, end_fact, NOW для активных))
    const empIds = employees.map(e => e.id);
    const { rows: conflicts } = await db.query(`
      SELECT
        ea.employee_id,
        w.id as work_id,
        w.work_title,
        COALESCE(w.start_in_work_date, w.start_plan) as start_date,
        CASE
          WHEN ${closedSql('w.work_status')} THEN COALESCE(w.end_fact, w.end_plan)
          ELSE GREATEST(COALESCE(w.end_plan, CURRENT_DATE), COALESCE(w.end_fact, CURRENT_DATE), CURRENT_DATE)
        END as end_date,
        w.work_status
      FROM employee_assignments ea
      JOIN works w ON w.id = ea.work_id
      WHERE ea.employee_id = ANY($1::int[])
        AND ea.work_id != $2
        AND COALESCE(ea.is_active, true) = true
        AND ${notClosedSql('w.work_status')}
        AND COALESCE(w.start_in_work_date, w.start_plan) <= $4
        AND CASE
              WHEN ${closedSql('w.work_status')} THEN COALESCE(w.end_fact, w.end_plan)
              ELSE GREATEST(COALESCE(w.end_plan, CURRENT_DATE), COALESCE(w.end_fact, CURRENT_DATE), CURRENT_DATE)
            END >= $3
    `, [empIds, parseInt(work_id), targetStart, targetEnd]);

    // Группируем конфликты по employee_id
    const conflictMap = {};
    for (const c of conflicts) {
      if (!conflictMap[c.employee_id]) conflictMap[c.employee_id] = [];
      conflictMap[c.employee_id].push({
        work_id: c.work_id,
        work_title: c.work_title,
        start_date: c.start_date,
        end_date: c.end_date,
        status: c.work_status
      });
    }

    const result = employees.map(e => ({
      ...formatDates(e),
      is_busy: !!conflictMap[e.id],
      busy_with: conflictMap[e.id] || []
    }));

    return {
      employees: result,
      target_work: { id: targetWork.id, title: targetWork.work_title, start: targetStart, end: targetEnd },
      total: result.length,
      free: result.filter(e => !e.is_busy).length,
      busy: result.filter(e => e.is_busy).length
    };
  });

  fastify.get('/employees/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('SELECT * FROM employees WHERE id = $1', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Сотрудник не найден' });
    const reviews = await db.query('SELECT * FROM employee_reviews WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 10', [request.params.id]);
    return { employee: formatDates(result.rows[0]), reviews: reviews.rows };
  });

  // GET /employees/:id/worklog — фактические периоды работы по объектам для ганта
  // «История работ» в карточке рабочего. Периоды строятся по ЧЕК-ИНАМ (field_checkins),
  // а не по плановым датам назначения: показываем реально отработанное время.
  //  • Сегмент = непрерывная серия чек-инов; разрыв > GAP_DAYS дней → новый заезд
  //    (человек может приезжать на один объект несколько раз → бары с разрывами).
  //  • Конец периода: если есть ДАТА ОТЪЕЗДА (departure_date) — ставим по ней
  //    (но не раньше последнего чек-ина). Если даты отъезда НЕТ — смотрим давность
  //    последнего чек-ина: ≤ GAP_DAYS дней назад → «текущая работа» (∞ до сегодня),
  //    иначе завершаем по последнему чек-ину (человек уехал, отъезд не отметили).
  //  • Назначение без единого чек-ина: с датой отъезда → бар до отъезда «нет отметок»,
  //    активное без отъезда → ongoing от даты назначения.
  fastify.get('/employees/:id/worklog', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const empId = parseInt(request.params.id, 10);
    if (isNaN(empId)) return reply.code(400).send({ error: 'Invalid id' });
    const GAP_DAYS = 10; // разрыв/давность больше 10 дней → отдельный заезд или конец работы

    const { rows: checkins } = await db.query(`
      SELECT work_id, date::text AS date
      FROM field_checkins
      WHERE employee_id = $1 AND status != 'cancelled' AND work_id IS NOT NULL
      ORDER BY work_id, date
    `, [empId]);

    // Сводка по назначениям на каждый объект: дата заезда, дата отъезда, активность.
    const { rows: assignRows } = await db.query(`
      SELECT work_id,
             MIN(COALESCE(date_from, created_at))::text AS date_from,
             MAX(departure_date)::text                  AS departure_date,
             BOOL_OR(COALESCE(is_active, true) AND departure_date IS NULL) AS active
      FROM employee_assignments
      WHERE employee_id = $1 AND work_id IS NOT NULL
      GROUP BY work_id
    `, [empId]);
    const assignByWork = new Map();
    for (const a of assignRows) assignByWork.set(a.work_id, a);

    // Инфо о работах
    const workIds = [...new Set(checkins.map(c => c.work_id).concat([...assignByWork.keys()]))];
    const worksInfo = {};
    if (workIds.length) {
      const { rows } = await db.query(`
        SELECT w.id, w.work_title, w.customer_name, w.pm_id, u.name AS pm_name
        FROM works w LEFT JOIN users u ON u.id = w.pm_id
        WHERE w.id = ANY($1::int[])
      `, [workIds]);
      for (const w of rows) worksInfo[w.id] = w;
    }

    // Сегментация по разрывам в датах чек-инов
    const byWork = {};
    for (const c of checkins) (byWork[c.work_id] = byWork[c.work_id] || []).push(c.date.slice(0, 10));

    const segments = [];
    for (const [widStr, dates] of Object.entries(byWork)) {
      const wid = parseInt(widStr, 10);
      let segStart = dates[0], prev = dates[0], days = 1;
      const push = (end) => segments.push({ work_id: wid, start: segStart, end, days });
      for (let i = 1; i < dates.length; i++) {
        const gap = (new Date(dates[i]) - new Date(prev)) / 86400000;
        if (gap > GAP_DAYS) { push(prev); segStart = dates[i]; days = 1; }
        else days++;
        prev = dates[i];
      }
      push(prev);
    }

    // Конец периода / «текущая работа» для последнего сегмента каждого объекта.
    const todayMs = Date.now();
    for (const [wid, a] of assignByWork) {
      const segs = segments.filter(s => s.work_id === wid);
      const dep = a.departure_date ? a.departure_date.slice(0, 10) : null;
      if (segs.length) {
        const lastSeg = segs.reduce((x, y) => (x.end >= y.end ? x : y));
        if (dep) {
          lastSeg.departure = dep;                    // есть отъезд → конец по нему
          if (dep > lastSeg.end) lastSeg.end = dep;   // но не раньше последнего чек-ина
        } else {
          // нет отъезда → правило давности: свежий чек-ин → текущая работа
          const daysSince = (todayMs - new Date(lastSeg.end)) / 86400000;
          if (daysSince <= GAP_DAYS) lastSeg.ongoing = true;
          // иначе оставляем завершённым по последнему чек-ину
        }
      } else {
        // назначение без чек-инов
        const startRaw = a.date_from || dep;
        const start = startRaw ? startRaw.slice(0, 10) : null;
        if (dep) {
          segments.push({ work_id: wid, start: start || dep, end: dep, days: 0, no_checkins: true, departure: dep });
        } else if (a.active) {
          segments.push({ work_id: wid, start, end: null, days: 0, ongoing: true, no_checkins: true });
        }
      }
    }

    const result = segments
      .map(s => ({
        ...s,
        ongoing: !!s.ongoing,
        departure: s.departure || null,
        work_title: worksInfo[s.work_id]?.work_title || null,
        customer_name: worksInfo[s.work_id]?.customer_name || null,
        pm_name: worksInfo[s.work_id]?.pm_name || null,
      }))
      .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));

    return { segments: result };
  });

  // GET /employees/:id/photo — фото/аватар сотрудника. v2 EmployeeDetailModal.jsx:204
  // запрашивает этот URL, без endpoint'а возвращался 404 на каждое открытие карточки.
  // Колонка на проде называется `active_avatar` (URL/путь). Если её нет — 404.
  fastify.get('/employees/:id/photo', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { rows } = await db.query('SELECT active_avatar FROM employees WHERE id = $1', [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Сотрудник не найден' });
    const src = rows[0].active_avatar;
    if (!src) return reply.code(404).send({ error: 'Фото не задано' });
    // Если значение — относительный путь, отдаём редирект на статику.
    if (/^https?:\/\//.test(src)) return reply.redirect(src);
    if (src.startsWith('/')) return reply.redirect(src);
    // Если data: URL — отдаём как base64.
    if (src.startsWith('data:')) {
      const m = src.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        reply.header('Content-Type', m[1]);
        return reply.send(Buffer.from(m[2], 'base64'));
      }
    }
    // Иначе пытаемся найти в uploads.
    return reply.redirect('/uploads/' + src);
  });

  // SECURITY: SQL injection fix + B3 role check
  // FIX (23.06.2026): HEAD_PM (руководитель РП) и OFFICE_MANAGER (офис-менеджер) — могут добавлять сотрудников.
  // Финансовые поля у них всё равно режутся через FIN_RESTRICTED_FIELDS ниже.
  fastify.post('/employees', { preHandler: [fastify.requireRoles(['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'HEAD_PM', 'OFFICE_MANAGER'])] }, async (request, reply) => {
    const body = { ...(request.body || {}) };
    const userRole = request.user && request.user.role;
    if (!body.fio || !String(body.fio).trim()) {
      return reply.code(400).send({ error: 'Обязательное поле: fio' });
    }
    // FIX (23.06.2026): HEAD_PM/OFFICE_MANAGER не должны проставлять финансовые поля при создании —
    // тихо отрезаем (как в PUT). Также фин-роли (BUH/директор) могут — у них доступ остаётся.
    if (!FIN_ROLES.has(userRole)) {
      for (const field of FIN_RESTRICTED_FIELDS) {
        if (field in body) delete body[field];
      }
    }
    const data = filterData({ ...body, created_at: new Date().toISOString() }, EMPLOYEE_COLS);
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO employees (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { employee: formatDates(result.rows[0]) };
  });

  // SECURITY: SQL injection fix + B3 role check
  // M2-A Phase 2 (19.06.2026): расширен под редактирование СЗ/Оф полей с карточки рабочего.
  //   - Whitelist расширен (V143 + V239 поля).
  //   - Финансовые поля (can_exceed_limit, official_salary, official_non_burnable,
  //     se_yearly_used_initial, se_monthly_used_initial) — только ADMIN/DIRECTOR_GEN/BUH.
  //   - Поле `inn` пишется в отдельную таблицу `self_employed` (не в employees!).
  //   - CHECK: is_self_employed=true И is_officially_employed=true → 400.
  //   - Возврат с JOIN self_employed.inn — фронт сразу получает свежие данные.
  //   - RBAC preHandler расширен: PM/HEAD_PM могут менять is_self_employed + inn
  //     (но НЕ финансовые суммы — для них отдельный FIN_RESTRICTED_FIELDS-гейт ниже).
  //   - FIX (23.06.2026): OFFICE_MANAGER добавлен — редактирует контактные поля «Моей дружины».
  //     Финансовые суммы и статус увольнения у него режутся через FIN_RESTRICTED_FIELDS.
  fastify.put('/employees/:id', { preHandler: [fastify.requireRoles(['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'BUH', 'PM', 'HEAD_PM', 'OFFICE_MANAGER'])] }, async (request, reply) => {
    const { id } = request.params;
    const body = { ...(request.body || {}) };
    const userRole = request.user && request.user.role;

    // ── 1) CHECK взаимоисключения СЗ/Оф (бьём раньше, чтобы было понятное сообщение).
    if (body.is_self_employed === true && body.is_officially_employed === true) {
      return reply.code(400).send({
        error: 'Сотрудник не может быть одновременно СЗ и официально устроен'
      });
    }

    // ── 2) Защита финансовых полей — тихо отрезаем у не-финансовых ролей.
    if (!FIN_ROLES.has(userRole)) {
      for (const field of FIN_RESTRICTED_FIELDS) {
        if (field in body) delete body[field];
      }
    }

    // ── 3) Валидация se_monthly_used_initial: {year, month, amount} или null.
    if ('se_monthly_used_initial' in body) {
      const v = body.se_monthly_used_initial;
      if (v !== null && v !== undefined) {
        if (typeof v !== 'object' || Array.isArray(v) ||
            typeof v.year !== 'number' || typeof v.month !== 'number' ||
            typeof v.amount !== 'number' ||
            v.month < 1 || v.month > 12) {
          return reply.code(400).send({
            error: 'se_monthly_used_initial должен быть объектом {year:int, month:1-12, amount:number} или null'
          });
        }
      }
      // pg-driver ожидает строку для jsonb — сериализуем явно.
      if (v && typeof v === 'object') body.se_monthly_used_initial = JSON.stringify(v);
    }

    // ── 3a) V240 СЗ-получатель.
    // se_payee_id должен указывать на существующего employee с is_se_payee=true.
    // null/0/'' — разрешено (отвязка).
    if ('se_payee_id' in body) {
      const v = body.se_payee_id;
      if (v === null || v === '' || v === 0 || v === '0') {
        body.se_payee_id = null;
      } else {
        const payeeId = parseInt(v, 10);
        if (!Number.isFinite(payeeId) || payeeId <= 0) {
          return reply.code(400).send({ error: 'se_payee_id должен быть числом' });
        }
        if (payeeId === parseInt(id, 10)) {
          return reply.code(400).send({ error: 'Рабочий не может быть получателем сам у себя' });
        }
        const { rows: payeeRows } = await db.query(
          'SELECT id, is_se_payee, is_active FROM employees WHERE id = $1',
          [payeeId]
        );
        if (!payeeRows[0]) {
          return reply.code(400).send({ error: 'se_payee_id: получатель не найден' });
        }
        if (!payeeRows[0].is_se_payee) {
          return reply.code(400).send({
            error: 'se_payee_id: указанный employee не помечен как СЗ-получатель (is_se_payee=false)'
          });
        }
        body.se_payee_id = payeeId;
      }
    }
    // is_se_payee=true → автоматически is_self_employed=true, is_officially_employed=false.
    // «Помощник» — это всегда СЗ, но не работает сам.
    if (body.is_se_payee === true) {
      if (body.is_self_employed === undefined) body.is_self_employed = true;
      if (body.is_officially_employed === undefined) body.is_officially_employed = false;
    }

    // ── 4) INN — отдельная таблица self_employed. Не пускаем в employees.
    const innRaw = body.inn;
    delete body.inn;
    const hasInnInBody = innRaw !== undefined;

    // ── 5) Mutex автодополнение (как в payroll-dashboard): если включают один режим,
    // явно гасим противоположный (если в body не передали false уже).
    if (body.is_officially_employed === true && body.is_self_employed === undefined) {
      body.is_self_employed = false;
    }
    if (body.is_self_employed === true && body.is_officially_employed === undefined) {
      body.is_officially_employed = false;
    }

    // ── 6) Whitelist + UPDATE employees.
    const data = filterData(body, EMPLOYEE_COLS);
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      updates.push(`${key} = $${idx}`); values.push(value); idx++;
    }

    // Если есть только inn, без других полей — допустимо: просто пишем self_employed.
    if (!updates.length && !hasInnInBody) {
      return reply.code(400).send({ error: 'Нет данных' });
    }

    let updatedEmp = null;
    if (updates.length) {
      updates.push('updated_at = NOW()');
      values.push(id);
      const sql = `UPDATE employees SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
      try {
        const result = await db.query(sql, values);
        if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
        updatedEmp = result.rows[0];
      } catch (e) {
        // chk_employment_mode (defence-in-depth — мы уже проверили выше, но если
        // в БД уже стоит другой режим и в body передан только один из флагов).
        if (e.code === '23514') {
          return reply.code(400).send({
            error: 'Сотрудник не может быть одновременно СЗ и официально устроен'
          });
        }
        throw e;
      }
    } else {
      // updates пусто, но есть inn — подгрузим текущего сотрудника для INN-логики ниже.
      const { rows } = await db.query('SELECT * FROM employees WHERE id = $1', [id]);
      if (!rows[0]) return reply.code(404).send({ error: 'Не найден' });
      updatedEmp = rows[0];
    }

    // ── 7) Логика INN: если пришёл inn И is_self_employed=true (по текущему состоянию).
    if (hasInnInBody && updatedEmp.is_self_employed) {
      const innStr = innRaw == null ? null : String(innRaw).trim();
      // Пустая строка трактуется как очистка ИНН (но запись self_employed оставляем).
      const innValue = innStr || null;

      const { rows: existingSe } = await db.query(
        'SELECT id, inn, is_active FROM self_employed WHERE employee_id = $1 LIMIT 1',
        [id]
      );
      if (!existingSe[0]) {
        // INSERT с минимальным набором.
        await db.query(
          `INSERT INTO self_employed (employee_id, full_name, inn, is_active, updated_at)
           VALUES ($1, $2, $3, true, NOW())`,
          [id, updatedEmp.fio || updatedEmp.full_name || '', innValue]
        );
      } else {
        // UPDATE inn + поднимаем is_active, если был false.
        await db.query(
          `UPDATE self_employed
              SET inn = $1,
                  is_active = COALESCE(NULLIF(is_active, false), true),
                  updated_at = NOW()
            WHERE employee_id = $2`,
          [innValue, id]
        );
      }
    }

    // ── 8) Возврат: employees.* + self_employed.inn (LEFT JOIN — может быть NULL).
    const { rows: finalRows } = await db.query(
      `SELECT e.*, se.inn AS se_inn
         FROM employees e
         LEFT JOIN self_employed se ON se.employee_id = e.id
        WHERE e.id = $1
        LIMIT 1`,
      [id]
    );
    return { employee: formatDates(finalRows[0]) };
  });

  // ────────────────────────────────────────────────────────────────
  // V240 (19.06.2026): СЗ-получатели (payees).
  // GET /payees?search=Q&limit=20 — автокомплит для анкеты рабочего.
  //   • Только is_se_payee=true AND is_active=true.
  //   • linked_to_fio: если этот payee уже привязан к рабочему, кто это.
  //   • RBAC: все авторизованные (фронт может показывать список в анкете).
  // POST /payees — создание нового СЗ-получателя.
  //   • RBAC: только FIN_ROLES (ADMIN/DIRECTOR_*/BUH).
  //   • Создаёт employees с is_self_employed=true, is_se_payee=true.
  //   • inn пишется в отдельную таблицу self_employed.
  // ────────────────────────────────────────────────────────────────
  fastify.get('/payees', { preHandler: [fastify.authenticate] }, async (request) => {
    const { search, limit } = request.query || {};
    const lim = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const params = [];
    let where = `e.is_se_payee = true AND COALESCE(e.is_active, true) = true`;
    if (search && String(search).trim()) {
      const q = `%${String(search).trim().toLowerCase()}%`;
      params.push(q);
      where += ` AND (LOWER(COALESCE(e.fio, e.full_name)) LIKE $${params.length} OR LOWER(COALESCE(e.phone, '')) LIKE $${params.length})`;
    }
    params.push(lim);
    const sql = `
      SELECT
        e.id,
        COALESCE(e.fio, e.full_name) AS fio,
        e.phone,
        se.inn AS inn,
        (
          SELECT COALESCE(w.fio, w.full_name)
            FROM employees w
           WHERE w.se_payee_id = e.id
             AND COALESCE(w.is_active, true) = true
           ORDER BY w.id
           LIMIT 1
        ) AS linked_to_fio,
        (
          SELECT COUNT(*) FROM employees w2
           WHERE w2.se_payee_id = e.id AND COALESCE(w2.is_active, true) = true
        )::int AS linked_count
        FROM employees e
        LEFT JOIN self_employed se ON se.employee_id = e.id AND COALESCE(se.is_active, true) = true
       WHERE ${where}
       ORDER BY COALESCE(e.fio, e.full_name) ASC
       LIMIT $${params.length}
    `;
    const { rows } = await db.query(sql, params);
    return { payees: rows };
  });

  fastify.post('/payees', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'])]
  }, async (request, reply) => {
    const body = request.body || {};
    const fio = String(body.fio || '').trim();
    const phone = body.phone == null ? null : String(body.phone).trim() || null;
    const innRaw = body.inn == null ? null : String(body.inn).trim() || null;
    if (!fio) return reply.code(400).send({ error: 'Обязательное поле: fio' });

    // Создаём employee с флагами payee. is_self_employed=true (СЗ-режим),
    // is_officially_employed=false (CHECK), is_se_payee=true.
    let createdEmp;
    try {
      const { rows } = await db.query(
        `INSERT INTO employees (fio, phone, is_self_employed, is_officially_employed,
                                is_se_payee, is_active, created_at, updated_at)
         VALUES ($1, $2, true, false, true, true, NOW(), NOW())
         RETURNING *`,
        [fio, phone]
      );
      createdEmp = rows[0];
    } catch (e) {
      if (e.code === '23514') {
        return reply.code(400).send({ error: 'CHECK constraint: не удалось создать получателя' });
      }
      throw e;
    }

    // INN — в self_employed (snapshot для отчётов / агрегатов лимита).
    if (innRaw) {
      try {
        await db.query(
          `INSERT INTO self_employed (employee_id, full_name, inn, is_active, updated_at)
           VALUES ($1, $2, $3, true, NOW())`,
          [createdEmp.id, fio, innRaw]
        );
      } catch (e) {
        fastify.log.warn('[payees POST] не удалось записать INN: ' + e.message);
      }
    }

    const { rows: outRows } = await db.query(
      `SELECT e.*, se.inn AS se_inn
         FROM employees e
         LEFT JOIN self_employed se ON se.employee_id = e.id
        WHERE e.id = $1`,
      [createdEmp.id]
    );
    return reply.code(201).send({ payee: formatDates(outRows[0]) });
  });

  // Employee reviews — SECURITY: SQL injection fix — filter keys
  fastify.post('/employees/:id/review', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const data = filterData({
        employee_id: id,
        ...request.body,
        pm_id: request.user.id,
        created_at: new Date().toISOString()
      }, REVIEW_COLS);
      const keys = Object.keys(data);
      const values = Object.values(data);
      const sql = `INSERT INTO employee_reviews (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);

      // Update average rating
      try {
        const avgResult = await db.query('SELECT AVG(COALESCE(score, rating)) as avg FROM employee_reviews WHERE employee_id = $1', [id]);
        await db.query('UPDATE employees SET rating_avg = $1, updated_at = NOW() WHERE id = $2', [avgResult.rows[0].avg, id]);
      } catch (avgErr) {
        fastify.log.warn('Rating avg update failed:', avgErr.message);
      }

      return { review: result.rows[0] };
    } catch (err) {
      return reply.code(500).send({ error: 'Ошибка создания отзыва', detail: err.message });
    }
  });

  // Schedule
  fastify.get('/schedule', { preHandler: [fastify.authenticate] }, async (request) => {
    const { employee_id, date_from, date_to } = request.query;
    let sql = 'SELECT p.*, e.fio FROM employee_plan p LEFT JOIN employees e ON p.employee_id = e.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (employee_id) { sql += ` AND p.employee_id = $${idx}`; params.push(employee_id); idx++; }
    if (date_from) { sql += ` AND p.date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND p.date <= $${idx}`; params.push(date_to); idx++; }
    sql += ' ORDER BY p.date ASC';
    const result = await db.query(sql, params);
    return { schedule: result.rows };
  });

  // SECURITY: SQL injection fix — filter keys
  fastify.post('/schedule', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const body = request.body || {};
      if (!body.employee_id) {
        return reply.code(400).send({ error: 'Обязательное поле: employee_id' });
      }
      const data = filterData({ ...body, created_at: new Date().toISOString() }, SCHEDULE_COLS);
      const keys = Object.keys(data);
      if (!keys.length) return reply.code(400).send({ error: 'Нет данных' });
      const values = Object.values(data);
      const sql = `INSERT INTO employee_plan (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);
      return { plan: result.rows[0] };
    } catch (err) {
      if (err.code === '23503') return reply.code(400).send({ error: 'Сотрудник или объект не найден' });
      if (err.code === '23505') return reply.code(409).send({ error: 'Запись уже существует' });
      if (err.code === '22003') return reply.code(400).send({ error: 'Числовое значение вне допустимого диапазона' });
      throw err;
    }
  });

  // SECURITY: SQL injection fix — filter keys
  fastify.put('/schedule/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const data = filterData(request.body, SCHEDULE_COLS);
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      updates.push(`${key} = $${idx}`); values.push(value); idx++;
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    values.push(id);
    const sql = `UPDATE employee_plan SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { plan: result.rows[0] };
  });
  // Bulk create schedule entries (for booking)
  fastify.post('/schedule/bulk', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { entries } = request.body || {};
      if (!Array.isArray(entries) || !entries.length) {
        return reply.code(400).send({ error: 'entries array required' });
      }
      const results = [];
      for (const entry of entries) {
        const data = filterData({ ...entry, created_at: new Date().toISOString() }, SCHEDULE_COLS);
        if (!data.employee_id || !data.date) continue;
        const keys = Object.keys(data);
        const values = Object.values(data);
        try {
          const sql = `INSERT INTO employee_plan (${keys.join(', ')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) ON CONFLICT DO NOTHING RETURNING *`;
          const result = await db.query(sql, values);
          if (result.rows[0]) results.push(result.rows[0]);
        } catch (e) { /* skip duplicates */ }
      }
      return { success: true, created: results.length };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SE-LIMITS IMPORT (B5 / 19.06.2026) — выгрузка Озон-Банка по СЗ
  // ─────────────────────────────────────────────────────────────────────────
  // Раз в неделю бухгалтер выгружает Excel с месячными остатками НПД-лимита.
  // 3 эндпоинта:
  //   POST /api/staff/se-limits/preview  — парсит Excel, матчит к employees, без записи.
  //   POST /api/staff/se-limits/apply    — применяет решения (update/create_se/create_payee/skip).
  //   GET  /api/staff/se-limits/last-import — когда и кто синхронизировал последний раз.
  // RBAC: FIN_ROLES (ADMIN/DIRECTOR_*/BUH).
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /se-limits/preview — multipart с одним файлом Excel.
  // Возвращает разбор + матчинг к employees БЕЗ записи в БД.
  fastify.post('/se-limits/preview', {
    preHandler: [fastify.requireRoles(FIN_ROLES_ARRAY)]
  }, async (req, reply) => {
    const fileData = await req.file();
    if (!fileData) return reply.code(400).send({ error: 'Файл не загружен' });

    const fileName = fileData.filename || 'upload.xlsx';
    let buf;
    try { buf = await fileData.toBuffer(); }
    catch (_) { return reply.code(400).send({ error: 'Не удалось прочитать файл' }); }

    // Парсим Excel
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); }
    catch (_) { return reply.code(400).send({ error: 'Не удалось распарсить Excel — формат не XLSX или файл повреждён' }); }

    const ws = wb.worksheets[0];
    if (!ws) return reply.code(400).send({ error: 'В файле нет листов' });

    // ── 1) Заголовки. Колонки определяются ILIKE-поиском.
    const headerRow = ws.getRow(1);
    const colMap = {}; // 1-based index → 'phone' | 'fio' | 'remaining'
    (headerRow.values || []).forEach((v, idx) => {
      if (idx === 0) return; // exceljs values[0] = undefined
      const text = (v && v.text) ? v.text : v;
      const f = classifySeHeader(text);
      if (f && !Object.values(colMap).includes(f)) colMap[idx] = f;
    });

    const fields = Object.values(colMap);
    if (!fields.includes('phone') && !fields.includes('fio')) {
      return reply.code(400).send({
        error: 'Не найдены колонки «телефон» или «ФИО» в заголовке. Проверьте, что 1-я строка — шапка.'
      });
    }
    if (!fields.includes('remaining')) {
      return reply.code(400).send({
        error: 'Не найдена колонка «лимит»/«остаток» в заголовке.'
      });
    }

    // ── 2) Собираем сырые строки.
    const rawRows = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return; // шапка
      let phoneRaw = null, fioRaw = null, remainingRaw = null;
      for (const [ci, field] of Object.entries(colMap)) {
        const cellVal = row.getCell(parseInt(ci)).value;
        const v = (cellVal && cellVal.text) ? cellVal.text : cellVal;
        if (v == null || v === '') continue;
        if (field === 'phone') phoneRaw = v;
        else if (field === 'fio') fioRaw = v;
        else if (field === 'remaining') remainingRaw = v;
      }
      // Полностью пустая строка → пропуск.
      if (phoneRaw == null && fioRaw == null && remainingRaw == null) return;
      rawRows.push({ row_idx: idx, phone_raw: phoneRaw, fio_raw: fioRaw, remaining_raw: remainingRaw });
    });

    if (!rawRows.length) {
      return reply.code(400).send({ error: 'В файле нет данных (после шапки пусто)' });
    }

    // ── 3) Тянем всех employees один раз (на проде ~98 СЗ, всего ~1000 — норм).
    // Сразу нормализуем телефон/ФИО на сервере для матчинга.
    const { rows: allEmps } = await db.query(`
      SELECT id, fio, phone, is_self_employed, is_se_payee, se_payee_id,
             se_monthly_used_initial, can_exceed_limit
      FROM employees
      WHERE COALESCE(is_active, true) = true
    `);

    const byPhone = new Map(); // norm_phone → emp
    const byFio = new Map();   // norm_fio → emp[]
    for (const e of allEmps) {
      const np = normalizeSePhone(e.phone);
      if (np) byPhone.set(np, e);
      const nf = normalizeSeFio(e.fio);
      if (nf) {
        if (!byFio.has(nf)) byFio.set(nf, []);
        byFio.get(nf).push(e);
      }
    }

    // monthly_limit из settings (с дефолтом 350000).
    const { rows: limRows } = await db.query(
      `SELECT value_json FROM settings WHERE key = 'self_employed_monthly_limit'`
    );
    let monthlyLimit = 350000;
    if (limRows[0]) {
      const v = parseFloat(String(limRows[0].value_json).replace(/[^\d.\-]/g, ''));
      if (Number.isFinite(v) && v > 0) monthlyLimit = v;
    }

    // ── 4) Матчим строки.
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;

    const rows = [];
    let matchedCount = 0;
    for (const r of rawRows) {
      const np = normalizeSePhone(r.phone_raw);
      const nf = normalizeSeFio(r.fio_raw);
      const remaining = parseSeRemaining(r.remaining_raw);

      let emp = null;
      // Приоритет: точный матч по телефону → точный матч по ФИО (если уникален).
      if (np && byPhone.has(np)) emp = byPhone.get(np);
      else if (nf && byFio.has(nf) && byFio.get(nf).length === 1) emp = byFio.get(nf)[0];

      // Кандидаты-однофамильцы (если не нашли по точному матчу).
      let candidates = [];
      if (!emp && nf) {
        // последнее слово часто фамилия; берём всех с тем же первым словом (фамилия).
        const surname = nf.split(' ')[0];
        if (surname && surname.length >= 3) {
          for (const e of allEmps) {
            const efio = normalizeSeFio(e.fio);
            if (efio && efio.startsWith(surname)) {
              candidates.push({ id: e.id, fio: e.fio, phone: e.phone });
              if (candidates.length >= 5) break;
            }
          }
        }
      }

      if (emp) {
        matchedCount++;
        // Текущее «использовано» в БД (если запись на тот же месяц).
        let currentUsed = 0;
        const sm = emp.se_monthly_used_initial;
        if (sm && typeof sm === 'object' &&
            sm.year === curYear && sm.month === curMonth &&
            typeof sm.amount === 'number') {
          currentUsed = sm.amount;
        }
        const currentRemaining = emp.can_exceed_limit ? null : Math.max(0, monthlyLimit - currentUsed);

        // Новое значение (что будет после apply).
        let newUsed = null;
        let newCanExceed = !!emp.can_exceed_limit;
        if (remaining != null) {
          if (remaining > monthlyLimit) {
            newCanExceed = true;
            newUsed = null; // se_monthly_used_initial = null
          } else {
            newCanExceed = false;
            newUsed = Math.max(0, monthlyLimit - remaining);
          }
        }

        rows.push({
          row_idx: r.row_idx,
          phone_raw: r.phone_raw == null ? null : String(r.phone_raw),
          fio_raw: r.fio_raw == null ? null : String(r.fio_raw),
          remaining_in_file: remaining,
          matched: true,
          employee_id: emp.id,
          employee_fio: emp.fio,
          employee_is_se: !!emp.is_self_employed,
          is_se_payee: !!emp.is_se_payee,
          current_se_monthly_used: currentUsed,
          current_monthly_remaining: currentRemaining,
          new_monthly_used: newUsed,
          new_can_exceed_limit: newCanExceed
        });
      } else {
        rows.push({
          row_idx: r.row_idx,
          phone_raw: r.phone_raw == null ? null : String(r.phone_raw),
          fio_raw: r.fio_raw == null ? null : String(r.fio_raw),
          remaining_in_file: remaining,
          matched: false,
          suggested_action: nf ? 'create_new' : 'skip',
          candidate_namesake: candidates
        });
      }
    }

    return {
      file_name: fileName,
      total_rows: rows.length,
      matched: matchedCount,
      not_matched: rows.length - matchedCount,
      monthly_limit: monthlyLimit,
      year: curYear,
      month: curMonth,
      rows
    };
  });

  // POST /se-limits/apply — применить решения (update/create_se/create_payee/skip).
  // Body: { year, month, rows: [{action, employee_id?, fio?, phone?, remaining?, linked_to_employee_id?}] }
  fastify.post('/se-limits/apply', {
    preHandler: [fastify.requireRoles(FIN_ROLES_ARRAY)]
  }, async (req, reply) => {
    const body = req.body || {};
    const year = parseInt(body.year, 10);
    const month = parseInt(body.month, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return reply.code(400).send({ error: 'year/month обязательны, month 1-12' });
    }
    if (!Array.isArray(body.rows) || !body.rows.length) {
      return reply.code(400).send({ error: 'rows обязателен (непустой массив)' });
    }

    // monthly_limit из settings (дефолт 350000).
    const { rows: limRows } = await db.query(
      `SELECT value_json FROM settings WHERE key = 'self_employed_monthly_limit'`
    );
    let monthlyLimit = 350000;
    if (limRows[0]) {
      const v = parseFloat(String(limRows[0].value_json).replace(/[^\d.\-]/g, ''));
      if (Number.isFinite(v) && v > 0) monthlyLimit = v;
    }

    const client = await db.pool.connect();
    let updated = 0, created = 0;
    const errors = [];

    // Q-1 (19.06.2026): userId нужен и для UPSERT в se_monthly_history,
    // и для метаданных «последний импорт by». Поднят выше внутрь транзакции.
    const userId = req.user && req.user.id;

    // Q-1: писать в se_monthly_history snapshot месяца.
    // monthly_used = monthly_limit - remaining (если remaining > monthly_limit →
    // фактически потрачено более лимита; покрывает can_exceed_limit. Хранить
    // ≤ monthly_limit нет смысла, т.к. yearly_used = SUM(monthly_used) и
    // оверфлоу >monthly_limit важен для накопительного годового). Берём
    // ИМЕННО факт = max(0, monthly_limit - remaining); при remaining=0 или
    // remaining > monthly_limit получаем monthly_limit (полный месяц).
    const upsertMonthlyHistory = async (employeeId, remainingVal) => {
      const monthlyUsedValue = Math.max(0, monthlyLimit - Number(remainingVal || 0));
      try {
        await client.query(`
          INSERT INTO se_monthly_history (employee_id, year, month, monthly_used, source, imported_at, imported_by)
          VALUES ($1, $2, $3, $4, 'import', NOW(), $5)
          ON CONFLICT (employee_id, year, month) DO UPDATE
          SET monthly_used = EXCLUDED.monthly_used,
              imported_at = NOW(),
              imported_by = EXCLUDED.imported_by
        `, [employeeId, year, month, monthlyUsedValue, userId]);
      } catch (e) {
        // Таблица se_monthly_history может отсутствовать (graceful) —
        // не валим всю транзакцию из-за неё.
        if (e && e.code !== '42P01') throw e;
      }
    };

    try {
      await client.query('BEGIN');

      for (let i = 0; i < body.rows.length; i++) {
        const r = body.rows[i] || {};
        const action = r.action;

        try {
          if (action === 'skip') {
            continue;
          }

          if (action === 'update') {
            const empId = parseInt(r.employee_id, 10);
            if (!Number.isFinite(empId) || empId <= 0) {
              errors.push({ idx: i, error: 'update: employee_id обязателен' });
              continue;
            }
            const remaining = r.remaining == null ? null : Number(r.remaining);
            if (remaining == null || !Number.isFinite(remaining) || remaining < 0) {
              errors.push({ idx: i, error: 'update: remaining обязателен и >= 0' });
              continue;
            }
            // Проверим, что employee существует.
            const { rows: empRows } = await client.query(
              'SELECT id FROM employees WHERE id = $1',
              [empId]
            );
            if (!empRows[0]) {
              errors.push({ idx: i, error: `update: employee_id=${empId} не найден` });
              continue;
            }
            // Логика: remaining > monthly_limit → can_exceed_limit=true, se_monthly_used_initial=null.
            //        иначе                       → can_exceed_limit=false, se_monthly_used_initial={year,month,amount}.
            let canExceed, seMonthlyUsed;
            if (remaining > monthlyLimit) {
              canExceed = true;
              seMonthlyUsed = null;
            } else {
              canExceed = false;
              seMonthlyUsed = JSON.stringify({
                year, month,
                amount: Math.max(0, monthlyLimit - remaining)
              });
            }
            await client.query(`
              UPDATE employees
              SET can_exceed_limit = $1,
                  se_monthly_used_initial = $2::jsonb,
                  updated_at = NOW()
              WHERE id = $3
            `, [canExceed, seMonthlyUsed, empId]);
            // Q-1: snapshot месяца в se_monthly_history (для накопительного yearly).
            await upsertMonthlyHistory(empId, remaining);
            updated++;
            continue;
          }

          if (action === 'create_se' || action === 'create_payee') {
            const fio = String(r.fio || '').trim();
            if (!fio) {
              errors.push({ idx: i, error: `${action}: fio обязателен` });
              continue;
            }
            const phone = r.phone == null ? null : String(r.phone).trim() || null;
            const remaining = r.remaining == null ? null : Number(r.remaining);
            const remValid = remaining != null && Number.isFinite(remaining) && remaining >= 0;

            // Базовая структура нового employee.
            // create_se   → is_self_employed=true,  is_se_payee=false.
            // create_payee→ is_self_employed=true,  is_se_payee=true (помощник-родственник).
            const isSePayee = action === 'create_payee';
            let canExceed = false;
            let seMonthlyUsed = null;
            if (remValid) {
              if (remaining > monthlyLimit) {
                canExceed = true;
                seMonthlyUsed = null;
              } else {
                canExceed = false;
                seMonthlyUsed = JSON.stringify({
                  year, month,
                  amount: Math.max(0, monthlyLimit - remaining)
                });
              }
            }

            const { rows: insRows } = await client.query(`
              INSERT INTO employees (
                fio, phone,
                is_self_employed, is_se_payee, is_officially_employed,
                can_exceed_limit, se_monthly_used_initial,
                is_active, created_at, updated_at
              ) VALUES (
                $1, $2,
                true, $3, false,
                $4, $5::jsonb,
                true, NOW(), NOW()
              ) RETURNING id
            `, [fio, phone, isSePayee, canExceed, seMonthlyUsed]);

            const newId = insRows[0].id;
            created++;

            // Q-1: snapshot месяца для нового СЗ (если remaining валидно).
            if (remValid) {
              await upsertMonthlyHistory(newId, remaining);
            }

            // create_payee: если указан linked_to_employee_id — обновляем рабочего.
            // Рабочий теряет статус СЗ (выплаты идут на родственника).
            if (action === 'create_payee' && r.linked_to_employee_id != null) {
              const linkedId = parseInt(r.linked_to_employee_id, 10);
              if (Number.isFinite(linkedId) && linkedId > 0 && linkedId !== newId) {
                const { rows: linkRows } = await client.query(
                  'SELECT id FROM employees WHERE id = $1',
                  [linkedId]
                );
                if (!linkRows[0]) {
                  errors.push({
                    idx: i,
                    error: `create_payee: linked_to_employee_id=${linkedId} не найден (получатель создан, привязка не сделана)`
                  });
                } else {
                  await client.query(`
                    UPDATE employees
                    SET se_payee_id = $1, is_self_employed = false, updated_at = NOW()
                    WHERE id = $2
                  `, [newId, linkedId]);
                }
              }
            }
            continue;
          }

          errors.push({ idx: i, error: `Неизвестный action='${action}'` });

        } catch (rowErr) {
          // Ошибка одной строки не валит весь импорт — записываем в errors и продолжаем.
          errors.push({
            idx: i,
            error: rowErr.message || 'Ошибка при обработке строки',
            code: rowErr.code
          });
        }
      }

      // ── Обновляем метаданные «последняя синхронизация».
      // (userId уже определён выше — используется и для se_monthly_history.)
      await client.query(`
        INSERT INTO settings (key, value_json, updated_at)
        VALUES ('se_limits_last_import_at', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()
      `, [JSON.stringify(new Date().toISOString())]);
      if (userId) {
        await client.query(`
          INSERT INTO settings (key, value_json, updated_at)
          VALUES ('se_limits_last_import_by', $1, NOW())
          ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()
        `, [JSON.stringify(userId)]);
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      return reply.code(500).send({ error: 'Ошибка транзакции: ' + (txErr.message || '') });
    }
    client.release();

    // Достаём свежий timestamp.
    const { rows: tsRows } = await db.query(
      `SELECT value_json FROM settings WHERE key = 'se_limits_last_import_at'`
    );
    let lastImportAt = null;
    if (tsRows[0]) {
      try { lastImportAt = JSON.parse(tsRows[0].value_json); }
      catch (_) { lastImportAt = tsRows[0].value_json; }
    }

    return {
      ok: true,
      updated,
      created,
      errors,
      last_import_at: lastImportAt
    };
  });

  // GET /se-limits/last-import — когда и кто синхронизировал последний раз.
  // Для отображения «последняя синхронизация» на экране бухгалтера.
  fastify.get('/se-limits/last-import', {
    preHandler: [fastify.requireRoles(FIN_ROLES_ARRAY)]
  }, async () => {
    const { rows } = await db.query(`
      SELECT key, value_json FROM settings
      WHERE key IN ('se_limits_last_import_at', 'se_limits_last_import_by')
    `);
    let lastAt = null, lastBy = null;
    for (const r of rows) {
      try {
        const v = JSON.parse(r.value_json);
        if (r.key === 'se_limits_last_import_at') lastAt = v;
        else if (r.key === 'se_limits_last_import_by') lastBy = v;
      } catch (_) {
        if (r.key === 'se_limits_last_import_at') lastAt = r.value_json;
        else if (r.key === 'se_limits_last_import_by') lastBy = r.value_json;
      }
    }

    let lastByFio = null;
    if (lastBy != null) {
      const uid = parseInt(lastBy, 10);
      if (Number.isFinite(uid) && uid > 0) {
        const { rows: uRows } = await db.query(
          'SELECT name FROM users WHERE id = $1',
          [uid]
        );
        if (uRows[0]) lastByFio = uRows[0].name;
      }
    }

    return {
      last_import_at: lastAt,
      last_import_by_fio: lastByFio
    };
  });
}

module.exports = routes;
