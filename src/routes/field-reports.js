/**
 * ASGARD Field — Reports API (master daily reports + incidents)
 * ═══════════════════════════════════════════════════════════════
 * GET  /template/:work_id — report template for project
 * POST /                  — submit daily report (master only)
 * GET  /                  — list reports (master sees own, PM sees all)
 * PUT  /:id/accept        — accept report (PM via CRM auth)
 * POST /incidents         — report incident (master only)
 * GET  /incidents         — list incidents
 */

const { createNotification } = require('../services/notify');

const FIELD_QUOTES_REPORT = [
  'Otchyot otpravlen — skaldy zapomniat etot den!',
  'Komandir poluchil donesenie. Khoroshaya rabota!',
  'Khronika bitvy zapisana. RP uvedomlyun',
];

function randomQuote(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function routes(fastify, options) {
  const db = fastify.db;
  const fieldAuth = { preHandler: [fastify.fieldAuthenticate] };

  // Helper: check master role
  async function requireMaster(empId, workId) {
    const { rows } = await db.query(`
      SELECT field_role FROM employee_assignments
      WHERE employee_id = $1 AND work_id = $2 AND is_active = true
        AND field_role IN ('shift_master', 'senior_master')
      LIMIT 1
    `, [empId, workId]);
    return rows.length > 0 ? rows[0].field_role : null;
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /template/:work_id — report template for project
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/template/:work_id', fieldAuth, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });

      const { rows } = await db.query(`
        SELECT rt.id, rt.name, rt.fields, rt.progress_unit, rt.progress_field, rt.progress_total
        FROM field_project_settings fps
        JOIN field_report_templates rt ON rt.id = fps.report_template_id
        WHERE fps.work_id = $1
      `, [workId]);

      if (rows.length === 0) {
        // Return default template
        const { rows: defaults } = await db.query(
          `SELECT id, name, fields, progress_unit, progress_field, progress_total FROM field_report_templates WHERE is_default = true ORDER BY id LIMIT 1`
        );
        return { template: defaults[0] || null };
      }

      return { template: rows[0] };
    } catch (err) {
      fastify.log.error('[field-reports] GET /template error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST / — submit daily report (master only)
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { work_id, date, shift, report_data, crew_snapshot, downtime_minutes, downtime_reason, template_id } = req.body || {};

      if (!work_id) return reply.code(400).send({ error: 'Укажите work_id' });

      const masterRole = await requireMaster(empId, work_id);
      if (!masterRole) {
        return reply.code(403).send({ error: 'Только мастер может отправлять отчёты' });
      }

      const reportDate = date || new Date().toISOString().split('T')[0];

      // Build crew snapshot if not provided
      let snapshot = crew_snapshot;
      if (!snapshot) {
        const { rows: checkins } = await db.query(`
          SELECT fc.employee_id, e.fio, fc.checkin_at, fc.checkout_at, fc.hours_worked, fc.status
          FROM field_checkins fc
          JOIN employees e ON e.id = fc.employee_id
          WHERE fc.work_id = $1 AND fc.date = $2 AND fc.status != 'cancelled'
          ORDER BY fc.checkin_at
        `, [work_id, reportDate]);
        snapshot = checkins;
      }

      const { rows: inserted } = await db.query(`
        INSERT INTO field_daily_reports (work_id, date, shift, author_id, author_role, template_id,
          report_data, crew_snapshot, downtime_minutes, downtime_reason, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'submitted')
        RETURNING id, created_at
      `, [
        work_id, reportDate, shift || 'day', empId, masterRole,
        template_id || null,
        JSON.stringify(report_data || {}),
        JSON.stringify(snapshot || []),
        downtime_minutes || 0,
        downtime_reason || null
      ]);

      // Notify PM
      try {
        const { rows: work } = await db.query(
          `SELECT work_title, pm_id FROM works WHERE id = $1`, [work_id]
        );
        if (work[0]?.pm_id) {
          await createNotification(db, {
            user_id: work[0].pm_id,
            title: 'Новый отчёт с объекта',
            message: `${req.fieldEmployee.fio} отправил отчёт по проекту "${work[0].work_title}" за ${reportDate}`,
            type: 'field_report',
            link: `/works/${work_id}`
          });
        }
      } catch (notifyErr) {
        fastify.log.error('[field-reports] notify error:', notifyErr.message);
      }

      // Quest progress: report_submit (fire-and-forget)
      try {
        const { updateQuestProgress } = require('../services/questProgress');
        updateQuestProgress(db, empId, 'report_submit').catch(() => {});
      } catch { /* non-critical */ }

      return {
        report_id: inserted[0].id,
        created_at: inserted[0].created_at,
        quote: randomQuote(FIELD_QUOTES_REPORT),
      };
    } catch (err) {
      fastify.log.error('[field-reports] POST / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET / — list reports
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.query.work_id);
      const dateFrom = req.query.date_from;
      const dateTo = req.query.date_to;

      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });

      // Check assignment
      const { rows: assign } = await db.query(
        `SELECT field_role FROM employee_assignments WHERE employee_id = $1 AND work_id = $2 AND is_active = true LIMIT 1`,
        [empId, workId]
      );
      if (assign.length === 0) {
        return reply.code(403).send({ error: 'Нет доступа к проекту' });
      }

      let sql = `
        SELECT dr.*, e.fio as author_name
        FROM field_daily_reports dr
        JOIN employees e ON e.id = dr.author_id
        WHERE dr.work_id = $1
      `;
      const params = [workId];
      let idx = 2;

      // Master sees only own reports, senior_master/PM sees all
      if (assign[0].field_role === 'worker') {
        return reply.code(403).send({ error: 'Только мастер может просматривать отчёты' });
      }
      if (assign[0].field_role === 'shift_master') {
        sql += ` AND dr.author_id = $${idx}`;
        params.push(empId);
        idx++;
      }

      if (dateFrom) {
        sql += ` AND dr.date >= $${idx}`;
        params.push(dateFrom);
        idx++;
      }
      if (dateTo) {
        sql += ` AND dr.date <= $${idx}`;
        params.push(dateTo);
        idx++;
      }

      sql += ` ORDER BY dr.date DESC, dr.created_at DESC`;

      const { rows } = await db.query(sql, params);
      return { reports: rows };
    } catch (err) {
      fastify.log.error('[field-reports] GET / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /:id/accept — accept report (PM via CRM auth)
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/:id/accept',
    { preHandler: [fastify.requireRoles(['PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])] },
    async (req, reply) => {
      try {
        const reportId = parseInt(req.params.id);
        const userId = req.user.id;
        const { comment } = req.body || {};

        const { rows: report } = await db.query(
          `SELECT id, status, author_id, work_id FROM field_daily_reports WHERE id = $1`, [reportId]
        );
        if (report.length === 0) {
          return reply.code(404).send({ error: 'Отчёт не найден' });
        }
        if (report[0].status === 'accepted') {
          return reply.code(409).send({ error: 'Отчёт уже принят' });
        }

        await db.query(`
          UPDATE field_daily_reports SET status = 'accepted', accepted_by = $2,
            accepted_at = NOW(), comment = COALESCE($3, comment), updated_at = NOW()
          WHERE id = $1
        `, [reportId, userId, comment || null]);

        return { ok: true, status: 'accepted' };
      } catch (err) {
        fastify.log.error('[field-reports] PUT /:id/accept error:', err);
        return reply.code(500).send({ error: 'Ошибка сервера' });
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // POST /incidents — report incident
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/incidents', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { work_id, incident_type, description, severity, started_at, ended_at, duration_minutes } = req.body || {};

      if (!work_id || !incident_type || !description) {
        return reply.code(400).send({ error: 'Укажите work_id, incident_type и description' });
      }

      const masterRole = await requireMaster(empId, work_id);
      if (!masterRole) {
        return reply.code(403).send({ error: 'Только мастер может регистрировать инциденты' });
      }

      const { rows: inserted } = await db.query(`
        INSERT INTO field_incidents (work_id, reported_by, incident_type, description,
          severity, started_at, ended_at, duration_minutes, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
        RETURNING id, created_at
      `, [
        work_id, empId, incident_type, description,
        severity || 'medium',
        started_at || new Date().toISOString(),
        ended_at || null,
        duration_minutes || null
      ]);

      // Notify PM (+ SMS for critical)
      try {
        const { rows: work } = await db.query(
          `SELECT work_title, pm_id FROM works WHERE id = $1`, [work_id]
        );
        if (work[0]?.pm_id) {
          const sevLabel = severity === 'critical' ? 'КРИТИЧЕСКИЙ' : severity === 'high' ? 'ВАЖНЫЙ' : '';
          await createNotification(db, {
            user_id: work[0].pm_id,
            title: `${sevLabel} Инцидент на объекте`.trim(),
            message: `${incident_type}: ${description.slice(0, 200)}`,
            type: 'field_incident',
            link: `/works/${work_id}`
          });
        }
      } catch (notifyErr) {
        fastify.log.error('[field-reports] incident notify error:', notifyErr.message);
      }

      return {
        incident_id: inserted[0].id,
        created_at: inserted[0].created_at,
      };
    } catch (err) {
      fastify.log.error('[field-reports] POST /incidents error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /incidents — list incidents
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/incidents', fieldAuth, async (req, reply) => {
    try {
      const workId = parseInt(req.query.work_id);
      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });

      const { rows } = await db.query(`
        SELECT fi.*, e.fio as reported_by_name
        FROM field_incidents fi
        JOIN employees e ON e.id = fi.reported_by
        WHERE fi.work_id = $1
        ORDER BY fi.created_at DESC
      `, [workId]);

      return { incidents: rows };
    } catch (err) {
      fastify.log.error('[field-reports] GET /incidents error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
