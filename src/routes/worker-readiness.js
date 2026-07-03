/**
 * Worker Readiness API
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/staff/readiness
 *
 * GET  /                    — список рабочих с группировкой по статусу
 * GET  /stats               — статистика по группам
 * GET  /reasons             — справочник причин неготовности
 * GET  /log/:employee_id    — история изменений статуса
 * PUT  /:employee_id/status — HR обновляет статус (ready/not_ready + дата/причина)
 *
 * Доступ: ADMIN, HR, HR_MANAGER, DIRECTOR_GEN, DIRECTOR_COMM
 */

// READINESS_ROLES — смена статуса готовности (запись). PM сюда НЕ входит (read-only).
// 23.06.2026 BUG-FIX (D-09): добавлены HEAD_PM и OFFICE_MANAGER.
// v2 Personnel/api.js:74 EDIT_ROLES уже включает их и показывает кнопки «✓ Готов» / «Не готов»,
// а backend отвечал 403 при клике → у HEAD_PM и Офис-менеджера переход неактивен в реальности.
// Сейчас оба могут менять статус готовности сотрудника, паритет с UI.
const READINESS_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM', 'OFFICE_MANAGER'];
// VIEW_ROLES — просмотр списка дружины. PM/HEAD_PM видят всех (свою бригаду — в полевом модуле).
// OFFICE_MANAGER ведёт картотеку рабочих (телефоны, документы), нужен read-доступ к «Моей дружине».
const VIEW_ROLES      = ['ADMIN', 'HR', 'HR_MANAGER', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'TO', 'HEAD_TO', 'OFFICE_MANAGER'];

const READINESS_REASONS = [
  { key: 'illness',    label: 'Болезнь' },
  { key: 'vacation',   label: 'Отпуск' },
  { key: 'family',     label: 'Семейные обстоятельства' },
  { key: 'training',   label: 'Обучение' },
  { key: 'personal',   label: 'Личные дела' },
  { key: 'legal',      label: 'Юридические вопросы' },
  { key: 'injury',     label: 'Травма на производстве' },
  { key: 'no_contact', label: 'Не выходит на связь' },
  { key: 'refused',    label: 'Отказ без причины' },
  { key: 'other',      label: 'Другое' },
];

async function routes(fastify, options) {
  const db = fastify.db;

  // ─── GET / — список рабочих с группировкой по статусу ─────────────────────
  fastify.get('/', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const today = new Date().toISOString().slice(0, 10);

    const { rows: employees } = await db.query(`
      SELECT
        e.id, e.fio, e.phone, e.role_tag, e.position,
        e.rating_avg, e.is_active,
        e.is_self_employed, e.is_officially_employed,
        e.readiness_status, e.readiness_date, e.readiness_reason,
        e.readiness_comment, e.readiness_updated_at,
        e.last_pm_id, e.last_work_id,
        e.city,
        pm.name AS last_pm_name,
        lw.work_title AS last_work_title
      FROM employees e
      LEFT JOIN users pm ON pm.id = e.last_pm_id
      LEFT JOIN works lw ON lw.id = e.last_work_id
      WHERE e.is_active = true
      ORDER BY e.fio
    `);

    if (!employees.length) {
      return { employees: [], groups: { on_site: 0, approved: 0, ready: 0, not_ready: 0, archive: 0 } };
    }

    const empIds = employees.map(e => e.id);

    // Активные назначения на объектах
    const { rows: assignments } = await db.query(`
      SELECT
        ea.employee_id, ea.work_id, ea.field_role,
        ea.departure_date, ea.is_active,
        w.work_title,
        wpm.name AS pm_name
      FROM employee_assignments ea
      LEFT JOIN works w   ON w.id  = ea.work_id
      LEFT JOIN users wpm ON wpm.id = w.pm_id
      WHERE ea.employee_id = ANY($1::int[])
        AND COALESCE(ea.is_active, true) = true
        AND ea.departure_date IS NULL
    `, [empIds]);

    const onSiteByEmp = {};
    for (const a of assignments) {
      if (!onSiteByEmp[a.employee_id]) onSiteByEmp[a.employee_id] = a;
    }

    // Назначения в активных заявках (approved, ещё не added_to_crew)
    const { rows: srAssignments } = await db.query(`
      SELECT
        sra.employee_id, sra.request_id,
        sr.work_id, sr.status_v2,
        w.work_title,
        wpm.name AS pm_name
      FROM staff_request_assignments sra
      JOIN staff_requests sr ON sr.id = sra.request_id
      LEFT JOIN works w   ON w.id  = sr.work_id
      LEFT JOIN users wpm ON wpm.id = w.pm_id
      WHERE sra.employee_id = ANY($1::int[])
        AND sra.status = 'approved'
        AND sr.status_v2 IN ('approved')
    `, [empIds]);

    const approvedByEmp = {};
    for (const a of srAssignments) {
      if (!approvedByEmp[a.employee_id]) approvedByEmp[a.employee_id] = a;
    }

    // Последняя завершённая работа — для тех, кто СЕЙЧАС не на объекте и не согласован.
    // Показываем в колонке «Объект/РП» как «история», и в «Начало работ» — дату начала
    // последнего assignment'а (это и есть «срок последней работы» по сути).
    // Канонический столбец «когда сотрудника назначили на работу» в БД — `date_from`
    // (триггером заполняется из works.start_plan/created_at; см. field-pm.js:163,224).
    // Колонки `assigned_at` в схеме нет — обращение к ней даёт 42703 column does not exist → 500.
    const { rows: lastAssignments } = await db.query(`
      SELECT DISTINCT ON (ea.employee_id)
        ea.employee_id, ea.work_id,
        COALESCE(ea.date_from, ea.created_at) AS start_date,
        ea.departure_date AS end_date,
        w.work_title,
        wpm.name AS pm_name
      FROM employee_assignments ea
      LEFT JOIN works w   ON w.id  = ea.work_id
      LEFT JOIN users wpm ON wpm.id = w.pm_id
      WHERE ea.employee_id = ANY($1::int[])
      ORDER BY ea.employee_id, COALESCE(ea.departure_date, ea.date_from, ea.created_at) DESC
    `, [empIds]);

    const lastByEmp = {};
    for (const a of lastAssignments) {
      if (!lastByEmp[a.employee_id]) lastByEmp[a.employee_id] = a;
    }

    // Документы — просрочка / скоро истекут.
    // Просроченный допуск НЕ считается проблемой, если у рабочего есть другой
    // действующий допуск того же типа (свежая замена скрывает старый дубль).
    const { rows: permits } = await db.query(`
      SELECT
        ep.employee_id,
        COUNT(*) FILTER (
          WHERE ep.expiry_date IS NOT NULL AND ep.expiry_date < CURRENT_DATE
          AND NOT EXISTS (
            SELECT 1 FROM employee_permits fresh
            WHERE fresh.employee_id = ep.employee_id
              AND COALESCE(fresh.is_active, true) = true
              AND fresh.id <> ep.id
              AND COALESCE(fresh.type_id::text, lower(fresh.permit_type)) = COALESCE(ep.type_id::text, lower(ep.permit_type))
              AND (fresh.expiry_date IS NULL OR fresh.expiry_date >= CURRENT_DATE)
          )
        ) AS expired,
        COUNT(*) FILTER (
          WHERE ep.expiry_date IS NOT NULL AND ep.expiry_date >= CURRENT_DATE AND ep.expiry_date < CURRENT_DATE + INTERVAL '30 days'
        ) AS expiring
      FROM employee_permits ep
      WHERE ep.employee_id = ANY($1::int[])
        AND COALESCE(ep.is_active, true) = true
      GROUP BY ep.employee_id
    `, [empIds]);

    const permitsByEmp = {};
    for (const p of permits) {
      permitsByEmp[p.employee_id] = { expired: Number(p.expired || 0), expiring: Number(p.expiring || 0) };
    }

    // 25.06.2026: ключевые пропуска (БОСИЕТ/РУКАВ/ФСБ/МЛСП) для колонок Дружины.
    // На каждого рабочего — последний действующий допуск каждого типа +
    // его expiry_date. Коды permit_types.code:
    //   BOSIET   — БОСИЕТ        (id 153, offshore)
    //   SLEEVE   — РУКАВ         (id 154, offshore)
    //   FSB      — Пропуск ФСБ   (id 168)
    //   MLSP_PASS — Пропуск МЛСП (заводится миграцией V255 если нет — пока пусто)
    const { rows: keyPermits } = await db.query(`
      SELECT DISTINCT ON (ep.employee_id, pt.code)
        ep.employee_id, pt.code, ep.permit_number AS number, ep.expiry_date
      FROM employee_permits ep
      JOIN permit_types pt ON pt.id = ep.type_id
      WHERE ep.employee_id = ANY($1::int[])
        AND COALESCE(ep.is_active, true) = true
        AND pt.code IN ('BOSIET','SLEEVE','FSB','MLSP_PASS')
      ORDER BY ep.employee_id, pt.code,
               (ep.expiry_date IS NULL) ASC,
               ep.expiry_date DESC NULLS LAST,
               ep.id DESC
    `, [empIds]);

    const keyPermitsByEmp = {};
    for (const kp of keyPermits) {
      if (!keyPermitsByEmp[kp.employee_id]) keyPermitsByEmp[kp.employee_id] = {};
      keyPermitsByEmp[kp.employee_id][kp.code] = {
        number: kp.number || null,
        expiry_date: kp.expiry_date || null
      };
    }

    // Годовой лимит СЗ
    const { rows: seSum } = await db.query(`
      SELECT employee_id, COALESCE(SUM(transfer_amount), 0) AS transferred_year
      FROM se_transfers
      WHERE employee_id = ANY($1::int[])
        AND year = EXTRACT(YEAR FROM CURRENT_DATE)
        AND status != 'cancelled'
      GROUP BY employee_id
    `, [empIds]);
    const seByEmp = {};
    for (const r of seSum) seByEmp[r.employee_id] = Number(r.transferred_year || 0);

    // Группировка
    const groups = { on_site: 0, approved: 0, ready: 0, not_ready: 0, archive: 0 };
    const enriched = employees.map(e => {
      let effective_status = e.readiness_status || 'unknown';
      let on_site_info = null;
      let approved_info = null;

      if (onSiteByEmp[e.id]) {
        effective_status = 'on_site';
        on_site_info = {
          work_id:    onSiteByEmp[e.id].work_id,
          work_title: onSiteByEmp[e.id].work_title,
          pm_name:    onSiteByEmp[e.id].pm_name,
        };
      } else if (approvedByEmp[e.id]) {
        effective_status = 'approved';
        approved_info = {
          work_id:    approvedByEmp[e.id].work_id,
          work_title: approvedByEmp[e.id].work_title,
          pm_name:    approvedByEmp[e.id].pm_name,
        };
      } else if (e.readiness_status === 'ready') {
        // ВСЕГДА 'ready' — и текущие готовы, и будущие (с readiness_date > today).
        // Раньше для будущих ставили 'ready_future', чего нет в группах фронта
        // → Егоров (готов с 22.06) пропадал из списка. Если нужно отличить —
        // у клиента есть readiness_date (на frontend подписываем «с DD.MM.YYYY»).
        effective_status = 'ready';
      }

      // Силовой fallback: если effective_status не входит в известные группы
      // ({on_site, approved, ready, not_ready, archive}) — НЕ silent-drop'аем
      // (раньше так пропадал ready_future, и любой будущий новый статус), а
      // считаем как not_ready (надёжное место для «непонятного» статуса).
      if (groups[effective_status] !== undefined) {
        groups[effective_status]++;
      } else {
        groups.not_ready++;
        effective_status = 'not_ready';
      }

      // last_assignment_info — последняя работа сотрудника (даже завершённая).
      // Используется для пустых строк «Объект/РП» и «Начало работ», когда сотрудник
      // СЕЙЧАС не на объекте и не согласован, но ИСТОРИЯ его работ есть.
      const last_assignment_info = lastByEmp[e.id] ? {
        work_id:    lastByEmp[e.id].work_id,
        work_title: lastByEmp[e.id].work_title,
        pm_name:    lastByEmp[e.id].pm_name,
        start_date: lastByEmp[e.id].start_date,
        end_date:   lastByEmp[e.id].end_date,
      } : null;

      return {
        ...e,
        effective_status,
        on_site_info,
        approved_info,
        last_assignment_info,
        permits: permitsByEmp[e.id] || { expired: 0, expiring: 0 },
        key_permits: keyPermitsByEmp[e.id] || {},
        se_transferred_year: seByEmp[e.id] || 0,
      };
    });

    return { employees: enriched, groups };
  });

  // ─── GET /stats — только цифры по группам ──────────────────────────────────
  fastify.get('/stats', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async () => {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.employee_id = e.id
            AND COALESCE(ea.is_active, true) = true
            AND ea.departure_date IS NULL
        )) AS on_site,
        COUNT(*) FILTER (WHERE e.readiness_status = 'ready' AND (e.readiness_date IS NULL OR e.readiness_date <= CURRENT_DATE)) AS ready,
        COUNT(*) FILTER (WHERE e.readiness_status = 'not_ready') AS not_ready,
        COUNT(*) FILTER (WHERE e.readiness_status = 'archive')   AS archive
      FROM employees e
      WHERE e.is_active = true
    `);
    const r = rows[0] || {};
    return {
      on_site:   Number(r.on_site || 0),
      ready:     Number(r.ready || 0),
      not_ready: Number(r.not_ready || 0),
      archive:   Number(r.archive || 0),
    };
  });

  // ─── GET /reasons — справочник ────────────────────────────────────────────
  fastify.get('/reasons', { preHandler: [fastify.authenticate] }, async () => {
    return { reasons: READINESS_REASONS };
  });

  // ─── GET /log/:employee_id — история ──────────────────────────────────────
  fastify.get('/log/:employee_id', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const empId = parseInt(request.params.employee_id, 10);
    const { rows } = await db.query(`
      SELECT
        l.*,
        u.name AS changed_by_name
      FROM worker_readiness_log l
      LEFT JOIN users u ON u.id = l.changed_by
      WHERE l.employee_id = $1
      ORDER BY l.created_at DESC
      LIMIT 100
    `, [empId]);
    return { log: rows };
  });

  // ─── PUT /:employee_id/status — HR обновляет статус ───────────────────────
  fastify.put('/:employee_id/status', { preHandler: [fastify.requireRoles(READINESS_ROLES)] }, async (request, reply) => {
    const empId = parseInt(request.params.employee_id, 10);
    if (!Number.isFinite(empId)) return reply.code(400).send({ error: 'Bad employee_id' });

    const { status, readiness_date, reason, comment } = request.body || {};
    if (!['ready', 'not_ready', 'archive', 'unknown'].includes(status)) {
      return reply.code(400).send({ error: 'Недопустимый статус. Ожидается ready|not_ready|archive|unknown' });
    }
    if (status === 'not_ready' && !reason) {
      return reply.code(400).send({ error: 'Для not_ready обязательна причина' });
    }
    if (status === 'ready' && !readiness_date) {
      return reply.code(400).send({ error: 'Для ready обязательна дата готовности' });
    }
    if (reason && !READINESS_REASONS.find(r => r.key === reason)) {
      return reply.code(400).send({ error: 'Неизвестная причина' });
    }

    const { rows: [existing] } = await db.query(
      'SELECT readiness_status FROM employees WHERE id = $1',
      [empId]
    );
    if (!existing) return reply.code(404).send({ error: 'Сотрудник не найден' });

    const oldStatus = existing.readiness_status;

    await db.query(`
      UPDATE employees SET
        readiness_status     = $1,
        readiness_date       = $2,
        readiness_reason     = $3,
        readiness_comment    = $4,
        readiness_updated_at = NOW(),
        readiness_updated_by = $5,
        updated_at           = NOW()
      WHERE id = $6
    `, [status, status === 'ready' ? readiness_date : null, status === 'not_ready' ? reason : null, comment || null, request.user.id, empId]);

    await db.query(`
      INSERT INTO worker_readiness_log
        (employee_id, old_status, new_status, readiness_date, reason, comment, source, changed_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'hr', $7)
    `, [empId, oldStatus, status, readiness_date || null, reason || null, comment || null, request.user.id]);

    const { rows: [updated] } = await db.query('SELECT * FROM employees WHERE id = $1', [empId]);
    return { employee: updated };
  });
}

module.exports = routes;
