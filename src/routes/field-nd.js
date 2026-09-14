'use strict';

/**
 * Field API: /api/field/nd
 * Master: see drafts, edit, issue, daily, extensions decide, risk close, docx, email
 * Worker: issued+ only, ack, request extension, inbox
 */

const { logError } = require('../lib/log-error');
const nd = require('../lib/nd-core');
const { buildPermitDocx, filenameFor } = require('../services/nd-docx');
const { sendCrmEmail } = require('../services/crm-mailer');

async function routes(fastify) {
  const db = fastify.db;
  const fieldAuth = { preHandler: [fastify.fieldAuthenticate] };

  function empId(req) {
    return req.fieldEmployee?.id || req.employee?.id || req.user?.employee_id;
  }

  // ── Inbox ────────────────────────────────────────────────────────────
  fastify.get('/inbox', fieldAuth, async (req) => {
    const id = empId(req);
    const { rows } = await db.query(
      `SELECT * FROM nd_inbox WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [id]
    );
    return { items: rows };
  });

  fastify.post('/inbox/:id/read', fieldAuth, async (req) => {
    await db.query(
      `UPDATE nd_inbox SET is_read = true WHERE id = $1 AND employee_id = $2`,
      [Number(req.params.id), empId(req)]
    );
    return { ok: true };
  });

  // ── Catalog (read) ───────────────────────────────────────────────────
  fastify.get('/templates', fieldAuth, async () => {
    const { rows } = await db.query(
      `SELECT id, code, title, legal_basis, template_ready, max_days, extend_days
       FROM nd_form_templates WHERE is_active ORDER BY sort_order`
    );
    return { templates: rows };
  });

  fastify.get('/risks', fieldAuth, async (req) => {
    const form = req.query.form_code || null;
    const params = [];
    let sql = `SELECT r.*,
      COALESCE(json_agg(json_build_object('id', m.id, 'code', m.code, 'title', m.title)
        ORDER BY m.sort_order) FILTER (WHERE m.id IS NOT NULL), '[]') AS measures
      FROM nd_risk_catalog r
      LEFT JOIN nd_risk_measures rm ON rm.risk_id = r.id
      LEFT JOIN nd_measure_catalog m ON m.id = rm.measure_id AND m.is_active
      WHERE r.is_active = true`;
    if (form) {
      params.push(form);
      sql += ` AND ($1 = ANY(r.form_codes) OR cardinality(r.form_codes) = 0)`;
    }
    sql += ` GROUP BY r.id ORDER BY r.sort_order`;
    const { rows } = await db.query(sql, params);
    return { risks: rows };
  });

  // ── List for current worker/master ───────────────────────────────────
  fastify.get('/my', fieldAuth, async (req) => {
    const id = empId(req);
    const workId = req.query.work_id ? Number(req.query.work_id) : null;

    // Active assignments
    const { rows: assigns } = await db.query(
      `SELECT work_id, field_role FROM employee_assignments
       WHERE employee_id = $1 AND is_active = true`,
      [id]
    );
    const masterWorkIds = assigns.filter((a) => nd.isMasterRole(a.field_role)).map((a) => a.work_id);
    const allWorkIds = assigns.map((a) => a.work_id);
    if (workId) {
      // filter later
    }

    // Drafts visible only to masters on that work
    let drafts = [];
    if (masterWorkIds.length) {
      const { rows } = await db.query(
        `SELECT p.id, p.number, p.status, p.form_code, p.work_content, p.work_id,
                p.starts_at, p.ends_at, p.created_at, ft.title AS form_title, w.work_title
         FROM nd_permits p
         JOIN nd_form_templates ft ON ft.id = p.form_template_id
         JOIN works w ON w.id = p.work_id
         WHERE p.status = 'draft' AND p.work_id = ANY($1)
         ${workId ? 'AND p.work_id = $2' : ''}
         ORDER BY p.id DESC`,
        workId ? [masterWorkIds, workId] : [masterWorkIds]
      );
      drafts = rows;
    }

    // Issued+: in crew OR master on work
    const params = [id];
    let issuedSql = `
      SELECT DISTINCT p.id, p.number, p.status, p.form_code, p.work_content, p.work_id,
             p.starts_at, p.ends_at, p.issued_at, ft.title AS form_title, w.work_title,
             EXISTS(SELECT 1 FROM nd_acks a WHERE a.permit_id = p.id AND a.employee_id = $1) AS acknowledged
      FROM nd_permits p
      JOIN nd_form_templates ft ON ft.id = p.form_template_id
      JOIN works w ON w.id = p.work_id
      WHERE p.status <> 'draft'
        AND (
          EXISTS (SELECT 1 FROM nd_permit_crew c WHERE c.permit_id = p.id AND c.employee_id = $1)
          OR p.work_id = ANY($2)
        )`;
    params.push(allWorkIds.length ? allWorkIds : [0]);
    if (workId) {
      params.push(workId);
      issuedSql += ` AND p.work_id = $${params.length}`;
    }
    issuedSql += ` ORDER BY p.id DESC`;
    const { rows: issued } = await db.query(issuedSql, params);

    return { drafts, permits: issued, is_master: masterWorkIds.length > 0 };
  });

  fastify.get('/:id', fieldAuth, async (req, reply) => {
    const id = empId(req);
    const permit = await nd.loadPermitFull(db, Number(req.params.id));
    if (!permit) return reply.code(404).send({ error: 'Не найден' });

    const assign = await nd.getActiveAssignment(db, id, permit.work_id);
    const isMaster = assign && nd.isMasterRole(assign.field_role);
    const inCrew = (permit.crew || []).some((c) => c.employee_id === id);

    if (permit.status === 'draft') {
      if (!isMaster) return reply.code(403).send({ error: 'Черновик доступен только мастеру' });
    } else if (!isMaster && !inCrew) {
      return reply.code(403).send({ error: 'Нет доступа к наряду' });
    }

    const ack = (permit.acks || []).find((a) => a.employee_id === id);
    return {
      permit,
      meta: {
        is_master: !!isMaster,
        in_crew: !!inCrew,
        acknowledged: !!ack,
        can_issue: !!isMaster && permit.status === 'draft',
      },
    };
  });

  // ── Master edit draft / limited after issue ──────────────────────────
  fastify.put('/:id', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permitId = Number(req.params.id);
      const { rows: cur } = await db.query(`SELECT * FROM nd_permits WHERE id = $1`, [permitId]);
      if (!cur[0]) return reply.code(404).send({ error: 'Не найден' });
      await nd.assertMasterOnWork(db, eid, cur[0].work_id);
      const b = req.body || {};

      if (cur[0].status === 'draft') {
        await db.query(
          `UPDATE nd_permits SET
             work_content = COALESCE($2, work_content),
             work_place = COALESCE($3, work_place),
             ppe_text = COALESCE($4, ppe_text),
             emergency_text = COALESCE($5, emergency_text),
             sections_json = COALESCE($6, sections_json),
             starts_at = COALESCE($7, starts_at),
             ends_at = COALESCE($8, ends_at),
             updated_at = NOW()
           WHERE id = $1`,
          [
            permitId,
            b.work_content != null ? b.work_content : null,
            b.work_place != null ? b.work_place : null,
            b.ppe_text != null ? b.ppe_text : null,
            b.emergency_text != null ? b.emergency_text : null,
            b.sections_json != null ? JSON.stringify(b.sections_json) : null,
            b.starts_at || null,
            b.ends_at || null,
          ]
        );
        if (b.crew) await nd.replaceCrew(db, permitId, b.crew);
        if (b.equipment) await nd.replaceEquipment(db, permitId, b.equipment);
        if (b.risks) await nd.replaceRisks(db, permitId, b.risks);
      } else {
        // limited yellow fields + crew/equipment ops
        await db.query(
          `UPDATE nd_permits SET
             ppe_text = COALESCE($2, ppe_text),
             emergency_text = COALESCE($3, emergency_text),
             updated_at = NOW()
           WHERE id = $1`,
          [permitId, b.ppe_text != null ? b.ppe_text : null, b.emergency_text != null ? b.emergency_text : null]
        );
        if (b.crew) await nd.replaceCrew(db, permitId, b.crew);
      }
      await nd.logEvent(db, permitId, 'updated_by_master', { employeeId: eid });
      return { permit: await nd.loadPermitFull(db, permitId) };
    } catch (err) {
      logError(fastify, '[field-nd] PUT', err, req);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Ошибка' });
    }
  });

  // ── Issue (утвердить) ────────────────────────────────────────────────
  fastify.post('/:id/issue', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permitId = Number(req.params.id);
      const { rows: cur } = await db.query(`SELECT * FROM nd_permits WHERE id = $1`, [permitId]);
      if (!cur[0]) return reply.code(404).send({ error: 'Не найден' });
      if (cur[0].status !== 'draft') return reply.code(400).send({ error: 'Уже утверждён' });
      await nd.assertMasterOnWork(db, eid, cur[0].work_id);

      const { rows: crew } = await db.query(`SELECT COUNT(*)::int AS c FROM nd_permit_crew WHERE permit_id = $1`, [
        permitId,
      ]);
      if (!crew[0].c) return reply.code(400).send({ error: 'Укажите состав бригады' });
      if (!String(cur[0].work_content || '').trim()) {
        return reply.code(400).send({ error: 'Укажите содержание работ' });
      }

      const { rows: tpl } = await db.query(`SELECT * FROM nd_form_templates WHERE id = $1`, [
        cur[0].form_template_id,
      ]);
      if (tpl[0]?.risks_required) {
        const { rows: rc } = await db.query(
          `SELECT COUNT(*)::int AS c FROM nd_permit_risks WHERE permit_id = $1`,
          [permitId]
        );
        if (!rc[0].c) return reply.code(400).send({ error: 'Добавьте хотя бы один риск' });
      }

      let number = cur[0].number;
      await db.transaction(async (client) => {
        if (!number) number = await nd.nextPermitNumber(client, cur[0].work_id);
        const upd = await client.query(
          `UPDATE nd_permits SET
             status = 'issued', number = $2, issued_by_employee_id = $3, issued_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'draft'
           RETURNING id`,
          [permitId, number, eid]
        );
        if (!upd.rowCount) {
          const err = new Error('Уже утверждён');
          err.statusCode = 400;
          throw err;
        }
      });
      await nd.logEvent(db, permitId, 'issued', { employeeId: eid, payload: { number } });
      await nd.notifyPermitCrew(
        db,
        permitId,
        'Наряд утверждён',
        `Наряд ${number}: прочитайте инструктаж и риски`,
        'issued'
      );
      return { permit: await nd.loadPermitFull(db, permitId) };
    } catch (err) {
      logError(fastify, '[field-nd] issue', err, req);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Ошибка' });
    }
  });

  // ── Acknowledge (worker) ─────────────────────────────────────────────
  fastify.post('/:id/ack', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permitId = Number(req.params.id);
      const permit = await nd.loadPermitFull(db, permitId);
      if (!permit) return reply.code(404).send({ error: 'Не найден' });
      if (permit.status === 'draft') return reply.code(403).send({ error: 'Наряд ещё не утверждён' });
      const inCrew = (permit.crew || []).some((c) => c.employee_id === eid);
      if (!inCrew) return reply.code(403).send({ error: 'Вы не в составе наряда' });

      const sections = (req.body && req.body.sections_read) || ['work', 'risks', 'ppe', 'emergency'];
      await db.query(
        `INSERT INTO nd_acks (permit_id, employee_id, sections_read)
         VALUES ($1,$2,$3)
         ON CONFLICT (permit_id, employee_id) DO UPDATE SET ack_at = NOW(), sections_read = $3`,
        [permitId, eid, JSON.stringify(sections)]
      );
      await nd.logEvent(db, permitId, 'acked', { employeeId: eid });
      return { ok: true, permit: await nd.loadPermitFull(db, permitId) };
    } catch (err) {
      logError(fastify, '[field-nd] ack', err, req);
      return reply.code(500).send({ error: err.message || 'Ошибка' });
    }
  });

  // ── Risk closure checklist (master) ──────────────────────────────────
  fastify.post('/:id/risks/:riskRowId/close', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permitId = Number(req.params.id);
      const riskRowId = Number(req.params.riskRowId);
      const { rows: p } = await db.query(`SELECT * FROM nd_permits WHERE id = $1`, [permitId]);
      if (!p[0]) return reply.code(404).send({ error: 'Не найден' });
      await nd.assertMasterOnWork(db, eid, p[0].work_id);
      const evidence = (req.body && req.body.evidence_text) || null;
      await db.query(
        `INSERT INTO nd_risk_closures (permit_risk_id, is_closed, closed_by_employee_id, closed_at, evidence_text)
         VALUES ($1, true, $2, NOW(), $3)
         ON CONFLICT (permit_risk_id) DO UPDATE SET
           is_closed = true, closed_by_employee_id = $2, closed_at = NOW(),
           evidence_text = COALESCE($3, nd_risk_closures.evidence_text), updated_at = NOW()`,
        [riskRowId, eid, evidence]
      );
      await nd.logEvent(db, permitId, 'risk_closed', { employeeId: eid, payload: { riskRowId } });
      return { permit: await nd.loadPermitFull(db, permitId) };
    } catch (err) {
      logError(fastify, '[field-nd] risk close', err, req);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Ошибка' });
    }
  });

  fastify.post('/:id/risks/:riskRowId/reopen', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permitId = Number(req.params.id);
      const riskRowId = Number(req.params.riskRowId);
      const { rows: p } = await db.query(`SELECT * FROM nd_permits WHERE id = $1`, [permitId]);
      if (!p[0]) return reply.code(404).send({ error: 'Не найден' });
      await nd.assertMasterOnWork(db, eid, p[0].work_id);
      await db.query(
        `UPDATE nd_risk_closures SET is_closed = false, updated_at = NOW() WHERE permit_risk_id = $1`,
        [riskRowId]
      );
      return { permit: await nd.loadPermitFull(db, permitId) };
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Ошибка' });
    }
  });

  // ── Daily admission ──────────────────────────────────────────────────
  fastify.post('/:id/daily', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permitId = Number(req.params.id);
      const { rows: p } = await db.query(`SELECT * FROM nd_permits WHERE id = $1`, [permitId]);
      if (!p[0]) return reply.code(404).send({ error: 'Не найден' });
      if (p[0].status === 'draft' || p[0].status === 'closed' || p[0].status === 'cancelled') {
        return reply.code(400).send({ error: 'Наряд не действует' });
      }
      await nd.assertMasterOnWork(db, eid, p[0].work_id);
      const workDate = (req.body && req.body.work_date) || new Date().toISOString().slice(0, 10);
      const action = (req.body && req.body.action) || 'start';

      if (action === 'start') {
        await db.query(
          `INSERT INTO nd_daily (permit_id, work_date, started_at, admitter_employee_id, admitter_sign_at, producer_employee_id, producer_sign_at)
           VALUES ($1,$2,NOW(),$3,NOW(),$3,NOW())
           ON CONFLICT (permit_id, work_date) DO UPDATE SET
             started_at = COALESCE(nd_daily.started_at, NOW()),
             admitter_employee_id = $3, admitter_sign_at = NOW(),
             producer_employee_id = COALESCE(nd_daily.producer_employee_id, $3),
             producer_sign_at = COALESCE(nd_daily.producer_sign_at, NOW())`,
          [permitId, workDate, eid]
        );
        if (p[0].status === 'issued') {
          await db.query(`UPDATE nd_permits SET status = 'active', updated_at = NOW() WHERE id = $1`, [permitId]);
        }
        await nd.logEvent(db, permitId, 'daily_start', { employeeId: eid, payload: { workDate } });
      } else if (action === 'end') {
        await db.query(
          `UPDATE nd_daily SET ended_at = NOW(), producer_employee_id = COALESCE(producer_employee_id, $3),
             producer_sign_at = COALESCE(producer_sign_at, NOW())
           WHERE permit_id = $1 AND work_date = $2`,
          [permitId, workDate, eid]
        );
        await nd.logEvent(db, permitId, 'daily_end', { employeeId: eid, payload: { workDate } });
      }
      return { permit: await nd.loadPermitFull(db, permitId) };
    } catch (err) {
      logError(fastify, '[field-nd] daily', err, req);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Ошибка' });
    }
  });

  // ── Extensions ───────────────────────────────────────────────────────
  fastify.post('/:id/extensions', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permitId = Number(req.params.id);
      const permit = await nd.loadPermitFull(db, permitId);
      if (!permit) return reply.code(404).send({ error: 'Не найден' });
      if (permit.status === 'draft') return reply.code(400).send({ error: 'Сначала утверждение' });
      const inCrew = (permit.crew || []).some((c) => c.employee_id === eid);
      const assign = await nd.getActiveAssignment(db, eid, permit.work_id);
      if (!inCrew && !(assign && nd.isMasterRole(assign.field_role))) {
        return reply.code(403).send({ error: 'Нет доступа' });
      }

      const { rows: tpl } = await db.query(`SELECT * FROM nd_form_templates WHERE id = $1`, [
        permit.form_template_id,
      ]);
      if (tpl[0]?.extend_once) {
        const { rows: prev } = await db.query(
          `SELECT COUNT(*)::int AS c FROM nd_extensions WHERE permit_id = $1 AND status = 'approved'`,
          [permitId]
        );
        if (prev[0].c > 0) return reply.code(400).send({ error: 'Продление уже использовано' });
      }
      const days = tpl[0]?.extend_days || 7;
      const until =
        (req.body && req.body.requested_until) ||
        new Date(new Date(permit.ends_at || Date.now()).getTime() + days * 86400000).toISOString();

      const { rows } = await db.query(
        `INSERT INTO nd_extensions (permit_id, requested_by_employee_id, requested_until, status)
         VALUES ($1,$2,$3,'pending') RETURNING *`,
        [permitId, eid, until]
      );
      await nd.notifyWorkMasters(
        db,
        permit.work_id,
        permitId,
        'Запрос продления наряда',
        `Наряд ${permit.number}: запрос до ${until}`,
        'extension_request'
      );
      await nd.logEvent(db, permitId, 'extension_requested', { employeeId: eid });
      return { extension: rows[0], permit: await nd.loadPermitFull(db, permitId) };
    } catch (err) {
      logError(fastify, '[field-nd] extension', err, req);
      return reply.code(500).send({ error: err.message || 'Ошибка' });
    }
  });

  fastify.post('/:id/extensions/:extId/decide', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permitId = Number(req.params.id);
      const extId = Number(req.params.extId);
      const { rows: p } = await db.query(`SELECT * FROM nd_permits WHERE id = $1`, [permitId]);
      if (!p[0]) return reply.code(404).send({ error: 'Не найден' });
      await nd.assertMasterOnWork(db, eid, p[0].work_id);
      const approve = !!(req.body && req.body.approve);
      const { rows: ext } = await db.query(`SELECT * FROM nd_extensions WHERE id = $1 AND permit_id = $2`, [
        extId,
        permitId,
      ]);
      if (!ext[0] || ext[0].status !== 'pending') return reply.code(400).send({ error: 'Нет ожидания' });

      await db.query(
        `UPDATE nd_extensions SET status = $2, decided_by_employee_id = $3, decided_at = NOW(), decision_note = $4
         WHERE id = $1`,
        [extId, approve ? 'approved' : 'rejected', eid, (req.body && req.body.note) || null]
      );
      if (approve) {
        await db.query(
          `UPDATE nd_permits SET ends_at = $2, status = 'extended', updated_at = NOW() WHERE id = $1`,
          [permitId, ext[0].requested_until]
        );
        await nd.notifyPermitCrew(
          db,
          permitId,
          'Наряд продлён',
          `До ${ext[0].requested_until}`,
          'extended'
        );
      }
      await nd.logEvent(db, permitId, approve ? 'extension_approved' : 'extension_rejected', {
        employeeId: eid,
      });
      return { permit: await nd.loadPermitFull(db, permitId) };
    } catch (err) {
      logError(fastify, '[field-nd] extension decide', err, req);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Ошибка' });
    }
  });

  // ── Close ────────────────────────────────────────────────────────────
  fastify.post('/:id/close', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permitId = Number(req.params.id);
      const { rows: p } = await db.query(`SELECT * FROM nd_permits WHERE id = $1`, [permitId]);
      if (!p[0]) return reply.code(404).send({ error: 'Не найден' });
      if (p[0].status === 'draft' || p[0].status === 'closed' || p[0].status === 'cancelled') {
        return reply.code(400).send({ error: 'Нельзя закрыть в этом статусе' });
      }
      await nd.assertMasterOnWork(db, eid, p[0].work_id);
      const force = !!(req.body && req.body.force);
      const { rows: openRisks } = await db.query(
        `SELECT COUNT(*)::int AS c FROM nd_permit_risks r
         JOIN nd_risk_closures c ON c.permit_risk_id = r.id
         WHERE r.permit_id = $1 AND c.is_closed = false`,
        [permitId]
      );
      if (openRisks[0].c > 0 && !force) {
        return reply.code(400).send({
          error: `Открытых рисков: ${openRisks[0].c}. Закройте риски или передайте force:true`,
          open_risks: openRisks[0].c,
        });
      }
      await db.query(
        `UPDATE nd_permits SET status = 'closed', closed_at = NOW(), closed_by_employee_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [permitId, eid]
      );
      await nd.logEvent(db, permitId, 'closed', {
        employeeId: eid,
        payload: { force, open_risks: openRisks[0].c },
      });
      await nd.notifyPermitCrew(db, permitId, 'Наряд закрыт', `Наряд ${p[0].number || '#' + permitId} закрыт`, 'closed');
      return { permit: await nd.loadPermitFull(db, permitId) };
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Ошибка' });
    }
  });

  // ── DOCX ─────────────────────────────────────────────────────────────
  fastify.get('/:id/docx', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permit = await nd.loadPermitFull(db, Number(req.params.id));
      if (!permit) return reply.code(404).send({ error: 'Не найден' });
      const assign = await nd.getActiveAssignment(db, eid, permit.work_id);
      const isMaster = assign && nd.isMasterRole(assign.field_role);
      const inCrew = (permit.crew || []).some((c) => c.employee_id === eid);
      if (permit.status === 'draft' && !isMaster) return reply.code(403).send({ error: 'Нет доступа' });
      if (permit.status !== 'draft' && !isMaster && !inCrew) return reply.code(403).send({ error: 'Нет доступа' });
      const buf = buildPermitDocx(permit);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${filenameFor(permit)}"`)
        .send(buf);
    } catch (err) {
      logError(fastify, '[field-nd] docx', err, req);
      return reply.code(500).send({ error: err.message || 'Ошибка' });
    }
  });

  // ── Email (master, after issue) ──────────────────────────────────────
  fastify.post('/:id/email', fieldAuth, async (req, reply) => {
    try {
      const eid = empId(req);
      const permit = await nd.loadPermitFull(db, Number(req.params.id));
      if (!permit) return reply.code(404).send({ error: 'Не найден' });
      await nd.assertMasterOnWork(db, eid, permit.work_id);
      if (permit.status === 'draft') return reply.code(400).send({ error: 'Сначала утвердите наряд' });
      const to = String((req.body && req.body.to) || '').trim();
      if (!to) return reply.code(400).send({ error: 'Укажите to' });

      // Resolve office user for SMTP: try link via employees.user_id if any, else system
      let userId = 1;
      try {
        const { rows: u } = await db.query(
          `SELECT u.id FROM users u
           JOIN employees e ON lower(e.email) = lower(u.email)
           WHERE e.id = $1 LIMIT 1`,
          [eid]
        );
        if (u[0]) userId = u[0].id;
      } catch (_) { /* optional */ }
      const buf = buildPermitDocx(permit);
      await sendCrmEmail(db, userId, {
        to,
        subject: `Наряд-допуск ${permit.number || '#' + permit.id}`,
        text: `Наряд ${permit.number}\n${permit.form_title}\n${permit.work_place || ''}`,
        attachments: [{ filename: filenameFor(permit), content: buf }],
      });
      await nd.logEvent(db, permit.id, 'emailed', { employeeId: eid, payload: { to } });
      return { ok: true };
    } catch (err) {
      logError(fastify, '[field-nd] email', err, req);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Ошибка отправки' });
    }
  });
}

module.exports = routes;
