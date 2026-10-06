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
  const mode = row.contract_mode || 'none';
  // once/general/none не дают no_contract; только linked без contract_id
  if (mode === 'linked' && !row.contract_id) r.push('no_contract');
  if (row.dir === 'in' && !row.payment_due_at) r.push('no_payment_due');
  const sk = row.spend_kind || 'work';
  if (row.dir === 'in' && sk === 'work' && !row.work_id && !row.purpose_asgard && !row.purpose_consumables) {
    r.push('no_work');
  }
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
    billing_act_id: invoice.act_id || null,
    contract_mode: invoice.contract_id ? 'linked' : 'none',
    contract_id: invoice.contract_id || null
  };
  Object.assign(draft, calcIncomplete(draft));
  if (existing.rows[0]) {
    await db.query(
      `UPDATE doc_registry SET
        invoice_number=$2, invoice_date=$3::date, counterparty_name=$4,
        amount_gross=$5, ops_status=$6, pay_status=$7, payment_due_at=$8,
        work_id=COALESCE($9, work_id),
        billing_act_id=COALESCE($10, billing_act_id),
        updated_at=NOW()
       WHERE id=$1`,
      [
        existing.rows[0].id, draft.invoice_number, draft.invoice_date, draft.counterparty_name,
        draft.amount_gross, draft.ops_status, draft.pay_status, draft.payment_due_at, draft.work_id,
        draft.billing_act_id
      ]
    );
    return existing.rows[0];
  }
  const { rows } = await db.query(
    `INSERT INTO doc_registry(
      dir, package_type, ops_status, invoice_number, invoice_date, counterparty_name,
      amount_gross, amount_net, vat_amount, has_vat, payment_due_at, pay_status,
      work_id, billing_invoice_id, billing_act_id, contract_mode, contract_id,
      is_incomplete, incomplete_reasons, created_by, updated_at, created_at
    ) VALUES (
      'out','invoice',$1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW()
    ) RETURNING id`,
    [
      draft.ops_status, draft.invoice_number, draft.invoice_date, draft.counterparty_name,
      draft.amount_gross, draft.amount_net, draft.vat_amount, draft.has_vat,
      draft.payment_due_at, draft.pay_status, draft.work_id, invoice.id,
      draft.billing_act_id, draft.contract_mode, draft.contract_id,
      draft.is_incomplete, draft.incomplete_reasons,
      invoice.created_by || null
    ]
  );
  return rows[0] || null;
}

/**
 * F1: исходящий акт → карточка doc_registry (dir=out, package_type=act).
 */
async function upsertFromOutgoingAct(db, act) {
  if (!act || !act.id) return null;
  const existing = await db.query(
    `SELECT id FROM doc_registry WHERE billing_act_id=$1 AND deleted_at IS NULL LIMIT 1`,
    [act.id]
  );
  const amount = num(act.total_amount != null ? act.total_amount : act.amount);
  const draft = {
    dir: 'out',
    package_type: 'act',
    ops_status: act.status === 'signed' || act.status === 'paid' ? 'done' : (act.status === 'draft' ? 'draft' : 'out_sent'),
    invoice_number: act.act_number || String(act.id),
    invoice_date: act.act_date || today(),
    counterparty_name: act.customer_name || act.counterparty_name || 'Заказчик',
    amount_gross: amount,
    amount_net: amount,
    vat_amount: num(act.vat_amount),
    has_vat: num(act.vat_amount) > 0,
    payment_due_at: null,
    pay_status: act.status === 'paid' ? 'paid' : 'n_a',
    work_id: act.work_id || null,
    billing_act_id: act.id,
    contract_mode: act.contract_id ? 'linked' : 'none',
    contract_id: act.contract_id || null
  };
  Object.assign(draft, calcIncomplete(draft));
  if (existing.rows[0]) {
    await db.query(
      `UPDATE doc_registry SET
        invoice_number=$2, invoice_date=$3::date, counterparty_name=$4,
        amount_gross=$5, ops_status=$6, pay_status=$7,
        work_id=COALESCE($8, work_id), updated_at=NOW()
       WHERE id=$1`,
      [
        existing.rows[0].id, draft.invoice_number, draft.invoice_date, draft.counterparty_name,
        draft.amount_gross, draft.ops_status, draft.pay_status, draft.work_id
      ]
    );
    // F2: если у счёта той же работы есть act_id=этот акт — проставить billing_act_id на карточке счёта
    if (act.id) {
      await db.query(
        `UPDATE doc_registry d SET billing_act_id=$1, updated_at=NOW()
         FROM invoices i
         WHERE i.act_id=$1 AND d.billing_invoice_id=i.id AND d.deleted_at IS NULL
           AND (d.billing_act_id IS NULL OR d.billing_act_id<>$1)`,
        [act.id]
      ).catch(() => null);
    }
    return existing.rows[0];
  }
  const { rows } = await db.query(
    `INSERT INTO doc_registry(
      dir, package_type, ops_status, invoice_number, invoice_date, counterparty_name,
      amount_gross, amount_net, vat_amount, has_vat, pay_status,
      work_id, billing_act_id, contract_mode, contract_id,
      is_incomplete, incomplete_reasons, created_by, updated_at, created_at
    ) VALUES (
      'out','act',$1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()
    ) RETURNING id`,
    [
      draft.ops_status, draft.invoice_number, draft.invoice_date, draft.counterparty_name,
      draft.amount_gross, draft.amount_net, draft.vat_amount, draft.has_vat,
      draft.pay_status, draft.work_id, act.id,
      draft.contract_mode, draft.contract_id,
      draft.is_incomplete, draft.incomplete_reasons,
      act.created_by || null
    ]
  );
  return rows[0] || null;
}

/** F4: soft-delete карточки реестра, привязанной к billing invoice/act */
async function softDeleteByBillingRef(db, { billingInvoiceId, billingActId, userId }) {
  if (billingInvoiceId) {
    await db.query(
      `UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW(), updated_by=$2
       WHERE billing_invoice_id=$1 AND deleted_at IS NULL`,
      [billingInvoiceId, userId || null]
    );
  }
  if (billingActId) {
    await db.query(
      `UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW(), updated_by=$2
       WHERE billing_act_id=$1 AND deleted_at IS NULL`,
      [billingActId, userId || null]
    );
  }
}

/**
 * F4b: можно ли hard-delete billing / карточку.
 * Возвращает { ok:true } или { ok:false, error, code }.
 */
async function assertSafeBillingDelete(db, { billingInvoiceId, billingActId, docId }) {
  let doc = null;
  if (docId) {
    const { rows } = await db.query(
      `SELECT * FROM doc_registry WHERE id=$1 AND deleted_at IS NULL`,
      [docId]
    );
    doc = rows[0] || null;
  } else if (billingInvoiceId) {
    const { rows } = await db.query(
      `SELECT * FROM doc_registry WHERE billing_invoice_id=$1 AND deleted_at IS NULL LIMIT 1`,
      [billingInvoiceId]
    );
    doc = rows[0] || null;
  } else if (billingActId) {
    const { rows } = await db.query(
      `SELECT * FROM doc_registry WHERE billing_act_id=$1 AND deleted_at IS NULL LIMIT 1`,
      [billingActId]
    );
    doc = rows[0] || null;
  }
  if (!doc) return { ok: true, doc: null };

  if (doc.payment_invoice_id) {
    const { rows: pays } = await db.query(
      `SELECT id, status FROM payment_invoices WHERE id=$1`,
      [doc.payment_invoice_id]
    );
    const st = pays[0] && pays[0].status;
    if (pays[0] && !['rejected'].includes(st)) {
      return {
        ok: false,
        code: 409,
        error: 'Сначала отмените/отклоните связанную заявку на оплату #' + doc.payment_invoice_id
      };
    }
  }
  if (doc.work_expense_id) {
    const { rows: ex } = await db.query(
      `SELECT id FROM work_expenses WHERE id=$1`,
      [doc.work_expense_id]
    );
    if (ex[0]) {
      return {
        ok: false,
        code: 409,
        error: 'Документ связан с расходом проекта #' + doc.work_expense_id + ' — сначала отвяжите расход'
      };
    }
  }
  // расходы, созданные через payment_invoices
  if (doc.payment_invoice_id) {
    const { rows: we } = await db.query(
      `SELECT id FROM work_expenses WHERE source_table='payment_invoices' AND source_key=$1 LIMIT 1`,
      [String(doc.payment_invoice_id)]
    );
    if (we[0]) {
      return {
        ok: false,
        code: 409,
        error: 'Есть расход проекта от оплаты — сначала разберите расход #' + we[0].id
      };
    }
  }
  return { ok: true, doc };
}

/**
 * F4 full sync: удаление карточки хаба → hard-delete связанных billing docs.
 */
async function hardDeleteBillingForDoc(db, doc) {
  if (!doc) return;
  if (doc.billing_invoice_id) {
    await db.query(`DELETE FROM invoice_payments WHERE invoice_id=$1`, [doc.billing_invoice_id]).catch(() => null);
    await db.query(`DELETE FROM invoices WHERE id=$1`, [doc.billing_invoice_id]).catch(() => null);
  }
  if (doc.billing_act_id) {
    await db.query(`DELETE FROM acts WHERE id=$1`, [doc.billing_act_id]).catch(() => null);
  }
}

module.exports = {
  upsertFromPaymentInvoice,
  suggestFromOfficeExpense,
  upsertFromOutgoingInvoice,
  upsertFromOutgoingAct,
  softDeleteByBillingRef,
  assertSafeBillingDelete,
  hardDeleteBillingForDoc,
  findDup,
  calcIncomplete
};
