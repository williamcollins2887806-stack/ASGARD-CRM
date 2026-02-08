'use strict';

/**
 * Допуски и разрешения — выделенный API (M6)
 *
 * Заменяет generic /api/data/employee_permits
 * Добавляет: загрузку сканов, матрицу, уведомления, требования проектов
 */

const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

module.exports = async function(fastify) {
  const db = fastify.db;
  const uploadDir = process.env.UPLOAD_DIR || './uploads';

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Уведомление
  // ═══════════════════════════════════════════════════════════════
  async function notify(userId, title, message, link) {
    try {
      await db.query(`
        INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
        VALUES ($1, $2, $3, 'permit', $4, false, NOW())
      `, [userId, title, message, link || '#/permits']);

      // Telegram notification
      try {
        const telegram = require('../services/telegram');
        await telegram.sendNotification(userId, `*${title}*\n\n${message}`);
      } catch (tgErr) {
        fastify.log.warn('Telegram notification failed:', tgErr.message);
      }
    } catch (e) {
      fastify.log.error('Permit notification error:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // GET /api/permits/types — Справочник типов допусков
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/types', {
    preHandler: [fastify.requirePermission('permits', 'read')]
  }, async () => {
    const { rows } = await db.query(
      'SELECT * FROM permit_types WHERE is_active = true ORDER BY sort_order, name'
    );
    return { types: rows };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /api/permits — Список допусков (с фильтрами)
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/', {
    preHandler: [fastify.requirePermission('permits', 'read')]
  }, async (request) => {
    const { employee_id, type_id, category, status, work_id, limit = 500, offset = 0 } = request.query;

    let sql = `
      SELECT ep.*,
        e.fio as employee_name, e.position as employee_position, e.is_active as employee_active,
        pt.name as type_name, pt.category as type_category, pt.validity_months
      FROM employee_permits ep
      LEFT JOIN employees e ON ep.employee_id = e.id
      LEFT JOIN permit_types pt ON ep.type_id = pt.id
      WHERE ep.is_active = true
    `;
    const params = [];
    let idx = 1;

    if (employee_id) { sql += ` AND ep.employee_id = $${idx}`; params.push(employee_id); idx++; }
    if (type_id) { sql += ` AND ep.type_id = $${idx}`; params.push(type_id); idx++; }
    if (category) { sql += ` AND pt.category = $${idx}`; params.push(category); idx++; }

    // Фильтр по статусу: expired, expiring_30, expiring_14, active
    if (status === 'expired') {
      sql += ` AND ep.expiry_date IS NOT NULL AND ep.expiry_date < CURRENT_DATE`;
    } else if (status === 'expiring_30') {
      sql += ` AND ep.expiry_date IS NOT NULL AND ep.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`;
    } else if (status === 'expiring_14') {
      sql += ` AND ep.expiry_date IS NOT NULL AND ep.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'`;
    } else if (status === 'active') {
      sql += ` AND (ep.expiry_date IS NULL OR ep.expiry_date >= CURRENT_DATE)`;
    }

    // Фильтр по проекту: показать только допуски, которые требуются для данного проекта
    if (work_id) {
      sql += ` AND ep.type_id IN (SELECT permit_type_id FROM work_permit_requirements WHERE work_id = $${idx})`;
      params.push(work_id);
      idx++;
    }

    sql += ` ORDER BY ep.expiry_date ASC NULLS LAST, e.fio LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const { rows } = await db.query(sql, params);

    // Добавить вычисленный статус к каждому
    const today = new Date();
    rows.forEach(r => {
      if (!r.expiry_date) {
        r.computed_status = 'active';
        r.days_left = null;
      } else {
        const expiry = new Date(r.expiry_date);
        const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
        r.days_left = daysLeft;
        if (daysLeft < 0) r.computed_status = 'expired';
        else if (daysLeft <= 14) r.computed_status = 'expiring_14';
        else if (daysLeft <= 30) r.computed_status = 'expiring_30';
        else r.computed_status = 'active';
      }
    });

    return { permits: rows };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /api/permits/matrix — Матрица: сотрудники × типы допусков
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/matrix', {
    preHandler: [fastify.requirePermission('permits', 'read')]
  }, async (request) => {
    const { work_id, category } = request.query;

    // Все активные сотрудники
    const { rows: employees } = await db.query(
      'SELECT id, fio, position, is_active FROM employees WHERE is_active = true ORDER BY fio'
    );

    // Типы допусков (с опциональной фильтрацией по категории)
    let typesSql = 'SELECT * FROM permit_types WHERE is_active = true';
    const typesParams = [];
    if (category) {
      typesSql += ' AND category = $1';
      typesParams.push(category);
    }
    typesSql += ' ORDER BY sort_order';
    const { rows: types } = await db.query(typesSql, typesParams);

    // Если указан work_id — показать только требуемые типы
    let requiredTypeIds = null;
    if (work_id) {
      const { rows: reqs } = await db.query(
        'SELECT permit_type_id, is_mandatory FROM work_permit_requirements WHERE work_id = $1',
        [work_id]
      );
      requiredTypeIds = new Map(reqs.map(r => [r.permit_type_id, r.is_mandatory]));
    }

    // Все действующие допуски (не истёкшие)
    const { rows: permits } = await db.query(`
      SELECT employee_id, type_id, expiry_date, id
      FROM employee_permits
      WHERE is_active = true
      ORDER BY expiry_date DESC
    `);

    // Строим матрицу
    const permitMap = {}; // key: `${employee_id}_${type_id}` → {expiry_date, status, permit_id}
    const today = new Date();
    permits.forEach(p => {
      const key = `${p.employee_id}_${p.type_id}`;
      if (!permitMap[key]) { // берём последний (с наибольшим expiry)
        let status = 'active';
        let daysLeft = null;
        if (p.expiry_date) {
          daysLeft = Math.ceil((new Date(p.expiry_date) - today) / 86400000);
          if (daysLeft < 0) status = 'expired';
          else if (daysLeft <= 14) status = 'expiring_14';
          else if (daysLeft <= 30) status = 'expiring_30';
        }
        permitMap[key] = { expiry_date: p.expiry_date, status, days_left: daysLeft, permit_id: p.id };
      }
    });

    const filteredTypes = requiredTypeIds
      ? types.filter(t => requiredTypeIds.has(t.id))
      : types;

    return {
      employees,
      types: filteredTypes,
      matrix: permitMap,
      required: requiredTypeIds ? Object.fromEntries(requiredTypeIds) : null
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /api/permits/stats — Сводная статистика
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/stats', {
    preHandler: [fastify.requirePermission('permits', 'read')]
  }, async () => {
    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE expiry_date IS NULL OR expiry_date >= CURRENT_DATE) as active,
        COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE) as expired,
        COUNT(*) FILTER (WHERE expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days') as expiring_14,
        COUNT(*) FILTER (WHERE expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') as expiring_30,
        COUNT(DISTINCT employee_id) as employees_count
      FROM employee_permits WHERE is_active = true
    `);
    return stats;
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /api/permits/:id — Детали допуска
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id', {
    preHandler: [fastify.requirePermission('permits', 'read')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { rows: [permit] } = await db.query(`
      SELECT ep.*,
        e.fio as employee_name, e.position as employee_position,
        pt.name as type_name, pt.category as type_category, pt.validity_months
      FROM employee_permits ep
      LEFT JOIN employees e ON ep.employee_id = e.id
      LEFT JOIN permit_types pt ON ep.type_id = pt.id
      WHERE ep.id = $1
    `, [id]);

    if (!permit) return reply.code(404).send({ error: 'Допуск не найден' });
    return { permit };
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /api/permits — Создать допуск (с загрузкой скана)
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/', {
    preHandler: [fastify.requirePermission('permits', 'write')]
  }, async (request, reply) => {
    // Проверяем тип контента
    const contentType = request.headers['content-type'] || '';

    let fields = {};
    let file = null;

    if (contentType.includes('multipart/form-data')) {
      // Парсинг multipart
      const parts = request.parts();
      for await (const part of parts) {
        if (part.file) {
          file = {
            filename: part.filename,
            mimetype: part.mimetype,
            buffer: await part.toBuffer()
          };
        } else {
          fields[part.fieldname] = part.value;
        }
      }
    } else {
      // JSON body
      fields = request.body || {};
    }

    const { employee_id, type_id, doc_number, issuer, issue_date, expiry_date, notes } = fields;

    if (!employee_id) return reply.code(400).send({ error: 'Укажите сотрудника' });
    if (!type_id) return reply.code(400).send({ error: 'Укажите тип допуска' });

    // Сохранить скан если есть
    let scanFile = null;
    let scanOrigName = null;
    if (file) {
      const ext = path.extname(file.filename) || '';
      scanFile = `permit_${uuidv4()}${ext}`;
      await fs.mkdir(uploadDir, { recursive: true });
      await fs.writeFile(path.join(uploadDir, scanFile), file.buffer);
      scanOrigName = file.filename;
    }

    // Получить категорию из справочника
    const { rows: [pt] } = await db.query('SELECT category FROM permit_types WHERE id = $1', [type_id]);

    const result = await db.query(`
      INSERT INTO employee_permits
        (employee_id, type_id, category, doc_number, issuer, issue_date, expiry_date,
         scan_file, scan_original_name, notes, is_active, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, NOW(), NOW())
      RETURNING *
    `, [
      employee_id, type_id, pt?.category || null,
      doc_number || null, issuer || null,
      issue_date || null, expiry_date || null,
      scanFile, scanOrigName,
      notes || null, request.user.id
    ]);

    return { permit: result.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // PUT /api/permits/:id — Обновить допуск
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/:id', {
    preHandler: [fastify.requirePermission('permits', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { type_id, doc_number, issuer, issue_date, expiry_date, notes, file_url } = request.body || {};

    const updates = [];
    const values = [];
    let idx = 1;

    if (type_id !== undefined) { updates.push(`type_id = $${idx}`); values.push(type_id); idx++; }
    if (doc_number !== undefined) { updates.push(`doc_number = $${idx}`); values.push(doc_number); idx++; }
    if (issuer !== undefined) { updates.push(`issuer = $${idx}`); values.push(issuer); idx++; }
    if (issue_date !== undefined) { updates.push(`issue_date = $${idx}`); values.push(issue_date || null); idx++; }
    if (expiry_date !== undefined) {
      updates.push(`expiry_date = $${idx}`); values.push(expiry_date || null); idx++;
      // Сбросить флаги уведомлений при изменении даты
      updates.push('notify_30_sent = false', 'notify_14_sent = false', 'notify_expired_sent = false');
    }
    if (notes !== undefined) { updates.push(`notes = $${idx}`); values.push(notes); idx++; }
    if (file_url !== undefined) { updates.push(`file_url = $${idx}`); values.push(file_url); idx++; }

    if (updates.length === 0) return reply.code(400).send({ error: 'Нет данных' });

    updates.push('updated_at = NOW()');
    values.push(id);

    const result = await db.query(
      `UPDATE employee_permits SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });

    return { permit: result.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /api/permits/:id/scan — Загрузить/заменить скан допуска
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/:id/scan', {
    preHandler: [fastify.requirePermission('permits', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { rows: [permit] } = await db.query('SELECT * FROM employee_permits WHERE id = $1', [id]);
    if (!permit) return reply.code(404).send({ error: 'Допуск не найден' });

    const parts = request.parts();
    let file = null;
    for await (const part of parts) {
      if (part.file) {
        file = { filename: part.filename, buffer: await part.toBuffer() };
      }
    }
    if (!file) return reply.code(400).send({ error: 'Файл не передан' });

    // Удалить старый скан
    if (permit.scan_file) {
      try { await fs.unlink(path.join(uploadDir, permit.scan_file)); } catch(e) { /* ignore */ }
    }

    const ext = path.extname(file.filename) || '';
    const scanFile = `permit_${uuidv4()}${ext}`;
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, scanFile), file.buffer);

    await db.query(
      'UPDATE employee_permits SET scan_file = $1, scan_original_name = $2, updated_at = NOW() WHERE id = $3',
      [scanFile, file.filename, id]
    );

    return { success: true, scan_file: scanFile, download_url: `/api/files/download/${scanFile}` };
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /api/permits/:id/renew — Продлить допуск (создаёт новый на основе старого)
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/:id/renew', {
    preHandler: [fastify.requirePermission('permits', 'write')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { issue_date, expiry_date, doc_number, issuer } = request.body || {};

    const { rows: [old] } = await db.query('SELECT * FROM employee_permits WHERE id = $1', [id]);
    if (!old) return reply.code(404).send({ error: 'Допуск не найден' });

    if (!expiry_date) return reply.code(400).send({ error: 'Укажите новую дату окончания' });

    // Деактивировать старый
    await db.query('UPDATE employee_permits SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);

    // Создать новый
    const result = await db.query(`
      INSERT INTO employee_permits
        (employee_id, type_id, category, doc_number, issuer, issue_date, expiry_date,
         notes, is_active, created_by, renewal_of, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, NOW(), NOW())
      RETURNING *
    `, [
      old.employee_id, old.type_id, old.category,
      doc_number || old.doc_number, issuer || old.issuer,
      issue_date || new Date().toISOString().slice(0, 10),
      expiry_date,
      old.notes,
      request.user.id, id
    ]);

    return { permit: result.rows[0], old_id: id };
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /api/permits/bulk-renew — Массовое продление
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/bulk-renew', {
    preHandler: [fastify.requirePermission('permits_admin', 'write')]
  }, async (request, reply) => {
    const { permit_ids, issue_date, expiry_date } = request.body || {};
    if (!Array.isArray(permit_ids) || permit_ids.length === 0) {
      return reply.code(400).send({ error: 'Укажите permit_ids (массив)' });
    }
    if (!expiry_date) return reply.code(400).send({ error: 'Укажите новую дату' });

    let renewed = 0;
    for (const pid of permit_ids) {
      const { rows: [old] } = await db.query('SELECT * FROM employee_permits WHERE id = $1 AND is_active = true', [pid]);
      if (!old) continue;

      await db.query('UPDATE employee_permits SET is_active = false, updated_at = NOW() WHERE id = $1', [pid]);

      await db.query(`
        INSERT INTO employee_permits
          (employee_id, type_id, category, doc_number, issuer, issue_date, expiry_date,
           notes, is_active, created_by, renewal_of, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, NOW(), NOW())
      `, [
        old.employee_id, old.type_id, old.category,
        old.doc_number, old.issuer,
        issue_date || new Date().toISOString().slice(0, 10),
        expiry_date, old.notes, request.user.id, pid
      ]);
      renewed++;
    }

    return { renewed, total: permit_ids.length };
  });

  // ═══════════════════════════════════════════════════════════════
  // DELETE /api/permits/:id — Удалить (деактивировать) допуск
  // ═══════════════════════════════════════════════════════════════
  fastify.delete('/:id', {
    preHandler: [fastify.requirePermission('permits', 'delete')]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const result = await db.query(
      'UPDATE employee_permits SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { success: true };
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║             ТРЕБОВАНИЯ ПРОЕКТОВ                              ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // GET /api/permits/work/:workId/requirements — Требования проекта
  fastify.get('/work/:workId/requirements', {
    preHandler: [fastify.requirePermission('permits', 'read')]
  }, async (request, reply) => {
    const workId = parseInt(request.params.workId);
    if (isNaN(workId)) return reply.code(400).send({ error: 'Invalid workId' });

    const { rows } = await db.query(`
      SELECT wpr.*, pt.name as type_name, pt.category
      FROM work_permit_requirements wpr
      JOIN permit_types pt ON wpr.permit_type_id = pt.id
      WHERE wpr.work_id = $1 ORDER BY pt.sort_order
    `, [workId]);
    return { requirements: rows };
  });

  // POST /api/permits/work/:workId/requirements — Добавить требование
  fastify.post('/work/:workId/requirements', {
    preHandler: [fastify.requirePermission('permits', 'write')]
  }, async (request, reply) => {
    const workId = parseInt(request.params.workId);
    if (isNaN(workId)) return reply.code(400).send({ error: 'Invalid workId' });

    const { permit_type_id, is_mandatory, notes } = request.body || {};
    if (!permit_type_id) return reply.code(400).send({ error: 'Укажите permit_type_id' });

    const result = await db.query(`
      INSERT INTO work_permit_requirements (work_id, permit_type_id, is_mandatory, notes, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT DO NOTHING RETURNING *
    `, [workId, permit_type_id, is_mandatory !== false, notes || null]);

    return { requirement: result.rows[0] };
  });

  // DELETE /api/permits/work/:workId/requirements/:id — Удалить требование
  fastify.delete('/work/:workId/requirements/:id', {
    preHandler: [fastify.requirePermission('permits', 'write')]
  }, async (request, reply) => {
    const workId = parseInt(request.params.workId);
    const reqId = parseInt(request.params.id);
    if (isNaN(workId) || isNaN(reqId)) return reply.code(400).send({ error: 'Invalid params' });

    const result = await db.query(
      'DELETE FROM work_permit_requirements WHERE id = $1 AND work_id = $2 RETURNING id',
      [reqId, workId]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { success: true };
  });

  // GET /api/permits/work/:workId/compliance — Проверка готовности команды проекта
  fastify.get('/work/:workId/compliance', {
    preHandler: [fastify.requirePermission('permits', 'read')]
  }, async (request, reply) => {
    const workId = parseInt(request.params.workId);
    if (isNaN(workId)) return reply.code(400).send({ error: 'Invalid workId' });

    // Требования проекта
    const { rows: requirements } = await db.query(
      'SELECT permit_type_id, is_mandatory FROM work_permit_requirements WHERE work_id = $1',
      [workId]
    );

    // Назначенные сотрудники (через employee_assignments или work.team JSONB)
    const { rows: assignments } = await db.query(`
      SELECT ea.employee_id, e.fio as employee_name
      FROM employee_assignments ea
      JOIN employees e ON ea.employee_id = e.id
      WHERE ea.work_id = $1
    `, [workId]);

    // Если нет таблицы employee_assignments, пробуем через team field
    let employeeIds = assignments.map(a => a.employee_id);
    let employeeMap = {};
    assignments.forEach(a => { employeeMap[a.employee_id] = a.employee_name; });

    // Fallback: если нет assignments, получим из works.team
    if (employeeIds.length === 0) {
      const { rows: [work] } = await db.query('SELECT team FROM works WHERE id = $1', [workId]);
      if (work?.team && Array.isArray(work.team)) {
        employeeIds = work.team.map(t => t.employee_id || t.id).filter(Boolean);
        work.team.forEach(t => {
          if (t.employee_id || t.id) employeeMap[t.employee_id || t.id] = t.fio || t.name || 'Unknown';
        });
      }
    }

    // Действующие допуски назначенных
    let permitsMap = {};
    if (employeeIds.length > 0) {
      const { rows: permits } = await db.query(`
        SELECT employee_id, type_id, expiry_date
        FROM employee_permits
        WHERE employee_id = ANY($1)
          AND is_active = true
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
      `, [employeeIds]);
      permits.forEach(p => {
        const key = `${p.employee_id}_${p.type_id}`;
        permitsMap[key] = p;
      });
    }

    // Проверка
    const compliance = employeeIds.map(empId => {
      const checks = requirements.map(req => {
        const key = `${empId}_${req.permit_type_id}`;
        const has = !!permitsMap[key];
        return { type_id: req.permit_type_id, mandatory: req.is_mandatory, has };
      });
      const mandatoryOk = checks.filter(c => c.mandatory).every(c => c.has);
      const allOk = checks.every(c => c.has);
      return {
        employee_id: empId,
        employee_name: employeeMap[empId] || 'ID:' + empId,
        checks,
        mandatory_ok: mandatoryOk,
        all_ok: allOk
      };
    });

    const teamReady = compliance.length === 0 || compliance.every(c => c.mandatory_ok);

    return { compliance, team_ready: teamReady, requirements_count: requirements.length };
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║             ПРОВЕРКА УВЕДОМЛЕНИЙ                             ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // GET /api/permits/check-expiry — Проверить и отправить уведомления
  // Вызывается периодически (со страницы или cron)
  fastify.get('/check-expiry', {
    preHandler: [fastify.authenticate]
  }, async () => {
    // Допуски, истекающие через 30 дней (ещё не уведомлённые)
    const { rows: expiring30 } = await db.query(`
      SELECT ep.*, e.fio as employee_name, pt.name as type_name
      FROM employee_permits ep
      JOIN employees e ON ep.employee_id = e.id
      LEFT JOIN permit_types pt ON ep.type_id = pt.id
      WHERE ep.is_active = true
        AND ep.notify_30_sent = false
        AND ep.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
    `);

    // Допуски, истекающие через 14 дней
    const { rows: expiring14 } = await db.query(`
      SELECT ep.*, e.fio as employee_name, pt.name as type_name
      FROM employee_permits ep
      JOIN employees e ON ep.employee_id = e.id
      LEFT JOIN permit_types pt ON ep.type_id = pt.id
      WHERE ep.is_active = true
        AND ep.notify_14_sent = false
        AND ep.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
    `);

    // Уже истёкшие (не уведомлённые)
    const { rows: expired } = await db.query(`
      SELECT ep.*, e.fio as employee_name, pt.name as type_name
      FROM employee_permits ep
      JOIN employees e ON ep.employee_id = e.id
      LEFT JOIN permit_types pt ON ep.type_id = pt.id
      WHERE ep.is_active = true
        AND ep.notify_expired_sent = false
        AND ep.expiry_date < CURRENT_DATE
    `);

    // Кому отправлять: HR и TO
    const { rows: recipients } = await db.query(
      "SELECT id FROM users WHERE is_active = true AND role IN ('HR', 'TO', 'ADMIN')"
    );

    let sent = 0;

    for (const p of expiring30) {
      const daysLeft = Math.ceil((new Date(p.expiry_date) - Date.now()) / 86400000);
      for (const r of recipients) {
        await notify(r.id, 'Допуск истекает (30 дн.)',
          `${p.employee_name}: "${p.type_name || p.type_id}" истекает через ${daysLeft} дн. (${new Date(p.expiry_date).toLocaleDateString('ru-RU')})`,
          '#/permits'
        );
        sent++;
      }
      await db.query('UPDATE employee_permits SET notify_30_sent = true WHERE id = $1', [p.id]);
    }

    for (const p of expiring14) {
      const daysLeft = Math.ceil((new Date(p.expiry_date) - Date.now()) / 86400000);
      for (const r of recipients) {
        await notify(r.id, 'Допуск истекает (14 дн.)',
          `${p.employee_name}: "${p.type_name || p.type_id}" истекает через ${daysLeft} дн. (${new Date(p.expiry_date).toLocaleDateString('ru-RU')})`,
          '#/permits'
        );
        sent++;
      }
      await db.query('UPDATE employee_permits SET notify_14_sent = true WHERE id = $1', [p.id]);
    }

    for (const p of expired) {
      for (const r of recipients) {
        await notify(r.id, 'Допуск ИСТЁК',
          `${p.employee_name}: "${p.type_name || p.type_id}" истёк ${new Date(p.expiry_date).toLocaleDateString('ru-RU')}. Требуется продление!`,
          '#/permits'
        );
        sent++;
      }
      await db.query('UPDATE employee_permits SET notify_expired_sent = true WHERE id = $1', [p.id]);
    }

    return { checked: { expiring30: expiring30.length, expiring14: expiring14.length, expired: expired.length }, sent };
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║             УПРАВЛЕНИЕ СПРАВОЧНИКОМ                          ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // POST /api/permits/types — Добавить тип допуска
  fastify.post('/types', {
    preHandler: [fastify.requirePermission('permits_admin', 'write')]
  }, async (request, reply) => {
    const { id, name, category, validity_months, sort_order } = request.body || {};
    if (!id || !name || !category) return reply.code(400).send({ error: 'id, name, category обязательны' });

    const result = await db.query(`
      INSERT INTO permit_types (id, name, category, validity_months, sort_order, is_active)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (id) DO UPDATE SET name = $2, category = $3, validity_months = $4, sort_order = $5
      RETURNING *
    `, [id, name, category, validity_months || null, sort_order || 0]);

    return { type: result.rows[0] };
  });

  // PUT /api/permits/types/:id — Обновить тип допуска
  fastify.put('/types/:id', {
    preHandler: [fastify.requirePermission('permits_admin', 'write')]
  }, async (request, reply) => {
    const typeId = request.params.id;
    const { name, category, validity_months, sort_order, is_active } = request.body || {};

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx}`); values.push(name); idx++; }
    if (category !== undefined) { updates.push(`category = $${idx}`); values.push(category); idx++; }
    if (validity_months !== undefined) { updates.push(`validity_months = $${idx}`); values.push(validity_months); idx++; }
    if (sort_order !== undefined) { updates.push(`sort_order = $${idx}`); values.push(sort_order); idx++; }
    if (is_active !== undefined) { updates.push(`is_active = $${idx}`); values.push(is_active); idx++; }

    if (updates.length === 0) return reply.code(400).send({ error: 'Нет данных' });

    values.push(typeId);
    const result = await db.query(
      `UPDATE permit_types SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Тип не найден' });

    return { type: result.rows[0] };
  });
};
