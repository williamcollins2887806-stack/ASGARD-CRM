'use strict';

/**
 * Upsert doc_registry из payment_invoices / office_expenses.
 */

let normalizeUploadUrl = (p) => p;
try { ({ normalizeUploadUrl } = require('../utils/upload-url')); } catch (_) { /* optional */ }

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normPath(p) {
  return normalizeUploadUrl(p) || p;
}

async function findDup(db, row) {
  if (!row.invoice_number || !row.invoice_date) return null;
  const params = [
    String(row.counterparty_name || '').trim().toLowerCase(),
    String(row.invoice_number || '').trim().toLowerCase(),
    row.invoice_date,
    num(row.amount_gross),
    row.dir || 'in'
  ];
  const { rows } = await db.query(
    `SELECT id FROM doc_registry WHERE deleted_at IS NULL
      AND lower(trim(counterparty_name))=$1 AND lower(trim(COALESCE(invoice_number,'')))=$2
      AND invoice_date=$3::date AND amount_gross=$4 AND dir=$5 LIMIT 1`,
    params
  );
  return rows[0] || null;
}

function calcIncomplete(row) {
  const r = [];
  if (!(row.invoice_number || '').toString().trim()) r.push('no_invoice_number');
  if (!row.invoice_date) r.push('no_invoice_date');
  if (!(row.counterparty_name || '').toString().trim()) r.push('no_counterparty');
  if ((row.contract_mode || 'none') === 'none' && !row.contract_id) r.push('no_contract');
  if (row.dir === 'in' && !row.payment_due_at) r.push('no_payment_due');
  if (row.dir === 'in' && !row.work_id && !row.purpose_asgard && !row.purpose_consumables) r.push('no_work');
  return { is_incomplete: r.length > 0, incomplete_reasons: r };
}

/**
 * После оплаты payment_invoice — создать/обновить карточку Doc Hub.
 * @returns {Promise<object|null>} doc row
 */
async function upsertFromPaymentInvoice(db, payment) {
  if (!payment || !payment.id) return null;

  const byPay = await db.query(
    `SELECT * FROM doc_registry WHERE payment_invoice_id=$1 AND deleted_at IS NULL LIMIT 1`,
    [payment.id]
  );

  const amount = num(payment.amount);
  const counterparty = String(payment.supplier_name || '').trim();
  const due = payment.due_date ? String(payment.due_date).slice(0, 10) : null;
  const fileUrl = payment.file_path ? normPath(payment.file_path) : null;
  const attachments = fileUrl
    ? [{ url: fileUrl, name: payment.file_name || null, source: 'payment_invoice' }]
    : [];

  const draft = {
    dir: 'in',
    package_type: 'invoice',
    ops_status: 'wait_sf',
    pay_status: 'paid',
    counterparty_name: counterparty,
    supplier_id: payment.supplier_id || null,
    amount_gross: amount,
    amount_net: amount,
    vat_amount: 0,
    has_vat: true,
    payment_due_at: due,
    work_id: payment.work_id || null,
    procurement_id: payment.procurement_id || null,
    payment_invoice_id: payment.id,
    attachments,
    original_path_url: fileUrl,
    invoice_number: payment.invoice_number || null,
    invoice_date: payment.invoice_date || (due || today()),
    comment_text: payment.basis_text || null
  };
  Object.assign(draft, calcIncomplete(draft));

  if (byPay.rows[0]) {
    const id = byPay.rows[0].id;
    const { rows } = await db.query(
      `UPDATE doc_registry SET
         counterparty_name=COALESCE(NULLIF($2,''), counterparty_name),
         supplier_id=COALESCE($3, supplier_id),
         amount_gross=$4, amount_net=$4,
         payment_due_at=COALESCE($5, payment_due_at),
         work_id=COALESCE($6, work_id),
         procurement_id=COALESCE($7, procurement_id),
         pay_status='paid',
         ops_status=CASE WHEN ops_status IN ('done','cancelled') THEN ops_status ELSE 'wait_sf' END,
         attachments=CASE
           WHEN $8::text IS NULL THEN attachments
           ELSE COALESCE(attachments, '[]'::jsonb) || $9::jsonb
         END,
         original_path_url=COALESCE($8, original_path_url),
         is_incomplete=$10, incomplete_reasons=$11::text[],
         updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [
        id,
        draft.counterparty_name,
        draft.supplier_id,
        draft.amount_gross,
        draft.payment_due_at,
        draft.work_id,
        draft.procurement_id,
        fileUrl,
        JSON.stringify(attachments),
        draft.is_incomplete,
        draft.incomplete_reasons
      ]
    );
    return rows[0] || null;
  }

  const dup = await findDup(db, draft);
  if (dup) {
    const { rows } = await db.query(
      `UPDATE doc_registry SET
         payment_invoice_id=$2, pay_status='paid',
         ops_status=CASE WHEN ops_status IN ('done','cancelled') THEN ops_status ELSE 'wait_sf' END,
         procurement_id=COALESCE($3, procurement_id),
         work_id=COALESCE($4, work_id),
         updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [dup.id, payment.id, draft.procurement_id, draft.work_id]
    );
    return rows[0] || null;
  }

  const { rows } = await db.query(
    `INSERT INTO doc_registry(
       dir, package_type, ops_status, pay_status, counterparty_name, supplier_id,
       amount_gross, amount_net, vat_amount, has_vat, payment_due_at,
       work_id, procurement_id, payment_invoice_id, attachments, original_path_url,
       invoice_number, invoice_date, comment_text,
       is_incomplete, incomplete_reasons, contract_mode, wh_status
     ) VALUES (
       'in','invoice','wait_sf','paid',$1,$2,
       $3,$3,0,true,$4,
       $5,$6,$7,$8::jsonb,$9,
       $10,$11::date,$12,
       $13,$14::text[],'none','none'
     ) RETURNING *`,
    [
      draft.counterparty_name,
      draft.supplier_id,
      draft.amount_gross,
      draft.payment_due_at,
      draft.work_id,
      draft.procurement_id,
      payment.id,
      JSON.stringify(attachments),
      fileUrl,
      draft.invoice_number,
      draft.invoice_date,
      draft.comment_text,
      draft.is_incomplete,
      draft.incomplete_reasons
    ]
  );
  return rows[0] || null;
}

/**
 * Мягкая карточка Doc Hub для офисного расхода (если ещё нет).
 */
async function suggestFromOfficeExpense(db, expense, userId) {
  if (!expense || !expense.id) return null;
  const amount = num(expense.amount || expense.total_amount);
  if (!(amount > 0)) return null;
  const exists = await db.query(
    `SELECT id FROM doc_registry WHERE office_expense_id=$1 AND deleted_at IS NULL LIMIT 1`,
    [expense.id]
  );
  if (exists.rows[0]) return exists.rows[0];

  const counterparty = String(expense.supplier || '').trim() || 'Офисный расход';
  const invDate = expense.date ? String(expense.date).slice(0, 10) : today();
  const draft = {
    dir: 'in',
    counterparty_name: counterparty,
    invoice_number: expense.doc_number || `OE-${expense.id}`,
    invoice_date: invDate,
    amount_gross: amount,
    purpose_consumables: true,
    purpose_asgard: true,
    office_expense_id: expense.id,
    contract_mode: 'none'
  };
  Object.assign(draft, calcIncomplete(draft));

  try {
    const { rows } = await db.query(
      `INSERT INTO doc_registry(
         dir, package_type, ops_status, pay_status, counterparty_name,
         amount_gross, amount_net, vat_amount, has_vat,
         invoice_number, invoice_date, office_expense_id,
         purpose_consumables, purpose_asgard, comment_text,
         is_incomplete, incomplete_reasons, contract_mode, wh_status,
         doc_owner_id, created_by, updated_by
       ) VALUES (
         'in','invoice','incomplete','none',$1,
         $2,$2,COALESCE($3,0),true,
         $4,$5::date,$6,
         true,true,$7,
         $8,$9::text[],'none','none',
         $10,$10,$10
       ) RETURNING id`,
      [
        counterparty,
        amount,
        expense.vat_amount != null ? num(expense.vat_amount) : 0,
        draft.invoice_number,
        invDate,
        expense.id,
        expense.description || expense.notes || null,
        draft.is_incomplete,
        draft.incomplete_reasons,
        userId || expense.created_by || null
      ]
    );
    return rows[0] || null;
  } catch (e) {
    if (e.code === '23505') {
      const again = await db.query(
        `SELECT id FROM doc_registry WHERE office_expense_id=$1 AND deleted_at IS NULL LIMIT 1`,
        [expense.id]
      );
      return again.rows[0] || null;
    }
    throw e;
  }
}

async function upsertFromOutgoingInvoice(db, invoice) {
  if (!invoice || !invoice.id) return null;
  const existing = await db.query(
    `SELECT id FROM doc_registry WHERE billing_invoice_id=$1 AND deleted_at IS NULL LIMIT 1`,
    [invoice.id]
  );
  const amount = num(invoice.total_amount != null ? invoice.total_amount : invoice.amount);
  const draft = {
    dir: 'out',
    package_type: 'invoice',
    ops_status: invoice.status === 'paid' ? 'done' : (invoice.status === 'draft' ? 'draft' : 'out_sent'),
    invoice_number: invoice.invoice_number || String(invoice.id),
    invoice_date: invoice.invoice_date || today(),
    counterparty_name: invoice.customer_name || invoice.counterparty_name || 'Заказчик',
    amount_gross: amount,
    amount_net: amount,
    vat_amount: num(invoice.vat_amount),
    has_vat: num(invoice.vat_amount) > 0,
    payment_due_at: invoice.due_date || null,
    pay_status: invoice.status === 'paid' ? 'paid' : 'wait',
    work_id: invoice.work_id || null,
    billing_invoice_id: invoice.id,
    contract_mode: invoice.contract_id ? 'linked' : 'none',
    contract_id: invoice.contract_id || null
  };
  Object.assign(draft, calcIncomplete(draft));
  if (existing.rows[0]) {
    await db.query(
      `UPDATE doc_registry SET
        invoice_number=$2, invoice_date=$3::date, counterparty_name=$4,
        amount_gross=$5, ops_status=$6, pay_status=$7, payment_due_at=$8,
        work_id=COALESCE($9, work_id), updated_at=NOW()
       WHERE id=$1`,
      [
        existing.rows[0].id, draft.invoice_number, draft.invoice_date, draft.counterparty_name,
        draft.amount_gross, draft.ops_status, draft.pay_status, draft.payment_due_at, draft.work_id
      ]
    );
    return existing.rows[0];
  }
  const { rows } = await db.query(
    `INSERT INTO doc_registry(
      dir, package_type, ops_status, invoice_number, invoice_date, counterparty_name,
      amount_gross, amount_net, vat_amount, has_vat, payment_due_at, pay_status,
      work_id, billing_invoice_id, contract_mode, contract_id,
      is_incomplete, incomplete_reasons, created_by, updated_at, created_at
    ) VALUES (
      'out','invoice',$1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW()
    ) RETURNING id`,
    [
      draft.ops_status, draft.invoice_number, draft.invoice_date, draft.counterparty_name,
      draft.amount_gross, draft.amount_net, draft.vat_amount, draft.has_vat,
      draft.payment_due_at, draft.pay_status, draft.work_id, invoice.id,
      draft.contract_mode, draft.contract_id, draft.is_incomplete, draft.incomplete_reasons,
      invoice.created_by || null
    ]
  );
  return rows[0] || null;
}

module.exports = {
  upsertFromPaymentInvoice,
  suggestFromOfficeExpense,
  upsertFromOutgoingInvoice,
  findDup,
  calcIncomplete
};
