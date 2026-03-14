'use strict';

/**
 * ASGARD CRM — Заявки на обучение
 *
 * GET    /              — Список заявок
 * GET    /:id           — Детали
 * POST   /              — Создать
 * PUT    /:id           — Обновить (черновик)
 * PUT    /:id/status    — Сменить статус (workflow)
 * DELETE /:id           — Удалить черновик
 */

async function routes(fastify, options) {
  const db = fastify.db;
  let createNotification;
  try { createNotification = require('../services/notify').createNotification; } catch(e) { createNotification = () => {}; }

  const DIRECTOR_ROLES = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

  function isDirector(role) {
    return DIRECTOR_ROLES.includes(role);
  }

  // Видимость заявок по ролям:
  // ADMIN, HR, HR_MANAGER, BUH, Директора — все заявки
  // HEAD_PM — свои + PM
  // HEAD_TO — свои + TO
  // Остальные — только свои
  function visibilityClause(user) {
    const role = user.role;
    if (role === 'ADMIN' || role === 'HR' || role === 'HR_MANAGER' || role === 'BUH' || isDirector(role)) {
      return { where: '', params: [] };
    }
    if (role === 'HEAD_PM') {
      return {
        where: " AND (ta.user_id = $IDX OR ta.user_id IN (SELECT id FROM users WHERE role IN ('PM') AND is_active = true))",
        params: [user.id]
      };
    }
    if (role === 'HEAD_TO') {
      return {
        where: " AND (ta.user_id = $IDX OR ta.user_id IN (SELECT id FROM users WHERE role IN ('TO') AND is_active = true))",
        params: [user.id]
      };
    }
    return { where: ' AND ta.user_id = $IDX', params: [user.id] };
  }

  // ═══════════════════════════════════════════════════════════════
  // GET / — Список заявок
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { status, limit = 100, offset = 0 } = request.query;
    const vis = visibilityClause(request.user);

    let sql = [
      'SELECT ta.*, u.name as user_name, u.role as user_role,',
      '       h.name as head_name, d.name as dir_name,',
      '       b.name as buh_name, hr2.name as hr_name,',
      '       rej.name as rejector_name',
      'FROM training_applications ta',
      'LEFT JOIN users u ON ta.user_id = u.id',
      'LEFT JOIN users h ON ta.approved_by_head = h.id',
      'LEFT JOIN users d ON ta.approved_by_dir = d.id',
      'LEFT JOIN users b ON ta.paid_by_buh = b.id',
      'LEFT JOIN users hr2 ON ta.completed_by_hr = hr2.id',
      'LEFT JOIN users rej ON ta.rejected_by = rej.id',
      'WHERE 1=1'
    ].join('\n');
    const params = [];
    let idx = 1;

    if (vis.params.length) {
      params.push(...vis.params);
      sql += vis.where.replace('$IDX', '$' + idx);
      idx += vis.params.length;
    } else {
      sql += vis.where;
    }

    if (status) {
      sql += ' AND ta.status = $' + idx++;
      params.push(status);
    }

    sql += ' ORDER BY ta.id DESC LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(Math.min(parseInt(limit), 200), parseInt(offset));

    const { rows } = await db.query(sql, params);
    var countSql = 'SELECT COUNT(*) as total FROM training_applications ta WHERE 1=1' +
      (vis.params.length ? vis.where.replace('$IDX', '$1') : vis.where);
    const countRes = await db.query(countSql, vis.params);

    return { applications: rows, total: parseInt(countRes.rows[0].total) };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /:id — Детали
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows } = await db.query([
      'SELECT ta.*, u.name as user_name, u.role as user_role,',
      '       h.name as head_name, d.name as dir_name,',
      '       b.name as buh_name, hr2.name as hr_name,',
      '       rej.name as rejector_name',
      'FROM training_applications ta',
      'LEFT JOIN users u ON ta.user_id = u.id',
      'LEFT JOIN users h ON ta.approved_by_head = h.id',
      'LEFT JOIN users d ON ta.approved_by_dir = d.id',
      'LEFT JOIN users b ON ta.paid_by_buh = b.id',
      'LEFT JOIN users hr2 ON ta.completed_by_hr = hr2.id',
      'LEFT JOIN users rej ON ta.rejected_by = rej.id',
      'WHERE ta.id = $1'
    ].join('\n'), [request.params.id]);

    if (!rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // POST / — Создать
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { course_name, provider, training_type, date_start, date_end, cost, justification, comment } = request.body;

    if (!course_name || !course_name.trim()) {
      return reply.code(400).send({ error: 'Укажите название курса/обучения' });
    }

    const { rows } = await db.query([
      'INSERT INTO training_applications',
      '  (user_id, course_name, provider, training_type, date_start, date_end, cost, justification, comment, status)',
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')",
      'RETURNING *'
    ].join('\n'), [
      request.user.id,
      course_name.trim(),
      provider || null,
      training_type || 'external',
      date_start || null,
      date_end || null,
      cost || 0,
      justification || null,
      comment || null
    ]);

    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // PUT /:id — Обновить (только черновик)
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const check = await db.query('SELECT * FROM training_applications WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    const app = check.rows[0];

    if (app.user_id !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Нет прав на редактирование' });
    }
    if (app.status !== 'draft') {
      return reply.code(400).send({ error: 'Редактировать можно только черновик' });
    }

    const allowed = ['course_name', 'provider', 'training_type', 'date_start', 'date_end', 'cost', 'justification', 'comment'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (request.body[key] !== undefined) {
        updates.push(key + ' = $' + idx++);
        values.push(request.body[key]);
      }
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных для обновления' });

    updates.push('updated_at = NOW()');
    values.push(id);

    const { rows } = await db.query(
      'UPDATE training_applications SET ' + updates.join(', ') + ' WHERE id = $' + idx + ' RETURNING *',
      values
    );

    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // DELETE /:id — Удалить черновик
  // ═══════════════════════════════════════════════════════════════
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { rows } = await db.query(
      "DELETE FROM training_applications WHERE id = $1 AND status = 'draft' RETURNING id",
      [request.params.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Заявка не найдена или не является черновиком' });
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // PUT /:id/status — Workflow transitions
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/:id/status', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { action, reject_reason } = request.body;
    const user = request.user;

    const check = await db.query([
      'SELECT ta.*, u.name as user_name',
      'FROM training_applications ta',
      'LEFT JOIN users u ON ta.user_id = u.id',
      'WHERE ta.id = $1'
    ].join('\n'), [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'Заявка не найдена' });
    const app = check.rows[0];

    var sql, params;

    switch (action) {
      case 'submit': {
        if (app.status !== 'draft') return reply.code(400).send({ error: 'Подать можно только черновик' });
        if (app.user_id !== user.id && user.role !== 'ADMIN') {
          return reply.code(403).send({ error: 'Подать заявку может только автор' });
        }
        sql = "UPDATE training_applications SET status = 'pending_approval', updated_at = NOW() WHERE id = $1 RETURNING *";
        params = [id];
        var heads = await db.query(
          "SELECT id FROM users WHERE role IN ('HEAD_PM','HEAD_TO','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','ADMIN') AND is_active = true"
        );
        for (var h of heads.rows) {
          if (h.id !== user.id) {
            createNotification(db, {
              user_id: h.id,
              title: 'Заявка на обучение',
              message: (app.user_name || 'Сотрудник') + ' подал заявку на обучение: ' + app.course_name,
              type: 'training',
              link: '#/training?id=' + id
            });
          }
        }
        break;
      }
      case 'approve_head': {
        if (app.status !== 'pending_approval') return reply.code(400).send({ error: 'Заявка не на этапе согласования руководителем' });
        var canApproveHead = ['HEAD_PM', 'HEAD_TO', 'ADMIN'].concat(DIRECTOR_ROLES).indexOf(user.role) >= 0;
        if (!canApproveHead) return reply.code(403).send({ error: 'Нет прав на согласование' });
        sql = "UPDATE training_applications SET status = 'approved', approved_by_head = $2, approved_by_head_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *";
        params = [id, user.id];
        var dirs = await db.query(
          "SELECT id FROM users WHERE role IN ('DIRECTOR_GEN','ADMIN') AND is_active = true"
        );
        for (var d of dirs.rows) {
          if (d.id !== user.id) {
            createNotification(db, {
              user_id: d.id,
              title: 'Обучение: согласовано руководителем',
              message: 'Заявка на обучение "' + app.course_name + '" согласована, требуется утверждение бюджета',
              type: 'training',
              link: '#/training?id=' + id
            });
          }
        }
        break;
      }
      case 'approve_budget': {
        if (app.status !== 'approved') return reply.code(400).send({ error: 'Заявка не на этапе утверждения бюджета' });
        var canBudget = ['DIRECTOR_GEN', 'ADMIN'].indexOf(user.role) >= 0;
        if (!canBudget) return reply.code(403).send({ error: 'Утвердить бюджет может только генеральный директор' });
        sql = "UPDATE training_applications SET status = 'budget_approved', approved_by_dir = $2, approved_by_dir_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *";
        params = [id, user.id];
        var buhs = await db.query(
          "SELECT id FROM users WHERE role IN ('BUH','ADMIN') AND is_active = true"
        );
        for (var b of buhs.rows) {
          if (b.id !== user.id) {
            createNotification(db, {
              user_id: b.id,
              title: 'Обучение: бюджет утверждён',
              message: 'Заявка на обучение "' + app.course_name + '" — бюджет утверждён, требуется оплата',
              type: 'training',
              link: '#/training?id=' + id
            });
          }
        }
        break;
      }
      case 'confirm_payment': {
        if (app.status !== 'budget_approved') return reply.code(400).send({ error: 'Заявка не на этапе оплаты' });
        var canPay = ['BUH', 'ADMIN'].indexOf(user.role) >= 0;
        if (!canPay) return reply.code(403).send({ error: 'Подтвердить оплату может только бухгалтерия' });
        sql = "UPDATE training_applications SET status = 'paid', paid_by_buh = $2, paid_by_buh_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *";
        params = [id, user.id];
        var hrs = await db.query(
          "SELECT id FROM users WHERE role IN ('HR','HR_MANAGER','ADMIN') AND is_active = true"
        );
        for (var hr of hrs.rows) {
          if (hr.id !== user.id) {
            createNotification(db, {
              user_id: hr.id,
              title: 'Обучение: оплачено',
              message: 'Заявка на обучение "' + app.course_name + '" оплачена, ожидает завершения',
              type: 'training',
              link: '#/training?id=' + id
            });
          }
        }
        break;
      }
      case 'mark_completed': {
        if (app.status !== 'paid') return reply.code(400).send({ error: 'Заявка не на этапе завершения' });
        var canComplete = ['HR', 'HR_MANAGER', 'ADMIN'].indexOf(user.role) >= 0;
        if (!canComplete) return reply.code(403).send({ error: 'Завершить может только HR' });
        sql = "UPDATE training_applications SET status = 'completed', completed_by_hr = $2, completed_by_hr_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *";
        params = [id, user.id];
        if (app.user_id !== user.id) {
          createNotification(db, {
            user_id: app.user_id,
            title: 'Обучение завершено',
            message: 'Ваша заявка на обучение "' + app.course_name + '" завершена',
            type: 'training',
            link: '#/training?id=' + id
          });
        }
        break;
      }
      case 'reject': {
        var rejectableStatuses = ['pending_approval', 'approved', 'budget_approved'];
        if (rejectableStatuses.indexOf(app.status) < 0) {
          return reply.code(400).send({ error: 'Заявку нельзя отклонить на текущем этапе' });
        }
        var canReject = user.role === 'ADMIN';
        if (app.status === 'pending_approval') canReject = canReject || ['HEAD_PM', 'HEAD_TO'].concat(DIRECTOR_ROLES).indexOf(user.role) >= 0;
        if (app.status === 'approved') canReject = canReject || user.role === 'DIRECTOR_GEN';
        if (app.status === 'budget_approved') canReject = canReject || user.role === 'BUH';
        if (!canReject) return reply.code(403).send({ error: 'Нет прав на отклонение' });
        sql = "UPDATE training_applications SET status = 'rejected', rejected_by = $2, rejected_at = NOW(), reject_reason = $3, updated_at = NOW() WHERE id = $1 RETURNING *";
        params = [id, user.id, reject_reason || null];
        if (app.user_id !== user.id) {
          createNotification(db, {
            user_id: app.user_id,
            title: 'Заявка на обучение отклонена',
            message: 'Ваша заявка "' + app.course_name + '" отклонена' + (reject_reason ? ': ' + reject_reason : ''),
            type: 'training',
            link: '#/training?id=' + id
          });
        }
        break;
      }
      default:
        return reply.code(400).send({ error: 'Неизвестное действие: ' + action });
    }

    const { rows } = await db.query(sql, params);
    return { item: rows[0] };
  });
}

module.exports = routes;
