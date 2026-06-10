/**
 * Staff Requests v2 API
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/staff-requests
 *
 * PM:
 *   POST   /                    — создать черновик (status_v2='draft')
 *   PUT    /:id/draft           — сохранить черновик
 *   PUT    /:id/submit          — отправить HR (status_v2='new')
 *   GET    /my                  — мои заявки (включая draft)
 *   GET    /:id                 — детали
 *   PUT    /:id/add-to-crew     — добавить утверждённых в бригаду
 *
 * HR:
 *   GET    /pending                       — заявки ожидающие HR (status_v2='new')
 *   PUT    /:id/take                      — взять в работу
 *   PUT    /:id/assign                    — добавить рабочего в заявку
 *   DELETE /:id/assign/:assignment_id     — убрать рабочего из заявки
 *   PUT    /:id/send-to-pm                — отправить на просмотр РП
 *   PUT    /:id/approve                   — утвердить заявку
 *   PUT    /:id/rework                    — вернуть на доработку
 *   PUT    /:id/replace/:assignment_id    — заменить рабочего
 *
 * Общее:
 *   GET    /:id/available-workers — доступные рабочие для заявки
 */

const PM_ROLES = ['PM', 'HEAD_PM', 'ADMIN'];
const HR_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN'];
const VIEW_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];

const ROLE_LABELS = {
  master:     'Мастера',
  fitter:     'Слесари',
  welder:     'Сварщики',
  pto:        'ПТО',
  chemist:    'Химики',
  insulator:  'Изолировщики',
  assembler:  'Монтажники',
  laborer:    'Разнорабочие',
};

async function routes(fastify, options) {
  const db = fastify.db;

  // Утилита загрузки полной заявки
  async function loadRequest(id) {
    const { rows: [req] } = await db.query(`
      SELECT
        sr.*,
        w.work_title, w.pm_id AS work_pm_id,
        pm.name AS pm_name,
        hr.name AS hr_name
      FROM staff_requests sr
      LEFT JOIN works w  ON w.id = sr.work_id
      LEFT JOIN users pm ON pm.id = sr.pm_id
      LEFT JOIN users hr ON hr.id = sr.hr_user_id
      WHERE sr.id = $1
    `, [id]);
    if (!req) return null;

    const { rows: positions } = await db.query(
      'SELECT * FROM staff_request_positions WHERE request_id = $1 ORDER BY id',
      [id]
    );
    const { rows: assignments } = await db.query(`
      SELECT
        sra.*,
        e.fio, e.phone, e.role_tag, e.position, e.rating_avg
      FROM staff_request_assignments sra
      LEFT JOIN employees e ON e.id = sra.employee_id
      WHERE sra.request_id = $1
      ORDER BY sra.assigned_at
    `, [id]);

    return { ...req, positions, assignments };
  }

  // ─── Проверка допусков рабочих заявки против требований работы ──────────────
  // Возвращает массив { employee_id, fio, missing: [{ permit_type_id, type_name, is_mandatory }] }
  async function computePermitGaps(requestId) {
    const { rows: [req] } = await db.query(
      'SELECT work_id FROM staff_requests WHERE id = $1', [requestId]
    );
    if (!req || !req.work_id) return { work_id: null, requirements: [], gaps: [] };

    const { rows: requirements } = await db.query(`
      SELECT wpr.permit_type_id, wpr.is_mandatory, wpr.role_key, pt.name AS type_name
      FROM work_permit_requirements wpr
      JOIN permit_types pt ON pt.id = wpr.permit_type_id
      WHERE wpr.work_id = $1
    `, [req.work_id]);

    if (!requirements.length) return { work_id: req.work_id, requirements: [], gaps: [] };

    const { rows: assignments } = await db.query(`
      SELECT sra.employee_id, sra.assigned_role, e.fio, e.role_tag, e.position
      FROM staff_request_assignments sra
      LEFT JOIN employees e ON e.id = sra.employee_id
      WHERE sra.request_id = $1 AND sra.status NOT IN ('rejected', 'replaced')
    `, [requestId]);

    if (!assignments.length) return { work_id: req.work_id, requirements, gaps: [] };

    const empIds = assignments.map(a => a.employee_id);
    const { rows: permits } = await db.query(`
      SELECT employee_id, type_id
      FROM employee_permits
      WHERE employee_id = ANY($1::int[])
        AND is_active = true
        AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
    `, [empIds]);

    const hasPermit = new Set(permits.map(p => `${p.employee_id}_${p.type_id}`));

    const gaps = assignments.map(a => {
      // Роль рабочего: назначенная > role_tag > position
      const empRole = a.assigned_role || a.role_tag || a.position || null;
      // Требования: общие (role_key IS NULL) + требования его должности
      const reqForEmp = requirements.filter(r => !r.role_key || r.role_key === empRole);
      const missing = reqForEmp
        .filter(r => !hasPermit.has(`${a.employee_id}_${r.permit_type_id}`))
        .map(r => ({ permit_type_id: r.permit_type_id, type_name: r.type_name, is_mandatory: r.is_mandatory }));
      return { employee_id: a.employee_id, fio: a.fio, role: empRole, missing };
    }).filter(g => g.missing.length);

    return { work_id: req.work_id, requirements, gaps };
  }

  // Создаёт записи worker_training для недостающих допусков (без дублей)
  async function enrollMissingTraining(requestId, userId) {
    const { work_id, gaps } = await computePermitGaps(requestId);
    if (!gaps.length) return { created: 0 };

    let created = 0;
    for (const g of gaps) {
      for (const m of g.missing) {
        // Не создаём дубль, если уже есть активное обучение по этому допуску
        const { rows: existing } = await db.query(`
          SELECT 1 FROM worker_training
          WHERE employee_id = $1 AND permit_type_id = $2
            AND status IN ('pending', 'in_progress')
          LIMIT 1
        `, [g.employee_id, m.permit_type_id]);
        if (existing.length) continue;

        await db.query(`
          INSERT INTO worker_training
            (employee_id, work_id, staff_request_id, permit_type_id,
             training_type, title, description, status, assigned_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 'permit', $5, $6, 'pending', $7, NOW(), NOW())
        `, [
          g.employee_id, work_id, requestId, m.permit_type_id,
          `Оформление допуска: ${m.type_name}`,
          `Автоматически назначено по заявке #${requestId} (отсутствует требуемый допуск${m.is_mandatory ? ', обязательный' : ''}).`,
          userId,
        ]);
        created++;
      }
    }
    return { created };
  }

  // ─── POST / — создать черновик заявки (PM) ────────────────────────────────
  fastify.post('/', { preHandler: [fastify.requireRoles(PM_ROLES)] }, async (request, reply) => {
    const { work_id, date_from, date_to, positions, work_description, work_conditions, is_vachta } = request.body || {};
    if (!work_id) return reply.code(400).send({ error: 'work_id обязателен' });

    // Если есть существующий draft на эту работу для текущего PM — возвращаем его
    const { rows: existing } = await db.query(`
      SELECT id FROM staff_requests
      WHERE work_id = $1 AND pm_id = $2 AND status_v2 = 'draft'
      LIMIT 1
    `, [work_id, request.user.id]);
    if (existing.length) {
      const full = await loadRequest(existing[0].id);
      return { request: full, reused: true };
    }

    const requestJson = JSON.stringify(positions || []);

    const { rows: [created] } = await db.query(`
      INSERT INTO staff_requests
        (work_id, pm_id, request_json, work_description, work_conditions, status, status_v2, is_vachta, created_at)
      VALUES ($1, $2, $3, $4, $5, 'sent', 'draft', $6, NOW())
      RETURNING *
    `, [
      parseInt(work_id, 10),
      request.user.id,
      requestJson,
      work_description || null,
      JSON.stringify(work_conditions || {}),
      !!is_vachta,
    ]);

    // Создаём позиции
    if (Array.isArray(positions)) {
      for (const p of positions) {
        if (!p.role_key || !p.required_count) continue;
        await db.query(`
          INSERT INTO staff_request_positions
            (request_id, role_key, role_label, required_count, filled_count)
          VALUES ($1, $2, $3, $4, 0)
        `, [created.id, p.role_key, ROLE_LABELS[p.role_key] || p.role_label || p.role_key, parseInt(p.required_count, 10) || 0]);
      }
    }

    const full = await loadRequest(created.id);
    return { request: full };
  });

  // ─── PUT /:id/draft — обновить черновик ───────────────────────────────────
  fastify.put('/:id/draft', { preHandler: [fastify.requireRoles(PM_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [existing] } = await db.query(
      'SELECT pm_id, status_v2 FROM staff_requests WHERE id = $1', [id]
    );
    if (!existing) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (existing.status_v2 !== 'draft') {
      return reply.code(409).send({ error: 'Редактирование возможно только для черновика' });
    }
    if (existing.pm_id !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Чужой черновик' });
    }

    const { work_description, work_conditions, is_vachta, positions } = request.body || {};

    await db.query(`
      UPDATE staff_requests SET
        work_description = COALESCE($1, work_description),
        work_conditions  = COALESCE($2, work_conditions),
        is_vachta        = COALESCE($3, is_vachta),
        updated_at       = NOW()
      WHERE id = $4
    `, [
      work_description !== undefined ? work_description : null,
      work_conditions !== undefined ? JSON.stringify(work_conditions) : null,
      is_vachta !== undefined ? !!is_vachta : null,
      id,
    ]);

    if (Array.isArray(positions)) {
      // Полная замена позиций
      await db.query('DELETE FROM staff_request_positions WHERE request_id = $1', [id]);
      for (const p of positions) {
        if (!p.role_key || !p.required_count) continue;
        await db.query(`
          INSERT INTO staff_request_positions
            (request_id, role_key, role_label, required_count, filled_count)
          VALUES ($1, $2, $3, $4, 0)
        `, [id, p.role_key, ROLE_LABELS[p.role_key] || p.role_label || p.role_key, parseInt(p.required_count, 10) || 0]);
      }
    }

    const full = await loadRequest(id);
    return { request: full };
  });

  // ─── PUT /:id/submit — отправить HR ───────────────────────────────────────
  fastify.put('/:id/submit', { preHandler: [fastify.requireRoles(PM_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [existing] } = await db.query(
      'SELECT pm_id, status_v2 FROM staff_requests WHERE id = $1', [id]
    );
    if (!existing) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (existing.pm_id !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Чужая заявка' });
    }
    if (!['draft', 'rework'].includes(existing.status_v2)) {
      return reply.code(409).send({ error: 'Отправить можно только черновик или возвращённую на доработку' });
    }

    // ── Блокировка: требуемые допуска должны быть заданы для каждой должности ──
    const { rows: [reqRow] } = await db.query(
      'SELECT work_id FROM staff_requests WHERE id = $1', [id]
    );
    if (reqRow && reqRow.work_id) {
      const { rows: positions } = await db.query(
        `SELECT role_key, role_label FROM staff_request_positions
         WHERE request_id = $1 AND required_count > 0`, [id]
      );
      if (positions.length) {
        // Загружаем требования работы: role_key (NULL = для всех) + флаг "без допусков"
        const { rows: reqs } = await db.query(
          `SELECT role_key, no_permits_required FROM work_permit_requirements WHERE work_id = $1`,
          [reqRow.work_id]
        );
        // Есть ли общее требование (для всех должностей)?
        const hasGlobal = reqs.some(r => r.role_key === null);
        // Множество должностей, для которых задано хотя бы одно требование
        // или явно отмечено "допуска не требуются"
        const coveredRoles = new Set(reqs.filter(r => r.role_key !== null).map(r => r.role_key));
        const missing = [];
        for (const p of positions) {
          if (hasGlobal || coveredRoles.has(p.role_key)) continue;
          missing.push({ role_key: p.role_key, role_label: p.role_label || ROLE_LABELS[p.role_key] || p.role_key });
        }
        if (missing.length) {
          return reply.code(409).send({
            error: 'Требуется заполнение: не заданы требуемые допуска для должностей: '
              + missing.map(m => m.role_label).join(', '),
            missing_roles: missing.map(m => m.role_key),
            missing: missing,
          });
        }
      }
    }

    await db.query(`
      UPDATE staff_requests SET status_v2 = 'new', status = 'sent', updated_at = NOW() WHERE id = $1
    `, [id]);

    const full = await loadRequest(id);
    return { request: full };
  });

  // ─── GET /my — мои заявки (PM) ────────────────────────────────────────────
  fastify.get('/my', { preHandler: [fastify.requireRoles(PM_ROLES)] }, async (request) => {
    const { rows } = await db.query(`
      SELECT
        sr.*,
        w.work_title,
        (SELECT COUNT(*) FROM staff_request_positions p WHERE p.request_id = sr.id) AS positions_count,
        (SELECT SUM(required_count) FROM staff_request_positions p WHERE p.request_id = sr.id) AS total_required,
        (SELECT SUM(filled_count)   FROM staff_request_positions p WHERE p.request_id = sr.id) AS total_filled
      FROM staff_requests sr
      LEFT JOIN works w ON w.id = sr.work_id
      WHERE sr.pm_id = $1
      ORDER BY sr.created_at DESC
      LIMIT 200
    `, [request.user.id]);
    return { requests: rows };
  });

  // ─── GET /pending — входящие для HR ───────────────────────────────────────
  fastify.get('/pending', { preHandler: [fastify.requireRoles(HR_ROLES)] }, async () => {
    const { rows } = await db.query(`
      SELECT
        sr.*,
        w.work_title,
        pm.name AS pm_name,
        hr.name AS hr_name,
        (SELECT SUM(required_count) FROM staff_request_positions p WHERE p.request_id = sr.id) AS total_required,
        (SELECT SUM(filled_count)   FROM staff_request_positions p WHERE p.request_id = sr.id) AS total_filled
      FROM staff_requests sr
      LEFT JOIN works w  ON w.id = sr.work_id
      LEFT JOIN users pm ON pm.id = sr.pm_id
      LEFT JOIN users hr ON hr.id = sr.hr_user_id
      WHERE sr.status_v2 IN ('new', 'in_progress', 'sent_to_pm')
      ORDER BY sr.created_at DESC
      LIMIT 200
    `);
    return { requests: rows };
  });

  // ─── GET /:id — детали ────────────────────────────────────────────────────
  fastify.get('/:id', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const full = await loadRequest(parseInt(request.params.id, 10));
    if (!full) return reply.code(404).send({ error: 'Заявка не найдена' });
    // PM видит только свои заявки, HR/director — любые
    const role = request.user.role;
    const isPm = role === 'PM' || role === 'HEAD_PM';
    if (isPm && full.pm_id !== request.user.id) {
      return reply.code(403).send({ error: 'Чужая заявка' });
    }
    return { request: full };
  });

  // ─── PUT /:id/take — HR берёт в работу ────────────────────────────────────
  fastify.put('/:id/take', { preHandler: [fastify.requireRoles(HR_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [existing] } = await db.query(`
      SELECT sr.hr_user_id, sr.status_v2, u.name AS hr_name
      FROM staff_requests sr
      LEFT JOIN users u ON u.id = sr.hr_user_id
      WHERE sr.id = $1
    `, [id]);
    if (!existing) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (existing.hr_user_id && existing.hr_user_id !== request.user.id) {
      return reply.code(409).send({ error: 'Заявка уже в работе', taken_by: existing.hr_name });
    }
    if (!['new', 'in_progress'].includes(existing.status_v2)) {
      return reply.code(409).send({ error: 'Заявка в неподходящем статусе: ' + existing.status_v2 });
    }

    await db.query(`
      UPDATE staff_requests SET
        hr_user_id = $1,
        status_v2  = 'in_progress',
        taken_at   = COALESCE(taken_at, NOW()),
        updated_at = NOW()
      WHERE id = $2
    `, [request.user.id, id]);

    const full = await loadRequest(id);
    return { request: full };
  });

  // ─── PUT /:id/assign — HR добавляет рабочего ──────────────────────────────
  fastify.put('/:id/assign', { preHandler: [fastify.requireRoles(HR_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { employee_id, position_id, assigned_role } = request.body || {};

    const { rows: [req] } = await db.query(
      'SELECT status_v2 FROM staff_requests WHERE id = $1', [id]
    );
    if (!req) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (req.status_v2 !== 'in_progress') {
      return reply.code(409).send({ error: 'Назначать можно только в статусе in_progress' });
    }

    // Защита: рабочий не в другой активной заявке
    const { rows: conflict } = await db.query(`
      SELECT sra.request_id, sr.status_v2 FROM staff_request_assignments sra
      JOIN staff_requests sr ON sr.id = sra.request_id
      WHERE sra.employee_id = $1
        AND sra.request_id != $2
        AND sra.status IN ('proposed','approved')
        AND sr.status_v2 IN ('in_progress','sent_to_pm','approved')
      LIMIT 1
    `, [employee_id, id]);
    if (conflict.length) {
      return reply.code(409).send({ error: 'Рабочий уже в другой активной заявке', request_id: conflict[0].request_id });
    }

    const { rows: [emp] } = await db.query(
      'SELECT role_tag, position FROM employees WHERE id = $1', [employee_id]
    );
    if (!emp) return reply.code(404).send({ error: 'Сотрудник не найден' });

    const originalRole = emp.role_tag || emp.position || null;
    const mismatch = !!assigned_role && !!originalRole && assigned_role !== originalRole;

    try {
      const { rows: [assignment] } = await db.query(`
        INSERT INTO staff_request_assignments
          (request_id, position_id, employee_id, assigned_role, employee_original_role, role_mismatch, status, assigned_by)
        VALUES ($1, $2, $3, $4, $5, $6, 'proposed', $7)
        RETURNING *
      `, [id, position_id, employee_id, assigned_role || originalRole || 'unknown', originalRole, mismatch, request.user.id]);

      // Обновляем filled_count
      await db.query(`
        UPDATE staff_request_positions p SET filled_count = (
          SELECT COUNT(*) FROM staff_request_assignments WHERE position_id = p.id AND status != 'rejected' AND status != 'replaced'
        )
        WHERE p.id = $1
      `, [position_id]);

      // Обновляем readiness
      await db.query(`
        UPDATE employees SET readiness_status = 'approved', readiness_updated_at = NOW(), readiness_updated_by = $1
        WHERE id = $2 AND readiness_status NOT IN ('on_site')
      `, [request.user.id, employee_id]);

      return { assignment, role_mismatch: mismatch };
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'Этот рабочий уже в заявке' });
      throw e;
    }
  });

  // ─── DELETE /:id/assign/:assignment_id — убрать рабочего ──────────────────
  fastify.delete('/:id/assign/:assignment_id', { preHandler: [fastify.requireRoles(HR_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const aid = parseInt(request.params.assignment_id, 10);
    const { rows: [a] } = await db.query(
      'SELECT employee_id, position_id, request_id FROM staff_request_assignments WHERE id = $1', [aid]
    );
    if (!a || a.request_id !== id) return reply.code(404).send({ error: 'Назначение не найдено' });

    await db.query('DELETE FROM staff_request_assignments WHERE id = $1', [aid]);

    await db.query(`
      UPDATE staff_request_positions p SET filled_count = (
        SELECT COUNT(*) FROM staff_request_assignments WHERE position_id = p.id AND status != 'rejected' AND status != 'replaced'
      )
      WHERE p.id = $1
    `, [a.position_id]);

    return { ok: true };
  });

  // ─── PUT /:id/send-to-pm ──────────────────────────────────────────────────
  fastify.put('/:id/send-to-pm', { preHandler: [fastify.requireRoles(HR_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [req] } = await db.query('SELECT status_v2 FROM staff_requests WHERE id = $1', [id]);
    if (!req) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (req.status_v2 !== 'in_progress') return reply.code(409).send({ error: 'Можно только из in_progress' });

    await db.query(`
      UPDATE staff_requests SET status_v2 = 'sent_to_pm', sent_to_pm_at = NOW(), status = 'answered', updated_at = NOW()
      WHERE id = $1
    `, [id]);
    return { ok: true };
  });

  // ─── PUT /:id/approve ─────────────────────────────────────────────────────
  fastify.put('/:id/approve', { preHandler: [fastify.requireRoles(HR_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    await db.query(`
      UPDATE staff_requests SET status_v2 = 'approved', approved_at = NOW(), status = 'approved', updated_at = NOW()
      WHERE id = $1
    `, [id]);
    await db.query(`
      UPDATE staff_request_assignments SET status = 'approved'
      WHERE request_id = $1 AND status = 'proposed'
    `, [id]);

    // Авто-постановка на обучение: рабочие без требуемых допусков → worker_training
    let training = { created: 0 };
    try {
      training = await enrollMissingTraining(id, request.user.id);
    } catch (e) {
      fastify.log.warn('[staff-requests/approve] enrollMissingTraining failed: ' + e.message);
    }

    return { ok: true, training_created: training.created };
  });

  // ─── GET /:id/permit-check — превью нехватки допусков (для HR) ─────────────
  fastify.get('/:id/permit-check', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [req] } = await db.query('SELECT id FROM staff_requests WHERE id = $1', [id]);
    if (!req) return reply.code(404).send({ error: 'Заявка не найдена' });
    const result = await computePermitGaps(id);
    return result;
  });

  // ─── PUT /:id/rework ──────────────────────────────────────────────────────
  fastify.put('/:id/rework', { preHandler: [fastify.requireRoles(HR_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { comment } = request.body || {};
    if (!comment) return reply.code(400).send({ error: 'Требуется комментарий' });
    await db.query(`
      UPDATE staff_requests SET status_v2 = 'rework', status = 'rework', hr_comment = $2, updated_at = NOW()
      WHERE id = $1
    `, [id, comment]);
    return { ok: true };
  });

  // ─── PUT /:id/replace/:assignment_id ──────────────────────────────────────
  fastify.put('/:id/replace/:assignment_id', { preHandler: [fastify.requireRoles(HR_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const aid = parseInt(request.params.assignment_id, 10);
    const { new_employee_id } = request.body || {};
    if (!new_employee_id) return reply.code(400).send({ error: 'new_employee_id обязателен' });

    const { rows: [old] } = await db.query(
      'SELECT position_id, assigned_role, request_id FROM staff_request_assignments WHERE id = $1', [aid]
    );
    if (!old || old.request_id !== id) return reply.code(404).send({ error: 'Назначение не найдено' });

    const { rows: [newAssign] } = await db.query(`
      INSERT INTO staff_request_assignments
        (request_id, position_id, employee_id, assigned_role, status, assigned_by)
      VALUES ($1, $2, $3, $4, 'proposed', $5)
      RETURNING *
    `, [id, old.position_id, new_employee_id, old.assigned_role, request.user.id]);

    await db.query(`
      UPDATE staff_request_assignments SET status = 'replaced', replaced_by = $1 WHERE id = $2
    `, [newAssign.id, aid]);

    return { assignment: newAssign };
  });

  // ─── PUT /:id/add-to-crew — PM добавляет в бригаду ────────────────────────
  fastify.put('/:id/add-to-crew', { preHandler: [fastify.requireRoles(PM_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [req] } = await db.query(
      'SELECT pm_id, work_id, status_v2 FROM staff_requests WHERE id = $1', [id]
    );
    if (!req) return reply.code(404).send({ error: 'Заявка не найдена' });
    if (req.pm_id !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Чужая заявка' });
    }
    if (req.status_v2 !== 'approved') {
      return reply.code(409).send({ error: 'Добавлять можно только из approved' });
    }

    const { rows: assignments } = await db.query(`
      SELECT id, employee_id FROM staff_request_assignments
      WHERE request_id = $1 AND status = 'approved'
    `, [id]);

    // Название объекта для уведомления рабочему
    let workTitle = `#${req.work_id}`;
    try {
      const { rows: [w] } = await db.query('SELECT work_title FROM works WHERE id = $1', [req.work_id]);
      if (w && w.work_title) workTitle = w.work_title;
    } catch (e) { /* не критично */ }

    let added = 0;
    const notified = [];
    for (const a of assignments) {
      await db.query(`
        INSERT INTO employee_assignments (employee_id, work_id, is_active, created_at)
        VALUES ($1, $2, true, NOW())
        ON CONFLICT DO NOTHING
      `, [a.employee_id, req.work_id]);

      await db.query(`
        UPDATE staff_request_assignments SET status = 'added_to_crew' WHERE id = $1
      `, [a.id]);

      await db.query(`
        UPDATE employees SET readiness_status = 'on_site', last_pm_id = $1, last_work_id = $2,
                             readiness_updated_at = NOW(), updated_at = NOW()
        WHERE id = $3
      `, [request.user.id, req.work_id, a.employee_id]);

      added++;

      // Уведомление рабочему: push (если есть user-аккаунт) + MAX → SMS fallback
      try {
        const ok = await notifyWorkerAddedToCrew(a.employee_id, req.work_id, workTitle);
        if (ok) notified.push(a.employee_id);
      } catch (e) {
        fastify.log.error('[staff-requests] notify add-to-crew error: ' + e.message);
      }
    }

    await db.query(`
      UPDATE staff_requests SET status_v2 = 'added_to_crew', added_to_crew_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [id]);

    return { ok: true, added, notified: notified.length };
  });

  // Уведомить рабочего о добавлении в бригаду: push + MAX → SMS fallback.
  // Возвращает true, если хотя бы один канал сработал.
  async function notifyWorkerAddedToCrew(employeeId, workId, workTitle) {
    const { rows: [emp] } = await db.query(
      'SELECT user_id, phone, fio FROM employees WHERE id = $1', [employeeId]
    );
    if (!emp) return false;

    const title = '⚔️ Вы добавлены в бригаду';
    const msg = `Вы назначены на объект «${workTitle}». Подготовьтесь к выезду.`;
    let delivered = false;

    // 1. In-app push / SSE / Telegram (если рабочий привязан к users)
    if (emp.user_id) {
      try {
        const { createNotification } = require('../services/notify');
        createNotification(db, {
          user_id: emp.user_id, title, message: msg, type: 'crew', link: '#/field'
        });
        delivered = true;
      } catch (e) { fastify.log.error('[staff-requests] push notify error: ' + e.message); }
    }

    // 2. MAX-мессенджер (личный max_user_id из активного назначения)
    let maxOk = false;
    try {
      const maxMessenger = require('../services/max-messenger');
      if (maxMessenger.isEnabled()) {
        const { rows: [ea] } = await db.query(
          `SELECT max_user_id FROM employee_assignments
           WHERE employee_id = $1 AND work_id = $2 AND max_user_id IS NOT NULL
           ORDER BY is_active DESC, created_at DESC LIMIT 1`,
          [employeeId, workId]
        );
        if (ea && ea.max_user_id) {
          await maxMessenger.sendMessage(ea.max_user_id, `${title}\n${msg}`);
          maxOk = true; delivered = true;
        }
      }
    } catch (e) { fastify.log.error('[staff-requests] MAX notify error: ' + e.message); }

    // 3. SMS fallback (если MAX не доставлен и есть телефон)
    if (!maxOk && emp.phone) {
      try {
        const { getMangoService } = require('../services/mango');
        const mango = getMangoService();
        if (mango && mango.isConfigured()) {
          await mango.sendSms(null, emp.phone, `${title}. ${msg}`);
          delivered = true;
        }
      } catch (e) { fastify.log.error('[staff-requests] SMS notify error: ' + e.message); }
    }

    return delivered;
  }

  // ─── GET /:id/available-workers ───────────────────────────────────────────
  fastify.get('/:id/available-workers', { preHandler: [fastify.requireRoles(HR_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const role_key = request.query.role_key || request.query.role || null;

    const { rows: [req] } = await db.query(
      'SELECT work_id FROM staff_requests WHERE id = $1', [id]
    );
    if (!req) return reply.code(404).send({ error: 'Заявка не найдена' });

    // Уже добавленные в эту заявку
    const { rows: alreadyInReq } = await db.query(
      'SELECT employee_id FROM staff_request_assignments WHERE request_id = $1', [id]
    );
    const excludeIds = alreadyInReq.map(r => r.employee_id);

    let sql = `
      SELECT
        e.id, e.fio, e.phone, e.role_tag, e.position, e.rating_avg,
        e.readiness_status, e.readiness_date,
        e.is_self_employed, e.is_officially_employed
      FROM employees e
      WHERE e.is_active = true
        AND (e.readiness_status IS NULL OR e.readiness_status NOT IN ('on_site', 'archive'))
        AND NOT EXISTS (
          SELECT 1 FROM staff_request_assignments sra
          JOIN staff_requests sr ON sr.id = sra.request_id
          WHERE sra.employee_id = e.id
            AND sra.request_id != $1
            AND sra.status IN ('proposed','approved')
            AND sr.status_v2 IN ('in_progress','sent_to_pm','approved')
        )
        AND NOT EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.employee_id = e.id
            AND COALESCE(ea.is_active, true) = true
            AND ea.departure_date IS NULL
        )
    `;
    const params = [id];
    let idx = 2;

    if (role_key) {
      sql += ` AND (e.role_tag = $${idx} OR e.position = $${idx})`;
      params.push(role_key);
      idx++;
    }

    if (excludeIds.length) {
      sql += ` AND e.id != ALL($${idx}::int[])`;
      params.push(excludeIds);
      idx++;
    }

    sql += ` ORDER BY
      CASE WHEN e.readiness_status = 'ready' THEN 0
           WHEN e.readiness_status = 'not_ready' THEN 1
           ELSE 2 END,
      COALESCE(e.rating_avg, 0) DESC
    LIMIT 200`;

    const { rows } = await db.query(sql, params);

    // ── Пометка рабочих без требуемых допусков (conflict_reason='missing_permits') ──
    if (rows.length && req.work_id) {
      const { rows: requirements } = await db.query(
        `SELECT permit_type_id, role_key FROM work_permit_requirements
         WHERE work_id = $1 AND permit_type_id IS NOT NULL`, [req.work_id]
      );
      if (requirements.length) {
        const candIds = rows.map(r => r.id);
        const { rows: permits } = await db.query(`
          SELECT employee_id, type_id FROM employee_permits
          WHERE employee_id = ANY($1::int[])
            AND is_active = true
            AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        `, [candIds]);
        const hasPermit = new Set(permits.map(p => `${p.employee_id}_${p.type_id}`));
        for (const w of rows) {
          // Роль кандидата для подбора требований: запрошенная (role_key) > его role_tag/position
          const wRole = role_key || w.role_tag || w.position || null;
          const reqForW = requirements.filter(r => !r.role_key || r.role_key === wRole);
          const missing = reqForW
            .filter(r => !hasPermit.has(`${w.id}_${r.permit_type_id}`))
            .map(r => r.permit_type_id);
          if (missing.length) {
            w.conflict_reason = 'missing_permits';
            w.missing_permit_type_ids = missing;
          }
        }
      }
    }

    return { workers: rows };
  });
}

module.exports = routes;
