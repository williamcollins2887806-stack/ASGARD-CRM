'use strict';

/**
 * Site crew matrix — кто на объектах (HEAD_TO / ADMIN / directors).
 * Add/remove с 24ч предупреждением РП + email.
 */

const { createNotification } = require('../services/notify');

const MATRIX_ROLES = ['ADMIN', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const WARN_HOURS = 24;

async function sendEmailSafe(db, log, payload) {
  try {
    const { sendCrmEmail } = require('../services/crm-mailer');
    await sendCrmEmail(db, null, payload);
  } catch (e) {
    log?.warn?.({ err: e }, 'site-crew email failed');
  }
}

async function loadWorkPm(db, workId) {
  const { rows } = await db.query(`
    SELECT w.id, w.work_title, w.customer_name, w.pm_id,
           u.name AS pm_name, u.email AS pm_email
    FROM works w
    LEFT JOIN users u ON u.id = w.pm_id
    WHERE w.id = $1 AND w.deleted_at IS NULL
  `, [workId]);
  return rows[0] || null;
}

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.requireRoles(MATRIX_ROLES)] };

  // GET /api/site-crew/matrix
  fastify.get('/matrix', auth, async (request, reply) => {
    try {
      const { notClosedSql } = require('../helpers/work-status');
      // Все незакрытые работы (в т.ч. без бригады) + активные назначения
      const { rows: workRows } = await db.query(`
        SELECT w.id AS work_id, w.work_title, w.customer_name, w.city,
               w.pm_id, pm.name AS pm_name, pm.email AS pm_email
        FROM works w
        LEFT JOIN users pm ON pm.id = w.pm_id
        WHERE w.deleted_at IS NULL
          AND ${notClosedSql('w.work_status')}
        ORDER BY w.work_title NULLS LAST
      `);

      const { rows } = await db.query(`
        SELECT
          w.id AS work_id,
          e.id AS employee_id,
          COALESCE(e.fio, e.full_name) AS fio,
          e.phone,
          e.role_tag AS position,
          ea.id AS assignment_id,
          ea.date_from,
          ea.created_at AS assigned_at,
          (
            SELECT MIN(fc.date) FROM field_checkins fc
            WHERE fc.employee_id = e.id AND fc.work_id = w.id
              AND fc.status = 'completed'
          ) AS first_shift,
          (
            SELECT MIN(fts.date_from) FROM field_trip_stages fts
            WHERE fts.employee_id = e.id AND fts.work_id = w.id
              AND fts.stage_type IN ('travel','ship','helicopter')
              AND COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')
              AND COALESCE(fts.direction, 'to_site') = 'to_site'
          ) AS first_travel_to,
          (
            SELECT fts.direction FROM field_trip_stages fts
            WHERE fts.employee_id = e.id AND fts.work_id = w.id
              AND fts.stage_type IN ('travel','ship','helicopter')
              AND COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')
            ORDER BY fts.date_from DESC, fts.id DESC
            LIMIT 1
          ) AS last_travel_direction,
          rr.id AS removal_request_id,
          rr.status AS removal_status,
          rr.warned_at,
          rr.reason AS removal_reason
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id AND w.deleted_at IS NULL
        JOIN employees e ON e.id = ea.employee_id
        LEFT JOIN LATERAL (
          SELECT r.* FROM site_crew_removal_requests r
          WHERE r.work_id = ea.work_id AND r.employee_id = ea.employee_id
            AND r.status = 'warned'
          ORDER BY r.warned_at DESC
          LIMIT 1
        ) rr ON true
        WHERE COALESCE(ea.is_active, true) = true
          AND ea.departure_date IS NULL
          AND COALESCE(e.is_active, true) = true
          AND COALESCE(e.is_se_payee, false) = false
          AND ${notClosedSql('w.work_status')}
        ORDER BY COALESCE(e.fio, e.full_name)
      `);

      const byWork = new Map();
      for (const w of workRows) {
        byWork.set(w.work_id, {
          work_id: w.work_id,
          work_title: w.work_title || `Работа #${w.work_id}`,
          customer_name: w.customer_name,
          city: w.city,
          pm_id: w.pm_id,
          pm_name: w.pm_name,
          crew: []
        });
      }

      const now = Date.now();
      for (const r of rows) {
        if (!byWork.has(r.work_id)) continue;
        const dates = [r.first_shift, r.first_travel_to, r.date_from, r.assigned_at]
          .filter(Boolean)
          .map((d) => new Date(d).getTime())
          .filter((n) => Number.isFinite(n));
        const sinceMs = dates.length ? Math.min(...dates) : null;
        const warnedAt = r.warned_at ? new Date(r.warned_at).getTime() : null;
        const canForce = !!(warnedAt && (now - warnedAt) >= WARN_HOURS * 3600 * 1000);
        const hoursLeft = warnedAt && !canForce
          ? Math.max(0, Math.ceil((WARN_HOURS * 3600 * 1000 - (now - warnedAt)) / 3600000))
          : 0;

        byWork.get(r.work_id).crew.push({
          employee_id: r.employee_id,
          fio: r.fio,
          phone: r.phone,
          position: r.position,
          assignment_id: r.assignment_id,
          since: sinceMs ? new Date(sinceMs).toISOString().slice(0, 10) : null,
          first_shift: r.first_shift,
          first_travel_to: r.first_travel_to,
          date_from: r.date_from,
          last_travel_direction: r.last_travel_direction,
          removal: r.removal_request_id ? {
            id: r.removal_request_id,
            status: r.removal_status,
            warned_at: r.warned_at,
            reason: r.removal_reason,
            can_force: canForce,
            hours_left: hoursLeft
          } : null
        });
      }

      // Сначала с бригадой, потом пустые; внутри — по названию
      const works = [...byWork.values()].sort((a, b) => {
        const ca = (a.crew || []).length;
        const cb = (b.crew || []).length;
        if (ca !== cb) return cb - ca;
        return String(a.work_title || '').localeCompare(String(b.work_title || ''), 'ru');
      });

      return { works, warn_hours: WARN_HOURS };
    } catch (err) {
      request.log.error({ err }, 'site-crew matrix');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // POST /api/site-crew/add — добавить на объект
  fastify.post('/add', auth, async (request, reply) => {
    const { work_id, employee_id, date_from, field_role } = request.body || {};
    const workId = parseInt(work_id, 10);
    const empId = parseInt(employee_id, 10);
    if (!workId || !empId) {
      return reply.code(400).send({ error: 'work_id и employee_id обязательны' });
    }

    const work = await loadWorkPm(db, workId);
    if (!work) return reply.code(404).send({ error: 'Работа не найдена' });

    const { rows: empRows } = await db.query(
      `SELECT id, fio, full_name FROM employees WHERE id=$1 AND COALESCE(is_active,true)=true`,
      [empId]
    );
    if (!empRows.length) return reply.code(404).send({ error: 'Рабочий не найден' });
    const fio = empRows[0].fio || empRows[0].full_name || `#${empId}`;

    // reuse field-manage logic via inject
    const proxy = await fastify.inject({
      method: 'POST',
      url: `/api/field/manage/projects/${workId}/crew`,
      headers: {
        authorization: request.headers.authorization || '',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({
        employees: [{
          employee_id: empId,
          field_role: field_role || 'worker'
        }]
      })
    });
    if (proxy.statusCode >= 400) {
      return reply.code(proxy.statusCode).send(proxy.json());
    }

    if (date_from) {
      await db.query(`
        UPDATE employee_assignments
        SET date_from = $3::date, updated_at = NOW()
        WHERE work_id = $1 AND employee_id = $2
      `, [workId, empId, String(date_from).slice(0, 10)]);
    }

    // cancel open removal warnings
    await db.query(`
      UPDATE site_crew_removal_requests
      SET status = 'cancelled', updated_at = NOW()
      WHERE work_id = $1 AND employee_id = $2 AND status = 'warned'
    `, [workId, empId]);

    const appUrl = (process.env.PUBLIC_APP_URL || 'https://asgard-crm.ru').replace(/\/$/, '');
    const subject = `АСГАРД CRM: в бригаду добавлен ${fio}`;
    const text = [
      `Здравствуйте${work.pm_name ? `, ${work.pm_name}` : ''}!`,
      '',
      `По вашей работе «${work.work_title || workId}» в бригаду добавлен рабочий ${fio}.`,
      work.customer_name ? `Заказчик: ${work.customer_name}` : null,
      date_from ? `Дата с: ${String(date_from).slice(0, 10)}` : null,
      `Добавил: ${request.user.name || request.user.login || 'Рук. ТО'}`,
      '',
      `${appUrl}/#/works?id=${workId}`,
      '',
      '— АСГАРД CRM'
    ].filter(Boolean).join('\n');

    if (work.pm_id) {
      try {
        await createNotification(db, {
          user_id: work.pm_id,
          title: `В бригаду добавлен ${fio}`,
          message: `Работа «${work.work_title || workId}»: добавлен ${fio}`,
          type: 'crew',
          link: `#/works?id=${workId}`
        });
      } catch (_) { /* ignore */ }
    }
    if (work.pm_email) {
      await sendEmailSafe(db, request.log, {
        to: work.pm_email,
        subject,
        text,
        html: `<p>${text.replace(/\n/g, '<br>')}</p>`
      });
    }

    return { ok: true, work_id: workId, employee_id: empId, result: proxy.json() };
  });

  // POST /api/site-crew/remove-warn — 1-й клик
  fastify.post('/remove-warn', auth, async (request, reply) => {
    const { work_id, employee_id, reason } = request.body || {};
    const workId = parseInt(work_id, 10);
    const empId = parseInt(employee_id, 10);
    const why = String(reason || '').trim();
    if (!workId || !empId || !why) {
      return reply.code(400).send({ error: 'work_id, employee_id и reason обязательны' });
    }

    const work = await loadWorkPm(db, workId);
    if (!work) return reply.code(404).send({ error: 'Работа не найдена' });

    const { rows: asg } = await db.query(`
      SELECT ea.id, COALESCE(e.fio, e.full_name) AS fio
      FROM employee_assignments ea
      JOIN employees e ON e.id = ea.employee_id
      WHERE ea.work_id = $1 AND ea.employee_id = $2
        AND COALESCE(ea.is_active,true)=true AND ea.departure_date IS NULL
    `, [workId, empId]);
    if (!asg.length) return reply.code(404).send({ error: 'Рабочий не на объекте' });

    const { rows: existing } = await db.query(`
      SELECT id, warned_at FROM site_crew_removal_requests
      WHERE work_id=$1 AND employee_id=$2 AND status='warned'
      ORDER BY warned_at DESC LIMIT 1
    `, [workId, empId]);
    if (existing.length) {
      return {
        ok: true,
        already: true,
        request_id: existing[0].id,
        warned_at: existing[0].warned_at,
        warn_hours: WARN_HOURS
      };
    }

    const { rows: [reqRow] } = await db.query(`
      INSERT INTO site_crew_removal_requests
        (work_id, employee_id, requested_by, reason, status, warned_at)
      VALUES ($1,$2,$3,$4,'warned',NOW())
      RETURNING *
    `, [workId, empId, request.user.id, why]);

    const who = request.user.name || request.user.login || 'Рук. ТО';
    const fio = asg[0].fio;
    const subject = `АСГАРД CRM: снимите с объекта ${fio} (24 часа)`;
    const text = [
      `Здравствуйте${work.pm_name ? `, ${work.pm_name}` : ''}!`,
      '',
      `${who} просит в течение ${WARN_HOURS} часов снять с объекта рабочего ${fio}.`,
      `Объект: ${work.work_title || workId}${work.customer_name ? ` (${work.customer_name})` : ''}`,
      `Причина: ${why}`,
      '',
      `Если не снять за ${WARN_HOURS} ч — ${who} сможет снять принудительно.`,
      '',
      '— АСГАРД CRM'
    ].join('\n');

    if (work.pm_id) {
      try {
        await createNotification(db, {
          user_id: work.pm_id,
          title: `Снять с объекта: ${fio}`,
          message: `${who}: ${why}`.slice(0, 240),
          type: 'warning',
          link: `#/works?id=${workId}`
        });
      } catch (_) { /* ignore */ }
    }
    if (work.pm_email) {
      await sendEmailSafe(db, request.log, {
        to: work.pm_email,
        subject,
        text,
        html: `<p>${text.replace(/\n/g, '<br>')}</p>`
      });
    }

    return { ok: true, request: reqRow, warn_hours: WARN_HOURS };
  });

  // POST /api/site-crew/remove-force — 2-й клик после 24ч
  fastify.post('/remove-force', auth, async (request, reply) => {
    const { work_id, employee_id, reason, departure_date } = request.body || {};
    const workId = parseInt(work_id, 10);
    const empId = parseInt(employee_id, 10);
    const why = String(reason || '').trim();
    const depDate = String(departure_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    if (!workId || !empId || !why) {
      return reply.code(400).send({ error: 'work_id, employee_id и reason обязательны' });
    }

    const { rows: warnRows } = await db.query(`
      SELECT * FROM site_crew_removal_requests
      WHERE work_id=$1 AND employee_id=$2 AND status='warned'
      ORDER BY warned_at DESC LIMIT 1
    `, [workId, empId]);
    if (!warnRows.length) {
      return reply.code(409).send({ error: 'Сначала отправьте предупреждение РП' });
    }
    const warnedAt = new Date(warnRows[0].warned_at).getTime();
    if (Date.now() - warnedAt < WARN_HOURS * 3600 * 1000) {
      const hoursLeft = Math.ceil((WARN_HOURS * 3600 * 1000 - (Date.now() - warnedAt)) / 3600000);
      return reply.code(409).send({
        error: `Ещё рано: подождите ${hoursLeft} ч после предупреждения`,
        hours_left: hoursLeft
      });
    }

    const work = await loadWorkPm(db, workId);
    if (!work) return reply.code(404).send({ error: 'Работа не найдена' });

    const proxy = await fastify.inject({
      method: 'POST',
      url: `/api/field/manage/projects/${workId}/departure/${empId}`,
      headers: {
        authorization: request.headers.authorization || '',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({
        departure_date: depDate,
        reason: why
      })
    });
    if (proxy.statusCode >= 400) {
      return reply.code(proxy.statusCode).send(proxy.json());
    }

    await db.query(`
      UPDATE site_crew_removal_requests
      SET status='forced', forced_at=NOW(), force_reason=$2, departure_date=$3::date, updated_at=NOW()
      WHERE id=$1
    `, [warnRows[0].id, why, depDate]);

    const { rows: empRows } = await db.query(
      `SELECT COALESCE(fio, full_name) AS fio FROM employees WHERE id=$1`, [empId]
    );
    const fio = empRows[0]?.fio || `#${empId}`;
    const who = request.user.name || request.user.login || 'Рук. ТО';
    const subject = `АСГАРД CRM: принудительно снят ${fio}`;
    const text = [
      `Здравствуйте${work.pm_name ? `, ${work.pm_name}` : ''}!`,
      '',
      `${who} принудительно снял с объекта рабочего ${fio}.`,
      `Объект: ${work.work_title || workId}`,
      `Дата отъезда: ${depDate}`,
      `Причина: ${why}`,
      '',
      '— АСГАРД CRM'
    ].join('\n');

    if (work.pm_id) {
      try {
        await createNotification(db, {
          user_id: work.pm_id,
          title: `Снят с объекта: ${fio}`,
          message: `${who}: ${why}`.slice(0, 240),
          type: 'warning',
          link: `#/works?id=${workId}`
        });
      } catch (_) { /* ignore */ }
    }
    if (work.pm_email) {
      await sendEmailSafe(db, request.log, {
        to: work.pm_email,
        subject,
        text,
        html: `<p>${text.replace(/\n/g, '<br>')}</p>`
      });
    }

    return { ok: true, departure: proxy.json() };
  });

  // GET /api/site-crew/works — все активные (незакрытые) объекты для добавления в бригаду
  fastify.get('/works', auth, async (request, reply) => {
    try {
      const { notClosedSql } = require('../helpers/work-status');
      const { rows } = await db.query(`
        SELECT w.id, w.work_title, w.customer_name, w.city, u.name AS pm_name,
               COUNT(ea.id) FILTER (
                 WHERE COALESCE(ea.is_active,true)=true AND ea.departure_date IS NULL
               )::int AS crew_count
        FROM works w
        LEFT JOIN users u ON u.id = w.pm_id
        LEFT JOIN employee_assignments ea ON ea.work_id = w.id
        WHERE w.deleted_at IS NULL
          AND ${notClosedSql('w.work_status')}
        GROUP BY w.id, w.work_title, w.customer_name, w.city, u.name
        ORDER BY
          COUNT(ea.id) FILTER (
            WHERE COALESCE(ea.is_active,true)=true AND ea.departure_date IS NULL
          ) DESC,
          w.updated_at DESC NULLS LAST,
          w.work_title NULLS LAST
        LIMIT 500
      `);
      return {
        works: rows.map((r) => ({
          id: r.id,
          title: r.work_title || `#${r.id}`,
          customer_name: r.customer_name,
          city: r.city,
          pm_name: r.pm_name,
          crew_count: r.crew_count,
          label: [
            r.work_title || `#${r.id}`,
            r.customer_name,
            r.city,
            r.pm_name ? `РП: ${r.pm_name}` : null,
            r.crew_count ? `${r.crew_count} чел.` : 'пусто'
          ].filter(Boolean).join(' · ')
        }))
      };
    } catch (err) {
      request.log.error({ err }, 'site-crew works');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
