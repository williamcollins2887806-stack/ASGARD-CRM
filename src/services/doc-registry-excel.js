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

/** Ставка НДС Doc Hub (как в UI / DEFAULT schema). */
const VAT_RATE_DEFAULT = 0.22;

function resolveHasVat(raw) {
  if (raw.has_vat === false || raw.has_vat === 'false' || raw.has_vat === 0 || raw.has_vat === '0') return false;
  if (raw.has_vat === true || raw.has_vat === 'true' || raw.has_vat === 1 || raw.has_vat === '1') return true;
  const nds = String(raw.nds != null ? raw.nds : raw.vat_flag != null ? raw.vat_flag : '').trim();
  if (/^(нет|no|false|0|-)$/i.test(nds)) return false;
  return true; // пусто / «да» → с НДС
}

function computeVatFields(amount, hasVat, raw = {}) {
  if (!hasVat || !(amount > 0)) {
    return { has_vat: false, vat_rate: 0, vat_amount: 0, amount_net: amount, amount_gross: amount };
  }
  let rate = num(raw.vat_rate);
  if (raw.vat_rate == null || raw.vat_rate === '') rate = VAT_RATE_DEFAULT;
  if (rate > 1) rate = rate / 100;
  if (rate < 0) rate = 0;
  const allowed = [0, 0.05, 0.1, 0.2, 0.22];
  const hit = allowed.find((a) => Math.abs(a - rate) < 0.0001);
  rate = hit != null ? hit : VAT_RATE_DEFAULT;
  const givenVat = raw.vat_amount != null ? num(raw.vat_amount) : 0;
  const givenNet = raw.amount_net != null ? num(raw.amount_net) : 0;
  if (givenVat > 0 && givenNet > 0) {
    return { has_vat: true, vat_rate: rate, vat_amount: givenVat, amount_net: givenNet, amount_gross: amount };
  }
  if (rate === 0) {
    return { has_vat: true, vat_rate: 0, vat_amount: 0, amount_net: amount, amount_gross: amount };
  }
  const net = +(amount / (1 + rate)).toFixed(2);
  const vat = +(amount - net).toFixed(2);
  return { has_vat: true, vat_rate: rate, vat_amount: vat, amount_net: net, amount_gross: amount };
}

function normalizeRow(raw = {}) {
  const amount = num(raw.amount_gross != null ? raw.amount_gross : raw.amount);
  const hasVat = resolveHasVat(raw);
  const vat = computeVatFields(amount, hasVat, raw);
  const contractLabel = raw.contract_label != null ? String(raw.contract_label).trim() : '';
  const spend = String(raw.spend_kind || '').toLowerCase();
  const spendKind = ['work', 'warehouse', 'office', 'other'].includes(spend)
    ? spend
    : (boolish(raw.purpose_consumables) || boolish(raw.office) ? 'office' : 'work');
  let closingJson = [];
  if (Array.isArray(raw.closing_json)) {
    closingJson = raw.closing_json.filter((x) => x && (x.no || x.date || x.sum != null));
  } else if (raw.closing_json && typeof raw.closing_json === 'object') {
    closingJson = [raw.closing_json];
  } else if (raw.closing_no || raw.sf_number) {
    closingJson = [{
      kind: raw.closing_kind || 'СФ',
      no: String(raw.closing_no || raw.sf_number || '').trim() || null,
      date: raw.closing_date ? String(raw.closing_date).slice(0, 10) : null,
      sum: raw.closing_sum != null ? num(raw.closing_sum) : null
    }];
  }
  return {
    dir: raw.dir === 'out' ? 'out' : 'in',
    package_type: raw.package_type || 'invoice',
    invoice_number: raw.invoice_number != null ? String(raw.invoice_number).trim() : null,
    invoice_date: raw.invoice_date ? String(raw.invoice_date).slice(0, 10) : null,
    counterparty_name: String(raw.counterparty_name || raw.supplier_name || '').trim(),
    counterparty_email: raw.counterparty_email ? String(raw.counterparty_email).trim() : null,
    counterparty_phone: raw.counterparty_phone ? String(raw.counterparty_phone).trim() : null,
    amount_gross: vat.amount_gross,
    amount_net: vat.amount_net,
    vat_amount: vat.vat_amount,
    vat_rate: vat.vat_rate,
    has_vat: vat.has_vat,
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
    contract_mode: raw.contract_mode || (contractLabel ? 'linked' : 'none'),
    contract_label: contractLabel || null,
    contract_date: raw.contract_date ? String(raw.contract_date).slice(0, 10) : null,
    contract_has_scan: boolish(raw.contract_has_scan),
    contract_has_original: boolish(raw.contract_has_original),
    receive_channel: raw.receive_channel ? String(raw.receive_channel).trim() : null,
    delivery_note: raw.delivery_note ? String(raw.delivery_note).trim() : null,
    delivery_due_at: raw.delivery_due_at ? String(raw.delivery_due_at).slice(0, 10) : null,
    vitya_state: raw.vitya_state != null ? String(raw.vitya_state).trim() : null,
    reconciliation_note: raw.reconciliation_note ? String(raw.reconciliation_note).trim() : null,
    closing_json: closingJson,
    spend_kind: spendKind,
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
    try {
      const row = normalizeRow(rows[i]);
      // Guard invalid dates before SQL cast
      if (row.invoice_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.invoice_date)) {
        row.invoice_date = null;
      }
      const dup = row.invoice_date ? await findDup(db, row) : null;
      const cls = classify(row, dup);
      if (cls.action === 'create') create++;
      else if (cls.action === 'skip-duplicate') skip++;
      else manual++;
      results.push({ index: i, ...cls, row });
    } catch (e) {
      manual++;
      results.push({ index: i, action: 'needs-manual', missing: ['error:' + e.message], row: normalizeRow(rows[i]) });
    }
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
      if (row.invoice_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.invoice_date)) {
        row.invoice_date = null;
      }
      const dup = row.invoice_date ? await findDup(db, row) : null;
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

      const closingPayload = Array.isArray(draft.closing_json) ? JSON.stringify(draft.closing_json) : '[]';
      const { rows: ins } = await db.query(
        `INSERT INTO doc_registry(
           dir, package_type, ops_status, pay_status, wh_status, contract_mode, contract_label,
           contract_date, contract_has_scan, contract_has_original,
           invoice_number, invoice_date, counterparty_name, counterparty_email, counterparty_phone,
           amount_gross, amount_net, vat_amount, vat_rate, has_vat,
           payment_due_at, work_id, pm_id, doc_owner_id, receive_channel,
           delivery_note, delivery_due_at, vitya_state, reconciliation_note, spend_kind,
           closing_json,
           purpose_consumables, purpose_asgard, purpose_customer, comment_text,
           is_incomplete, incomplete_reasons, created_by, updated_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,
           $8::date,$9,$10,
           $11,$12::date,$13,$14,$15,
           $16,$17,$18,$19,$20,
           $21::date,$22,$23,$24,$25,
           $26,$27::date,$28,$29,$30,
           $31::jsonb,
           $32,$33,$34,$35,
           $36,$37::text[],$38,$38
         ) RETURNING *`,
        [
          draft.dir, draft.package_type, draft.ops_status, draft.pay_status, draft.wh_status, draft.contract_mode, draft.contract_label,
          draft.contract_date || null, !!draft.contract_has_scan, !!draft.contract_has_original,
          draft.invoice_number, draft.invoice_date, draft.counterparty_name, draft.counterparty_email || null, draft.counterparty_phone || null,
          draft.amount_gross, draft.amount_net, draft.vat_amount, draft.vat_rate, draft.has_vat,
          draft.payment_due_at, draft.work_id, draft.pm_id, draft.doc_owner_id, draft.receive_channel,
          draft.delivery_note || null, draft.delivery_due_at || null, draft.vitya_state || null, draft.reconciliation_note || null, draft.spend_kind || 'work',
          closingPayload,
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
