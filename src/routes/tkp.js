'use strict';

/**
 * ASGARD CRM — ТКП (Техническо-коммерческое предложение)
 *
 * GET    /              — Список ТКП
 * GET    /:id           — Детали
 * POST   /              — Создать
 * PUT    /:id           — Обновить
 * DELETE /:id           — Удалить черновик
 * GET    /:id/pdf       — Сгенерировать PDF
 * POST   /:id/send      — Отправить по email
 * PUT    /:id/status    — Сменить статус
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  // ═══════════════════════════════════════════════════════════════
  // GET / — Список ТКП
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { tender_id, status, limit = 100, offset = 0 } = request.query;
    let sql = `
      SELECT t.*, u.name as creator_name, te.customer_name as tender_customer
      FROM tkp t
      LEFT JOIN users u ON t.author_id = u.id
      LEFT JOIN tenders te ON t.tender_id = te.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (tender_id) { sql += ` AND t.tender_id = $${idx++}`; params.push(tender_id); }
    if (status) { sql += ` AND t.status = $${idx++}`; params.push(status); }

    sql += ` ORDER BY t.id DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Math.min(parseInt(limit), 200), parseInt(offset));

    const { rows } = await db.query(sql, params);
    return { items: rows };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /:id — Детали
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows } = await db.query(`
      SELECT t.*, u.name as creator_name, sb.name as sent_by_name,
             te.customer_name as tender_customer, te.tender_title as tender_number
      FROM tkp t
      LEFT JOIN users u ON t.author_id = u.id
      LEFT JOIN users sb ON t.sent_by = sb.id
      LEFT JOIN tenders te ON t.tender_id = te.id
      WHERE t.id = $1
    `, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'ТКП не найдено' });
    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // POST / — Создать
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { title, tender_id, work_id, customer_name, customer_email,
            content_json, services, total_sum, deadline, validity_days } = request.body;

    if (!title || !String(title).trim()) {
      return reply.code(400).send({ error: 'Обязательное поле: title (название)' });
    }

    const { rows } = await db.query(`
      INSERT INTO tkp (subject, tender_id, work_id, customer_name, contact_email,
                        items, services, total_sum, deadline, validity_days, author_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      title.trim(), tender_id || null, work_id || null,
      customer_name || null, customer_email || null,
      content_json ? JSON.stringify(content_json) : '{}',
      services || null, total_sum || 0, deadline || null,
      validity_days || 30, request.user.id
    ]);

    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // PUT /:id — Обновить
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const allowed = ['subject', 'tender_id', 'work_id', 'customer_name', 'contact_email',
                     'items', 'services', 'total_sum', 'deadline', 'validity_days'];
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
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });

    updates.push('updated_at = NOW()');
    values.push(id);
    const { rows } = await db.query(
      `UPDATE tkp SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values
    );
    if (!rows[0]) return reply.code(404).send({ error: 'ТКП не найдено' });
    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // DELETE /:id — Удалить черновик
  // ═══════════════════════════════════════════════════════════════
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { rows } = await db.query(
      `DELETE FROM tkp WHERE id = $1 AND status = 'draft' RETURNING id`, [request.params.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'ТКП не найдено или не является черновиком' });
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // PUT /:id/status — Сменить статус
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/:id/status', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { status } = request.body;
    const validStatuses = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
    if (!validStatuses.includes(status)) {
      return reply.code(400).send({ error: `Статус: ${validStatuses.join(', ')}` });
    }

    const { rows } = await db.query(
      'UPDATE tkp SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'ТКП не найдено' });

    // Notify creator about status change
    if (rows[0].author_id && rows[0].author_id !== request.user.id) {
      const statusLabels = { accepted: 'принято', rejected: 'отклонено', expired: 'просрочено' };
      if (statusLabels[status]) {
        createNotification(db, {
          user_id: rows[0].author_id,
          title: `📄 ТКП ${statusLabels[status]}`,
          message: `ТКП "${rows[0].subject}" — ${statusLabels[status]}`,
          type: 'tkp',
          link: `#/tkp?id=${id}`
        });
      }
    }

    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /:id/pdf — Генерация PDF
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id/pdf', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows } = await db.query('SELECT t.*, te.tender_title as tender_number FROM tkp t LEFT JOIN tenders te ON t.tender_id = te.id WHERE t.id = $1', [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'ТКП не найдено' });
    const tkp = rows[0];

    const fontPath = path.join(__dirname, '..', '..', 'public', 'assets', 'fonts');
    const regularFont = fs.existsSync(path.join(fontPath, 'DejaVuSans.ttf'))
      ? path.join(fontPath, 'DejaVuSans.ttf') : undefined;
    const boldFont = fs.existsSync(path.join(fontPath, 'DejaVuSans-Bold.ttf'))
      ? path.join(fontPath, 'DejaVuSans-Bold.ttf') : undefined;

    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: tkp.subject || 'ТКП', Author: 'АСГАРД СЕРВИС' } });

    // Register fonts if available
    if (regularFont) doc.registerFont('Regular', regularFont);
    if (boldFont) doc.registerFont('Bold', boldFont);
    const mainFont = regularFont ? 'Regular' : 'Helvetica';
    const bFont = boldFont ? 'Bold' : 'Helvetica-Bold';

    const chunks = [];
    doc.on('data', c => chunks.push(c));

    // Header
    doc.font(bFont).fontSize(16).text('ООО «АСГАРД СЕРВИС»', { align: 'center' });
    doc.font(mainFont).fontSize(9).text('ИНН 8911030530 | ОГРН 1178901002530', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#3b82f6');
    doc.moveDown(1);

    // Title
    doc.font(bFont).fontSize(14).text('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', { align: 'center' });
    doc.moveDown(0.5);
    doc.font(mainFont).fontSize(11).text(`№ ${tkp.id} от ${new Date(tkp.created_at).toLocaleDateString('ru-RU')}`, { align: 'center' });
    doc.moveDown(1);

    // Customer
    if (tkp.customer_name) {
      doc.font(bFont).fontSize(11).text('Заказчик: ', { continued: true });
      doc.font(mainFont).text(tkp.customer_name);
    }
    if (tkp.tender_number) {
      doc.font(bFont).text('Тендер: ', { continued: true });
      doc.font(mainFont).text(tkp.tender_number);
    }
    doc.moveDown(0.5);

    // Title text
    if (tkp.subject) {
      doc.font(bFont).fontSize(12).text(tkp.subject);
      doc.moveDown(0.5);
    }

    // Services
    if (tkp.services) {
      doc.font(bFont).fontSize(11).text('Перечень услуг:');
      doc.font(mainFont).fontSize(10).text(tkp.services);
      doc.moveDown(0.5);
    }

    // Content JSON sections
    if (tkp.items && typeof tkp.items === 'object') {
      const cj = tkp.items;
      if (cj.description) {
        doc.font(bFont).fontSize(11).text('Описание:');
        doc.font(mainFont).fontSize(10).text(cj.description);
        doc.moveDown(0.5);
      }
      if (Array.isArray(cj.items) && cj.items.length) {
        doc.font(bFont).fontSize(11).text('Позиции:');
        doc.moveDown(0.3);
        let num = 1;
        for (const item of cj.items) {
          const line = `${num}. ${item.name || 'Позиция'} — ${item.quantity || ''} ${item.unit || ''} × ${item.price || ''} = ${item.total || ''} руб.`;
          doc.font(mainFont).fontSize(10).text(line);
          num++;
        }
        doc.moveDown(0.5);
      }
    }

    // Total
    if (tkp.total_sum) {
      doc.moveDown(0.3);
      doc.font(bFont).fontSize(12).text(`Итого: ${Number(tkp.total_sum).toLocaleString('ru-RU')} руб.`, { align: 'right' });
      doc.moveDown(0.5);
    }

    // Conditions
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e5e7eb');
    doc.moveDown(0.5);
    if (tkp.deadline) {
      doc.font(mainFont).fontSize(10).text(`Срок выполнения: ${tkp.deadline}`);
    }
    doc.font(mainFont).fontSize(10).text(`Срок действия предложения: ${tkp.validity_days || 30} дней`);
    doc.moveDown(1);

    // Footer
    doc.font(mainFont).fontSize(9).fillColor('#6b7280')
      .text('ООО «АСГАРД СЕРВИС» — нефтегазовый сервис, Арктика', 50, doc.page.height - 60, { align: 'center' });

    doc.end();

    await new Promise(resolve => doc.on('end', resolve));
    const buffer = Buffer.concat(chunks);

    // Save PDF path
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const pdfDir = path.join(uploadDir, 'tkp');
    fs.mkdirSync(pdfDir, { recursive: true });
    const filename = `tkp_${tkp.id}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(pdfDir, filename), buffer);
    await db.query('UPDATE tkp SET pdf_path = $1 WHERE id = $2', [`tkp/${filename}`, tkp.id]);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="TKP_${tkp.id}.pdf"`);
    return reply.send(buffer);
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /:id/send — Отправить по email
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/:id/send', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { rows } = await db.query('SELECT * FROM tkp WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'ТКП не найдено' });
    const tkp = rows[0];

    const email = request.body.email || tkp.contact_email;
    if (!email) return reply.code(400).send({ error: 'Укажите email получателя' });

    // Get SMTP config
    const accRes = await db.query(
      'SELECT * FROM email_accounts WHERE is_active = true AND smtp_host IS NOT NULL LIMIT 1'
    );
    if (!accRes.rows[0]) return reply.code(500).send({ error: 'SMTP аккаунт не настроен' });
    const acc = accRes.rows[0];

    // Decrypt password
    let smtpPass = acc.smtp_pass || '';
    if (acc.smtp_pass_encrypted) {
      try {
        const imap = require('../services/imap');
        smtpPass = imap.decrypt(acc.smtp_pass_encrypted);
      } catch (e) { smtpPass = acc.smtp_pass || ''; }
    }

    // Generate PDF inline
    const pdfRes = await fastify.inject({ method: 'GET', url: `/api/tkp/${id}/pdf`, headers: { authorization: request.headers.authorization } });
    const pdfBuffer = pdfRes.rawPayload;

    const transporter = nodemailer.createTransport({
      host: acc.smtp_host, port: acc.smtp_port || 587,
      secure: acc.smtp_port === 465,
      auth: { user: acc.smtp_user || acc.email, pass: smtpPass }
    });

    await transporter.sendMail({
      from: `"АСГАРД СЕРВИС" <${acc.email}>`,
      to: email,
      subject: `Коммерческое предложение: ${tkp.subject}`,
      text: `Добрый день!\n\nНаправляем вам коммерческое предложение "${tkp.subject}".\nСумма: ${tkp.total_sum ? Number(tkp.total_sum).toLocaleString('ru-RU') + ' руб.' : 'по запросу'}\nСрок действия: ${tkp.validity_days || 30} дней\n\nС уважением,\nООО «АСГАРД СЕРВИС»`,
      attachments: [{ filename: `TKP_${tkp.id}.pdf`, content: pdfBuffer }]
    });

    await db.query(
      'UPDATE tkp SET status = $1, sent_at = NOW(), sent_by = $2, contact_email = $3, updated_at = NOW() WHERE id = $4',
      ['sent', request.user.id, email, id]
    );

    // Notify creator
    if (tkp.author_id && tkp.author_id !== request.user.id) {
      createNotification(db, {
        user_id: tkp.author_id,
        title: '📨 ТКП отправлено',
        message: `ТКП "${tkp.subject}" отправлено на ${email}`,
        type: 'tkp',
        link: `#/tkp?id=${id}`
      });
    }

    return { success: true, message: `ТКП отправлено на ${email}` };
  });
}

module.exports = routes;
