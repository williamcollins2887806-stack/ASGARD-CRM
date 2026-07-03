'use strict';

const correspondenceService = require('../services/correspondence');

const CORRESPONDENCE_ROLES = [
  'ADMIN',
  'DIRECTOR_GEN',
  'DIRECTOR_COMM',
  'DIRECTOR_DEV',
  'OFFICE_MANAGER',
  'PM',
  'HEAD_PM',
  'TO',
  'HEAD_TO'
];
// S-7: для DELETE и /relink — отдельный whitelist (см. §5).
const DELETE_ROLES = ['ADMIN', 'DIRECTOR_GEN'];
const RELINK_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'];

function hasAccess(user) {
  return !!user && CORRESPONDENCE_ROLES.includes(user.role);
}
function hasDeleteAccess(user) {
  return !!user && DELETE_ROLES.includes(user.role);
}
function hasRelinkAccess(user) {
  return !!user && RELINK_ROLES.includes(user.role);
}

module.exports = async function correspondenceRoutes(fastify) {
  const db = fastify.db;

  fastify.get('/next-outgoing-number', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }

    try {
      return await correspondenceService.getNextOutgoingNumberPreview(db, {
        date: request.query?.date
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Correspondence preview error');
      return reply.code(500).send({ error: 'Не удалось получить номер' });
    }
  });

  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }

    try {
      const result = await correspondenceService.createCorrespondence(db, request.body || {}, {
        userId: request.user.id
      });
      return {
        success: true,
        id: result.item.id,
        item: result.item,
        correspondence: result.item.number
          ? { id: result.item.id, number: result.item.number }
          : null
      };
    } catch (error) {
      if (error.statusCode) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      fastify.log.error({ err: error }, 'Correspondence create error');
      return reply.code(500).send({ error: 'Не удалось создать корреспонденцию' });
    }
  });

  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }

    try {
      const result = await correspondenceService.updateCorrespondence(db, request.params.id, request.body || {});
      return {
        success: true,
        item: result.item
      };
    } catch (error) {
      if (error.statusCode) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      fastify.log.error({ err: error }, 'Correspondence update error');
      return reply.code(500).send({ error: 'Не удалось обновить корреспонденцию' });
    }
  });

  // POST /:id/link-doc — привязать загруженный документ к корреспонденции
  fastify.post('/:id/link-doc', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const corrId = parseInt(request.params.id);
    const { document_id } = request.body || {};
    if (!document_id) return reply.code(400).send({ error: 'document_id обязателен' });

    await db.query(
      'UPDATE documents SET correspondence_id = $1 WHERE id = $2',
      [corrId, parseInt(document_id)]
    );
    return { success: true };
  });

  // ────────────────────────────────────────────────────────────────────
  // S-7 (Stage 2.4) additions
  // ────────────────────────────────────────────────────────────────────

  // GET /api/correspondence/by-parent — список писем по родительской сущности
  fastify.get('/by-parent', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!hasAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }
    const q = request.query || {};
    try {
      const result = await correspondenceService.listCorrespondenceByParent(db, {
        parent_type:     q.parent_entity_type || q.parent_type,
        parent_id:       q.parent_entity_id   || q.parent_id,
        direction:       q.direction,
        signing_status:  q.signing_status,
        only_current:    q.only_current !== '0' && q.only_current !== 'false',
        limit:           q.limit,
        offset:          q.offset,
        user:            { id: request.user.id, role: request.user.role }
      });
      return result;
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      fastify.log.error({ err }, 'correspondence/by-parent error');
      return reply.code(500).send({ error: 'Не удалось получить список корреспонденции' });
    }
  });

  // POST /api/correspondence/auto-context — пред-заполнить поля Composer'а
  // из родительской сущности (тендер/работа/просчёт/pre_tender/заявка-закупка).
  // Без этого endpoint'а Composer висит на запросе (S-13H ожидал что он будет).
  fastify.post('/auto-context', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!hasAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }
    const { parent_entity_type, parent_entity_id } = request.body || {};
    if (!parent_entity_type || !parent_entity_id) {
      return reply.code(400).send({ error: 'parent_entity_type и parent_entity_id обязательны' });
    }
    const id = parseInt(parent_entity_id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'parent_entity_id должен быть положительным числом' });
    }
    try {
      let parent = null;
      let prefill = {};

      if (parent_entity_type === 'tender') {
        const r = await db.query(
          `SELECT id, tender_title, tender_number, customer_name, customer, customer_inn,
                  customer_email, tender_status, tender_type, responsible_pm_id,
                  calculator_user_id, tender_price
             FROM tenders WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
        parent = r.rows[0] || null;
        if (parent) {
          prefill = {
            counterparty: parent.customer_name || parent.customer || '',
            customer_inn: parent.customer_inn || '',
            customer_email: parent.customer_email || '',
            tender_id: parent.id,
            header_subline: parent.tender_title || '',
            procedure_number: parent.tender_number || String(parent.id)
          };
        }
      } else if (parent_entity_type === 'work') {
        const r = await db.query(
          `SELECT w.id, w.tender_id, w.work_status, w.work_number, w.start_plan, w.end_plan,
                  t.customer_name, t.customer, t.customer_inn, t.customer_email, t.tender_title, t.tender_number
             FROM works w
             LEFT JOIN tenders t ON t.id = w.tender_id
            WHERE w.id = $1 AND w.deleted_at IS NULL LIMIT 1`, [id]);
        parent = r.rows[0] || null;
        if (parent) {
          prefill = {
            counterparty: parent.customer_name || parent.customer || '',
            customer_inn: parent.customer_inn || '',
            customer_email: parent.customer_email || '',
            tender_id: parent.tender_id || null,
            work_id: parent.id,
            header_subline: parent.tender_title || '',
            procedure_number: parent.tender_number || (parent.tender_id ? String(parent.tender_id) : '')
          };
        }
      } else if (parent_entity_type === 'calc' || parent_entity_type === 'estimate') {
        const r = await db.query(
          `SELECT e.id, e.tender_id, t.customer_name, t.customer, t.customer_inn,
                  t.customer_email, t.tender_title, t.tender_number
             FROM estimates e
             LEFT JOIN tenders t ON t.id = e.tender_id
            WHERE e.id = $1 LIMIT 1`, [id]);
        parent = r.rows[0] || null;
        if (parent) {
          prefill = {
            counterparty: parent.customer_name || parent.customer || '',
            customer_inn: parent.customer_inn || '',
            customer_email: parent.customer_email || '',
            tender_id: parent.tender_id || null,
            header_subline: parent.tender_title || '',
            procedure_number: parent.tender_number || (parent.tender_id ? String(parent.tender_id) : '')
          };
        }
      } else if (parent_entity_type === 'pre_tender') {
        const r = await db.query(
          `SELECT id, customer_name, customer_inn, customer_email, work_description, status
             FROM pre_tender_requests WHERE id = $1 LIMIT 1`, [id]);
        parent = r.rows[0] || null;
        if (parent) {
          prefill = {
            counterparty: parent.customer_name || '',
            customer_inn: parent.customer_inn || '',
            customer_email: parent.customer_email || '',
            header_subline: (parent.work_description || '').slice(0, 200)
          };
        }
      } else if (parent_entity_type === 'request') {
        const r = await db.query(
          `SELECT pr.id, pr.work_id, pr.title, w.tender_id, t.customer_name, t.customer,
                  t.customer_inn, t.customer_email, t.tender_title
             FROM procurement_requests pr
             LEFT JOIN works w   ON w.id = pr.work_id
             LEFT JOIN tenders t ON t.id = w.tender_id
            WHERE pr.id = $1 LIMIT 1`, [id]);
        parent = r.rows[0] || null;
        if (parent) {
          prefill = {
            counterparty: parent.customer_name || parent.customer || '',
            customer_inn: parent.customer_inn || '',
            customer_email: parent.customer_email || '',
            tender_id: parent.tender_id || null,
            work_id: parent.work_id || null,
            header_subline: parent.title || parent.tender_title || ''
          };
        }
      } else {
        return reply.code(400).send({ error: 'Неизвестный parent_entity_type: ' + parent_entity_type });
      }

      if (!parent) {
        return reply.code(404).send({ error: 'Родительская сущность не найдена' });
      }
      return { success: true, parent_entity_type, parent_entity_id: id, parent, prefill };
    } catch (err) {
      fastify.log.error({ err }, 'correspondence/auto-context error');
      return reply.code(500).send({ error: 'Не удалось загрузить контекст: ' + err.message });
    }
  });

  // POST /api/correspondence/:id/finalize — alias на /api/letter/:id/finalize.
  // Удобство фронта: реестр писем может финализировать черновик inline.
  fastify.post('/:id/finalize', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!hasAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'Некорректный id' });
    }
    try {
      const existing = await correspondenceService.getCorrespondenceById(db, id);
      if (!existing) return reply.code(404).send({ error: 'Корреспонденция не найдена' });
      // Тот же канон проверки что в /api/letter/:id/finalize (автор + override-роли).
      const WRITE_OVERRIDE = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'];
      if (!WRITE_OVERRIDE.includes(request.user.role) && Number(existing.created_by) !== Number(request.user.id)) {
        return reply.code(403).send({ error: 'Финализировать может только автор, OFFICE_MANAGER или DIRECTOR_*' });
      }
      const result = await correspondenceService.finalizeCorrespondence(db, id, {
        userId: request.user.id
      });
      return { success: true, ...result };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      fastify.log.error({ err }, 'correspondence/finalize error');
      return reply.code(500).send({ error: 'Не удалось финализировать' });
    }
  });

  // POST /api/correspondence/:id/new-revision — alias на /api/letter/:id/new-revision.
  // Vanilla реестр писем зовёт именно этот путь (см. correspondence.js:openProtected
  // подход — фронт ходит через /api/correspondence). Без alias был 404.
  fastify.post('/:id/new-revision', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!hasAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'Некорректный id' });
    }
    try {
      const existing = await correspondenceService.getCorrespondenceById(db, id);
      if (!existing) return reply.code(404).send({ error: 'Корреспонденция не найдена' });
      const WRITE_OVERRIDE = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'];
      if (!WRITE_OVERRIDE.includes(request.user.role) && Number(existing.created_by) !== Number(request.user.id)) {
        return reply.code(403).send({ error: 'Создать редакцию может только автор, OFFICE_MANAGER или DIRECTOR_*' });
      }
      const result = await correspondenceService.createNewRevision(db, id, {
        userId: request.user.id,
        revision_note: request.body?.revision_note || null
      });
      return { success: true, ...result };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      fastify.log.error({ err }, 'correspondence/new-revision error');
      return reply.code(500).send({ error: 'Не удалось создать новую редакцию' });
    }
  });

  // POST /api/correspondence/:id/relink — перенаправить parent-ссылки.
  // Для исправления mis-match'а addendum_response. Только ADMIN/DIRECTOR_*/OFFICE_MANAGER.
  fastify.post('/:id/relink', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!hasRelinkAccess(request.user)) {
      return reply.code(403).send({ error: 'Relink доступен только ADMIN/DIRECTOR_*/OFFICE_MANAGER' });
    }
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'Некорректный id' });
    }
    try {
      const result = await correspondenceService.relinkCorrespondence(db, id, request.body || {});
      return { success: true, item: result };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      fastify.log.error({ err }, 'correspondence/relink error');
      return reply.code(500).send({ error: 'Не удалось переставить ссылки' });
    }
  });

  // DELETE /api/correspondence/:id — soft-delete. Только ADMIN/DIRECTOR_GEN.
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!hasDeleteAccess(request.user)) {
      return reply.code(403).send({ error: 'Удалять может только ADMIN или DIRECTOR_GEN' });
    }
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'Некорректный id' });
    }
    try {
      const result = await correspondenceService.softDeleteCorrespondence(db, id, {
        userId: request.user.id
      });
      if (!result) {
        return reply.code(404).send({ error: 'Корреспонденция не найдена или уже удалена' });
      }
      return { success: true, ...result };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      fastify.log.error({ err }, 'correspondence/delete error');
      return reply.code(500).send({ error: 'Не удалось удалить' });
    }
  });
};
