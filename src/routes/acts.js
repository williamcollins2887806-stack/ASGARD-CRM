/**
 * ASGARD CRM - Acts Routes
 * Акты выполненных работ — реестр + конструктор (позиции, PDF, отправка).
 */

const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];
const billing = require('../services/billing-docs');
const office = require('../services/billing-office');

async function actsRoutes(fastify) {
  const db = fastify.db;

  async function generateActNumber() {
    const year = new Date().getFullYear();
    const prefix = `АКТ-${year}-`;
    const { rows } = await db.query(
      `SELECT act_number FROM acts
       WHERE act_number LIKE $1
       ORDER BY act_number DESC LIMIT 1`,
      [prefix + '%']
    );
    let next = 1;
    if (rows.length > 0) {
      const match = rows[0].act_number.match(/(\d+)$/);
      if (match) next = parseInt(match[1], 10) + 1;
    }
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  async function defaultVatPct() {
    try {
      const vat = await db.query("SELECT value_json FROM settings WHERE key = 'vat_default_pct'");
      if (vat.rows[0]) {
        const v = typeof vat.rows[0].value_json === 'string'
          ? JSON.parse(vat.rows[0].value_json)
          : vat.rows[0].value_json;
        if (v != null && v !== '') return Number(v);
      }
    } catch (_) { /* fallback */ }
    return 22;
  }

  fastify.get('/next-number', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const number = await generateActNumber();
    return { success: true, number };
  });

  fastify.get('/stats/summary', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const result = await db.query(`
      SELECT
        status,
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as total_sum
      FROM acts
      GROUP BY status
    `);
    return { success: true, stats: result.rows };
  });

  async function virtualFromBody(body) {
    const n = billing.normalizeBillingBody(body || {}, { vat_pct: await defaultVatPct() });
    return {
      ...n,
      act_number: body?.act_number || 'АКТ-черновик',
      act_date: body?.act_date || new Date().toISOString().slice(0, 10),
      items_json: n.items
    };
  }

  fastify.post('/preview-pdf', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const flags = office.facsimileOpts(Object.assign({}, request.query, request.body));
    const virtual = await virtualFromBody(request.body);
    const buf = await billing.generateBillingPdf(db, 'act', virtual, flags);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'inline; filename="act-preview.pdf"');
    return reply.send(buf);
  });

  fastify.post('/preview-docx', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const flags = office.facsimileOpts(Object.assign({}, request.query, request.body));
    const virtual = await virtualFromBody(request.body);
    const company = billing.mergeIssuer(await billing.loadCompany(db), virtual.issuer_json || virtual.issuer);
    return office.sendOffice(reply, 'act', virtual, company, flags, 'docx');
  });

  fastify.post('/preview-xlsx', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const flags = office.facsimileOpts(Object.assign({}, request.query, request.body));
    const virtual = await virtualFromBody(request.body);
    const company = billing.mergeIssuer(await billing.loadCompany(db), virtual.issuer_json || virtual.issuer);
    return office.sendOffice(reply, 'act', virtual, company, flags, 'xlsx');
  });

  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_id, customer_name, status, limit = 100 } = request.query;

    let sql = `SELECT a.*, w.work_title, w.work_number
               FROM acts a
               LEFT JOIN works w ON w.id = a.work_id
               WHERE 1=1`;
    const params = [];

    if (work_id) {
      params.push(work_id);
      sql += ` AND a.work_id = $${params.length}`;
    }
    if (customer_name) {
      params.push('%' + customer_name + '%');
      sql += ` AND a.customer_name ILIKE $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND a.status = $${params.length}`;
    }

    params.push(parseInt(limit, 10) || 100);
    sql += ` ORDER BY a.created_at DESC LIMIT $${params.length}`;

    const result = await db.query(sql, params);
    return { success: true, acts: result.rows };
  });

  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const result = await db.query(
      `SELECT a.*, w.work_title, w.work_number
       FROM acts a
       LEFT JOIN works w ON w.id = a.work_id
       WHERE a.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Акт не найден' });
    }
    return { success: true, act: result.rows[0] };
  });

  fastify.post('/', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const body = request.body || {};
    const n = billing.normalizeBillingBody(body, {
      vat_pct: body.vat_pct == null ? await defaultVatPct() : undefined,
      status: 'draft'
    });
    if (!(n.amount > 0) && !(n.total_amount > 0)) {
      return reply.code(400).send({ success: false, message: 'Укажите сумму или позиции' });
    }
    const act_number = body.act_number || await generateActNumber();
    const act = await billing.insertDoc(db, 'acts', {
      ...n,
      act_number,
      act_date: body.act_date || new Date().toISOString().slice(0, 10),
      act_type: body.act_type || 'issued',
      signed_date: body.signed_date || null,
      paid_date: body.paid_date || null,
      created_by: request.user?.id
    });
    return { success: true, act };
  });

  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};
    const n = billing.normalizeBillingBody(body, { status: body.status });
    const patch = billing.patchFromBody(body, n);
    if ('act_number' in body) patch.act_number = body.act_number;
    if ('act_date' in body) patch.act_date = body.act_date;
    if ('act_type' in body) patch.act_type = body.act_type;
    if ('signed_date' in body) patch.signed_date = body.signed_date || null;
    if ('paid_date' in body) patch.paid_date = body.paid_date || null;
    const act = await billing.updateDoc(db, 'acts', id, patch);
    if (!act) {
      return reply.code(404).send({ success: false, message: 'Акт не найден' });
    }
    return { success: true, act };
  });

  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const result = await db.query('DELETE FROM acts WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Акт не найден' });
    }
    return { success: true, deleted: true };
  });

  fastify.post('/:id/send', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await db.query('SELECT * FROM acts WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ success: false, message: 'Акт не найден' });
    const act = rows[0];
    const body = request.body || {};
    const email = body.to || body.email || act.contact_email;
    if (!email) return reply.code(400).send({ success: false, message: 'Укажите email получателя' });

    const flags = office.facsimileOpts(body);
    const pdfBuf = await billing.generateBillingPdf(db, 'act', act, flags);
    const sumStr = billing.fmtMoney(act.total_amount) + ' ₽';
    const emailText = body.body || body.custom_text ||
      `Добрый день!\n\nНаправляем акт выполненных работ № ${act.act_number || act.id} от ${billing.fmtDate(act.act_date)}.\nСумма: ${sumStr}\n\nС уважением,\nООО «Асгард-Сервис»`;

    try {
      const crmMailer = require('../services/crm-mailer');
      await crmMailer.sendCrmEmail(db, request.user.id, {
        to: email,
        cc: body.cc || undefined,
        subject: body.subject || `Акт № ${act.act_number || act.id}`,
        text: emailText,
        attachments: [{
          filename: `Akt_${act.act_number || act.id}.pdf`,
          content: pdfBuf,
          contentType: 'application/pdf'
        }]
      });
    } catch (err) {
      fastify.log.error({ err }, 'act send email failed');
      return reply.code(502).send({ success: false, message: err.message || 'Не удалось отправить письмо' });
    }

    const updated = await billing.updateDoc(db, 'acts', id, {
      status: 'sent',
      contact_email: email
    });
    return { success: true, message: `Акт отправлен на ${email}`, act: updated };
  });

  const officeAuth = [
    async (request) => {
      if (!request.headers.authorization && request.query.token) {
        request.headers.authorization = 'Bearer ' + request.query.token;
      }
    },
    fastify.authenticate
  ];

  async function loadActOr404(id, reply) {
    const actRes = await db.query('SELECT * FROM acts WHERE id = $1', [id]);
    if (actRes.rows.length === 0) {
      reply.code(404).send({ success: false, message: 'Акт не найден' });
      return null;
    }
    return actRes.rows[0];
  }

  fastify.get('/:id/docx', {
    preHandler: officeAuth
  }, async (request, reply) => {
    const act = await loadActOr404(request.params.id, reply);
    if (!act) return;
    const flags = office.facsimileOpts(request.query);
    const company = billing.mergeIssuer(await billing.loadCompany(db), act.issuer_json);
    return office.sendOffice(reply, 'act', act, company, flags, 'docx');
  });

  fastify.get('/:id/xlsx', {
    preHandler: officeAuth
  }, async (request, reply) => {
    const act = await loadActOr404(request.params.id, reply);
    if (!act) return;
    const flags = office.facsimileOpts(request.query);
    const company = billing.mergeIssuer(await billing.loadCompany(db), act.issuer_json);
    return office.sendOffice(reply, 'act', act, company, flags, 'xlsx');
  });

  fastify.get('/:id/pdf', {
    preHandler: officeAuth
  }, async (request, reply) => {
    const path = require('path');
    const fs = require('fs');
    const act = await loadActOr404(request.params.id, reply);
    if (!act) return;
    const flags = office.facsimileOpts(request.query);
    const pdfBuffer = await billing.generateBillingPdf(db, 'act', act, flags);

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const pdfDir = path.join(uploadDir, 'acts');
    fs.mkdirSync(pdfDir, { recursive: true });
    const filename = `act_${act.id}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(pdfDir, filename), pdfBuffer);
    await db.query('UPDATE acts SET file_path = $1 WHERE id = $2', [`acts/${filename}`, act.id]);

    reply.header('Content-Type', 'application/pdf');
    const rawName = `Act_${act.act_number || act.id}.pdf`;
    const asciiName = `Act_${act.id}.pdf`;
    reply.header(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`
    );
    return reply.send(pdfBuffer);
  });
}

module.exports = actsRoutes;
