'use strict';

/**
 * Excel dry-run / apply для Doc Hub (unified rows).
 */

const { findDup, calcIncomplete } = require('./doc-registry-upsert');

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function boolish(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'yes' || v === 'да';
}

function normalizeRow(raw = {}) {
  const amount = num(raw.amount_gross != null ? raw.amount_gross : raw.amount);
  return {
    dir: raw.dir === 'out' ? 'out' : 'in',
    package_type: raw.package_type || 'invoice',
    invoice_number: raw.invoice_number != null ? String(raw.invoice_number).trim() : null,
    invoice_date: raw.invoice_date ? String(raw.invoice_date).slice(0, 10) : null,
    counterparty_name: String(raw.counterparty_name || raw.supplier_name || '').trim(),
    amount_gross: amount,
    amount_net: raw.amount_net != null ? num(raw.amount_net) : amount,
    vat_amount: raw.vat_amount != null ? num(raw.vat_amount) : 0,
    has_vat: raw.has_vat !== false && raw.has_vat !== 'false',
    payment_due_at: raw.payment_due_at ? String(raw.payment_due_at).slice(0, 10) : null,
    work_id: raw.work_id != null && raw.work_id !== '' ? parseInt(raw.work_id, 10) : null,
    work_title: raw.work_title ? String(raw.work_title).trim() : null,
    work_pm_id: raw.work_pm_id != null && raw.work_pm_id !== '' ? parseInt(raw.work_pm_id, 10) : null,
    pm_id: raw.pm_id != null && raw.pm_id !== '' ? parseInt(raw.pm_id, 10) : null,
    purpose_consumables: boolish(raw.purpose_consumables) || boolish(raw.office),
    purpose_asgard: boolish(raw.purpose_asgard),
    purpose_customer: boolish(raw.purpose_customer),
    comment_text: raw.comment_text || raw.comment || null,
    ops_status: raw.ops_status || 'draft',
    pay_status: raw.pay_status || 'none',
    wh_status: raw.wh_status || 'none',
    contract_mode: raw.contract_mode || 'none',
    doc_owner_id: raw.doc_owner_id != null ? parseInt(raw.doc_owner_id, 10) : null,
    link_expense: boolish(raw.link_expense) || boolish(raw.create_expense)
  };
}

function classify(row, dup) {
  if (dup) return { action: 'skip-duplicate', existing_id: dup.id };
  const missing = [];
  if (!row.counterparty_name) missing.push('counterparty_name');
  if (!row.invoice_number) missing.push('invoice_number');
  if (!row.invoice_date) missing.push('invoice_date');
  if (!(row.amount_gross > 0)) missing.push('amount_gross');
  if (missing.length) return { action: 'needs-manual', missing };
  return { action: 'create' };
}

async function dryRun(db, rowsIn) {
  const rows = Array.isArray(rowsIn) ? rowsIn : [];
  const results = [];
  let create = 0; let skip = 0; let manual = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = normalizeRow(rows[i]);
    const dup = await findDup(db, row);
    const cls = classify(row, dup);
    if (cls.action === 'create') create++;
    else if (cls.action === 'skip-duplicate') skip++;
    else manual++;
    results.push({ index: i, ...cls, row });
  }
  return { create, skip_duplicate: skip, needs_manual: manual, items: results };
}

async function ensureWork(db, row, userId) {
  if (row.work_id && !isNaN(row.work_id)) return row.work_id;
  if (!row.work_title) return null;
  const { rows } = await db.query(
    `INSERT INTO works (work_title, pm_id, work_status, created_by, created_at, updated_at)
     VALUES ($1, $2, 'Новая', $3, NOW(), NOW()) RETURNING id`,
    [row.work_title, row.work_pm_id || row.pm_id || null, userId || null]
  );
  return rows[0].id;
}

async function maybeOfficeExpense(db, doc, userId) {
  if (!doc.purpose_consumables && !doc.purpose_asgard) return null;
  if (doc.office_expense_id) return doc.office_expense_id;
  if (doc.work_id) return null;
  const { rows } = await db.query(
    `INSERT INTO office_expenses (
       category, description, amount, date, supplier, status, created_by, created_at, doc_number
     ) VALUES (
       'consumables', $1, $2, COALESCE($3::date, CURRENT_DATE), $4, 'pending', $5, NOW(), $6
     ) RETURNING id`,
    [
      doc.comment_text || `Doc Hub #${doc.id}`,
      num(doc.amount_gross),
      doc.invoice_date || today(),
      doc.counterparty_name || null,
      userId || null,
      doc.invoice_number || null
    ]
  );
  const oeId = rows[0].id;
  await db.query(`UPDATE doc_registry SET office_expense_id=$2, updated_at=NOW() WHERE id=$1`, [doc.id, oeId]);
  return oeId;
}

async function maybeLinkWorkExpense(db, doc, userId) {
  if (!doc.work_id || doc.work_expense_id) return null;
  const { insertWorkExpense } = require('./work-expense-writer');
  const expense = await insertWorkExpense(db, {
    work_id: doc.work_id,
    category: 'materials',
    subcategory: 'other',
    amount: num(doc.amount_gross),
    date: doc.invoice_date || today(),
    description: `Doc Hub #${doc.id} ${doc.invoice_number || ''}`.trim(),
    supplier: doc.counterparty_name || null,
    doc_number: doc.invoice_number || null,
    vat_rate: doc.has_vat ? num(doc.vat_rate) : 0,
    vat_amount: num(doc.vat_amount),
    amount_ex_vat: num(doc.amount_net),
    payment_method: 'bank',
    source_table: 'doc_registry',
    source_id: doc.id,
    source_key: `doc_registry:${doc.id}`,
    status: 'pending',
    created_by: userId || null
  });
  await db.query(`UPDATE doc_registry SET work_expense_id=$2, updated_at=NOW() WHERE id=$1`, [doc.id, expense.id]);
  return expense.id;
}

async function apply(db, rowsIn, userId) {
  const rows = Array.isArray(rowsIn) ? rowsIn : [];
  const items = [];
  let created = 0; let skipped = 0; let manual = 0; let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = normalizeRow(rows[i]);
    try {
      const dup = await findDup(db, row);
      const cls = classify(row, dup);
      if (cls.action === 'skip-duplicate') {
        skipped++;
        items.push({ index: i, action: 'skip-duplicate', id: dup.id });
        continue;
      }
      if (cls.action === 'needs-manual') {
        manual++;
        items.push({ index: i, action: 'needs-manual', missing: cls.missing });
        continue;
      }

      const workId = await ensureWork(db, row, userId);
      const draft = {
        ...row,
        work_id: workId,
        pm_id: row.pm_id || row.work_pm_id || null,
        doc_owner_id: row.doc_owner_id || userId || null
      };
      Object.assign(draft, calcIncomplete(draft));

      const { rows: ins } = await db.query(
        `INSERT INTO doc_registry(
           dir, package_type, ops_status, pay_status, wh_status, contract_mode,
           invoice_number, invoice_date, counterparty_name,
           amount_gross, amount_net, vat_amount, has_vat,
           payment_due_at, work_id, pm_id, doc_owner_id,
           purpose_consumables, purpose_asgard, purpose_customer, comment_text,
           is_incomplete, incomplete_reasons, created_by, updated_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,$8::date,$9,
           $10,$11,$12,$13,
           $14::date,$15,$16,$17,
           $18,$19,$20,$21,
           $22,$23::text[],$24,$24
         ) RETURNING *`,
        [
          draft.dir, draft.package_type, draft.ops_status, draft.pay_status, draft.wh_status, draft.contract_mode,
          draft.invoice_number, draft.invoice_date, draft.counterparty_name,
          draft.amount_gross, draft.amount_net, draft.vat_amount, draft.has_vat,
          draft.payment_due_at, draft.work_id, draft.pm_id, draft.doc_owner_id,
          !!draft.purpose_consumables, !!draft.purpose_asgard, !!draft.purpose_customer, draft.comment_text,
          draft.is_incomplete, draft.incomplete_reasons, userId || null
        ]
      );
      const doc = ins[0];
      let office_expense_id = null;
      let work_expense_id = null;
      if (draft.purpose_consumables || (draft.purpose_asgard && !draft.work_id)) {
        try { office_expense_id = await maybeOfficeExpense(db, doc, userId); } catch (_) { /* soft */ }
      }
      if (draft.work_id && (draft.link_expense || draft.dir === 'in')) {
        try { work_expense_id = await maybeLinkWorkExpense(db, { ...doc, work_id: draft.work_id }, userId); } catch (_) { /* soft */ }
      }
      created++;
      items.push({ index: i, action: 'create', id: doc.id, work_id: draft.work_id, office_expense_id, work_expense_id });
    } catch (e) {
      errors++;
      items.push({ index: i, action: 'error', error: e.message });
    }
  }

  return { created, skip_duplicate: skipped, needs_manual: manual, errors, items };
}

module.exports = { dryRun, apply, normalizeRow };
