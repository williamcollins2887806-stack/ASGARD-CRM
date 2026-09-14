/**
 * ASGARD CRM - Invoices Routes
 * Invoices and payments
 */

const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];
const billing = require('../services/billing-docs');
const office = require('../services/billing-office');

async function invoicesRoutes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  // Auto-generate invoice number in format СЧ-ГГГГ-NNN
  async function generateInvoiceNumber() {
    const year = new Date().getFullYear();
    const prefix = `СЧ-${year}-`;
    const { rows } = await db.query(
      `SELECT invoice_number FROM invoices
       WHERE invoice_number LIKE $1
       ORDER BY invoice_number DESC LIMIT 1`,
      [prefix + '%']
    );
    let next = 1;
    if (rows.length > 0) {
      const match = rows[0].invoice_number.match(/(\d+)$/);
      if (match) next = parseInt(match[1]) + 1;
    }
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  // Auto-generate next invoice number (for frontend pre-fill)
  fastify.get('/next-number', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const number = await generateInvoiceNumber();
    return { success: true, number };
  });

  fastify.post('/preview-pdf', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const n = billing.normalizeBillingBody(request.body || {}, { vat_pct: 22 });
    const virtual = {
      ...n,
      invoice_number: request.body?.invoice_number || 'СЧ-черновик',
      invoice_date: request.body?.invoice_date || new Date().toISOString().slice(0, 10),
      due_date: request.body?.due_date || null,
      items_json: n.items
    };
    const flags = office.facsimileOpts(Object.assign({}, request.query, request.body));
    const buf = await billing.generateBillingPdf(db, 'invoice', virtual, flags);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'inline; filename="invoice-preview.pdf"');
    return reply.send(buf);
  });

  async function virtualFromBody(body, extra) {
    const n = billing.normalizeBillingBody(body || {}, { vat_pct: 22 });
    return {
      ...n,
      invoice_number: body?.invoice_number || 'СЧ-черновик',
      invoice_date: body?.invoice_date || new Date().toISOString().slice(0, 10),
      due_date: body?.due_date || null,
      items_json: n.items,
      ...extra
    };
  }

  fastify.post('/preview-docx', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const flags = office.facsimileOpts(Object.assign({}, request.query, request.body));
    const virtual = await virtualFromBody(request.body);
    const company = billing.mergeIssuer(await billing.loadCompany(db), virtual.issuer_json || virtual.issuer);
    return office.sendOffice(reply, 'invoice', virtual, company, flags, 'docx');
  });

  fastify.post('/preview-xlsx', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const flags = office.facsimileOpts(Object.assign({}, request.query, request.body));
    const virtual = await virtualFromBody(request.body);
    const company = billing.mergeIssuer(await billing.loadCompany(db), virtual.issuer_json || virtual.issuer);
    return office.sendOffice(reply, 'invoice', virtual, company, flags, 'xlsx');
  });

  // Get all invoices
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_id, customer_name, status, limit = 100 } = request.query;

    let sql = `SELECT i.*, w.work_title, w.work_number
               FROM invoices i
               LEFT JOIN works w ON w.id = i.work_id
               WHERE 1=1`;
    const params = [];

    if (work_id) {
      params.push(work_id);
      sql += ` AND i.work_id = $${params.length}`;
    }

    if (customer_name) {
      params.push('%' + customer_name + '%');
      sql += ` AND i.customer_name ILIKE $${params.length}`;
    }

    if (status) {
      params.push(status);
      sql += ` AND i.status = $${params.length}`;
    }

    params.push(parseInt(limit));
    sql += ` ORDER BY i.created_at DESC LIMIT $${params.length}`;

    const result = await db.query(sql, params);
    return { success: true, invoices: result.rows };
  });

  // Get invoice by ID
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const result = await db.query(
      `SELECT i.*, w.work_title, w.work_number
       FROM invoices i
       LEFT JOIN works w ON w.id = i.work_id
       WHERE i.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Invoice not found' });
    }

    const payments = await db.query('SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY payment_date', [id]);

    return {
      success: true,
      invoice: result.rows[0],
      payments: payments.rows
    };
  });

  // Create invoice
  fastify.post('/', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const body = request.body || {};
    const n = billing.normalizeBillingBody(body, { vat_pct: 22, status: 'draft' });
    if (!body.invoice_date) {
      return reply.code(400).send({ error: 'Required fields: invoice_date, amount' });
    }
    if (!(n.amount > 0) && !(n.total_amount > 0) && !body.amount) {
      return reply.code(400).send({ error: 'Required fields: invoice_date, amount' });
    }
    const invoice_number = body.invoice_number || await generateInvoiceNumber();
    const invoice = await billing.insertDoc(db, 'invoices', {
      ...n,
      invoice_number,
      invoice_date: body.invoice_date,
      invoice_type: body.invoice_type || 'outgoing',
      due_date: body.due_date || null,
      paid_amount: body.paid_amount != null ? Number(body.paid_amount) : 0,
      created_by: request.user?.id
    });
    if ((body.invoice_type || 'outgoing') === 'outgoing') {
      try {
        const { upsertFromOutgoingInvoice } = require('../services/doc-registry-upsert');
        await upsertFromOutgoingInvoice(db, invoice);
      } catch (e) {
        fastify.log.warn('[invoices] doc_registry upsert: ' + (e && e.message));
      }
    }
    return { success: true, invoice };
  });

  // Update invoice
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};
    const n = billing.normalizeBillingBody(body, { status: body.status, vat_pct: body.vat_pct });
    const patch = billing.patchFromBody(body, n);
    if ('invoice_number' in body) patch.invoice_number = body.invoice_number;
    if ('invoice_date' in body) patch.invoice_date = body.invoice_date;
    if ('invoice_type' in body) patch.invoice_type = body.invoice_type;
    if ('due_date' in body) patch.due_date = body.due_date || null;
    if ('paid_amount' in body) patch.paid_amount = Number(body.paid_amount);
    const invoice = await billing.updateDoc(db, 'invoices', id, patch);
    if (!invoice) {
      return reply.code(404).send({ success: false, message: 'Invoice not found' });
    }
    return { success: true, invoice };
  });

  // Add payment
  fastify.post('/:id/payments', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};
    // Accept both legacy {payment_date, comment} and spec {paid_at, payment_method, note}
    const amount = body.amount;
    const payment_date = body.payment_date || body.paid_at;
    const payment_method = body.payment_method || null;
    const comment = body.comment || body.note || null;

    if (amount == null || !(parseFloat(amount) > 0)) {
      return reply.code(400).send({ success: false, message: 'amount must be > 0' });
    }

    const invoice = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (invoice.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Invoice not found' });
    }

    const payment = await db.query(`
      INSERT INTO invoice_payments (invoice_id, amount, payment_date, payment_method, comment, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `, [id, amount, payment_date || new Date().toISOString().slice(0, 10), payment_method, comment, request.user?.id]);

    const newPaidAmount = parseFloat(invoice.rows[0].paid_amount || 0) + parseFloat(amount);
    const totalAmount = parseFloat(invoice.rows[0].total_amount || 0);

    let newStatus = invoice.rows[0].status;
    if (newPaidAmount >= totalAmount && totalAmount > 0) {
      newStatus = 'paid';
    } else if (newPaidAmount > 0) {
      newStatus = 'partial';
    }

    await db.query(`
      UPDATE invoices SET paid_amount = $1, status = $2, updated_at = NOW() WHERE id = $3
    `, [newPaidAmount, newStatus, id]);

    if (invoice.rows[0].created_by && invoice.rows[0].created_by !== request.user?.id) {
      createNotification(db, {
        user_id: invoice.rows[0].created_by,
        title: newStatus === 'paid' ? 'Invoice fully paid' : 'Partial payment received',
        message: `Payment ${amount} for invoice ${invoice.rows[0].invoice_number || '#' + id}`,
        type: 'invoice',
        link: `#/invoices?id=${id}`
      });
    }

    return {
      success: true,
      payment: payment.rows[0],
      new_paid_amount: newPaidAmount,
      new_status: newStatus
    };
  });

  fastify.post('/:id/send', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ success: false, message: 'Invoice not found' });
    const inv = rows[0];
    const body = request.body || {};
    const email = body.to || body.email || inv.contact_email;
    if (!email) return reply.code(400).send({ success: false, message: 'Укажите email получателя' });

    const flags = office.facsimileOpts(body);
    const pdfBuf = await billing.generateBillingPdf(db, 'invoice', inv, flags);

    const sumStr = billing.fmtMoney(inv.total_amount) + ' ₽';
    const emailText = body.body || body.custom_text ||
      `Добрый день!\n\nНаправляем счёт на оплату № ${inv.invoice_number || inv.id} от ${billing.fmtDate(inv.invoice_date)}.\nСумма к оплате: ${sumStr}` +
      (inv.due_date ? `\nСрок оплаты: ${billing.fmtDate(inv.due_date)}` : '') +
      `\n\nС уважением,\nООО «Асгард-Сервис»`;

    try {
      const crmMailer = require('../services/crm-mailer');
      await crmMailer.sendCrmEmail(db, request.user.id, {
        to: email,
        cc: body.cc || undefined,
        subject: body.subject || `Счёт на оплату № ${inv.invoice_number || inv.id}`,
        text: emailText,
        attachments: [{
          filename: `Schet_${inv.invoice_number || inv.id}.pdf`,
          content: pdfBuf,
          contentType: 'application/pdf'
        }]
      });
    } catch (err) {
      fastify.log.error({ err }, 'invoice send email failed');
      return reply.code(502).send({ success: false, message: err.message || 'Не удалось отправить письмо' });
    }

    const invoice = await billing.updateDoc(db, 'invoices', id, {
      status: inv.status === 'draft' || !inv.status ? 'sent' : inv.status,
      contact_email: email,
      invoice_type: inv.invoice_type || 'outgoing'
    });
    return { success: true, message: `Счёт отправлен на ${email}`, invoice };
  });

  // Delete invoice
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;

    await db.query('DELETE FROM invoice_payments WHERE invoice_id = $1', [id]);

    const result = await db.query('DELETE FROM invoices WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Invoice not found' });
    }

    return { success: true, deleted: true };
  });

  // Overdue invoices
  fastify.get('/overdue/list', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const result = await db.query(`
      SELECT * FROM invoices
      WHERE status NOT IN ('paid', 'cancelled')
        AND due_date < CURRENT_DATE
      ORDER BY due_date ASC
    `);

    return { success: true, invoices: result.rows };
  });

  // Stats
  fastify.get('/stats/summary', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const result = await db.query(`
      SELECT
        status,
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as total_sum,
        COALESCE(SUM(paid_amount), 0) as paid_sum
      FROM invoices
      GROUP BY status
    `);

    return { success: true, stats: result.rows };
  });

  const officeAuth = [
    async (request) => {
      if (!request.headers.authorization && request.query.token) {
        request.headers.authorization = 'Bearer ' + request.query.token;
      }
    },
    fastify.authenticate
  ];

  async function loadInvoiceOr404(id, reply) {
    const invRes = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (invRes.rows.length === 0) {
      reply.code(404).send({ success: false, message: 'Invoice not found' });
      return null;
    }
    return invRes.rows[0];
  }

  fastify.get('/:id/docx', {
    preHandler: officeAuth
  }, async (request, reply) => {
    const inv = await loadInvoiceOr404(request.params.id, reply);
    if (!inv) return;
    const flags = office.facsimileOpts(request.query);
    const company = billing.mergeIssuer(await billing.loadCompany(db), inv.issuer_json);
    return office.sendOffice(reply, 'invoice', inv, company, flags, 'docx');
  });

  fastify.get('/:id/xlsx', {
    preHandler: officeAuth
  }, async (request, reply) => {
    const inv = await loadInvoiceOr404(request.params.id, reply);
    if (!inv) return;
    const flags = office.facsimileOpts(request.query);
    const company = billing.mergeIssuer(await billing.loadCompany(db), inv.issuer_json);
    return office.sendOffice(reply, 'invoice', inv, company, flags, 'xlsx');
  });

  fastify.get('/:id/pdf', {
    preHandler: officeAuth
  }, async (request, reply) => {
    const path = require('path');
    const fs = require('fs');
    const inv = await loadInvoiceOr404(request.params.id, reply);
    if (!inv) return;
    const flags = office.facsimileOpts(request.query);
    const pdfBuffer = await billing.generateBillingPdf(db, 'invoice', inv, flags);

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const pdfDir = path.join(uploadDir, 'invoices');
    fs.mkdirSync(pdfDir, { recursive: true });
    const filename = `invoice_${inv.id}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(pdfDir, filename), pdfBuffer);
    await db.query('UPDATE invoices SET file_path = $1 WHERE id = $2', [`invoices/${filename}`, inv.id]);

    reply.header('Content-Type', 'application/pdf');
    const rawName = `Invoice_${inv.invoice_number || inv.id}.pdf`;
    const asciiName = `Invoice_${inv.id}.pdf`;
    reply.header(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`
    );
    return reply.send(pdfBuffer);
  });
}

module.exports = invoicesRoutes;
