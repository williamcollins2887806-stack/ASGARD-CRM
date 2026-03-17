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
    const { subject, title, tender_id, work_id, customer_name, customer_inn,
            contact_person, contact_phone, contact_email, customer_email,
            items, content_json, services, total_sum, deadline, validity_days,
            source, customer_address, work_description, estimate_id } = request.body;

    const subj = subject || title;
    if (!subj || !String(subj).trim()) {
      return reply.code(400).send({ error: 'Required field: subject' });
    }

    const itemsVal = items
      ? (typeof items === 'string' ? items : JSON.stringify(items))
      : (content_json ? JSON.stringify(content_json) : '{}');

    const { rows } = await db.query(`
      INSERT INTO tkp (subject, tender_id, work_id, customer_name, customer_inn,
                        contact_person, contact_phone, contact_email,
                        customer_address, work_description,
                        items, services, total_sum, deadline, validity_days,
                        author_id, source, estimate_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *
    `, [
      subj.trim(), tender_id || null, work_id || null,
      customer_name || null, customer_inn || null,
      contact_person || null, contact_phone || null,
      contact_email || customer_email || null,
      customer_address || null, work_description || null,
      itemsVal, services || null, total_sum || 0,
      deadline || null, validity_days || 30, request.user.id,
      source || null, estimate_id || null
    ]);

    return { item: rows[0] };
  });

  // PUT /:id — Update
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const allowed = ['subject', 'tender_id', 'work_id', 'customer_name', 'customer_inn',
                     'contact_person', 'contact_phone', 'contact_email',
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
 * PDFKit — красивый PDF генератор ТКП
 * Лого, кириллица (DejaVuSans), таблица работ, НДС, подпись, нумерация страниц
 */
async function generateTkpPdfKit(tkp) {
  const fontPath = path.join(__dirname, '..', '..', 'public', 'assets', 'fonts');
  let regularFont, boldFont;

  if (fs.existsSync(path.join(fontPath, 'DejaVuSans.ttf'))) {
    regularFont = path.join(fontPath, 'DejaVuSans.ttf');
    boldFont = fs.existsSync(path.join(fontPath, 'DejaVuSans-Bold.ttf'))
      ? path.join(fontPath, 'DejaVuSans-Bold.ttf') : regularFont;
  } else if (fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')) {
    regularFont = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    boldFont = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  }

  const doc = new PDFDocument({
    size: 'A4', margin: 50,
    info: { Title: tkp.subject || 'ТКП', Author: 'ООО АСГАРД СЕРВИС' },
    bufferPages: true
  });

  if (regularFont) doc.registerFont('F', regularFont);
  if (boldFont) doc.registerFont('FB', boldFont);
  const F = regularFont ? 'F' : 'Helvetica';
  const FB = boldFont ? 'FB' : 'Helvetica-Bold';

  const chunks = [];
  doc.on('data', c => chunks.push(c));

  const fmtNum = (n) => n ? Number(n).toLocaleString('ru-RU') : '—';

  // ─── ЛОГО ───
  const logoPath = path.join(__dirname, '..', '..', 'public', 'assets', 'img', 'asgard_emblem.png');
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 30, { width: 80, height: 46 });
  }

  // ─── Реквизиты справа от лого ───
  doc.font(FB).fontSize(12).fillColor('#1E4D8C')
     .text('ООО «АСГАРД СЕРВИС»', 140, 32);
  doc.font(F).fontSize(7.5).fillColor('#6B7280');
  doc.text('ИНН 8911030530 | ОГРН 1178901002530 | КПП 891101001', 140, 47);
  doc.text('629830, ЯНАО, г. Губкинский, мкр. 12, д. 58, кв. 35', 140, 57);
  doc.text('Тел: +7 (922) 459-38-98 | info@asgard-service.ru', 140, 67);

  // ─── Акцентная линия (синяя + красная) ───
  const lineY = 82;
  doc.rect(50, lineY, 247, 3).fill('#1E4D8C');
  doc.rect(297, lineY, 248, 3).fill('#C8293B');
  doc.x = 50; doc.y = 96;

  // ─── ЗАГОЛОВОК ───
  doc.font(FB).fontSize(16).fillColor('#1E4D8C')
     .text('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', 50, doc.y, { width: 495, align: 'center' });
  doc.moveDown(0.3);

  const tkpLabel = tkp.tkp_number || `№ ${tkp.id}`;
  const tkpDate = tkp.created_at ? new Date(tkp.created_at).toLocaleDateString('ru-RU') : '';
  doc.font(F).fontSize(11).fillColor('#6B7280')
     .text(`${tkpLabel} от ${tkpDate}`, 50, doc.y, { width: 495, align: 'center' });
  doc.moveDown(1);

  // ─── КАРТОЧКА ЗАКАЗЧИКА (серый фон) ───
  const cardY = doc.y;
  const cardLines = [];
  if (tkp.customer_name) cardLines.push({ label: 'Заказчик:', value: tkp.customer_name });
  if (tkp.customer_inn) cardLines.push({ label: 'ИНН:', value: tkp.customer_inn });
  if (tkp.customer_address) cardLines.push({ label: 'Адрес:', value: tkp.customer_address });
  if (tkp.contact_person) cardLines.push({ label: 'Контактное лицо:', value: tkp.contact_person });
  const contacts = [tkp.contact_phone, tkp.contact_email].filter(Boolean).join(' | ');
  if (contacts) cardLines.push({ label: 'Контакты:', value: contacts });

  if (cardLines.length > 0) {
    const cardH = cardLines.length * 16 + 16;
    doc.rect(50, cardY, 495, cardH).fill('#F3F4F6');
    doc.rect(50, cardY, 495, cardH).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

    let cy = cardY + 8;
    cardLines.forEach(line => {
      doc.font(FB).fontSize(9).fillColor('#6B7280').text(line.label, 58, cy, { continued: true, width: 100 });
      doc.font(F).fontSize(10).fillColor('#374151').text(' ' + line.value);
      cy += 16;
    });
    doc.x = 50;
    doc.y = cardY + cardH + 10;
  }

  // ─── ПРЕДМЕТ ───
  doc.x = 50;
  if (tkp.subject) {
    doc.font(FB).fontSize(12).fillColor('#1E4D8C')
       .text('Предмет предложения', 50, doc.y, { width: 495 });
    doc.moveDown(0.3);
    doc.font(FB).fontSize(11).fillColor('#374151')
       .text(tkp.subject, 50, doc.y, { width: 495 });
    doc.moveDown(0.5);
  }

  if (tkp.work_description) {
    doc.font(F).fontSize(10).fillColor('#374151')
       .text(tkp.work_description, 50, doc.y, { width: 495 });
    doc.moveDown(0.5);
  }

  // ─── ТАБЛИЦА РАБОТ ───
  let cj;
  try {
    cj = typeof tkp.items === 'string' ? JSON.parse(tkp.items || '{}') : (tkp.items || {});
  } catch (_) {
    cj = {};
  }
  const rows = Array.isArray(cj.items) ? cj.items : [];
  const vatPct = cj.vat_pct || 22;

  if (rows.length > 0) {
    doc.x = 50;
    doc.font(FB).fontSize(12).fillColor('#1E4D8C')
       .text('Состав работ и стоимость', 50, doc.y, { width: 495 });
    doc.moveDown(0.5);

    const colW = [25, 250, 40, 35, 70, 75];
    const totalW = colW.reduce((a, b) => a + b, 0);
    const tableX = 50;
    const rowH = 22;
    const headerH = 26;
    let ty = doc.y;

    // ── Шапка таблицы (синий фон) ──
    doc.rect(tableX, ty, totalW, headerH).fill('#1E4D8C');
    const headers = ['№', 'Наименование работ / услуг', 'Ед.', 'Кол', 'Цена, ₽', 'Сумма, ₽'];
    let hx = tableX;
    doc.font(FB).fontSize(8).fillColor('#FFFFFF');
    headers.forEach((h, i) => {
      doc.text(h, hx + 3, ty + 8, { width: colW[i] - 6, align: i >= 4 ? 'right' : (i === 0 || i >= 2 ? 'center' : 'left') });
      hx += colW[i];
    });
    ty += headerH;

    // ── Строки ──
    rows.forEach((row, ri) => {
      if (ty + rowH > 780) {
        doc.addPage();
        ty = 50;
      }

      if (ri % 2 === 1) {
        doc.rect(tableX, ty, totalW, rowH).fill('#F3F4F6');
      }

      const qty = row.qty || row.quantity || 1;
      const price = row.price || 0;
      const total = row.total || qty * price;
      const cells = [
        String(ri + 1),
        row.name || 'Услуга',
        row.unit || 'усл.',
        String(qty),
        fmtNum(price),
        fmtNum(total)
      ];

      let rx = tableX;
      doc.font(F).fontSize(8.5).fillColor('#374151');
      cells.forEach((cell, ci) => {
        doc.text(cell, rx + 3, ty + 6, { width: colW[ci] - 6, align: ci >= 4 ? 'right' : (ci === 0 || ci >= 2 ? 'center' : 'left') });
        rx += colW[ci];
      });

      doc.strokeColor('#E5E7EB').lineWidth(0.3)
         .moveTo(tableX, ty + rowH).lineTo(tableX + totalW, ty + rowH).stroke();
      ty += rowH;
    });

    // ── Сброс курсора после таблицы ──
    doc.x = 50;
    doc.y = ty + 10;
  }

  // ─── ИТОГО ───
  if (rows.length > 0) {
    const subtotal = cj.subtotal || rows.reduce((s, r) => s + (r.total || (r.qty || 1) * (r.price || 0)), 0);
    const vatSum = cj.vat_sum || Math.round(subtotal * vatPct / 100);
    const totalWithVat = cj.total_with_vat || (subtotal + vatSum);

    doc.font(F).fontSize(10).fillColor('#6B7280')
       .text(`Итого без НДС: ${fmtNum(subtotal)} ₽`, 50, doc.y, { width: 495, align: 'right' });
    doc.font(F).fontSize(10).fillColor('#6B7280')
       .text(`НДС ${vatPct}%: ${fmtNum(vatSum)} ₽`, 50, doc.y, { width: 495, align: 'right' });
    doc.moveDown(0.2);
    doc.moveTo(350, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    doc.font(FB).fontSize(13).fillColor('#0D1117')
       .text(`ИТОГО: ${fmtNum(totalWithVat)} ₽`, 50, doc.y, { width: 495, align: 'right' });
    doc.moveDown(0.8);
  } else if (tkp.total_sum) {
    doc.font(FB).fontSize(13).fillColor('#0D1117')
       .text(`Итого: ${fmtNum(tkp.total_sum)} ₽`, 50, doc.y, { width: 495, align: 'right' });
    doc.moveDown(0.8);
  }

  // ─── УСЛОВИЯ ───
  doc.x = 50;
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
  doc.moveDown(0.5);
  doc.font(FB).fontSize(12).fillColor('#1E4D8C')
     .text('Условия', 50, doc.y, { width: 495 });
  doc.moveDown(0.3);

  const paymentTerms = cj.payment_terms || '';
  const terms = [];
  if (tkp.deadline) terms.push(`Сроки выполнения: ${tkp.deadline}`);
  terms.push(`Срок действия предложения: ${tkp.validity_days || 30} дней`);
  if (paymentTerms) terms.push(`Условия оплаты: ${paymentTerms}`);

  terms.forEach(t => {
    doc.font(F).fontSize(10).fillColor('#374151')
       .text(`•  ${t}`, 60, doc.y, { width: 485 });
    doc.moveDown(0.2);
  });

  if (tkp.notes) {
    doc.moveDown(0.3);
    doc.font(F).fontSize(10).fillColor('#374151')
       .text(tkp.notes, 50, doc.y, { width: 495 });
  }

  // ─── ПОДПИСЬ ───
  doc.x = 50;
  doc.moveDown(1.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
  doc.moveDown(0.8);

  const authorName = cj.author_name || 'Кудряшов О.С.';
  const authorPos = cj.author_position || 'Генеральный директор';

  const signY = doc.y;
  doc.font(FB).fontSize(10).fillColor('#374151')
     .text(authorPos, 50, signY, { width: 170 });
  doc.font(F).fontSize(10).fillColor('#9CA3AF')
     .text('_________________', 230, signY, { width: 100, align: 'center' });
  doc.font(FB).fontSize(10).fillColor('#374151')
     .text(authorName, 370, signY, { width: 175, align: 'right' });

  doc.x = 50;
  doc.y = signY + 20;
  doc.font(F).fontSize(8).fillColor('#9CA3AF')
     .text('М.П.', 50, doc.y, { width: 495, align: 'center' });

  // ─── ФУТЕР (на всех страницах) ───
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(50, 810).lineTo(545, 810).strokeColor('#E5E7EB').lineWidth(0.3).stroke();
    doc.font(F).fontSize(7).fillColor('#9CA3AF')
       .text('ООО «АСГАРД СЕРВИС» — промышленный сервис, химическая и гидродинамическая очистка, HVAC',
             50, 815, { width: 400 });
    doc.font(F).fontSize(7).fillColor('#9CA3AF')
       .text(`Стр. ${i + 1}`, 450, 815, { width: 95, align: 'right' });
  }

  // ─── ЗАКРЫТИЕ ───
  doc.end();
  await new Promise(resolve => doc.on('end', resolve));
  return Buffer.concat(chunks);
}

module.exports = routes;
