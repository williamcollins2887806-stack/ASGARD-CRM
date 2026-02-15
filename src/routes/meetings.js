'use strict';

/**
 * ASGARD CRM — Совещания (M5)
 *
 * Функционал:
 * - Планирование совещаний
 * - Приглашение участников (RSVP)
 * - Повестка и протокол
 * - Создание задач из протокола
 * - Напоминания
 */

module.exports = async function(fastify) {
  const db = fastify.db;

  const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Уведомление
  // ═══════════════════════════════════════════════════════════════
  async function notify(userId, title, message, link) {
    try {
      await db.query(`
        INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
        VALUES ($1, $2, $3, 'meeting', $4, false, NOW())
      `, [userId, title, message, link || '#/meetings']);

      try {
        const telegram = require('../services/telegram');
        if (telegram && telegram.sendNotification) {
          await telegram.sendNotification(userId, `📅 *${title}*\n\n${message}`);
        }
      } catch (e) {}
    } catch (e) {
      fastify.log.error('Meeting notification error:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Проверка доступа к совещанию
  // ═══════════════════════════════════════════════════════════════
  async function canAccessMeeting(meetingId, userId, userRole) {
    // Директора видят всё
    if (DIRECTOR_ROLES.includes(userRole)) return true;

    // Организатор или участник
    const { rows } = await db.query(`
      SELECT 1 FROM meetings WHERE id = $1 AND organizer_id = $2
      UNION
      SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2
    `, [meetingId, userId]);

    return rows.length > 0;
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║                    СОВЕЩАНИЯ                                 ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // ───────────────────────────────────────────────────────────────
  // GET /api/meetings — Список совещаний
  // ───────────────────────────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;
    const { status, from_date, to_date, limit = 50, offset = 0, my_only = 'false' } = request.query;

    let sql = `
      SELECT DISTINCT m.*, u.name as organizer_name,
        (SELECT COUNT(*) FROM meeting_participants WHERE meeting_id = m.id) as participant_count,
        (SELECT rsvp_status FROM meeting_participants WHERE meeting_id = m.id AND user_id = $1) as my_rsvp
      FROM meetings m
      JOIN users u ON m.organizer_id = u.id
      LEFT JOIN meeting_participants mp ON m.id = mp.meeting_id
      WHERE 1=1
    `;
    const params = [userId];
    let idx = 2;

    // Фильтр "только мои" — где я организатор или участник
    if (my_only === 'true') {
      sql += ` AND (m.organizer_id = $1 OR mp.user_id = $1)`;
    }

    if (status) {
      sql += ` AND m.status = $${idx}`;
      params.push(status);
      idx++;
    }

    if (from_date) {
      sql += ` AND m.start_time >= $${idx}`;
      params.push(from_date);
      idx++;
    }

    if (to_date) {
      sql += ` AND m.start_time <= $${idx}`;
      params.push(to_date);
      idx++;
    }

    sql += ` ORDER BY m.start_time ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await db.query(sql, params);
    return { meetings: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/meetings/upcoming — Ближайшие совещания (для виджета)
  // ───────────────────────────────────────────────────────────────
  fastify.get('/upcoming', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;
    const { limit = 5 } = request.query;

    const { rows } = await db.query(`
      SELECT DISTINCT m.*, u.name as organizer_name,
        (SELECT rsvp_status FROM meeting_participants WHERE meeting_id = m.id AND user_id = $1) as my_rsvp
      FROM meetings m
      JOIN users u ON m.organizer_id = u.id
      LEFT JOIN meeting_participants mp ON m.id = mp.meeting_id
      WHERE m.status IN ('scheduled', 'in_progress')
        AND m.start_time >= NOW()
        AND (m.organizer_id = $1 OR mp.user_id = $1)
      ORDER BY m.start_time ASC
      LIMIT $2
    `, [userId, parseInt(limit)]);

    return { meetings: rows };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/meetings/stats — Статистика (для виджета на главной)
  // ───────────────────────────────────────────────────────────────
  fastify.get('/stats', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;

    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(DISTINCT m.id) FILTER (WHERE m.start_time >= NOW() AND m.start_time < NOW() + INTERVAL '7 days' AND m.status = 'scheduled') as this_week,
        COUNT(DISTINCT m.id) FILTER (WHERE m.start_time::date = CURRENT_DATE AND m.status IN ('scheduled', 'in_progress')) as today,
        COUNT(DISTINCT m.id) FILTER (WHERE mp.rsvp_status = 'pending') as pending_rsvp
      FROM meetings m
      LEFT JOIN meeting_participants mp ON m.id = mp.meeting_id AND mp.user_id = $1
      WHERE m.organizer_id = $1 OR mp.user_id = $1
    `, [userId]);

    return stats;
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/meetings/:id — Детали совещания
  // ───────────────────────────────────────────────────────────────
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;

    if (!await canAccessMeeting(id, userId, request.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const { rows: [meeting] } = await db.query(`
      SELECT m.*, u.name as organizer_name, u.role as organizer_role,
        ma.name as minutes_author_name
      FROM meetings m
      JOIN users u ON m.organizer_id = u.id
      LEFT JOIN users ma ON m.minutes_author_id = ma.id
      WHERE m.id = $1
    `, [id]);

    if (!meeting) return reply.code(404).send({ error: 'Совещание не найдено' });

    // Получить участников
    const { rows: participants } = await db.query(`
      SELECT mp.*, u.name, u.role as user_role
      FROM meeting_participants mp
      JOIN users u ON mp.user_id = u.id
      WHERE mp.meeting_id = $1
      ORDER BY u.name
    `, [id]);

    // Получить пункты протокола
    const { rows: minutes } = await db.query(`
      SELECT mm.*, u.name as responsible_name, cb.name as created_by_name
      FROM meeting_minutes mm
      LEFT JOIN users u ON mm.responsible_user_id = u.id
      LEFT JOIN users cb ON mm.created_by = cb.id
      WHERE mm.meeting_id = $1
      ORDER BY mm.item_order
    `, [id]);

    return { meeting, participants, minutes };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/meetings — Создать совещание
  // ───────────────────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const {
      title, description, location, start_time, end_time,
      agenda, participant_ids, work_id, tender_id, notify_before_minutes
    } = request.body;

    if (!title || !title.trim()) {
      return reply.code(400).send({ error: 'Укажите название совещания' });
    }
    if (!start_time) {
      return reply.code(400).send({ error: 'Укажите время начала' });
    }

    const organizerId = request.user.id;

    // Создать совещание
    const { rows: [meeting] } = await db.query(`
      INSERT INTO meetings (
        organizer_id, title, description, location, start_time, end_time,
        agenda, work_id, tender_id, notify_before_minutes, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled', NOW(), NOW())
      RETURNING *
    `, [
      organizerId,
      title.trim(),
      description || null,
      location || null,
      start_time,
      end_time || null,
      agenda || null,
      work_id ? parseInt(work_id) : null,
      tender_id ? parseInt(tender_id) : null,
      notify_before_minutes || 15
    ]);

    // Добавить участников и отправить приглашения
    if (Array.isArray(participant_ids)) {
      const organizerName = request.user.name || request.user.login;
      const startTimeStr = new Date(start_time).toLocaleString('ru-RU');

      for (const pId of participant_ids) {
        if (pId !== organizerId) {
          await db.query(`
            INSERT INTO meeting_participants (meeting_id, user_id, rsvp_status, created_at)
            VALUES ($1, $2, 'pending', NOW())
            ON CONFLICT (meeting_id, user_id) DO NOTHING
          `, [meeting.id, parseInt(pId)]);

          await notify(
            parseInt(pId),
            '📅 Приглашение на совещание',
            `${organizerName} приглашает вас на совещание:\n«${title.trim()}»\n📍 ${location || 'Не указано'}\n🕐 ${startTimeStr}`,
            `#/meetings/${meeting.id}`
          );
        }
      }
    }

    return { meeting };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/meetings/:id — Обновить совещание
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;

    const { rows: [meeting] } = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
    if (!meeting) return reply.code(404).send({ error: 'Совещание не найдено' });

    // Только организатор или директор может редактировать
    if (meeting.organizer_id !== userId && !DIRECTOR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Только организатор может редактировать' });
    }

    const { title, description, location, start_time, end_time, agenda, status } = request.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) { updates.push(`title = $${idx}`); values.push(title.trim()); idx++; }
    if (description !== undefined) { updates.push(`description = $${idx}`); values.push(description); idx++; }
    if (location !== undefined) { updates.push(`location = $${idx}`); values.push(location); idx++; }
    if (start_time !== undefined) { updates.push(`start_time = $${idx}`); values.push(start_time); idx++; }
    if (end_time !== undefined) { updates.push(`end_time = $${idx}`); values.push(end_time); idx++; }
    if (agenda !== undefined) { updates.push(`agenda = $${idx}`); values.push(agenda); idx++; }
    if (status !== undefined && ['scheduled', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      updates.push(`status = $${idx}`); values.push(status); idx++;
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'Нет данных для обновления' });
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    await db.query(
      `UPDATE meetings SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    // Уведомить участников об изменениях
    if (start_time !== undefined || status === 'cancelled') {
      const { rows: participants } = await db.query(
        'SELECT user_id FROM meeting_participants WHERE meeting_id = $1',
        [id]
      );

      const msg = status === 'cancelled'
        ? `Совещание «${meeting.title}» отменено`
        : `Совещание «${meeting.title}» перенесено на ${new Date(start_time).toLocaleString('ru-RU')}`;

      for (const p of participants) {
        await notify(p.user_id, '📅 Изменение совещания', msg, `#/meetings/${id}`);
      }
    }

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/meetings/:id/participants — Добавить участника
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/participants', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;
    const { user_id } = request.body;

    const { rows: [meeting] } = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
    if (!meeting) return reply.code(404).send({ error: 'Совещание не найдено' });

    if (meeting.organizer_id !== userId && !DIRECTOR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Только организатор может добавлять участников' });
    }

    await db.query(`
      INSERT INTO meeting_participants (meeting_id, user_id, rsvp_status, created_at)
      VALUES ($1, $2, 'pending', NOW())
      ON CONFLICT (meeting_id, user_id) DO NOTHING
    `, [id, parseInt(user_id)]);

    // Уведомить
    await notify(
      parseInt(user_id),
      '📅 Приглашение на совещание',
      `Вас пригласили на совещание «${meeting.title}»\n🕐 ${new Date(meeting.start_time).toLocaleString('ru-RU')}`,
      `#/meetings/${id}`
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/meetings/:id/rsvp — RSVP (принять/отклонить)
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/rsvp', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;
    const { status, comment } = request.body;

    if (!['accepted', 'declined', 'tentative'].includes(status)) {
      return reply.code(400).send({ error: 'Статус: accepted, declined или tentative' });
    }

    const result = await db.query(`
      UPDATE meeting_participants
      SET rsvp_status = $1, rsvp_comment = $2
      WHERE meeting_id = $3 AND user_id = $4
      RETURNING *
    `, [status, comment || null, id, userId]);

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Вы не участник этого совещания' });
    }

    // Уведомить организатора
    const { rows: [meeting] } = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
    const statusText = { accepted: 'примет участие', declined: 'отказался', tentative: 'возможно примет участие' };
    await notify(
      meeting.organizer_id,
      '📅 RSVP',
      `${request.user.name || request.user.login} ${statusText[status]} в совещании «${meeting.title}»`,
      `#/meetings/${id}`
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/meetings/:id/attendance — Отметить присутствие
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/attendance', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;
    const { attendees } = request.body; // [{user_id, attended: true/false}]

    const { rows: [meeting] } = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
    if (!meeting) return reply.code(404).send({ error: 'Совещание не найдено' });

    if (meeting.organizer_id !== userId && !DIRECTOR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Только организатор' });
    }

    if (!Array.isArray(attendees)) {
      return reply.code(400).send({ error: 'attendees array required' });
    }

    for (const a of attendees) {
      await db.query(
        'UPDATE meeting_participants SET attended = $1 WHERE meeting_id = $2 AND user_id = $3',
        [a.attended === true, id, a.user_id]
      );
    }

    return { success: true };
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║                    ПРОТОКОЛ СОВЕЩАНИЯ                        ║
  // ╚═══════════════════════════════════════════════════════════════╝

  // ───────────────────────────────────────────────────────────────
  // POST /api/meetings/:id/minutes — Добавить пункт протокола
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:id/minutes', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;
    const { item_type, content, responsible_user_id, deadline } = request.body;

    if (!await canAccessMeeting(id, userId, request.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    if (!content || !content.trim()) {
      return reply.code(400).send({ error: 'Содержание обязательно' });
    }

    // Получить следующий порядок
    const { rows: [maxRow] } = await db.query(
      'SELECT COALESCE(MAX(item_order), 0) + 1 as next_order FROM meeting_minutes WHERE meeting_id = $1',
      [id]
    );

    const { rows: [item] } = await db.query(`
      INSERT INTO meeting_minutes (meeting_id, item_order, item_type, content, responsible_user_id, deadline, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `, [
      id,
      maxRow.next_order,
      item_type || 'note',
      content.trim(),
      responsible_user_id ? parseInt(responsible_user_id) : null,
      deadline || null,
      userId
    ]);

    return { item };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/meetings/:meetingId/minutes/:id — Обновить пункт
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:meetingId/minutes/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const meetingId = parseInt(request.params.meetingId);
    const itemId = parseInt(request.params.id);
    const userId = request.user.id;

    if (!await canAccessMeeting(meetingId, userId, request.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const { item_type, content, responsible_user_id, deadline } = request.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (item_type !== undefined) { updates.push(`item_type = $${idx}`); values.push(item_type); idx++; }
    if (content !== undefined) { updates.push(`content = $${idx}`); values.push(content.trim()); idx++; }
    if (responsible_user_id !== undefined) { updates.push(`responsible_user_id = $${idx}`); values.push(responsible_user_id ? parseInt(responsible_user_id) : null); idx++; }
    if (deadline !== undefined) { updates.push(`deadline = $${idx}`); values.push(deadline || null); idx++; }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'Нет данных' });
    }

    values.push(itemId, meetingId);
    await db.query(
      `UPDATE meeting_minutes SET ${updates.join(', ')} WHERE id = $${idx} AND meeting_id = $${idx + 1}`,
      values
    );

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/meetings/:meetingId/minutes/:id/create-task — Создать задачу из пункта
  // ───────────────────────────────────────────────────────────────
  fastify.post('/:meetingId/minutes/:id/create-task', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const meetingId = parseInt(request.params.meetingId);
    const itemId = parseInt(request.params.id);
    const userId = request.user.id;

    const { rows: [item] } = await db.query(
      'SELECT * FROM meeting_minutes WHERE id = $1 AND meeting_id = $2',
      [itemId, meetingId]
    );
    if (!item) return reply.code(404).send({ error: 'Пункт не найден' });

    if (!item.responsible_user_id) {
      return reply.code(400).send({ error: 'Укажите ответственного' });
    }

    // Получить совещание для контекста
    const { rows: [meeting] } = await db.query('SELECT title FROM meetings WHERE id = $1', [meetingId]);

    // Создать задачу
    const { rows: [task] } = await db.query(`
      INSERT INTO tasks (creator_id, assignee_id, title, description, deadline, priority, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'normal', 'new', NOW(), NOW())
      RETURNING *
    `, [
      userId,
      item.responsible_user_id,
      item.content.substring(0, 255),
      `Из протокола совещания «${meeting.title}»\n\n${item.content}`,
      item.deadline
    ]);

    // Связать задачу с пунктом протокола
    await db.query(
      'UPDATE meeting_minutes SET task_id = $1 WHERE id = $2',
      [task.id, itemId]
    );

    // Уведомить исполнителя
    await notify(
      item.responsible_user_id,
      '📋 Новая задача из совещания',
      `Вам назначена задача из совещания «${meeting.title}»:\n${item.content.substring(0, 100)}`,
      `#/tasks?id=${task.id}`
    );

    return { task };
  });

  // ───────────────────────────────────────────────────────────────
  // PUT /api/meetings/:id/finalize — Завершить и сохранить протокол
  // ───────────────────────────────────────────────────────────────
  fastify.put('/:id/finalize', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;
    const { minutes_text } = request.body;

    const { rows: [meeting] } = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
    if (!meeting) return reply.code(404).send({ error: 'Совещание не найдено' });

    if (meeting.organizer_id !== userId && !DIRECTOR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Только организатор' });
    }

    await db.query(`
      UPDATE meetings SET
        status = 'completed',
        minutes = $1,
        minutes_author_id = $2,
        minutes_approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
    `, [minutes_text || null, userId, id]);

    // Уведомить участников о завершении
    const { rows: participants } = await db.query(
      'SELECT user_id FROM meeting_participants WHERE meeting_id = $1',
      [id]
    );

    for (const p of participants) {
      await notify(
        p.user_id,
        '📅 Совещание завершено',
        `Протокол совещания «${meeting.title}» готов`,
        `#/meetings/${id}`
      );
    }

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // DELETE /api/meetings/:id — Удалить совещание
  // ───────────────────────────────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const userId = request.user.id;

    const { rows: [meeting] } = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
    if (!meeting) return reply.code(404).send({ error: 'Совещание не найдено' });

    if (meeting.organizer_id !== userId && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Только организатор или ADMIN' });
    }

    await db.query('DELETE FROM meeting_minutes WHERE meeting_id = $1', [id]);
    await db.query('DELETE FROM meeting_participants WHERE meeting_id = $1', [id]);
    await db.query('DELETE FROM meetings WHERE id = $1', [id]);

    return { success: true };
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/meetings/check-reminders — Проверка напоминаний (cron)
  // ───────────────────────────────────────────────────────────────
  fastify.get('/check-reminders', {
    preHandler: [fastify.authenticate]
  }, async () => {
    // Найти совещания, которые начнутся в ближайшие N минут
    const { rows: upcoming } = await db.query(`
      SELECT m.*, mp.user_id as participant_id
      FROM meetings m
      JOIN meeting_participants mp ON m.id = mp.meeting_id
      WHERE m.status = 'scheduled'
        AND m.start_time > NOW()
        AND m.start_time <= NOW() + (m.notify_before_minutes || ' minutes')::interval
        AND mp.reminder_sent_at IS NULL
    `);

    for (const row of upcoming) {
      await notify(
        row.participant_id,
        '⏰ Напоминание о совещании',
        `Совещание «${row.title}» начнётся в ${new Date(row.start_time).toLocaleTimeString('ru-RU')}`,
        `#/meetings/${row.id}`
      );

      await db.query(
        'UPDATE meeting_participants SET reminder_sent_at = NOW() WHERE meeting_id = $1 AND user_id = $2',
        [row.id, row.participant_id]
      );
    }

    return { reminded: upcoming.length };
  });
};
