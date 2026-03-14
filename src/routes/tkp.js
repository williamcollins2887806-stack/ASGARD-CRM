'use strict';

/**
 * ASGARD CRM — TKP (Technical-Commercial Proposals)
 *
 * GET    /              — List TKP
 * GET    /:id           — Details
 * POST   /              — Create
 * PUT    /:id           — Update
 * DELETE /:id           — Delete draft
 * GET    /:id/pdf       — Generate PDF (Puppeteer with PDFKit fallback)
 * POST   /:id/send      — Send by email
 * PUT    /:id/status    — Change status
 * POST   /:id/approve   — Approve TKP (directors only)
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

/* Try to load Puppeteer PDF generator */
let pdfGenerator = null;
try {
  pdfGenerator = require('../services/pdf-generator');
} catch (e) {
  console.warn('[TKP] pdf-generator not available, will use PDFKit:', e.message);
}

const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const SEE_ALL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH', 'HEAD_TO'];
const APPROVE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  // GET / — List
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { tender_id, status, limit = 100, offset = 0 } = request.query;
    const userRole = request.user.role;
    const userId = request.user.id;

    let sql = `
      SELECT t.*, u.name as creator_name, te.customer_name as tender_customer
      FROM tkp t
      LEFT JOIN users u ON t.author_id = u.id
      LEFT JOIN tenders te ON t.tender_id = te.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (!SEE_ALL_ROLES.includes(userRole)) {
      sql += ` AND t.author_id = $${idx++}`;
      params.push(userId);
    }

    if (tender_id) { sql += ` AND t.tender_id = $${idx++}`; params.push(tender_id); }
    if (status) { sql += ` AND t.status = $${idx++}`; params.push(status); }

    sql += ` ORDER BY t.id DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Math.min(parseInt(limit), 200), parseInt(offset));

    const { rows } = await db.query(sql, params);
    return { items: rows };
  });

  // GET /:id — Details
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows } = await db.query(`
      SELECT t.*, u.name as creator_name, sb.name as sent_by_name,
             ab.name as approved_by_name,
             te.customer_name as tender_customer, te.tender_title as tender_number
      FROM tkp t
      LEFT JOIN users u ON t.author_id = u.id
      LEFT JOIN users sb ON t.sent_by = sb.id
      LEFT JOIN users ab ON t.approved_by = ab.id
      LEFT JOIN tenders te ON t.tender_id = te.id
      WHERE t.id = $1
    `, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });
    return { item: rows[0] };
  });

  // POST / — Create
  fastify.post('/', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { title, tender_id, work_id, customer_name, customer_email,
            content_json, services, total_sum, deadline, validity_days,
            source, customer_address, work_description, estimate_id } = request.body;

    if (!title || !String(title).trim()) {
      return reply.code(400).send({ error: 'Required field: title' });
    }

    const { rows } = await db.query(`
      INSERT INTO tkp (subject, tender_id, work_id, customer_name, contact_email,
                        items, services, total_sum, deadline, validity_days, author_id,
                        source, customer_address, work_description, estimate_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      title.trim(), tender_id || null, work_id || null,
      customer_name || null, customer_email || null,
      content_json ? JSON.stringify(content_json) : '{}',
      services || null, total_sum || 0, deadline || null,
      validity_days || 30, request.user.id,
      source || null, customer_address || null,
      work_description || null, estimate_id || null
    ]);

    return { item: rows[0] };
  });

  // PUT /:id — Update
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const allowed = ['subject', 'tender_id', 'work_id', 'customer_name', 'contact_email',
                     'items', 'services', 'total_sum', 'deadline', 'validity_days', 'tkp_type',
                     'source', 'customer_address', 'work_description', 'estimate_id'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (request.body[key] !== undefined) {
        const val = key === 'items' ? JSON.stringify(request.body[key]) : request.body[key];
        updates.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }
    if (!updates.length) return reply.code(400).send({ error: 'No data' });

    updates.push('updated_at = NOW()');
    values.push(id);
    const { rows } = await db.query(
      `UPDATE tkp SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values
    );
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });
    return { item: rows[0] };
  });

  // DELETE /:id — Delete draft
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { rows } = await db.query(
      `DELETE FROM tkp WHERE id = $1 AND status = 'draft' RETURNING id`, [request.params.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found or not a draft' });
    return { success: true };
  });

  // PUT /:id/status — Change status
  fastify.put('/:id/status', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { status } = request.body;
    const validStatuses = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
    if (!validStatuses.includes(status)) {
      return reply.code(400).send({ error: `Status must be: ${validStatuses.join(', ')}` });
    }

    const { rows } = await db.query(
      'UPDATE tkp SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });

    if (rows[0].author_id && rows[0].author_id !== request.user.id) {
      const statusLabels = { accepted: 'accepted', rejected: 'rejected', expired: 'expired' };
      if (statusLabels[status]) {
        createNotification(db, {
          user_id: rows[0].author_id,
          title: `TKP ${statusLabels[status]}`,
          message: `TKP "${rows[0].subject}" — ${statusLabels[status]}`,
          type: 'tkp',
          link: `#/tkp?id=${id}`
        });
      }
    }

    return { item: rows[0] };
  });

  // POST /:id/approve — Approve TKP (directors only)
  fastify.post('/:id/approve', {
    preHandler: [fastify.requireRoles(APPROVE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const check = await db.query('SELECT * FROM tkp WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'TKP not found' });

    const tkp = check.rows[0];

    if (tkp.status === 'approved') {
      return reply.code(400).send({ error: 'TKP already approved' });
    }

    const { rows } = await db.query(`
      UPDATE tkp
         SET status = 'approved',
             approved_by = $1,
             approved_at = NOW(),
             updated_at  = NOW()
       WHERE id = $2
       RETURNING *
    `, [request.user.id, id]);

    if (tkp.author_id && tkp.author_id !== request.user.id) {
      createNotification(db, {
        user_id: tkp.author_id,
        title: 'TKP approved',
        message: `TKP "${tkp.subject}" approved by director`,
        type: 'tkp',
        link: `#/tkp?id=${id}`
      });
    }

    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /:id/pdf — Generate PDF (Puppeteer with PDFKit fallback)
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id/pdf', {
    preHandler: [
      // Allow token via query parameter (browser opens PDF in new tab without Bearer header)
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate
    ]
  }, async (request, reply) => {
    const { rows } = await db.query('SELECT t.*, te.tender_title as tender_number FROM tkp t LEFT JOIN tenders te ON t.tender_id = te.id WHERE t.id = $1', [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });
    const tkp = rows[0];

    let pdfBuffer;

    // Try Puppeteer-based generator first
    if (pdfGenerator) {
      try {
        pdfBuffer = await pdfGenerator.generateTkpPdf(tkp.id);
      } catch (err) {
        fastify.log.warn(`[TKP PDF] Puppeteer failed for TKP ${tkp.id}: ${err.message}, falling back to PDFKit`);
        pdfBuffer = null;
      }
    }

    // Fallback to PDFKit if Puppeteer failed or unavailable
    if (!pdfBuffer) {
      pdfBuffer = await generateTkpPdfKit(tkp);
    }

    // Save PDF
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const pdfDir = path.join(uploadDir, 'tkp');
    fs.mkdirSync(pdfDir, { recursive: true });
    const filename = `tkp_${tkp.id}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(pdfDir, filename), pdfBuffer);
    await db.query('UPDATE tkp SET pdf_path = $1 WHERE id = $2', [`tkp/${filename}`, tkp.id]);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="TKP_${tkp.id}.pdf"`);
    return reply.send(pdfBuffer);
  });

  // POST /:id/send — Send by email
  fastify.post('/:id/send', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { rows } = await db.query('SELECT * FROM tkp WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });
    const tkp = rows[0];

    const email = request.body.email || tkp.contact_email;
    if (!email) return reply.code(400).send({ error: 'Specify recipient email' });

    // Generate PDF inline
    const pdfRes = await fastify.inject({ method: 'GET', url: `/api/tkp/${id}/pdf`, headers: { authorization: request.headers.authorization } });
    const pdfBuf = pdfRes.rawPayload;

    // Send via CRM Mailer (personal mailbox + BCC to CRM)
    const crmMailer = require('../services/crm-mailer');
    await crmMailer.sendCrmEmail(db, request.user.id, {
      to: email,
      subject: `Commercial Proposal: ${tkp.subject}`,
      text: `Hello!\n\nPlease find attached commercial proposal "${tkp.subject}".\nAmount: ${tkp.total_sum ? Number(tkp.total_sum).toLocaleString('ru-RU') + ' rub.' : 'upon request'}\nValidity: ${tkp.validity_days || 30} days\n\nBest regards,\nASGARD SERVICE`,
      attachments: [{ filename: `TKP_${tkp.id}.pdf`, content: pdfBuf }]
    });

    await db.query(
      'UPDATE tkp SET status = $1, sent_at = NOW(), sent_by = $2, contact_email = $3, updated_at = NOW() WHERE id = $4',
      ['sent', request.user.id, email, id]
    );

    if (tkp.author_id && tkp.author_id !== request.user.id) {
      createNotification(db, {
        user_id: tkp.author_id,
        title: 'TKP sent',
        message: `TKP "${tkp.subject}" sent to ${email}`,
        type: 'tkp',
        link: `#/tkp?id=${id}`
      });
    }

    return { success: true, message: `TKP sent to ${email}` };
  });
}

/**
 * PDFKit fallback for TKP PDF generation
 */
async function generateTkpPdfKit(tkp) {
  const fontPath = path.join(__dirname, '..', '..', 'public', 'assets', 'fonts');
  const regularFont = fs.existsSync(path.join(fontPath, 'DejaVuSans.ttf'))
    ? path.join(fontPath, 'DejaVuSans.ttf') : undefined;
  const boldFont = fs.existsSync(path.join(fontPath, 'DejaVuSans-Bold.ttf'))
    ? path.join(fontPath, 'DejaVuSans-Bold.ttf') : undefined;

  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: tkp.subject || 'TKP', Author: 'ASGARD SERVICE' } });

  if (regularFont) doc.registerFont('Regular', regularFont);
  if (boldFont) doc.registerFont('Bold', boldFont);
  const mainFont = regularFont ? 'Regular' : 'Helvetica';
  const bFont = boldFont ? 'Bold' : 'Helvetica-Bold';

  const chunks = [];
  doc.on('data', c => chunks.push(c));

  doc.font(bFont).fontSize(16).text('OOO "ASGARD SERVICE"', { align: 'center' });
  doc.font(mainFont).fontSize(9).text('INN 8911030530 | OGRN 1178901002530', { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#3b82f6');
  doc.moveDown(1);

  doc.font(bFont).fontSize(14).text('COMMERCIAL PROPOSAL', { align: 'center' });
  doc.moveDown(0.5);
  const tkpLabel = tkp.tkp_number ? tkp.tkp_number : `No ${tkp.id}`;
  doc.font(mainFont).fontSize(11).text(`${tkpLabel} from ${new Date(tkp.created_at).toLocaleDateString('ru-RU')}`, { align: 'center' });
  doc.moveDown(1);

  if (tkp.customer_name) {
    doc.font(bFont).fontSize(11).text('Customer: ', { continued: true });
    doc.font(mainFont).text(tkp.customer_name);
  }
  if (tkp.customer_address) {
    doc.font(bFont).text('Address: ', { continued: true });
    doc.font(mainFont).text(tkp.customer_address);
  }
  if (tkp.tender_number) {
    doc.font(bFont).text('Tender: ', { continued: true });
    doc.font(mainFont).text(tkp.tender_number);
  }
  if (tkp.source) {
    doc.font(bFont).text('Source: ', { continued: true });
    doc.font(mainFont).text(tkp.source);
  }
  doc.moveDown(0.5);

  if (tkp.subject) {
    doc.font(bFont).fontSize(12).text(tkp.subject);
    doc.moveDown(0.5);
  }

  if (tkp.work_description) {
    doc.font(bFont).fontSize(11).text('Work description:');
    doc.font(mainFont).fontSize(10).text(tkp.work_description);
    doc.moveDown(0.5);
  }

  if (tkp.services) {
    doc.font(bFont).fontSize(11).text('Services:');
    doc.font(mainFont).fontSize(10).text(tkp.services);
    doc.moveDown(0.5);
  }

  if (tkp.items && typeof tkp.items === 'object') {
    const cj = tkp.items;
    if (cj.description) {
      doc.font(bFont).fontSize(11).text('Description:');
      doc.font(mainFont).fontSize(10).text(cj.description);
      doc.moveDown(0.5);
    }
    if (Array.isArray(cj.items) && cj.items.length) {
      doc.font(bFont).fontSize(11).text('Items:');
      doc.moveDown(0.3);
      let num = 1;
      for (const item of cj.items) {
        const line = `${num}. ${item.name || 'Item'} — ${item.quantity || ''} ${item.unit || ''} x ${item.price || ''} = ${item.total || ''} rub.`;
        doc.font(mainFont).fontSize(10).text(line);
        num++;
      }
      doc.moveDown(0.5);
    }
  }

  if (tkp.total_sum) {
    doc.moveDown(0.3);
    doc.font(bFont).fontSize(12).text(`Total: ${Number(tkp.total_sum).toLocaleString('ru-RU')} rub.`, { align: 'right' });
    doc.moveDown(0.5);
  }

  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e5e7eb');
  doc.moveDown(0.5);
  if (tkp.deadline) {
    doc.font(mainFont).fontSize(10).text(`Deadline: ${tkp.deadline}`);
  }
  doc.font(mainFont).fontSize(10).text(`Proposal validity: ${tkp.validity_days || 30} days`);
  doc.moveDown(1);

  doc.font(mainFont).fontSize(9).fillColor('#6b7280')
    .text('OOO "ASGARD SERVICE" — oil & gas service, Arctic', 50, doc.page.height - 60, { align: 'center' });

  doc.end();

  await new Promise(resolve => doc.on('end', resolve));
  return Buffer.concat(chunks);
}

module.exports = routes;
