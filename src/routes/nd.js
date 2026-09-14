'use strict';

/**
 * Office API: /api/nd — РП создаёт/правит черновики; конфигуратор справочников.
 */

const { logError } = require('../lib/log-error');
const nd = require('../lib/nd-core');
const { normalizeSectionsJson } = require('../lib/nd-blocks');
const { buildPermitDocx, filenameFor } = require('../services/nd-docx');
const { sendCrmEmail } = require('../services/crm-mailer');

const CRM_ROLES = [
  'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'CHIEF_ENGINEER', 'ADMIN',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER', 'HR', 'HR_MANAGER',
];

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.requireRoles(CRM_ROLES)] };

  // ── Catalog ──────────────────────────────────────────────────────────
  fastify.get('/templates', auth, async () => {
    const { rows } = await db.query(
      `SELECT * FROM nd_form_templates WHERE is_active = true ORDER BY sort_order, id`
    );
    return { templates: rows };
  });

  fastify.get('/risks', auth, async (req) => {
    const form = req.query.form_code || null;
    let sql = `SELECT r.*,
      COALESCE(json_agg(json_build_object('id', m.id, 'code', m.code, 'title', m.title)
        ORDER BY m.sort_order) FILTER (WHERE m.id IS NOT NULL), '[]') AS measures
      FROM nd_risk_catalog r
      LEFT JOIN nd_risk_measures rm ON rm.risk_id = r.id
      LEFT JOIN nd_measure_catalog m ON m.id = rm.measure_id AND m.is_active
      WHERE r.is_active = true`;
    const params = [];
    if (form) {
      params.push(form);
      sql += ` AND ($1 = ANY(r.form_codes) OR cardinality(r.form_codes) = 0)`;
    }
    sql += ` GROUP BY r.id ORDER BY r.sort_order, r.id`;
    const { rows } = await db.query(sql, params);
    return { risks: rows };
  });

  fastify.get('/measures', auth, async () => {
    const { rows } = await db.query(
      `SELECT * FROM nd_measure_catalog WHERE is_active = true ORDER BY sort_order, id`
    );
    return { measures: rows };
  });

  fastify.post('/risks', auth, async (req, reply) => {
    try {
      const { code, title, description, form_codes, measure_ids, category } = req.body || {};
      if (!code || !title) return reply.code(400).send({ error: 'code и title обязательны' });
      const { rows } = await db.query(
        `INSERT INTO nd_risk_catalog (code, title, description, form_codes, category)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [code, title, description || null, form_codes || [], category || 'general']
      );
      const risk = rows[0];
      if (Array.isArray(measure_ids)) {
        for (const mid of measure_ids) {
          await db.query(
            `INSERT INTO nd_risk_measures (risk_id, measure_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [risk.id, mid]
          );
        }
      }
      return { risk };
    } catch (err) {
      logError(fastify, '[nd] POST /risks', err, req);
      return reply.code(500).send({ error: err.message || 'Ошибка' });
    }
  });

  fastify.put('/risks/:id', auth, async (req, reply) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const { rows } = await db.query(
        `UPDATE nd_risk_catalog SET
           title = COALESCE($2, title),
           description = COALESCE($3, description),
           form_codes = COALESCE($4, form_codes),
           category = COALESCE($5, category),
           is_active = COALESCE($6, is_active)
         WHERE id = $1 RETURNING *`,
        [
          id,
          b.title != null ? b.title : null,
          b.description != null ? b.description : null,
          b.form_codes != null ? b.form_codes : null,
          b.category != null ? b.category : null,
          b.is_active != null ? b.is_active : null,
        ]
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Не найден' });
      if (Array.isArray(b.measure_ids)) {
        await db.query(`DELETE FROM nd_risk_measures WHERE risk_id = $1`, [id]);
        for (const mid of b.measure_ids) {
          await db.query(
            `INSERT INTO nd_risk_measures (risk_id, measure_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [id, mid]
          );
        }
      }
      return { risk: rows[0] };
    } catch (err) {
      logError(fastify, '[nd] PUT /risks', err, req);
      return reply.code(500).send({ error: err.message || 'Ошибка' });
    }
  });

  fastify.delete('/risks/:id', auth, async (req, reply) => {
    await db.query(`UPDATE nd_risk_catalog SET is_active = false WHERE id = $1`, [Number(req.params.id)]);
    return { ok: true };
  });

  fastify.post('/measures', auth, async (req, reply) => {
    try {
      const { code, title, description, category } = req.body || {};
      if (!code || !title) return reply.code(400).send({ error: 'code и title обязательны' });
      const { rows } = await db.query(
        `INSERT INTO nd_measure_catalog (code, title, description, category) VALUES ($1,$2,$3,$4) RETURNING *`,
        [code, title, description || null, category || 'general']
      );
      return { measure: rows[0] };
    } catch (err) {
      logError(fastify, '[nd] POST /measures', err, req);
      return reply.code(500).send({ error: err.message || 'Ошибка' });
    }
  });

  fastify.put('/measures/:id', auth, async (req, reply) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const { rows } = await db.query(
        `UPDATE nd_measure_catalog SET
           title = COALESCE($2, title),
           description = COALESCE($3, description),
           category = COALESCE($4, category),
           is_active = COALESCE($5, is_active)
         WHERE id = $1 RETURNING *`,
        [
          id,
          b.title != null ? b.title : null,
          b.description != null ? b.description : null,
          b.category != null ? b.category : null,
          b.is_active != null ? b.is_active : null,
        ]
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Не найден' });
      return { measure: rows[0] };
    } catch (err) {
      return reply.code(500).send({ error: err.message || 'Ошибка' });
    }
  });

  fastify.delete('/measures/:id', auth, async (req, reply) => {
    await db.query(`UPDATE nd_measure_catalog SET is_active = false WHERE id = $1`, [Number(req.params.id)]);
    return { ok: true };
  });

  // ── List by work ─────────────────────────────────────────────────────
  fastify.get('/works/:workId', auth, async (req, reply) => {
    const workId = Number(req.params.workId);
    const { rows } = await db.query(
      `SELECT p.id, p.number, p.status, p.form_code, p.work_content, p.starts_at, p.ends_at,
              p.created_at, p.issued_at, ft.title AS form_title,
              (SELECT COUNT(*) FROM nd_permit_crew c WHERE c.permit_id = p.id) AS crew_count,
              (SELECT COUNT(*) FROM nd_permit_risks r WHERE r.permit_id = p.id) AS risks_count
       FROM nd_permits p
       JOIN nd_form_templates ft ON ft.id = p.form_template_id
       WHERE p.work_id = $1
       ORDER BY p.id DESC`,
      [workId]
    );
    return { permits: rows };
  });

  // Helpers BEFORE /:id so Fastify never confuses path segments
  fastify.get('/works/:workId/crew-options', auth, async (req) => {
    const workId = Number(req.params.workId);
    const { rows } = await db.query(
      `SELECT ea.employee_id, ea.field_role, e.fio, e.role_tag
       FROM employee_assignments ea
       JOIN employees e ON e.id = ea.employee_id
       WHERE ea.work_id = $1 AND ea.is_active = true
       ORDER BY e.fio`,
      [workId]
    );
    return { crew: rows };
  });

  fastify.get('/works/:workId/equipment-options', auth, async (req) => {
    const workId = Number(req.params.workId);
    try {
      const { rows } = await db.query(
        `SELECT ewa.equipment_id, e.name, e.inventory_number
         FROM equipment_work_assignments ewa
         JOIN equipment e ON e.id = ewa.equipment_id
         WHERE ewa.work_id = $1 AND (ewa.unassigned_at IS NULL OR ewa.is_active = true)
         ORDER BY e.name`,
        [workId]
      );
      return { equipment: rows };
    } catch (_) {
      try {
        const { rows } = await db.query(
          `SELECT ewa.equipment_id, e.name, e.inventory_number
           FROM equipment_work_assignments ewa
           JOIN equipment e ON e.id = ewa.equipment_id
           WHERE ewa.work_id = $1
           ORDER BY e.name`,
          [workId]
        );
        return { equipment: rows };
      } catch (e2) {
        return { equipment: [] };
      }
    }
  });

  fastify.get('/:id', auth, async (req, reply) => {
    const permit = await nd.loadPermitFull(db, Number(req.params.id));
    if (!permit) return reply.code(404).send({ error: 'Наряд не найден' });
    return { permit };
  });

  // ── Create draft (РП) ────────────────────────────────────────────────
  fastify.post('/', auth, async (req, reply) => {
    try {
      const body = req.body || {};
      const workId = Number(body.work_id);
      const formCode = body.form_code;
      if (!workId || !formCode) return reply.code(400).send({ error: 'work_id и form_code обязательны' });
      if (!String(body.work_content || '').trim()) {
        return reply.code(400).send({ error: 'Укажите содержание работ' });
      }

      const { rows: tpl } = await db.query(
        `SELECT * FROM nd_form_templates WHERE code = $1 AND is_active = true`,
        [formCode]
      );
      if (!tpl[0]) return reply.code(400).send({ error: 'Неизвестный тип наряда' });

      const { rows: work } = await db.query(
        `SELECT id, object_name, address, city, customer_name, work_title FROM works WHERE id = $1`,
        [workId]
      );
      if (!work[0]) return reply.code(404).send({ error: 'Работа не найдена' });

      const place =
        body.work_place ||
        [work[0].object_name, work[0].city, work[0].address].filter(Boolean).join(', ');

      const defaultPpe =
        'Химстойкий костюм/фартук, сапоги, перчатки, очки и щиток, каска, респиратор по паспорту безопасности; для АВД — водостойкая одежда и защита слуха.';
      const defaultEmer =
        'Остановить насос, перекрыть арматуру, удалить людей, локализовать пролив. При попадании реагента — промывать водой ≥15 мин. При газе/дыме — прекратить работы, сообщить допускающему.';

      const starts = body.starts_at ? new Date(body.starts_at) : new Date();
      const maxDays = tpl[0].max_days || 7;
      const ends = body.ends_at
        ? new Date(body.ends_at)
        : new Date(starts.getTime() + maxDays * 86400000);

      const schema = tpl[0].schema_json || {};
      const sections = normalizeSectionsJson(body.sections_json, schema);

      const { rows } = await db.query(
        `INSERT INTO nd_permits (
           work_id, form_template_id, form_code, form_version, status,
           work_content, work_place, ppe_text, emergency_text, sections_json,
           starts_at, ends_at, created_by_user_id, template_snapshot
         ) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          workId,
          tpl[0].id,
          tpl[0].code,
          tpl[0].version,
          body.work_content || null,
          place,
          body.ppe_text || defaultPpe,
          body.emergency_text || defaultEmer,
          JSON.stringify(sections),
          starts,
          ends,
          req.user.id,
          JSON.stringify({
            code: tpl[0].code,
            title: tpl[0].title,
            legal_basis: tpl[0].legal_basis,
            version: tpl[0].version,
            schema_json: schema,
          }),
        ]
      );
      const permit = rows[0];
      await nd.replaceCrew(db, permit.id, body.crew);
      await nd.replaceEquipment(db, permit.id, body.equipment);

      let risksPayload = body.risks;
      if (!Array.isArray(risksPayload) || !risksPayload.length) {
        const codes = Array.isArray(schema.default_risk_codes) ? schema.default_risk_codes : [];
        if (codes.length) {
          const { rows: defRisks } = await db.query(
            `SELECT r.id, r.title,
               COALESCE(json_agg(json_build_object('id', m.id, 'title', m.title)
                 ORDER BY m.sort_order) FILTER (WHERE m.id IS NOT NULL), '[]') AS measures
             FROM nd_risk_catalog r
             LEFT JOIN nd_risk_measures rm ON rm.risk_id = r.id
             LEFT JOIN nd_measure_catalog m ON m.id = rm.measure_id AND m.is_active
             WHERE r.is_active AND r.code = ANY($1)
             GROUP BY r.id ORDER BY r.sort_order`,
            [codes]
          );
          risksPayload = defRisks.map((r) => ({
            risk_id: r.id,
            risk_title: r.title,
            measure_ids: (r.measures || []).map((m) => m.id),
            measure_titles: (r.measures || []).map((m) => m.title),
          }));
        }
      }
      await nd.replaceRisks(db, permit.id, risksPayload);
      await nd.logEvent(db, permit.id, 'created', { userId: req.user.id, payload: { form_code: formCode } });
      await nd.notifyWorkMasters(
        db,
        workId,
        permit.id,
        'Новый черновик наряда',
        `${tpl[0].title}: ожидает утверждения мастера`,
        'draft_created'
      );

      // Notify PM user? masters are employees — inbox is enough.
      const full = await nd.loadPermitFull(db, permit.id);
      return { permit: full };
    } catch (err) {
      logError(fastify, '[nd] POST /', err, req);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Ошибка' });
    }
  });

  // ── Update draft (РП) ────────────────────────────────────────────────
  fastify.put('/:id', auth, async (req, reply) => {
    try {
      const id = Number(req.params.id);
      const { rows: cur } = await db.query(`SELECT * FROM nd_permits WHERE id = $1`, [id]);
      if (!cur[0]) return reply.code(404).send({ error: 'Наряд не найден' });
      if (cur[0].status !== 'draft') {
        return reply.code(400).send({ error: 'После утверждения РП правит только через мастера (ограниченно)' });
      }
      const b = req.body || {};
      if (b.work_content != null && !String(b.work_content).trim()) {
        return reply.code(400).send({ error: 'Укажите содержание работ' });
      }
      let formTpl = null;
      if (b.form_code && b.form_code !== cur[0].form_code) {
        const { rows: tpl } = await db.query(
          `SELECT * FROM nd_form_templates WHERE code = $1 AND is_active = true`,
          [b.form_code]
        );
        if (!tpl[0]) return reply.code(400).send({ error: 'Неизвестный тип наряда' });
        formTpl = tpl[0];
      }
      let schemaForSections = null;
      if (b.sections_json != null) {
        if (formTpl) schemaForSections = formTpl.schema_json;
        else {
          const { rows: curTpl } = await db.query(
            `SELECT schema_json FROM nd_form_templates WHERE id = $1`,
            [cur[0].form_template_id]
          );
          schemaForSections =
            (curTpl[0] && curTpl[0].schema_json) ||
            (cur[0].template_snapshot && cur[0].template_snapshot.schema_json) ||
            {};
        }
      }
      await db.query(
        `UPDATE nd_permits SET
           work_content = COALESCE($2, work_content),
           work_place = COALESCE($3, work_place),
           ppe_text = COALESCE($4, ppe_text),
           emergency_text = COALESCE($5, emergency_text),
           sections_json = COALESCE($6, sections_json),
           starts_at = COALESCE($7, starts_at),
           ends_at = COALESCE($8, ends_at),
           form_template_id = COALESCE($9, form_template_id),
           form_code = COALESCE($10, form_code),
           form_version = COALESCE($11, form_version),
           template_snapshot = COALESCE($12, template_snapshot),
           updated_at = NOW()
         WHERE id = $1`,
        [
          id,
          b.work_content != null ? b.work_content : null,
          b.work_place != null ? b.work_place : null,
          b.ppe_text != null ? b.ppe_text : null,
          b.emergency_text != null ? b.emergency_text : null,
          b.sections_json != null
            ? JSON.stringify(normalizeSectionsJson(b.sections_json, schemaForSections || {}))
            : null,
          b.starts_at || null,
          b.ends_at || null,
          formTpl ? formTpl.id : null,
          formTpl ? formTpl.code : null,
          formTpl ? formTpl.version : null,
          formTpl
            ? JSON.stringify({
                code: formTpl.code,
                title: formTpl.title,
                legal_basis: formTpl.legal_basis,
                version: formTpl.version,
                schema_json: formTpl.schema_json,
              })
            : null,
        ]
      );
      if (b.crew) await nd.replaceCrew(db, id, b.crew);
      if (b.equipment) await nd.replaceEquipment(db, id, b.equipment);
      if (b.risks) await nd.replaceRisks(db, id, b.risks);
      await nd.logEvent(db, id, 'updated_by_pm', { userId: req.user.id });
      return { permit: await nd.loadPermitFull(db, id) };
    } catch (err) {
      logError(fastify, '[nd] PUT /:id', err, req);
      return reply.code(500).send({ error: err.message || 'Ошибка' });
    }
  });

  fastify.delete('/:id', auth, async (req, reply) => {
    const id = Number(req.params.id);
    const { rows } = await db.query(`SELECT status FROM nd_permits WHERE id = $1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найден' });
    if (rows[0].status !== 'draft') return reply.code(400).send({ error: 'Можно удалить только черновик' });
    await db.query(`DELETE FROM nd_permits WHERE id = $1`, [id]);
    return { ok: true };
  });

  // ── Word download (draft ok for PM) ──────────────────────────────────
  fastify.get('/:id/docx', auth, async (req, reply) => {
    try {
      const permit = await nd.loadPermitFull(db, Number(req.params.id));
      if (!permit) return reply.code(404).send({ error: 'Не найден' });
      const buf = buildPermitDocx(permit);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${filenameFor(permit)}"`)
        .send(buf);
    } catch (err) {
      logError(fastify, '[nd] GET docx', err, req);
      return reply.code(500).send({ error: err.message || 'Ошибка генерации' });
    }
  });

  // ── Email after issue (PM can also send) ─────────────────────────────
  fastify.post('/:id/email', auth, async (req, reply) => {
    try {
      const permit = await nd.loadPermitFull(db, Number(req.params.id));
      if (!permit) return reply.code(404).send({ error: 'Не найден' });
      if (permit.status === 'draft') {
        return reply.code(400).send({ error: 'Сначала мастер должен утвердить наряд' });
      }
      const to = String((req.body && req.body.to) || '').trim();
      if (!to) return reply.code(400).send({ error: 'Укажите to' });
      const buf = buildPermitDocx(permit);
      await sendCrmEmail(db, req.user.id, {
        to,
        subject: `Наряд-допуск ${permit.number || '#' + permit.id}`,
        text: `Наряд ${permit.number}\n${permit.form_title}\n${permit.work_place || ''}`,
        attachments: [
          {
            filename: filenameFor(permit),
            content: buf,
          },
        ],
      });
      await nd.logEvent(db, permit.id, 'emailed', { userId: req.user.id, payload: { to } });
      return { ok: true };
    } catch (err) {
      logError(fastify, '[nd] email', err, req);
      return reply.code(500).send({ error: err.message || 'Ошибка отправки' });
    }
  });

}

module.exports = routes;
