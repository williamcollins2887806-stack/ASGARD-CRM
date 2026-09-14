'use strict';

/**
 * payment_invoices — standalone ТО + волна из закупки.
 * DIR/BUH работают здесь / в #/approval-payment, не в модалке заявки.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const paymentMail = require('../services/payment-mail');
const { createNotification } = require('../services/notify');
const { normalizeUploadUrl, uploadFsPath } = require('../utils/upload-url');
const { enrichCatalogFromLines } = require('../services/catalog-from-invoice');

const DIR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const CREATE_ROLES = ['PROC', 'ADMIN', 'PM', 'HEAD_PM', 'HEAD_TO', 'TO', ...DIR_ROLES];
const BUH_ROLES = ['BUH', 'ADMIN'];
const FILE_ROLES = [...new Set([...DIR_ROLES, ...BUH_ROLES, 'PROC', 'PM', 'HEAD_PM', 'HEAD_TO', 'TO'])];

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function statusLabel(status, paymentStatus, payTiming) {
  if (status === 'paid' || paymentStatus === 'paid') return 'Оплачен';
  if (status === 'rejected') return 'Отклонён';
  if (status === 'rework') return 'На доработке';
  if (paymentStatus === 'pending_payment' || status === 'pending_payment') {
    return payTiming === 'deferred' ? 'Одобрен, ждёт даты оплаты' : 'Ожидает оплаты';
  }
  if (status === 'awaiting_dir') return 'Ожидает директора';
  return status || '—';
}

async function ensureUploadDir() {
  const dir = path.join(process.cwd(), 'uploads', 'payment-invoices');
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function buildLineItemsFromImport(db, procurementId, importId) {
  const { rows } = await db.query(
    `SELECT pi.id, pi.name, pi.quantity, pi.unit_price, pi.total_price
     FROM procurement_items pi
     WHERE pi.procurement_id=$1 AND pi.invoice_import_id=$2
       AND COALESCE(pi.item_status,'pending')<>'cancelled'
     ORDER BY pi.id`,
    [procurementId, importId]
  );
  return rows.map(r => ({
    item_id: r.id,
    name: r.name,
    qty: num(r.quantity),
    unit_price: num(r.unit_price),
    total: num(r.total_price)
  }));
}

async function createFromProcurementWave(db, {
  procurementId, importId, actorId, basisText, payTiming
}) {
  const pack = await db.query(
    `SELECT ii.*, pr.work_id, pr.title AS proc_title
     FROM procurement_invoice_imports ii
     JOIN procurement_requests pr ON pr.id = ii.procurement_id
     WHERE ii.id=$1 AND ii.procurement_id=$2`,
    [importId, procurementId]
  );
  const imp = pack.rows[0];
  if (!imp) throw Object.assign(new Error('Счёт не найден'), { statusCode: 404 });

  const filePath = normalizeUploadUrl(imp.file_path);
  if (!filePath) {
    throw Object.assign(new Error('Сначала загрузите файл счёта'), { statusCode: 400 });
  }

  const existing = await db.query(
    `SELECT id FROM payment_invoices WHERE invoice_import_id=$1 AND status NOT IN ('rejected') LIMIT 1`,
    [importId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const lines = await buildLineItemsFromImport(db, procurementId, importId);
  const amount = num(imp.total_sum) || lines.reduce((s, l) => s + (l.total || l.unit_price * l.qty), 0);
  const basis = basisText || `Закупка #${procurementId}${imp.proc_title ? ': ' + imp.proc_title : ''}`;
  const timing = payTiming === 'deferred' ? 'deferred' : 'immediate';

  const { rows } = await db.query(
    `INSERT INTO payment_invoices(
       status, supplier_name, supplier_id, amount, due_date, file_path, file_name,
       basis_type, basis_text, work_id, procurement_id, invoice_import_id,
       line_items_json, requires_payment, created_by, pay_timing
     ) VALUES(
       'awaiting_dir', $1, $2, $3, NULL, $4, $5,
       'work', $6, $7, $8, $9,
       $10::jsonb, true, $11, $12
     ) RETURNING *`,
    [
      imp.supplier_name || null,
      imp.supplier_id || null,
      amount,
      filePath,
      imp.file_name || null,
      basis,
      imp.work_id || null,
      procurementId,
      importId,
      JSON.stringify(lines),
      actorId,
      timing
    ]
  );
  return rows[0];
}

async function afterPaid(db, payment) {
  if (payment.invoice_import_id) {
    await db.query(
      `UPDATE procurement_invoice_imports SET approval_status='paid', paid_at=NOW() WHERE id=$1`,
      [payment.invoice_import_id]
    );
  }
  if (payment.procurement_id) {
    const open = await db.query(
      `SELECT COUNT(*)::int n FROM procurement_invoice_imports
       WHERE procurement_id=$1 AND approval_status IN ('draft','pm_returned','awaiting_pm','pm_approved','awaiting_dir','dir_approved')`,
      [payment.procurement_id]
    );
    const uncovered = await db.query(
      `SELECT COUNT(*)::int n FROM procurement_items
       WHERE procurement_id=$1 AND parent_item_id IS NULL AND COALESCE(item_status,'pending')<>'cancelled'
         AND invoice_import_id IS NULL`,
      [payment.procurement_id]
    );
    if (open.rows[0].n === 0 && uncovered.rows[0].n === 0) {
      await db.query(
        `UPDATE procurement_requests SET status='paid', updated_at=NOW() WHERE id=$1 AND status NOT IN ('delivered','closed','partially_delivered')`,
        [payment.procurement_id]
      );
    }
  }
  try {
    const { upsertFromPaymentInvoice } = require('../services/doc-registry-upsert');
    await upsertFromPaymentInvoice(db, payment);
  } catch (e) {
    console.warn('[payment-invoices] doc_registry upsert:', e && e.message);
  }
}

function decoratePayment(row) {
  if (!row) return row;
  const file_path = normalizeUploadUrl(row.file_path);
  return {
    ...row,
    file_path,
    file_url: row.id ? `/api/payment-invoices/${row.id}/file` : null,
    status_label: statusLabel(row.status, row.payment_status, row.pay_timing)
  };
}

async function routes(fastify) {
  const db = fastify.db;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (req) => {
    const status = req.query.status || null;
    const q = status
      ? await db.query(`SELECT * FROM payment_invoices WHERE status=$1 ORDER BY id DESC LIMIT 200`, [status])
      : await db.query(`SELECT * FROM payment_invoices ORDER BY id DESC LIMIT 200`);
    return { items: q.rows.map(decoratePayment) };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return decoratePayment(rows[0]);
  });

  // Auth-gated file stream
  fastify.get('/:id/file', { preHandler: [fastify.requireRoles(FILE_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows } = await db.query('SELECT file_path, file_name FROM payment_invoices WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const fsPath = uploadFsPath(rows[0].file_path);
    if (!fsPath || !fs.existsSync(fsPath)) {
      return reply.code(404).send({ error: 'Файл счёта не найден на диске' });
    }
    const name = rows[0].file_name || path.basename(fsPath);
    const ext = path.extname(name).toLowerCase();
    const types = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel'
    };
    reply.header('Content-Type', types[ext] || 'application/octet-stream');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    return reply.send(fs.createReadStream(fsPath));
  });

  // Standalone create (ТО / закупщик)
  fastify.post('/', { preHandler: [fastify.requireRoles(CREATE_ROLES)] }, async (req, reply) => {
    const b = req.body || {};
    const amount = num(b.amount);
    if (amount <= 0 && !(b.line_items && b.line_items.length)) {
      return reply.code(400).send({ error: 'Укажите сумму или позиции' });
    }
    const filePath = normalizeUploadUrl(b.file_path);
    if (!filePath) {
      return reply.code(400).send({ error: 'Прикрепите файл счёта' });
    }
    if (!(b.supplier_name || b.supplier_id)) {
      return reply.code(400).send({ error: 'Укажите поставщика' });
    }
    const lines = Array.isArray(b.line_items) ? b.line_items : [];
    const sum = amount > 0 ? amount : lines.reduce((s, l) => s + num(l.unit_price) * num(l.qty || l.quantity || 1), 0);
    const timing = b.pay_timing === 'deferred' ? 'deferred' : 'immediate';
    const { rows } = await db.query(
      `INSERT INTO payment_invoices(
         status, supplier_name, supplier_id, amount, due_date, file_path, file_name,
         basis_type, basis_text, work_id, contract_id, line_items_json, requires_payment, created_by, pay_timing
       ) VALUES(
         'awaiting_dir', $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11::jsonb, true, $12, $13
       ) RETURNING *`,
      [
        b.supplier_name || null,
        b.supplier_id || null,
        sum,
        b.due_date || null,
        filePath,
        b.file_name || null,
        b.basis_type || 'other',
        b.basis_text || null,
        b.work_id || null,
        b.contract_id || null,
        JSON.stringify(lines),
        req.user.id,
        timing
      ]
    );
    const pay = rows[0];
    try {
      await enrichCatalogFromLines(db, {
        lines: lines.length ? lines : [],
        supplierName: pay.supplier_name,
        supplierId: pay.supplier_id,
        userId: req.user.id,
        source: 'quote',
        headerAmount: lines.length ? 0 : sum,
        headerLabel: pay.basis_text || `Счёт #${pay.id}`
      });
    } catch (e) {
      fastify.log.warn('[payment-invoices] catalog enrich: ' + e.message);
    }
    const mail = await paymentMail.sendDirectorMail(db, pay.id);
    const dirs = await db.query("SELECT id FROM users WHERE role IN('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active=true");
    for (const d of dirs.rows) {
      createNotification(db, {
        user_id: d.id,
        title: `Счёт #${pay.id} к согласованию`,
        message: `${sum} ₽ · ${pay.supplier_name || 'поставщик'}`,
        type: 'payment',
        link: `#/payment-invoices?id=${pay.id}`
      });
    }
    return { ...decoratePayment(pay), mail };
  });

  // multipart upload file for standalone
  fastify.post('/upload', { preHandler: [fastify.requireRoles(CREATE_ROLES)] }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'Нет файла' });
    const dir = await ensureUploadDir();
    const safe = String(data.filename || 'invoice').replace(/[^\w.\-а-яА-ЯёЁ]+/gi, '_').slice(0, 120);
    const fname = `${Date.now()}_${safe}`;
    const full = path.join(dir, fname);
    await fsp.writeFile(full, await data.toBuffer());
    const file_path = normalizeUploadUrl(`uploads/payment-invoices/${fname}`);
    return { file_path, file_name: data.filename || fname };
  });

  // Director can set pay_timing on approve
  fastify.post('/:id/dir-approve', { preHandler: [fastify.requireRoles(DIR_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    if (rows[0].status !== 'awaiting_dir') return reply.code(409).send({ error: 'Счёт не на согласовании директора' });
    const timing = (req.body && req.body.pay_timing) || rows[0].pay_timing;
    if (timing === 'deferred' || timing === 'immediate') {
      await db.query(`UPDATE payment_invoices SET pay_timing=$2, updated_at=NOW() WHERE id=$1`, [id, timing]);
      rows[0].pay_timing = timing;
    }
    const result = await paymentMail.applyDecision(db, rows[0], 'approve', req.user);
    return result;
  });

  fastify.post('/:id/dir-reject', { preHandler: [fastify.requireRoles(DIR_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    if (rows[0].status !== 'awaiting_dir') return reply.code(409).send({ error: 'Счёт не на согласовании директора' });
    const result = await paymentMail.applyDecision(db, rows[0], 'reject', req.user);
    return result;
  });

  // BUH pay with optional payment slip
  fastify.post('/:id/pay-bank', { preHandler: [fastify.requireRoles(BUH_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const pay = rows[0];
    if (pay.payment_status !== 'pending_payment') {
      return reply.code(409).send({ error: 'Счёт не в очереди оплаты' });
    }
    const comment = (req.body && req.body.comment) || null;
    const documentId = (req.body && req.body.document_id) || null;
    const skipPp = !!(req.body && req.body.skip_pp);
    if (!documentId && !skipPp && !(req.body && req.body.allow_no_pp)) {
      // soft: still allow if comment explains; UI should send skip_pp
    }
    await db.query(
      `UPDATE payment_invoices SET
         status='paid', payment_method='bank_transfer', payment_status='paid',
         payment_comment=$1, payment_doc_id=$2, buh_id=$3, buh_acted_at=NOW(), updated_at=NOW()
       WHERE id=$4`,
      [comment, documentId, req.user.id, id]
    );
    await afterPaid(db, pay);
    if (pay.created_by && pay.created_by !== req.user.id) {
      createNotification(db, {
        user_id: pay.created_by,
        title: `Счёт #${id} оплачен`,
        message: comment || 'Оплата через ПП',
        type: 'payment',
        link: pay.procurement_id ? `#/procurement?id=${pay.procurement_id}` : `#/payment-invoices?id=${id}`
      });
    }
    return { success: true, status: 'paid' };
  });

  fastify.decorate('createPaymentInvoiceFromWave', async (opts) => {
    const pay = await createFromProcurementWave(db, opts);
    await db.query(
      `UPDATE procurement_invoice_imports SET approval_status='awaiting_dir', sent_to_dir_at=NOW() WHERE id=$1`,
      [opts.importId]
    );
    const mail = await paymentMail.sendDirectorMail(db, pay.id);
    const dirs = await db.query("SELECT id FROM users WHERE role IN('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active=true");
    for (const d of dirs.rows) {
      createNotification(db, {
        user_id: d.id,
        title: `Счёт #${pay.id} к согласованию`,
        message: `${pay.amount} ₽ · заявка #${opts.procurementId}`,
        type: 'payment',
        link: `#/payment-invoices?id=${pay.id}`
      });
    }
    return { payment: decoratePayment(pay), mail };
  });

  routes.createFromProcurementWave = createFromProcurementWave;
  routes.afterPaid = afterPaid;
}

routes.createFromProcurementWave = createFromProcurementWave;
routes.afterPaid = afterPaid;
routes.sendDirectorMail = (db, id) => paymentMail.sendDirectorMail(db, id);
routes.normalizeUploadUrl = normalizeUploadUrl;

module.exports = routes;
