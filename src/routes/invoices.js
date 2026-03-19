/**
 * ASGARD CRM - Invoices Routes
 * Invoices and payments
 */

const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];

/* Try to load Puppeteer PDF generator */
let pdfGenerator = null;
try {
  pdfGenerator = require('../services/pdf-generator');
} catch (e) {
  console.warn('[Invoices] pdf-generator not available, will use PDFKit:', e.message);
}

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

  // Get all invoices
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_id, customer_name, status, limit = 100 } = request.query;

    let sql = 'SELECT * FROM invoices WHERE 1=1';
    const params = [];

    if (work_id) {
      params.push(work_id);
      sql += ` AND work_id = $${params.length}`;
    }

    if (customer_name) {
      params.push('%' + customer_name + '%');
      sql += ` AND customer_name ILIKE $${params.length}`;
    }

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    params.push(parseInt(limit));
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const result = await db.query(sql, params);
    return { success: true, invoices: result.rows };
  });

  // Get invoice by ID
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const result = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);

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
    if (!body.invoice_date || !body.amount) {
      return reply.code(400).send({ error: 'Required fields: invoice_date, amount' });
    }
    if (!body.invoice_number) {
      body.invoice_number = await generateInvoiceNumber();
    }
    const {
      invoice_number, invoice_date, invoice_type,
      status = 'draft', work_id, act_id,
      customer_name, customer_inn, description,
      amount, vat_pct = 22, total_amount,
      due_date, paid_amount = 0
    } = body;

    const result = await db.query(`
      INSERT INTO invoices (
        invoice_number, invoice_date, invoice_type,
        status, work_id, act_id,
        customer_name, customer_inn, description,
        amount, vat_pct, total_amount,
        due_date, paid_amount, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
      RETURNING *
    `, [
      invoice_number, invoice_date, invoice_type,
      status, work_id, act_id,
      customer_name, customer_inn, description,
      amount, vat_pct, total_amount,
      due_date, paid_amount, request.user?.id
    ]);

    return { success: true, invoice: result.rows[0] };
  });

  // Update invoice
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const {
      invoice_number, invoice_date, invoice_type,
      status, work_id, act_id,
      customer_name, customer_inn, description,
      amount, vat_pct, total_amount,
      due_date, paid_amount
    } = request.body;

    const result = await db.query(`
      UPDATE invoices SET
        invoice_number = COALESCE($1, invoice_number),
        invoice_date = COALESCE($2, invoice_date),
        invoice_type = COALESCE($3, invoice_type),
        status = COALESCE($4, status),
        work_id = COALESCE($5, work_id),
        act_id = $6,
        customer_name = COALESCE($7, customer_name),
        customer_inn = COALESCE($8, customer_inn),
        description = COALESCE($9, description),
        amount = COALESCE($10, amount),
        vat_pct = COALESCE($11, vat_pct),
        total_amount = COALESCE($12, total_amount),
        due_date = $13,
        paid_amount = COALESCE($14, paid_amount),
        updated_at = NOW()
      WHERE id = $15
      RETURNING *
    `, [
      invoice_number, invoice_date, invoice_type,
      status, work_id, act_id,
      customer_name, customer_inn, description,
      amount, vat_pct, total_amount,
      due_date, paid_amount, id
    ]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Invoice not found' });
    }

    return { success: true, invoice: result.rows[0] };
  });

  // Add payment
  fastify.post('/:id/payments', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const { amount, payment_date, comment } = request.body;

    const invoice = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (invoice.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Invoice not found' });
    }

    const payment = await db.query(`
      INSERT INTO invoice_payments (invoice_id, amount, payment_date, comment, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `, [id, amount, payment_date || new Date().toISOString().slice(0, 10), comment, request.user?.id]);

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

  // ═══════════════════════════════════════════════════════════════
  // GET /:id/pdf — Generate Invoice PDF (Puppeteer with PDFKit fallback)
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
    const PDFDocument = require('pdfkit');
    const path = require('path');
    const fs = require('fs');

    const { id } = request.params;
    const invRes = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (invRes.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Invoice not found' });
    }
    const inv = invRes.rows[0];

    let pdfBuffer;

    // Try Puppeteer-based generator first
    if (pdfGenerator) {
      try {
        pdfBuffer = await pdfGenerator.generateInvoicePdf(inv.id);
      } catch (err) {
        fastify.log.warn(`[Invoice PDF] Puppeteer failed for invoice ${inv.id}: ${err.message}, falling back to PDFKit`);
        pdfBuffer = null;
      }
    }

    // Fallback to PDFKit
    if (!pdfBuffer) {
      pdfBuffer = await generateInvoicePdfKit(inv, db);
    }

    // Save PDF
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const pdfDir = path.join(uploadDir, 'invoices');
    fs.mkdirSync(pdfDir, { recursive: true });
    const filename = `invoice_${inv.id}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(pdfDir, filename), pdfBuffer);
    await db.query('UPDATE invoices SET file_path = $1 WHERE id = $2', [`invoices/${filename}`, inv.id]);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="Invoice_${inv.invoice_number || inv.id}.pdf"`);
    return reply.send(pdfBuffer);
  });
}

/**
 * PDFKit fallback for Invoice PDF generation
 */
async function generateInvoicePdfKit(inv, db) {
  const PDFDocument = require('pdfkit');
  const path = require('path');
  const fs = require('fs');

  let company = {};
  try {
    const cpRes = await db.query("SELECT value_json FROM settings WHERE key = 'company_profile'");
    if (cpRes.rows.length > 0) {
      company = typeof cpRes.rows[0].value_json === 'string'
        ? JSON.parse(cpRes.rows[0].value_json)
        : cpRes.rows[0].value_json;
    }
  } catch (e) {
    console.error('[Invoice PDF] Failed to load company_profile:', e.message);
  }

  const fontPath = path.join(__dirname, '..', '..', 'public', 'assets', 'fonts');
  const regularFont = fs.existsSync(path.join(fontPath, 'DejaVuSans.ttf'))
    ? path.join(fontPath, 'DejaVuSans.ttf') : undefined;
  const boldFont = fs.existsSync(path.join(fontPath, 'DejaVuSans-Bold.ttf'))
    ? path.join(fontPath, 'DejaVuSans-Bold.ttf') : undefined;

  const doc = new PDFDocument({
    size: 'A4', margin: 50,
    info: { Title: `Invoice ${inv.invoice_number || inv.id}`, Author: company.name || 'ASGARD SERVICE' }
  });

  if (regularFont) doc.registerFont('Regular', regularFont);
  if (boldFont) doc.registerFont('Bold', boldFont);
  const mainFont = regularFont ? 'Regular' : 'Helvetica';
  const bFont = boldFont ? 'Bold' : 'Helvetica-Bold';

  const chunks = [];
  doc.on('data', c => chunks.push(c));

  // Header
  doc.font(bFont).fontSize(14).text(company.name || 'OOO "ASGARD SERVICE"', { align: 'center' });
  doc.font(mainFont).fontSize(8)
    .text(`INN ${company.inn || ''} | KPP ${company.kpp || ''} | OGRN ${company.ogrn || ''}`, { align: 'center' });
  if (company.legal_address) {
    doc.text(company.legal_address, { align: 'center' });
  }
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#3b82f6');
  doc.moveDown(1);

  doc.font(bFont).fontSize(16).text('INVOICE', { align: 'center' });
  doc.moveDown(0.3);
  const invNumber = inv.invoice_number || `No ${inv.id}`;
  const invDate = inv.invoice_date
    ? new Date(inv.invoice_date).toLocaleDateString('ru-RU')
    : new Date(inv.created_at).toLocaleDateString('ru-RU');
  doc.font(mainFont).fontSize(11).text(`${invNumber} from ${invDate}`, { align: 'center' });
  doc.moveDown(1);

  doc.font(bFont).fontSize(10).text('Supplier:');
  doc.font(mainFont).fontSize(9);
  doc.text(`${company.full_name || company.name || 'OOO "ASGARD SERVICE"'}`);
  doc.text(`INN ${company.inn || ''}, KPP ${company.kpp || ''}`);
  if (company.legal_address) doc.text(`Address: ${company.legal_address}`);
  if (company.phone) doc.text(`Phone: ${company.phone}`);
  doc.moveDown(0.5);

  doc.font(bFont).fontSize(10).text('Buyer:');
  doc.font(mainFont).fontSize(9);
  if (inv.customer_name) doc.text(inv.customer_name);
  if (inv.customer_inn) doc.text(`INN: ${inv.customer_inn}`);
  doc.moveDown(1);

  const tableTop = doc.y;
  const col = { num: 50, desc: 75, qty: 310, unit: 355, price: 400, sum: 470 };

  doc.font(bFont).fontSize(8);
  doc.rect(50, tableTop - 2, 495, 18).fill('#f3f4f6').stroke('#d1d5db');
  doc.fillColor('#000000');
  doc.text('No', col.num, tableTop + 2, { width: 20, align: 'center' });
  doc.text('Description', col.desc, tableTop + 2, { width: 230 });
  doc.text('Qty', col.qty, tableTop + 2, { width: 40, align: 'center' });
  doc.text('Unit', col.unit, tableTop + 2, { width: 40, align: 'center' });
  doc.text('Price', col.price, tableTop + 2, { width: 65, align: 'right' });
  doc.text('Amount', col.sum, tableTop + 2, { width: 70, align: 'right' });

  let y = tableTop + 20;
  doc.font(mainFont).fontSize(8);

  let items = [];
  if (inv.items_json) {
    const ij = typeof inv.items_json === 'string' ? JSON.parse(inv.items_json) : inv.items_json;
    if (Array.isArray(ij)) items = ij;
    else if (Array.isArray(ij.items)) items = ij.items;
  }

  if (items.length > 0) {
    items.forEach((item, idx) => {
      if (y > 720) { doc.addPage(); y = 50; }
      const rowH = 16;
      if (idx % 2 === 1) {
        doc.rect(50, y - 2, 495, rowH).fill('#f9fafb').stroke();
        doc.fillColor('#000000');
      }
      doc.text(String(idx + 1), col.num, y, { width: 20, align: 'center' });
      doc.text(item.name || item.description || 'Item', col.desc, y, { width: 230 });
      doc.text(String(item.quantity || item.qty || 1), col.qty, y, { width: 40, align: 'center' });
      doc.text(item.unit || 'pcs', col.unit, y, { width: 40, align: 'center' });
      doc.text(Number(item.price || 0).toLocaleString('ru-RU'), col.price, y, { width: 65, align: 'right' });
      doc.text(Number(item.total || item.sum || 0).toLocaleString('ru-RU'), col.sum, y, { width: 70, align: 'right' });
      y += rowH;
    });
  } else {
    doc.text('1', col.num, y, { width: 20, align: 'center' });
    doc.text(inv.description || 'Services', col.desc, y, { width: 230 });
    doc.text('1', col.qty, y, { width: 40, align: 'center' });
    doc.text('svc', col.unit, y, { width: 40, align: 'center' });
    doc.text(Number(inv.amount || 0).toLocaleString('ru-RU'), col.price, y, { width: 65, align: 'right' });
    doc.text(Number(inv.amount || 0).toLocaleString('ru-RU'), col.sum, y, { width: 70, align: 'right' });
    y += 16;
  }

  doc.moveTo(50, y).lineTo(545, y).stroke('#d1d5db');
  y += 10;

  const amount = Number(inv.amount || 0);
  const vatPct = inv.vat_pct != null ? Number(inv.vat_pct) : 22;
  const vatAmount = inv.vat_amount != null ? Number(inv.vat_amount) : (amount * vatPct / 100);
  const totalAmount = inv.total_amount != null ? Number(inv.total_amount) : (amount + vatAmount);

  doc.font(mainFont).fontSize(9);
  doc.text('Subtotal:', 350, y, { width: 110, align: 'right' });
  doc.font(bFont).text(`${amount.toLocaleString('ru-RU')} rub.`, 465, y, { width: 80, align: 'right' });
  y += 14;
  doc.font(mainFont).text(`VAT (${vatPct}%):`, 350, y, { width: 110, align: 'right' });
  doc.font(bFont).text(`${vatAmount.toLocaleString('ru-RU')} rub.`, 465, y, { width: 80, align: 'right' });
  y += 14;
  doc.moveTo(350, y).lineTo(545, y).stroke('#3b82f6');
  y += 6;
  doc.font(bFont).fontSize(11).text('Total due:', 350, y, { width: 110, align: 'right' });
  doc.text(`${totalAmount.toLocaleString('ru-RU')} rub.`, 465, y, { width: 80, align: 'right' });
  y += 25;

  if (company.bank_name) {
    doc.moveTo(50, y).lineTo(545, y).stroke('#e5e7eb');
    y += 10;
    doc.font(bFont).fontSize(10).text('Bank details:', 50, y);
    y += 16;
    doc.font(mainFont).fontSize(9);
    doc.text(`Recipient: ${company.full_name || company.name || ''}`, 50, y); y += 13;
    doc.text(`INN ${company.inn || ''}, KPP ${company.kpp || ''}`, 50, y); y += 13;
    doc.text(`Bank: ${company.bank_name}`, 50, y); y += 13;
    doc.text(`Account: ${company.bank_rs || ''}`, 50, y); y += 13;
    doc.text(`Corr. account: ${company.bank_ks || ''}`, 50, y); y += 13;
    doc.text(`BIK: ${company.bank_bik || ''}`, 50, y); y += 13;
  }

  if (inv.due_date) {
    y += 10;
    doc.font(bFont).fontSize(9).text(
      `Payment due: ${new Date(inv.due_date).toLocaleDateString('ru-RU')}`, 50, y
    );
  }

  y = Math.max(y + 30, doc.y + 30);
  if (y > 750) { doc.addPage(); y = 50; }
  doc.moveTo(50, y).lineTo(545, y).stroke('#e5e7eb');
  y += 15;
  doc.font(bFont).fontSize(9).text(company.director_title || 'General Director', 50, y);
  doc.text('_________________', 250, y);
  doc.font(mainFont).text(company.director_name || '', 370, y);

  doc.font(mainFont).fontSize(8).fillColor('#6b7280')
    .text(company.name || 'OOO "ASGARD SERVICE"', 50, doc.page.height - 50, { align: 'center' });

  doc.end();

  await new Promise(resolve => doc.on('end', resolve));
  return Buffer.concat(chunks);
}

module.exports = invoicesRoutes;
