'use strict';

/**
 * API справочника норм Асгарда.
 * Prefix: /api/work-norms
 * Read: ADMIN, PM, HEAD_PM, TO, HEAD_TO, directors
 * Write: ADMIN, PM, HEAD_PM, TO, HEAD_TO — обязателен comment ≥5 символов
 */

const workNorms = require('../services/work-norms');

const READ_ROLES = [
  'ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];
const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO'];

function requireComment(body) {
  const c = String(body?.comment || '').trim();
  if (c.length < 5) {
    const err = new Error('Комментарий обязателен (минимум 5 символов)');
    err.statusCode = 400;
    throw err;
  }
  return c;
}

async function routes(fastify) {
  const db = fastify.db;

  // ─── Catalog ───────────────────────────────────────────────────────────────
  fastify.get('/catalog', {
    preHandler: [fastify.authenticate, fastify.requireRoles(READ_ROLES)]
  }, async (req) => {
    const category = req.query.category || null;
    const catalog = await workNorms.loadCatalog(db, { category });
    return { ok: true, ...catalog };
  });

  fastify.get('/globals', {
    preHandler: [fastify.authenticate, fastify.requireRoles(READ_ROLES)]
  }, async () => {
    const g = await workNorms.loadGlobals(db);
    return { ok: true, rows: g.rows, map: g.map };
  });

  // ─── Math preview (no AI) ──────────────────────────────────────────────────
  fastify.post('/preview-calc', {
    preHandler: [fastify.authenticate, fastify.requireRoles(READ_ROLES)]
  }, async (req, reply) => {
    const body = req.body || {};
    if (!body.category_code) {
      return reply.code(400).send({ error: 'category_code обязателен' });
    }
    const result = await workNorms.previewCalc(db, body);
    if (result.error && !result.ok) {
      return reply.code(400).send(result);
    }
    return result;
  });

  // ─── History ───────────────────────────────────────────────────────────────
  fastify.get('/history', {
    preHandler: [fastify.authenticate, fastify.requireRoles(READ_ROLES)]
  }, async (req) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const category = req.query.category || null;
    const params = category ? [category, limit] : [limit];
    const { rows } = await db.query(
      `SELECT id, entity_type, entity_id, category_code, action,
              before_json, after_json, comment, user_id, user_name, created_at
       FROM work_norm_change_log
       ${category ? 'WHERE category_code = $1' : ''}
       ORDER BY created_at DESC
       LIMIT $${category ? 2 : 1}`,
      params
    );
    return { ok: true, items: rows };
  });

  // ─── Update globals ────────────────────────────────────────────────────────
  fastify.put('/globals/:key', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    const comment = requireComment(req.body);
    const key = req.params.key;
    const { rows: beforeRows } = await db.query(
      `SELECT * FROM work_norm_globals WHERE key = $1`, [key]
    );
    if (!beforeRows[0]) return reply.code(404).send({ error: 'Ключ не найден' });
    const before = beforeRows[0];
    const valueNum = req.body.value_num !== undefined ? req.body.value_num : before.value_num;
    const valueText = req.body.value_text !== undefined ? req.body.value_text : before.value_text;
    const { rows } = await db.query(
      `UPDATE work_norm_globals
       SET value_num = $2, value_text = $3, updated_at = NOW(), updated_by = $4
       WHERE key = $1 RETURNING *`,
      [key, valueNum, valueText, req.user.id]
    );
    await workNorms.writeChangeLog(db, {
      entity_type: 'global', entity_id: key, category_code: null,
      action: 'update', before, after: rows[0], comment,
      user: req.user
    });
    return { ok: true, row: rows[0] };
  });

  // ─── Update rate ───────────────────────────────────────────────────────────
  fastify.put('/rates/:id', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    const comment = requireComment(req.body);
    const id = parseInt(req.params.id, 10);
    const { rows: beforeRows } = await db.query(
      `SELECT * FROM work_norm_rates WHERE id = $1`, [id]
    );
    if (!beforeRows[0]) return reply.code(404).send({ error: 'Норма не найдена' });
    const before = beforeRows[0];
    const b = req.body || {};
    const fields = {
      name: b.name !== undefined ? b.name : before.name,
      unit: b.unit !== undefined ? b.unit : before.unit,
      calc_kind: b.calc_kind !== undefined ? b.calc_kind : before.calc_kind,
      rate_loose: b.rate_loose !== undefined ? b.rate_loose : before.rate_loose,
      rate_medium: b.rate_medium !== undefined ? b.rate_medium : before.rate_medium,
      rate_hard: b.rate_hard !== undefined ? b.rate_hard : before.rate_hard,
      rate_default: b.rate_default !== undefined ? b.rate_default : before.rate_default,
      crew_json: b.crew_json !== undefined ? JSON.stringify(b.crew_json) : JSON.stringify(before.crew_json),
      params_json: b.params_json !== undefined ? JSON.stringify(b.params_json) : JSON.stringify(before.params_json),
      notes: b.notes !== undefined ? b.notes : before.notes,
      method_code: b.method_code !== undefined ? b.method_code : before.method_code,
      object_code: b.object_code !== undefined ? b.object_code : before.object_code,
      is_active: b.is_active !== undefined ? !!b.is_active : before.is_active
    };
    const { rows } = await db.query(
      `UPDATE work_norm_rates SET
         name=$2, unit=$3, calc_kind=$4,
         rate_loose=$5, rate_medium=$6, rate_hard=$7, rate_default=$8,
         crew_json=$9::jsonb, params_json=$10::jsonb, notes=$11,
         method_code=$12, object_code=$13, is_active=$14,
         updated_at=NOW(), updated_by=$15
       WHERE id=$1 RETURNING *`,
      [
        id, fields.name, fields.unit, fields.calc_kind,
        fields.rate_loose, fields.rate_medium, fields.rate_hard, fields.rate_default,
        fields.crew_json, fields.params_json, fields.notes,
        fields.method_code, fields.object_code, fields.is_active, req.user.id
      ]
    );
    await workNorms.writeChangeLog(db, {
      entity_type: 'rate', entity_id: String(id), category_code: rows[0].category_code,
      action: 'update', before, after: rows[0], comment, user: req.user
    });
    return { ok: true, row: rows[0] };
  });

  // ─── Create rate ───────────────────────────────────────────────────────────
  fastify.post('/rates', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    const comment = requireComment(req.body);
    const b = req.body || {};
    if (!b.category_code || !b.code || !b.name || !b.unit) {
      return reply.code(400).send({ error: 'category_code, code, name, unit обязательны' });
    }
    try {
      const { rows } = await db.query(
        `INSERT INTO work_norm_rates
          (category_code, method_code, object_code, code, name, unit, calc_kind,
           rate_loose, rate_medium, rate_hard, rate_default,
           crew_json, params_json, basis, notes, sort_order, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17)
         RETURNING *`,
        [
          b.category_code, b.method_code || null, b.object_code || null,
          b.code, b.name, b.unit, b.calc_kind || 'per_unit_shift',
          b.rate_loose ?? null, b.rate_medium ?? null, b.rate_hard ?? null, b.rate_default ?? null,
          JSON.stringify(b.crew_json || {}), JSON.stringify(b.params_json || {}),
          b.basis || 'expert', b.notes || null, b.sort_order || 0, req.user.id
        ]
      );
      await workNorms.writeChangeLog(db, {
        entity_type: 'rate', entity_id: String(rows[0].id), category_code: b.category_code,
        action: 'create', before: null, after: rows[0], comment, user: req.user
      });
      return { ok: true, row: rows[0] };
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'Код нормы уже существует' });
      throw e;
    }
  });

  // ─── Chemistry ─────────────────────────────────────────────────────────────
  fastify.put('/chemistry/:id', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    const comment = requireComment(req.body);
    const id = parseInt(req.params.id, 10);
    const { rows: beforeRows } = await db.query(
      `SELECT * FROM work_norm_chemistry WHERE id = $1`, [id]
    );
    if (!beforeRows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const before = beforeRows[0];
    const b = req.body || {};
    const { rows } = await db.query(
      `UPDATE work_norm_chemistry SET
         name=COALESCE($2,name), price_kg=COALESCE($3,price_kg),
         kg_per_m2=COALESCE($4,kg_per_m2), kg_per_m3=COALESCE($5,kg_per_m3),
         deposit_type=COALESCE($6,deposit_type), notes=COALESCE($7,notes),
         is_active=COALESCE($8,is_active),
         updated_at=NOW(), updated_by=$9
       WHERE id=$1 RETURNING *`,
      [
        id,
        b.name ?? null, b.price_kg ?? null, b.kg_per_m2 ?? null, b.kg_per_m3 ?? null,
        b.deposit_type ?? null, b.notes ?? null,
        b.is_active !== undefined ? !!b.is_active : null,
        req.user.id
      ]
    );
    await workNorms.writeChangeLog(db, {
      entity_type: 'chemistry', entity_id: String(id), category_code: null,
      action: 'update', before, after: rows[0], comment, user: req.user
    });
    return { ok: true, row: rows[0] };
  });

  // ─── Equipment ─────────────────────────────────────────────────────────────
  fastify.put('/equipment/:id', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    const comment = requireComment(req.body);
    const id = parseInt(req.params.id, 10);
    const { rows: beforeRows } = await db.query(
      `SELECT * FROM work_norm_equipment WHERE id = $1`, [id]
    );
    if (!beforeRows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const before = beforeRows[0];
    const b = req.body || {};
    const { rows } = await db.query(
      `UPDATE work_norm_equipment SET
         name=COALESCE($2,name), qty_formula=COALESCE($3,qty_formula),
         stub_price_rub=COALESCE($4,stub_price_rub),
         capex_in_cost_pct=COALESCE($5,capex_in_cost_pct),
         purpose=COALESCE($6,purpose), notes=COALESCE($7,notes),
         is_active=COALESCE($8,is_active)
       WHERE id=$1 RETURNING *`,
      [
        id, b.name ?? null, b.qty_formula ?? null, b.stub_price_rub ?? null,
        b.capex_in_cost_pct ?? null, b.purpose ?? null, b.notes ?? null,
        b.is_active !== undefined ? !!b.is_active : null
      ]
    );
    await workNorms.writeChangeLog(db, {
      entity_type: 'equipment', entity_id: String(id),
      category_code: rows[0].category_code, action: 'update',
      before, after: rows[0], comment, user: req.user
    });
    return { ok: true, row: rows[0] };
  });

  // ─── Coeffs ────────────────────────────────────────────────────────────────
  fastify.put('/coeffs/:id', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    const comment = requireComment(req.body);
    const id = parseInt(req.params.id, 10);
    const { rows: beforeRows } = await db.query(
      `SELECT * FROM work_norm_coeffs WHERE id = $1`, [id]
    );
    if (!beforeRows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const before = beforeRows[0];
    const b = req.body || {};
    const { rows } = await db.query(
      `UPDATE work_norm_coeffs SET
         label=COALESCE($2,label), multiplier=COALESCE($3,multiplier),
         notes=COALESCE($4,notes), is_active=COALESCE($5,is_active)
       WHERE id=$1 RETURNING *`,
      [
        id, b.label ?? null, b.multiplier ?? null, b.notes ?? null,
        b.is_active !== undefined ? !!b.is_active : null
      ]
    );
    await workNorms.writeChangeLog(db, {
      entity_type: 'coeff', entity_id: String(id),
      category_code: rows[0].category_code, action: 'update',
      before, after: rows[0], comment, user: req.user
    });
    return { ok: true, row: rows[0] };
  });

  // ─── Excel export ──────────────────────────────────────────────────────────
  fastify.get('/export.xlsx', {
    preHandler: [fastify.authenticate, fastify.requireRoles(READ_ROLES)]
  }, async (req, reply) => {
    const ExcelJS = require('exceljs');
    const catalog = await workNorms.loadCatalog(db);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ASGARD CRM';

    const wsG = wb.addWorksheet('Globals');
    wsG.addRow(['key', 'value_num', 'value_text', 'label', 'unit']);
    for (const r of catalog.globalsRows || []) {
      wsG.addRow([r.key, r.value_num, r.value_text, r.label, r.unit]);
    }

    for (const cat of catalog.categories || []) {
      const name = String(cat.title || cat.code).slice(0, 28);
      const ws = wb.addWorksheet(name);
      ws.addRow([
        'id', 'code', 'method_code', 'name', 'unit', 'calc_kind',
        'rate_loose', 'rate_medium', 'rate_hard', 'rate_default', 'notes'
      ]);
      for (const r of (catalog.rates || []).filter((x) => x.category_code === cat.code)) {
        ws.addRow([
          r.id, r.code, r.method_code, r.name, r.unit, r.calc_kind,
          r.rate_loose, r.rate_medium, r.rate_hard, r.rate_default, r.notes
        ]);
      }
    }

    const wsC = wb.addWorksheet('Chemistry');
    wsC.addRow(['id', 'code', 'name', 'price_kg', 'kg_per_m2', 'kg_per_m3', 'notes']);
    for (const c of catalog.chemistry || []) {
      wsC.addRow([c.id, c.code, c.name, c.price_kg, c.kg_per_m2, c.kg_per_m3, c.notes]);
    }

    const wsE = wb.addWorksheet('Equipment');
    wsE.addRow(['id', 'category_code', 'code', 'name', 'stub_price_rub', 'capex_in_cost_pct', 'notes']);
    for (const e of catalog.equipment || []) {
      wsE.addRow([e.id, e.category_code, e.code, e.name, e.stub_price_rub, e.capex_in_cost_pct, e.notes]);
    }

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="work_norms.xlsx"');
    return reply.send(buf);
  });

  // ─── Excel import (rates sheet by id) ───────────────────────────────────────
  fastify.post('/import.xlsx', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'Файл обязателен' });
    const comment = String(req.query.comment || req.headers['x-comment'] || '').trim();
    if (comment.length < 5) {
      return reply.code(400).send({ error: 'Комментарий обязателен (query ?comment=…, мин. 5 символов)' });
    }
    const ExcelJS = require('exceljs');
    const buf = await data.toBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    let updated = 0;
    const errors = [];

    for (const ws of wb.worksheets) {
      if (['Globals', 'Chemistry', 'Equipment'].includes(ws.name)) continue;
      const header = {};
      ws.getRow(1).eachCell((cell, col) => {
        header[String(cell.value || '').toLowerCase()] = col;
      });
      if (!header.id) continue;
      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        const id = row.getCell(header.id).value;
        if (!id || !Number(id)) continue;
        const patch = {};
        for (const key of ['rate_loose', 'rate_medium', 'rate_hard', 'rate_default', 'name', 'unit', 'notes']) {
          if (header[key]) {
            const v = row.getCell(header[key]).value;
            if (v !== null && v !== undefined && v !== '') patch[key] = v;
          }
        }
        if (!Object.keys(patch).length) continue;
        try {
          const { rows: beforeRows } = await db.query(
            `SELECT * FROM work_norm_rates WHERE id = $1`, [Number(id)]
          );
          if (!beforeRows[0]) { errors.push(`id=${id} not found`); continue; }
          const before = beforeRows[0];
          const { rows } = await db.query(
            `UPDATE work_norm_rates SET
               rate_loose=COALESCE($2,rate_loose),
               rate_medium=COALESCE($3,rate_medium),
               rate_hard=COALESCE($4,rate_hard),
               rate_default=COALESCE($5,rate_default),
               name=COALESCE($6,name),
               unit=COALESCE($7,unit),
               notes=COALESCE($8,notes),
               updated_at=NOW(), updated_by=$9
             WHERE id=$1 RETURNING *`,
            [
              Number(id),
              patch.rate_loose ?? null, patch.rate_medium ?? null,
              patch.rate_hard ?? null, patch.rate_default ?? null,
              patch.name ?? null, patch.unit ?? null, patch.notes ?? null,
              req.user.id
            ]
          );
          await workNorms.writeChangeLog(db, {
            entity_type: 'rate', entity_id: String(id),
            category_code: rows[0].category_code, action: 'import',
            before, after: rows[0], comment, user: req.user
          });
          updated++;
        } catch (e) {
          errors.push(`id=${id}: ${e.message}`);
        }
      }
    }

    return { ok: true, updated, errors };
  });

  // ─── Experiences (банк опыта РП) ────────────────────────────────────────────
  fastify.get('/experiences', {
    preHandler: [fastify.authenticate, fastify.requireRoles(READ_ROLES)]
  }, async (req) => {
    const items = await workNorms.listExperiences(db, {
      category: req.query.category || null,
      status: req.query.status || null,
      limit: parseInt(req.query.limit || '80', 10)
    });
    return { ok: true, items };
  });

  fastify.post('/experiences/propose', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    try {
      const result = await workNorms.proposeFromStory(db, req.body || {}, req.user);
      return result;
    } catch (e) {
      return reply.code(e.statusCode || 500).send({ error: e.message, ok: false });
    }
  });

  fastify.post('/experiences/derive', {
    preHandler: [fastify.authenticate, fastify.requireRoles(READ_ROLES)]
  }, async (req) => {
    const g = await workNorms.loadGlobals(db);
    const body = req.body || {};
    let catRow = null;
    if (body.category_code) {
      const { rows } = await db.query(
        `SELECT * FROM work_norm_categories WHERE code = $1`,
        [body.category_code]
      );
      catRow = rows[0] || null;
    }
    const derived = workNorms.deriveFromExperience(body, g.map, catRow);
    return { ok: true, derived };
  });

  fastify.get('/experiences/:id', {
    preHandler: [fastify.authenticate, fastify.requireRoles(READ_ROLES)]
  }, async (req, reply) => {
    const row = await workNorms.getExperience(db, parseInt(req.params.id, 10));
    if (!row) return reply.code(404).send({ error: 'Не найдено' });
    return { ok: true, row };
  });

  fastify.post('/experiences', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    try {
      const result = await workNorms.createExperience(db, req.body || {}, req.user);
      return { ok: true, ...result };
    } catch (e) {
      return reply.code(e.statusCode || 500).send({ error: e.message });
    }
  });

  fastify.put('/experiences/:id', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    try {
      const result = await workNorms.updateExperience(
        db, parseInt(req.params.id, 10), req.body || {}, req.user
      );
      return { ok: true, ...result };
    } catch (e) {
      return reply.code(e.statusCode || 500).send({ error: e.message });
    }
  });

  fastify.post('/experiences/:id/confirm', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    try {
      const row = await workNorms.confirmExperience(
        db, parseInt(req.params.id, 10), req.body?.comment, req.user
      );
      return { ok: true, row };
    } catch (e) {
      return reply.code(e.statusCode || 500).send({ error: e.message });
    }
  });

  fastify.post('/experiences/:id/publish', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WRITE_ROLES)]
  }, async (req, reply) => {
    try {
      const result = await workNorms.publishExperience(
        db,
        parseInt(req.params.id, 10),
        { comment: req.body?.comment, mode: req.body?.mode },
        req.user
      );
      return { ok: true, ...result };
    } catch (e) {
      return reply.code(e.statusCode || 500).send({ error: e.message });
    }
  });

  fastify.get('/works/search', {
    preHandler: [fastify.authenticate, fastify.requireRoles(READ_ROLES)]
  }, async (req) => {
    const items = await workNorms.searchClosedWorks(
      db, req.query.q || '', parseInt(req.query.limit || '20', 10)
    );
    return { ok: true, items };
  });

  fastify.get('/works/:id/hint', {
    preHandler: [fastify.authenticate, fastify.requireRoles(READ_ROLES)]
  }, async (req, reply) => {
    const hint = await workNorms.getWorkHint(db, parseInt(req.params.id, 10));
    if (!hint) return reply.code(404).send({ error: 'Работа не найдена' });
    return { ok: true, hint };
  });
}

module.exports = routes;
