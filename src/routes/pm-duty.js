/**
 * PM Duty routes — дежурства РП, очередь, отчёты, коллабораторы
 */
const {
  getCurrentDuty,
  ensureReview,
  writeReviewLog,
  writeRegistryAudit,
  syncTenderStatus
} = require('../services/tender-registry-helpers');
const { createNotification } = require('../services/notify');
const { broadcast } = require('./sse');

const PM_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const ASSIGN_ROLES = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

async function isDutyPm(db, userId) {
  const duty = await getCurrentDuty(db);
  return duty && duty.pm_user_id === userId;
}

async function isCollaborator(db, tenderId, userId) {
  const r = await db.query(`
    SELECT 1 FROM tender_rp_review_collaborators c
    JOIN tender_rp_reviews r ON r.id = c.review_id
    WHERE c.tender_id = $1 AND c.pm_user_id = $2 AND c.revoked_at IS NULL
  `, [tenderId, userId]);
  return r.rows.length > 0;
}

async function routes(fastify) {
  const db = fastify.db;

  // GET /current
  fastify.get('/current', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async () => {
    const duty = await getCurrentDuty(db);
    return { duty, is_duty: duty ? undefined : false };
  });

  // GET /roster
  fastify.get('/roster', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request) => {
    const limit = Math.min(parseInt(request.query.limit || '50', 10), 200);
    const r = await db.query(`
      SELECT r.*, u.name AS pm_name, ab.name AS assigned_by_name
      FROM pm_duty_roster r
      JOIN users u ON u.id = r.pm_user_id
      JOIN users ab ON ab.id = r.assigned_by_user_id
      ORDER BY r.period_start DESC
      LIMIT $1
    `, [limit]);
    return { items: r.rows };
  });

  // POST /roster
  fastify.post('/roster', {
    preHandler: [fastify.requireRoles(ASSIGN_ROLES)]
  }, async (request, reply) => {
    const { pm_user_id, period_start, period_end } = request.body || {};
    if (!pm_user_id || !period_start || !period_end) {
      return reply.code(400).send({ error: 'pm_user_id, period_start, period_end обязательны' });
    }
    if (period_end < period_start) {
      return reply.code(400).send({ error: 'period_end должен быть >= period_start' });
    }
    const overlap = await db.query(`
      SELECT id FROM pm_duty_roster
      WHERE period_start <= $2::date AND period_end >= $1::date
    `, [period_start, period_end]);
    if (overlap.rows.length) {
      return reply.code(409).send({ error: 'Период пересекается с существующим дежурством' });
    }
    const r = await db.query(`
      INSERT INTO pm_duty_roster (pm_user_id, period_start, period_end, assigned_by_user_id)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [pm_user_id, period_start, period_end, request.user.id]);
    return { roster: r.rows[0] };
  });

  // PUT /roster/:id
  fastify.put('/roster/:id', {
    preHandler: [fastify.requireRoles(ASSIGN_ROLES)]
  }, async (request, reply) => {
    const { pm_user_id, period_start, period_end } = request.body || {};
    const existing = await db.query('SELECT * FROM pm_duty_roster WHERE id = $1', [request.params.id]);
    if (!existing.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const cur = existing.rows[0];
    const nextStart = period_start || cur.period_start;
    const nextEnd = period_end || cur.period_end;
    if (nextEnd < nextStart) {
      return reply.code(400).send({ error: 'period_end должен быть >= period_start' });
    }
    const overlap = await db.query(`
      SELECT id FROM pm_duty_roster
      WHERE id <> $3 AND period_start <= $2::date AND period_end >= $1::date
    `, [nextStart, nextEnd, request.params.id]);
    if (overlap.rows.length) {
      return reply.code(409).send({ error: 'Период пересекается с существующим дежурством' });
    }
    const r = await db.query(`
      UPDATE pm_duty_roster SET
        pm_user_id = COALESCE($1, pm_user_id),
        period_start = COALESCE($2, period_start),
        period_end = COALESCE($3, period_end)
      WHERE id = $4 RETURNING *
    `, [pm_user_id, period_start, period_end, request.params.id]);
    return { roster: r.rows[0] };
  });

  // DELETE /roster/:id
  fastify.delete('/roster/:id', {
    preHandler: [fastify.requireRoles(ASSIGN_ROLES)]
  }, async (request, reply) => {
    const r = await db.query('DELETE FROM pm_duty_roster WHERE id = $1 RETURNING id', [request.params.id]);
    if (!r.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { ok: true };
  });

  // GET /queue?tab=need_report|my_reviewed
  fastify.get('/queue', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request) => {
    const tab = request.query.tab || 'need_report';
    const userId = request.user.id;
    const duty = await getCurrentDuty(db);
    const isDuty = duty && duty.pm_user_id === userId;

    if (tab === 'my_reviewed') {
      const r = await db.query(`
        SELECT t.*, rev.decision, rev.is_final, rev.updated_at AS review_updated_at
        FROM tenders t
        JOIN tender_rp_reviews rev ON rev.tender_id = t.id
        WHERE t.deleted_at IS NULL
          AND (
            rev.started_by_user_id = $1 OR rev.finalized_by_user_id = $1
            OR rev.calculator_user_id = $1
            OR EXISTS (
              SELECT 1 FROM tender_rp_review_log l
              WHERE l.review_id = rev.id AND l.actor_user_id = $1
            )
          )
        ORDER BY rev.updated_at DESC
        LIMIT 300
      `, [userId]);
      return { items: r.rows, tab, duty, is_duty: isDuty };
    }

    // need_report
    let items = [];
    if (isDuty) {
      const r = await db.query(`
        SELECT t.*, rev.decision, rev.is_final, rev.id AS review_id
        FROM tenders t
        LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
        WHERE t.deleted_at IS NULL
          AND t.registry_status = 'рассмотрение'
          AND (rev.is_final IS NULL OR rev.is_final = false)
        ORDER BY t.created_at ASC
        LIMIT 500
      `);
      items = r.rows;
    } else {
      const r = await db.query(`
        SELECT t.*, rev.decision, rev.is_final, rev.id AS review_id
        FROM tenders t
        JOIN tender_rp_reviews rev ON rev.tender_id = t.id
        JOIN tender_rp_review_collaborators c ON c.review_id = rev.id AND c.revoked_at IS NULL
        WHERE t.deleted_at IS NULL AND c.pm_user_id = $1
          AND (rev.is_final IS NULL OR rev.is_final = false)
        ORDER BY t.created_at ASC
      `, [userId]);
      items = r.rows;
    }

    return {
      items,
      tab,
      duty,
      is_duty: isDuty,
      banner: !isDuty && tab === 'need_report' && items.length === 0 && duty
        ? {
            message: `Вы не дежурный. Дежурный: ${duty.pm_name}, период ${duty.period_start} — ${duty.period_end}. При ошибке обратитесь к ${duty.assigned_by_name}.`
          }
        : null
    };
  });
}

// RP Review routes mounted on /api/tenders
async function reviewRoutes(fastify) {
  const db = fastify.db;

  fastify.get('/:id/rp-review', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const review = await ensureReview(db, tenderId, request.user.id);
    const logs = await db.query(`
      SELECT l.*, u.name AS actor_name FROM tender_rp_review_log l
      LEFT JOIN users u ON u.id = l.actor_user_id
      WHERE l.review_id = $1 ORDER BY l.created_at DESC LIMIT 100
    `, [review.id]);
    const collabs = await db.query(`
      SELECT c.*, u.name AS pm_name FROM tender_rp_review_collaborators c
      JOIN users u ON u.id = c.pm_user_id
      WHERE c.review_id = $1 AND c.revoked_at IS NULL
    `, [review.id]);
    return { review, logs: logs.rows, collaborators: collabs.rows };
  });

  fastify.put('/:id/rp-review', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    const duty = await getCurrentDuty(db);
    const isDuty = duty && duty.pm_user_id === userId;
    const collab = await isCollaborator(db, tenderId, userId);
    if (!isDuty && !collab && !['ADMIN', 'HEAD_TO', 'HEAD_PM'].includes(request.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа к редактированию отчёта' });
    }

    const review = await ensureReview(db, tenderId, userId);
    if (review.is_final) {
      return reply.code(409).send({ error: 'Отчёт уже закрыт' });
    }

    const b = request.body || {};
    const isFinal = !!b.finalize;
    if (isFinal && b.decision === 'submit' && !b.work_price && !review.work_price) {
      return reply.code(400).send({ error: 'Для финализации «подаём» нужна цена или смета' });
    }

    const report_json = b.report_json !== undefined ? b.report_json : review.report_json;
    const decision = b.decision || review.decision;
    const report_kind = b.report_kind || review.report_kind || (decision === 'reject' ? 'reject' : 'work');
    const work_price = b.work_price !== undefined ? b.work_price : review.work_price;
    const missing_info_flags = b.missing_info_flags || review.missing_info_flags;

    let registry_status = null;
    if (isFinal) {
      if (decision === 'reject') registry_status = 'отмена';
      else if (decision === 'submit') registry_status = 'готовим';
    }

    const r = await db.query(`
      UPDATE tender_rp_reviews SET
        decision = $1,
        report_kind = $2,
        report_json = $3,
        missing_info_flags = $4,
        work_price = $5,
        estimate_file_id = COALESCE($6, estimate_file_id),
        is_final = $7,
        started_by_user_id = COALESCE(started_by_user_id, $8),
        finalized_by_user_id = CASE WHEN $7 THEN $8 ELSE finalized_by_user_id END,
        calculator_user_id = CASE WHEN $7 THEN $8 ELSE calculator_user_id END,
        updated_at = NOW()
      WHERE tender_id = $9
      RETURNING *
    `, [
      decision, report_kind, JSON.stringify(report_json),
      missing_info_flags, work_price, b.estimate_file_id || null,
      isFinal, userId, tenderId
    ]);

    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: userId,
      action: isFinal ? 'finalize' : 'save_draft',
      payload: { decision, report_kind }
    });

    if (registry_status) {
      await db.query(`
        UPDATE tenders SET registry_status = $1, tender_status = $2, updated_at = NOW(),
          calculator_user_id = $3
        WHERE id = $4
      `, [registry_status, syncTenderStatus(registry_status), userId, tenderId]);
    } else {
      await db.query(`
        UPDATE tenders SET calculator_user_id = $1, updated_at = NOW() WHERE id = $2
      `, [userId, tenderId]);
    }

    broadcast('tender:registry:changed', { id: parseInt(tenderId, 10) });
    return { review: r.rows[0] };
  });

  fastify.get('/:id/rp-review/history', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request) => {
    const review = await ensureReview(db, request.params.id, request.user.id);
    const logs = await db.query(`
      SELECT l.*, u.name AS actor_name FROM tender_rp_review_log l
      LEFT JOIN users u ON u.id = l.actor_user_id
      WHERE l.review_id = $1 ORDER BY l.created_at ASC
    `, [review.id]);
    return { logs: logs.rows };
  });

  fastify.post('/:id/rp-review/invite', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const { pm_user_id } = request.body || {};
    if (!pm_user_id) return reply.code(400).send({ error: 'pm_user_id обязателен' });

    const duty = await getCurrentDuty(db);
    if (!duty || duty.pm_user_id !== request.user.id) {
      if (!['ADMIN', 'HEAD_TO'].includes(request.user.role)) {
        return reply.code(403).send({ error: 'Приглашать может только дежурный РП' });
      }
    }

    const review = await ensureReview(db, tenderId, request.user.id);
    const r = await db.query(`
      INSERT INTO tender_rp_review_collaborators (review_id, tender_id, pm_user_id, invited_by_user_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (review_id, pm_user_id) DO UPDATE SET revoked_at = NULL, invited_at = NOW()
      RETURNING *
    `, [review.id, tenderId, pm_user_id, request.user.id]);

    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: request.user.id,
      action: 'invite_collaborator', payload: { pm_user_id }
    });

    createNotification(db, {
      user_id: pm_user_id,
      title: 'Приглашение к проверке тендера',
      message: `${request.user.name || 'РП'} пригласил вас к проверке тендера #${tenderId}`,
      type: 'tender',
      link: '#/pm-duty'
    });

    return { collaborator: r.rows[0] };
  });

  fastify.delete('/:id/rp-review/invite/:pmId', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const review = await ensureReview(db, request.params.id, request.user.id);
    await db.query(`
      UPDATE tender_rp_review_collaborators SET revoked_at = NOW()
      WHERE review_id = $1 AND pm_user_id = $2
    `, [review.id, request.params.pmId]);
    return { ok: true };
  });
}

module.exports = routes;
module.exports.reviewRoutes = reviewRoutes;
