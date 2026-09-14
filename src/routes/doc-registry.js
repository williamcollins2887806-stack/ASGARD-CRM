'use strict';

/**
 * Doc Hub API — doc_registry (+ audit). Не путать с payment_invoices.
 */

const path = require('path');
const fsp = require('fs').promises;
const { randomUUID } = require('crypto');
const { enrichCatalogFromLines } = require('../services/catalog-from-invoice');
const excelSvc = require('../services/doc-registry-excel');

let normalizeUploadUrl = (p) => p;
try { ({ normalizeUploadUrl } = require('../utils/upload-url')); } catch (_) { /* optional */ }

const ALLOWED = [
  'ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR',
  'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'PROC', 'WAREHOUSE', 'OFFICE_MANAGER'
];
const WH_ROLES = new Set(['WAREHOUSE', 'ADMIN', 'BUH']);
const WH_CHAIN = ['none', 'await', 'received', 'to_office', 'buh_ok'];
const JSON_COLS = new Set(['attachments', 'parsed_json', 'closing_json', 'onec_payload']);
const WRITE_COLS = [
  'dir', 'package_type', 'ops_status', 'invoice_number', 'invoice_date',
  'counterparty_name', 'counterparty_email', 'counterparty_phone',
  'supplier_id', 'customer_id', 'work_id', 'contract_id', 'contract_mode', 'contract_label',
  'amount_gross', 'amount_net', 'vat_amount', 'vat_rate', 'has_vat',
  'payment_due_at', 'sf_due_at', 'delivery_due_at', 'delivery_note', 'pay_status',
  'closing_json', 'receive_channel', 'reconciliation_note',
  'purpose_customer', 'purpose_asgard', 'purpose_consumables', 'comment_text',
  'wh_status', 'procurement_id', 'payment_invoice_id', 'office_expense_id',
  'work_expense_id', 'billing_invoice_id', 'billing_act_id',
  'attachments', 'original_path_url', 'parsed_json',
  'is_incomplete', 'incomplete_reasons', 'onec_id', 'onec_synced_at', 'onec_payload',
  'edo_status', 'edo_external_id', 'doc_owner_id', 'pm_id'
];

const JOIN_SQL = `SELECT d.*,
  COALESCE(w.work_title, w.object_name) AS work_title,
  uo.name AS doc_owner_name, up.name AS pm_name
 FROM doc_registry d
 LEFT JOIN works w ON w.id = d.work_id
 LEFT JOIN users uo ON uo.id = d.doc_owner_id
 LEFT JOIN users up ON up.id = d.pm_id`;

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function today() { return new Date().toISOString().slice(0, 10); }

function computeAmounts(b = {}) {
  const rate = num(b.vat_rate) > 0 ? num(b.vat_rate) : 0.22;
  const gross = num(b.amount_gross);
  const hasVat = !(b.has_vat === false || b.has_vat === 'false' || b.has_vat === 0);
  if (b.amount_net != null && b.amount_net !== '' && Number.isFinite(parseFloat(b.amount_net))) {
    const net = num(b.amount_net);
    const vat = (b.vat_amount != null && b.vat_amount !== '') ? num(b.vat_amount) : Math.max(0, +(gross - net).toFixed(2));
    return { amount_gross: gross, amount_net: net, vat_amount: vat, vat_rate: rate, has_vat: hasVat };
  }
  if (hasVat) {
    const net = +(gross / (1 + rate)).toFixed(2);
    return { amount_gross: gross, amount_net: net, vat_amount: +(gross - net).toFixed(2), vat_rate: rate, has_vat: true };
  }
  return { amount_gross: gross, amount_net: gross, vat_amount: 0, vat_rate: rate, has_vat: false };
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

function normPath(p) { return normalizeUploadUrl(p) || p; }

function pickBody(b) {
  const out = {};
  for (const k of WRITE_COLS) if (b[k] !== undefined) out[k] = b[k];
  if (Array.isArray(out.attachments)) {
    out.attachments = out.attachments.map((a) => {
      if (typeof a === 'string') return normPath(a);
      if (a && typeof a === 'object') {
        const c = { ...a };
        if (c.url) c.url = normPath(c.url);
        if (c.path) c.path = normPath(c.path);
        return c;
      }
      return a;
    });
  }
  if (out.original_path_url) out.original_path_url = normPath(out.original_path_url);
  if (b.line_items && out.parsed_json === undefined) out.parsed_json = b.line_items;
  return out;
}

function decorate(row) {
  if (!row) return row;
  const t = today();
  const payDue = row.payment_due_at ? String(row.payment_due_at).slice(0, 10) : null;
  const sfDue = row.sf_due_at ? String(row.sf_due_at).slice(0, 10) : null;
  return {
    ...row,
    original_path_url: normPath(row.original_path_url),
    overdue_pay: !!(payDue && payDue < t && !['paid', 'n_a'].includes(row.pay_status)),
    overdue_sf: !!(sfDue && sfDue < t && ['wait_sf', 'wait_closing'].includes(row.ops_status))
  };
}

function linesOf(doc) {
  const pj = doc && doc.parsed_json;
  if (Array.isArray(pj)) return pj;
  if (pj && Array.isArray(pj.lines)) return pj.lines;
  return [];
}

function attachmentsOf(doc) {
  let a = doc && doc.attachments;
  if (typeof a === 'string') try { a = JSON.parse(a); } catch (_) { a = []; }
  return Array.isArray(a) ? a : [];
}

function fireCatalog(fastify, db, doc, userId) {
  if (!doc || doc.dir !== 'in') return;
  const lines = linesOf(doc);
  if (!lines.length) return;
  Promise.resolve()
    .then(() => enrichCatalogFromLines(db, {
      lines, supplierName: doc.counterparty_name, supplierId: doc.supplier_id, userId, source: 'quote'
    }))
    .catch((e) => fastify.log.warn('[doc-registry] catalog: ' + (e && e.message)));
}

async function markCatalogPending(db, docId, doc) {
  const reasons = Array.isArray(doc.incomplete_reasons) ? [...doc.incomplete_reasons] : [];
  if (!reasons.includes('catalog_parse_pending')) reasons.push('catalog_parse_pending');
  await db.query(
    `UPDATE doc_registry SET is_incomplete=true, incomplete_reasons=$2::text[], updated_at=NOW() WHERE id=$1`,
    [docId, reasons]
  );
}

async function parseLinesFromAi(text) {
  const aiProvider = require('../services/ai-provider');
  const r = await aiProvider.complete({
    system: 'Извлеки из текста счёта список позиций. Верни СТРОГО JSON {"supplier":"","items":[{"name":"","article":"","quantity":1,"unit":"шт","unit_price":0}]} без markdown.',
    messages: [{ role: 'user', content: 'Счёт:\n\n' + String(text).slice(0, 14000) }],
    maxTokens: 4000,
    temperature: 0.1
  });
  const m = (r && r.text || '').match(/\{[\s\S]*\}/);
  const j = m ? JSON.parse(m[0]) : null;
  return {
    items: j && Array.isArray(j.items) ? j.items : [],
    supplier: j && j.supplier ? j.supplier : null
  };
}

async function runParseCatalog(db, doc, opts = {}) {
  let lines = [];
  let supplierHint = null;
  if (Array.isArray(opts.items) && opts.items.length) {
    lines = opts.items;
  } else if (opts.text && String(opts.text).trim()) {
    const parsed = await parseLinesFromAi(opts.text);
    lines = parsed.items;
    supplierHint = parsed.supplier;
  } else if (opts.buffer) {
    const { parseProcurementExcel } = require('../utils/excel-parser');
    lines = await parseProcurementExcel(opts.buffer);
  }
  lines = (lines || []).filter((x) => x && (x.name || x.invoice_name || x.item_name));
  const parsed_json = lines;
  await db.query(
    `UPDATE doc_registry SET parsed_json=$2::jsonb, updated_at=NOW() WHERE id=$1`,
    [doc.id, JSON.stringify(parsed_json)]
  );
  let catalog = { products_touched: 0, price_records: 0 };
  if (lines.length) {
    catalog = await enrichCatalogFromLines(db, {
      lines,
      supplierName: supplierHint || doc.counterparty_name,
      supplierId: doc.supplier_id,
      userId: opts.userId,
      source: 'quote'
    });
    const reasons = (Array.isArray(doc.incomplete_reasons) ? doc.incomplete_reasons : [])
      .filter((x) => x !== 'catalog_parse_pending');
    await db.query(
      `UPDATE doc_registry SET incomplete_reasons=$2::text[],
         is_incomplete=$3, updated_at=NOW() WHERE id=$1`,
      [doc.id, reasons, reasons.length > 0]
    );
  }
  return { lines, catalog };
}

function maybeScheduleParse(fastify, db, doc, userId) {
  if (!doc || doc.dir !== 'in') return;
  const lines = linesOf(doc);
  if (lines.length) {
    fireCatalog(fastify, db, doc, userId);
    return;
  }
  const atts = attachmentsOf(doc);
  if (!atts.length) return;
  Promise.resolve()
    .then(async () => {
      // 1) Excel-вложение → parse lines
      // 2) .txt / .json со строками (тест/ручной скан без OCR)
      // 3) иначе PDF/фото → catalog_parse_pending (не блокируем документ)
      let buffer = null;
      let text = null;
      let items = null;
      for (const a of atts) {
        const url = typeof a === 'string' ? a : (a && (a.url || a.path));
        if (!url) continue;
        const lower = String(url).toLowerCase();
        try {
          const { uploadFsPath } = require('../utils/upload-url');
          const fsPath = uploadFsPath(url);
          if (/\.(xlsx|xls)$/.test(lower)) {
            buffer = await fsp.readFile(fsPath);
            break;
          }
          if (/\.(txt|json|csv)$/.test(lower)) {
            text = await fsp.readFile(fsPath, 'utf8');
            try {
              const j = JSON.parse(text);
              if (Array.isArray(j)) items = j;
              else if (j && Array.isArray(j.items)) items = j.items;
            } catch (_) { /* plain text → AI path below */ }
            break;
          }
        } catch (_) { /* skip */ }
      }
      if (buffer || items || (text && String(text).trim())) {
        await runParseCatalog(db, doc, { buffer, items, text: items ? null : text, userId });
        return;
      }
      await markCatalogPending(db, doc.id, doc);
    })
    .catch(async (e) => {
      fastify.log.warn('[doc-registry] parse schedule: ' + (e && e.message));
      try { await markCatalogPending(db, doc.id, doc); } catch (_) { /* ignore */ }
    });
}

async function audit(db, docId, userId, action, payload) {
  await db.query(
    `INSERT INTO doc_registry_audit(doc_id,user_id,action,payload) VALUES($1,$2,$3,$4::jsonb)`,
    [docId, userId || null, action, JSON.stringify(payload || {})]
  );
}

async function findDup(db, row) {
  if (!row.invoice_number || !row.invoice_date) return null;
  const params = [
    String(row.counterparty_name || '').trim().toLowerCase(),
    String(row.invoice_number || '').trim().toLowerCase(),
    row.invoice_date, num(row.amount_gross), row.dir || 'in'
  ];
  let sql = `SELECT id FROM doc_registry WHERE deleted_at IS NULL
    AND lower(trim(counterparty_name))=$1 AND lower(trim(COALESCE(invoice_number,'')))=$2
    AND invoice_date=$3::date AND amount_gross=$4 AND dir=$5`;
  if (row.excludeId) { params.push(row.excludeId); sql += ` AND id<>$${params.length}`; }
  const { rows } = await db.query(sql + ' LIMIT 1', params);
  return rows[0] || null;
}

function bindVal(k, v) {
  if (JSON_COLS.has(k)) return typeof v === 'string' ? v : JSON.stringify(v == null ? (k === 'closing_json' ? [] : {}) : v);
  if (k === 'incomplete_reasons') return Array.isArray(v) ? v : [];
  return v;
}

function cast(k, i) {
  if (JSON_COLS.has(k)) return `$${i}::jsonb`;
  if (k === 'incomplete_reasons') return `$${i}::text[]`;
  return `$${i}`;
}

function buildFilters(q, userId) {
  const params = [];
  let where = ' WHERE d.deleted_at IS NULL';
  if ((q.scope || 'mine').toLowerCase() !== 'all') {
    params.push(userId);
    where += ` AND (d.doc_owner_id=$${params.length} OR d.pm_id=$${params.length})`;
  }
  const eq = (col, val) => { params.push(val); where += ` AND ${col}=$${params.length}`; };
  if (q.dir) eq('d.dir', q.dir);
  if (q.ops_status) {
    const raw = String(q.ops_status);
    if (raw.includes(',')) {
      params.push(raw);
      where += ` AND d.ops_status = ANY(string_to_array($${params.length}, ','))`;
    } else eq('d.ops_status', raw);
  }
  if (q.wh_status) {
    const raw = String(q.wh_status);
    if (raw.includes(',')) {
      params.push(raw);
      where += ` AND d.wh_status = ANY(string_to_array($${params.length}, ','))`;
    } else eq('d.wh_status', raw);
  }
  if (q.work_id) eq('d.work_id', parseInt(q.work_id, 10));
  if (q.counterparty) { params.push(`%${q.counterparty}%`); where += ` AND d.counterparty_name ILIKE $${params.length}`; }
  if (q.q) {
    params.push(`%${q.q}%`);
    const i = params.length;
    where += ` AND (d.counterparty_name ILIKE $${i} OR d.invoice_number ILIKE $${i} OR COALESCE(d.comment_text,'') ILIKE $${i} OR COALESCE(w.work_title,w.object_name,'') ILIKE $${i})`;
  }
  const t = today();
  const payOver = `d.payment_due_at IS NOT NULL AND d.payment_due_at::date < '${t}'::date AND COALESCE(d.pay_status,'none') NOT IN ('paid','n_a')`;
  const sfOver = `d.sf_due_at IS NOT NULL AND d.sf_due_at::date < '${t}'::date AND d.ops_status IN ('wait_sf','wait_closing')`;
  if (q.overdue_pay === '1' || q.overdue_pay === 'true') where += ` AND ${payOver}`;
  if (q.overdue_sf === '1' || q.overdue_sf === 'true') where += ` AND ${sfOver}`;
  if (q.incomplete === '1' || q.incomplete === 'true') where += ' AND d.is_incomplete';
  if (q.no_onec === '1' || q.no_onec === 'true') where += ` AND (d.onec_id IS NULL OR trim(d.onec_id)='')`;
  const kpi = (q.kpi || '').toLowerCase();
  if (kpi === 'pay') where += ` AND ${payOver}`;
  else if (kpi === 'sf') where += ` AND (d.ops_status IN ('wait_sf','wait_closing') OR (${sfOver}))`;
  else if (kpi === 'wh') where += ` AND d.wh_status IN ('await','received','to_office')`;
  else if (kpi === 'out') where += ` AND d.dir='out'`;
  else if (kpi === '1c' || kpi === 'no_1c') where += ` AND (d.onec_id IS NULL OR trim(d.onec_id)='')`;
  else if (kpi === 'incomplete') where += ' AND d.is_incomplete';
  return { where, params };
}

module.exports = async function docRegistryRoutes(fastify) {
  const db = fastify.db || fastify.pg;
  const auth = { preHandler: [fastify.requireRoles(ALLOWED)] };

  fastify.get('/', auth, async (req) => {
    const q = req.query || {};
    const { where, params } = buildFilters(q, req.user.id);
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const [cnt, list] = await Promise.all([
      db.query(`SELECT COUNT(*)::int n FROM doc_registry d LEFT JOIN works w ON w.id=d.work_id${where}`, params),
      db.query(`${JOIN_SQL}${where} ORDER BY d.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit])
    ]);
    return { items: list.rows.map(decorate), total: cnt.rows[0].n, page, limit };
  });

  fastify.get('/kpi', auth, async (req) => {
    const q = { ...(req.query || {}) };
    delete q.kpi; delete q.overdue_pay; delete q.overdue_sf; delete q.incomplete; delete q.no_onec; delete q.wh_status; delete q.dir;
    const { where, params } = buildFilters(q, req.user.id);
    const t = today();
    params.push(t);
    const ti = `$${params.length}`;
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS "all",
        COUNT(*) FILTER (WHERE d.payment_due_at IS NOT NULL AND d.payment_due_at::date < ${ti}::date
          AND COALESCE(d.pay_status,'none') NOT IN ('paid','n_a'))::int AS pay,
        COUNT(*) FILTER (WHERE d.ops_status IN ('wait_sf','wait_closing')
          OR (d.sf_due_at IS NOT NULL AND d.sf_due_at::date < ${ti}::date
              AND d.ops_status IN ('wait_sf','wait_closing')))::int AS sf,
        COUNT(*) FILTER (WHERE d.wh_status IN ('await','received','to_office'))::int AS wh,
        COUNT(*) FILTER (WHERE d.dir='out')::int AS out,
        COUNT(*) FILTER (WHERE d.onec_id IS NULL OR trim(d.onec_id)='')::int AS no_1c,
        COUNT(*) FILTER (WHERE d.is_incomplete)::int AS incomplete
       FROM doc_registry d LEFT JOIN works w ON w.id=d.work_id${where}`,
      params
    );
    return rows[0] || { all: 0, pay: 0, sf: 0, wh: 0, out: 0, no_1c: 0, incomplete: 0 };
  });

  fastify.get('/facets', auth, async (req) => {
    const scope = ((req.query || {}).scope || 'mine').toLowerCase();
    const params = [];
    let scopeSql = ' WHERE d.deleted_at IS NULL';
    if (scope !== 'all') {
      params.push(req.user.id);
      scopeSql += ` AND (d.doc_owner_id=$${params.length} OR d.pm_id=$${params.length})`;
    }
    try {
      const [cp, ops, owners, pms, works] = await Promise.all([
        db.query(
          `SELECT DISTINCT TRIM(d.counterparty_name) AS name FROM doc_registry d ${scopeSql}
           AND TRIM(COALESCE(d.counterparty_name,''))<>'' ORDER BY 1 LIMIT 500`, params
        ),
        db.query(
          `SELECT DISTINCT d.ops_status FROM doc_registry d ${scopeSql} AND d.ops_status IS NOT NULL ORDER BY 1`, params
        ),
        db.query(
          `SELECT DISTINCT u.id, u.name FROM doc_registry d
           INNER JOIN users u ON u.id=d.doc_owner_id ${scopeSql} ORDER BY u.name NULLS LAST LIMIT 300`, params
        ),
        db.query(
          `SELECT DISTINCT u.id, u.name FROM doc_registry d
           INNER JOIN users u ON u.id=d.pm_id ${scopeSql} ORDER BY u.name NULLS LAST LIMIT 300`, params
        ),
        db.query(
          `SELECT DISTINCT w.id, COALESCE(w.work_title, w.object_name) AS title
           FROM doc_registry d INNER JOIN works w ON w.id=d.work_id ${scopeSql}
           ORDER BY 2 NULLS LAST LIMIT 500`, params
        )
      ]);
      return {
        counterparties: cp.rows.map((r) => r.name).filter(Boolean),
        ops_status: ops.rows.map((r) => r.ops_status).filter(Boolean),
        doc_owners: owners.rows,
        pms: pms.rows,
        works: works.rows
      };
    } catch (e) {
      fastify.log.warn('[doc-registry] facets: ' + (e && e.message));
      return { counterparties: [], ops_status: [], doc_owners: [], pms: [], works: [] };
    }
  });

  fastify.post('/check-duplicate', auth, async (req) => {
    const hit = await findDup(db, req.body || {});
    return hit ? { duplicate: true, id: hit.id } : { duplicate: false };
  });

  fastify.post('/export-1c', auth, async (req, reply) => {
    const ids = Array.isArray((req.body || {}).ids)
      ? req.body.ids.map((x) => parseInt(x, 10)).filter((n) => !isNaN(n)) : [];
    const params = [];
    let sql = `SELECT id,dir,invoice_number,invoice_date,counterparty_name,amount_gross,amount_net,vat_amount,work_id,onec_id,ops_status
               FROM doc_registry WHERE deleted_at IS NULL`;
    if (ids.length) { params.push(ids); sql += ` AND id=ANY($1::int[])`; }
    else sql += ` AND (onec_id IS NULL OR trim(onec_id)='')`;
    const { rows } = await db.query(sql + ' ORDER BY id', params);
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = 'id;dir;invoice_number;invoice_date;counterparty_name;amount_gross;amount_net;vat_amount;work_id;onec_id;ops_status';
    const body = rows.map((r) =>
      [r.id, r.dir, r.invoice_number, r.invoice_date, r.counterparty_name, r.amount_gross, r.amount_net, r.vat_amount, r.work_id, r.onec_id, r.ops_status].map(esc).join(';')
    );
    const csv = [head, ...body].join('\n');
    reply.header('Content-Type', 'application/json; charset=utf-8');
    return { csv, count: rows.length };
  });

  fastify.post('/import-1c', auth, async (req) => {
    let rowsIn = (req.body && req.body.rows) || (Array.isArray(req.body) ? req.body : null);
    if (!rowsIn && typeof req.isMultipart === 'function' && req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const text = (await part.toBuffer()).toString('utf8');
          try { rowsIn = JSON.parse(text); }
          catch (_) {
            rowsIn = text.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
              const c = line.split(';').map((s) => s.replace(/^"|"$/g, ''));
              return { id: c[0], invoice_number: c[2], counterparty_name: c[4], onec_id: c[9] || c[1] };
            });
          }
        } else if (part.fieldname === 'rows') {
          try { rowsIn = JSON.parse(part.value); } catch (_) { /* ignore */ }
        }
      }
    }
    if (!Array.isArray(rowsIn) || !rowsIn.length) return { matched: 0, unmatched: 0, items: [], error: 'Нет строк' };
    const items = [];
    let matched = 0; let unmatched = 0;
    for (const row of rowsIn) {
      const onecId = row.onec_id != null ? String(row.onec_id).trim() : '';
      if (!onecId) { unmatched++; items.push({ status: 'no_onec_id' }); continue; }
      let docId = row.id ? parseInt(row.id, 10) : NaN;
      if (isNaN(docId)) {
        const hit = await findDup(db, row);
        docId = hit ? hit.id : null;
      }
      if (!docId) { unmatched++; items.push({ onec_id: onecId, status: 'unmatched' }); continue; }
      await db.query(
        `UPDATE doc_registry SET onec_id=$2, onec_synced_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL`,
        [docId, onecId]
      );
      matched++; items.push({ id: docId, onec_id: onecId, status: 'matched' });
    }
    return { matched, unmatched, items };
  });

  fastify.post('/excel/dry-run', auth, async (req, reply) => {
    const rows = (req.body && req.body.rows) || [];
    if (!Array.isArray(rows)) return reply.code(400).send({ error: 'rows[]' });
    return excelSvc.dryRun(db, rows);
  });

  fastify.post('/excel/apply', auth, async (req, reply) => {
    const rows = (req.body && req.body.rows) || [];
    if (!Array.isArray(rows)) return reply.code(400).send({ error: 'rows[]' });
    return excelSvc.apply(db, rows, req.user.id);
  });

  fastify.post('/', auth, async (req, reply) => {
    const b = req.body || {};
    if (!b.dir || !['in', 'out'].includes(b.dir)) return reply.code(400).send({ error: 'dir: in|out' });
    const draft = {
      ...pickBody(b), ...computeAmounts(b),
      dir: b.dir,
      package_type: b.package_type || 'invoice',
      ops_status: b.ops_status || 'draft',
      counterparty_name: b.counterparty_name || '',
      contract_mode: b.contract_mode || 'none',
      wh_status: b.wh_status || 'none',
      pay_status: b.pay_status || 'none',
      doc_owner_id: b.doc_owner_id != null ? b.doc_owner_id : req.user.id,
      created_by: req.user.id,
      updated_by: req.user.id
    };
    Object.assign(draft, calcIncomplete(draft));
    const dup = await findDup(db, draft);
    if (dup) return reply.code(409).send({ error: 'Дубликат', existing_id: dup.id });

    const cols = [...Object.keys(draft).filter((k) => WRITE_COLS.includes(k) || k === 'created_by' || k === 'updated_by')];
    const vals = cols.map((k) => bindVal(k, draft[k]));
    try {
      const { rows } = await db.query(
        `INSERT INTO doc_registry(${cols.join(',')}) VALUES(${cols.map((k, i) => cast(k, i + 1)).join(',')}) RETURNING *`,
        vals
      );
      await audit(db, rows[0].id, req.user.id, 'create', { id: rows[0].id });
      maybeScheduleParse(fastify, db, rows[0], req.user.id);
      return decorate(rows[0]);
    } catch (e) {
      if (e.code === '23505') {
        const again = await findDup(db, draft);
        return reply.code(409).send({ error: 'Дубликат', existing_id: again ? again.id : null });
      }
      throw e;
    }
  });

  fastify.get('/:id', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows } = await db.query(`${JOIN_SQL} WHERE d.id=$1 AND d.deleted_at IS NULL`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return decorate(rows[0]);
  });

  fastify.put('/:id', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const cur = await db.query('SELECT * FROM doc_registry WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const b = req.body || {};
    const merged = { ...cur.rows[0], ...pickBody(b) };
    if (['amount_gross', 'has_vat', 'vat_rate', 'amount_net', 'vat_amount'].some((k) => b[k] !== undefined)) {
      Object.assign(merged, computeAmounts({ ...cur.rows[0], ...b }));
    }
    Object.assign(merged, calcIncomplete(merged));
    const dup = await findDup(db, { ...merged, excludeId: id });
    if (dup) return reply.code(409).send({ error: 'Дубликат', existing_id: dup.id });

    const patch = { ...pickBody(b), ...computeAmounts({ ...cur.rows[0], ...b }), ...calcIncomplete(merged), updated_by: req.user.id };
    const keys = Object.keys(patch);
    if (!keys.length) return decorate(cur.rows[0]);
    const vals = keys.map((k) => bindVal(k, patch[k]));
    vals.push(id);
    try {
      const { rows } = await db.query(
        `UPDATE doc_registry SET ${keys.map((k, i) => `${k}=${cast(k, i + 1)}`).join(',')}, updated_at=NOW()
         WHERE id=$${vals.length} AND deleted_at IS NULL RETURNING *`,
        vals
      );
      await audit(db, id, req.user.id, 'update', { keys });
      maybeScheduleParse(fastify, db, rows[0], req.user.id);
      return decorate(rows[0]);
    } catch (e) {
      if (e.code === '23505') {
        const again = await findDup(db, { ...merged, excludeId: id });
        return reply.code(409).send({ error: 'Дубликат', existing_id: again ? again.id : null });
      }
      throw e;
    }
  });

  fastify.delete('/:id', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows } = await db.query(
      `UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW(), updated_by=$2
       WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
      [id, req.user.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    await audit(db, id, req.user.id, 'delete', {});
    return { ok: true, id };
  });

  fastify.post('/:id/upload', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows: found } = await db.query('SELECT * FROM doc_registry WHERE id=$1 AND deleted_at IS NULL', [id]);
    const doc = found[0];
    if (!doc) return reply.code(404).send({ error: 'Не найдено' });

    let filePart = null;
    let metaName = null;
    if (typeof req.isMultipart === 'function' && req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file' && !filePart) {
          filePart = { buffer: await part.toBuffer(), filename: part.filename, mimetype: part.mimetype };
        } else if (part.fieldname === 'name') metaName = part.value;
      }
    } else if (req.file) {
      const data = await req.file();
      if (data) filePart = { buffer: await data.toBuffer(), filename: data.filename, mimetype: data.mimetype };
    }
    if (!filePart || !filePart.buffer) return reply.code(400).send({ error: 'Файл не загружен' });

    const dir = path.join(process.env.UPLOAD_DIR || './uploads', 'doc-hub');
    await fsp.mkdir(dir, { recursive: true });
    const safe = String(filePart.filename || 'file.bin').replace(/[^\w.\-а-яА-ЯёЁ]+/gi, '_');
    const fname = `doc_${id}_${randomUUID()}_${safe}`;
    await fsp.writeFile(path.join(dir, fname), filePart.buffer);
    const url = normPath(`uploads/doc-hub/${fname}`);
    const att = {
      url,
      name: metaName || filePart.filename || fname,
      mimetype: filePart.mimetype || null,
      uploaded_at: new Date().toISOString(),
      by: req.user.id
    };
    const prev = attachmentsOf(doc);
    prev.push(att);
    const { rows } = await db.query(
      `UPDATE doc_registry SET attachments=$2::jsonb,
         original_path_url=COALESCE(original_path_url,$3),
         updated_by=$4, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, JSON.stringify(prev), url, req.user.id]
    );
    await audit(db, id, req.user.id, 'upload', { url });
    if (rows[0].dir === 'in') maybeScheduleParse(fastify, db, rows[0], req.user.id);
    return decorate(rows[0]);
  });

  fastify.post('/:id/parse-catalog', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows: found } = await db.query('SELECT * FROM doc_registry WHERE id=$1 AND deleted_at IS NULL', [id]);
    const doc = found[0];
    if (!doc) return reply.code(404).send({ error: 'Не найдено' });
    if (doc.dir !== 'in') return reply.code(400).send({ error: 'parse-catalog только для dir=in' });

    let items = null;
    let text = null;
    let buffer = null;
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart') && typeof req.isMultipart === 'function' && req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          buffer = await part.toBuffer();
        } else if (part.fieldname === 'text') text = part.value;
        else if (part.fieldname === 'items') {
          try { items = JSON.parse(part.value); } catch (_) { /* ignore */ }
        }
      }
    } else {
      const b = req.body || {};
      items = Array.isArray(b.items) ? b.items : null;
      text = b.text || null;
    }

    if (!items && !text && !buffer) {
      await markCatalogPending(db, id, doc);
      return { lines: [], catalog: null, pending: true, reason: 'catalog_parse_pending' };
    }

    try {
      const result = await runParseCatalog(db, doc, { items, text, buffer, userId: req.user.id });
      await audit(db, id, req.user.id, 'parse_catalog', { lines: result.lines.length });
      if (!result.lines.length) await markCatalogPending(db, id, doc);
      return result;
    } catch (e) {
      await markCatalogPending(db, id, doc);
      return reply.code(502).send({ error: e.message || 'parse failed', pending: true });
    }
  });

  fastify.post('/:id/quick', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    if (isNaN(id) || !b.action) return reply.code(400).send({ error: 'id + action' });
    const { rows: found } = await db.query('SELECT * FROM doc_registry WHERE id=$1 AND deleted_at IS NULL', [id]);
    const doc = found[0];
    if (!doc) return reply.code(404).send({ error: 'Не найдено' });

    if (b.action === 'pay') {
      const redirect = doc.payment_invoice_id
        ? `#/approval-payment?id=${doc.payment_invoice_id}` : '#/approval-payment';
      await audit(db, id, req.user.id, 'quick_pay', { redirect });
      return { redirect, payment_invoice_id: doc.payment_invoice_id || null };
    }

    if (b.action === 'sf') {
      let closing = doc.closing_json;
      if (typeof closing === 'string') try { closing = JSON.parse(closing); } catch (_) { closing = []; }
      if (!Array.isArray(closing)) closing = closing ? [closing] : [];
      closing.push({
        kind: b.kind || 'sf', no: b.number || b.no || null, date: b.date || today(),
        sum: b.sum != null ? num(b.sum) : num(doc.amount_gross), by: req.user.id, at: new Date().toISOString()
      });
      const ops = ['wait_sf', 'wait_closing'].includes(doc.ops_status) ? 'done' : doc.ops_status;
      const { rows } = await db.query(
        `UPDATE doc_registry SET closing_json=$2::jsonb, ops_status=$3, sf_due_at=NULL, updated_by=$4, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, JSON.stringify(closing), ops, req.user.id]
      );
      await audit(db, id, req.user.id, 'quick_sf', { ops });
      if (b.lines) fireCatalog(fastify, db, { ...rows[0], parsed_json: b.lines }, req.user.id);
      if (rows[0].work_expense_id) {
        try {
          await db.query(
            `UPDATE work_expenses SET invoice_received=true, invoice_needed=COALESCE(invoice_needed,true) WHERE id=$1`,
            [rows[0].work_expense_id]
          );
        } catch (e) {
          fastify.log.warn('[doc-registry] buh sync work_expense: ' + (e && e.message));
        }
      }
      return decorate(rows[0]);
    }

    if (b.action === 'due') {
      const sets = []; const vals = [];
      for (const f of ['delivery_due_at', 'payment_due_at', 'sf_due_at']) {
        if (b[f] !== undefined) { vals.push(b[f] || null); sets.push(`${f}=$${vals.length}`); }
      }
      if (!sets.length) return reply.code(400).send({ error: 'Укажите delivery_due_at / payment_due_at / sf_due_at' });
      vals.push(req.user.id, id);
      const { rows } = await db.query(
        `UPDATE doc_registry SET ${sets.join(',')}, updated_by=$${vals.length - 1}, updated_at=NOW()
         WHERE id=$${vals.length} RETURNING *`, vals
      );
      const inc = calcIncomplete(rows[0]);
      await db.query(`UPDATE doc_registry SET is_incomplete=$2, incomplete_reasons=$3::text[] WHERE id=$1`,
        [id, inc.is_incomplete, inc.incomplete_reasons]);
      await audit(db, id, req.user.id, 'quick_due', b);
      return decorate({ ...rows[0], ...inc });
    }

    if (b.action === 'wh') {
      if (!WH_ROLES.has(req.user.role)) return reply.code(403).send({ error: 'Только склад / бух / admin' });
      const curWh = doc.wh_status || 'none';
      const idx = WH_CHAIN.indexOf(curWh);
      const next = b.wh_status || WH_CHAIN[Math.min(idx + 1, WH_CHAIN.length - 1)];
      if (!WH_CHAIN.includes(next)) return reply.code(400).send({ error: 'Неверный wh_status' });
      if (b.wh_status) {
        const wantIdx = WH_CHAIN.indexOf(b.wh_status);
        if (wantIdx !== idx + 1 && b.wh_status !== curWh) {
          return reply.code(409).send({ error: `Ожидается: ${WH_CHAIN[Math.min(idx + 1, WH_CHAIN.length - 1)]}`, current: curWh });
        }
      } else if (curWh === 'buh_ok') {
        return reply.code(409).send({ error: 'Цепочка уже завершена', current: curWh });
      }
      const { rows } = await db.query(
        `UPDATE doc_registry SET wh_status=$2, updated_by=$3, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [id, next, req.user.id]
      );
      await audit(db, id, req.user.id, 'quick_wh', { from: curWh, to: next });
      return decorate(rows[0]);
    }

    return reply.code(400).send({ error: 'action: sf|due|wh|pay' });
  });

  fastify.post('/:id/link-expense', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows: found } = await db.query('SELECT * FROM doc_registry WHERE id=$1 AND deleted_at IS NULL', [id]);
    const doc = found[0];
    if (!doc) return reply.code(404).send({ error: 'Не найдено' });
    if (doc.work_expense_id) {
      const ex = await db.query('SELECT * FROM work_expenses WHERE id=$1', [doc.work_expense_id]);
      return { work_expense_id: doc.work_expense_id, expense: ex.rows[0] || null, existing: true };
    }
    const b = req.body || {};
    if (b.work_expense_id) {
      await db.query(`UPDATE doc_registry SET work_expense_id=$2, updated_by=$3, updated_at=NOW() WHERE id=$1`,
        [id, b.work_expense_id, req.user.id]);
      await audit(db, id, req.user.id, 'link_expense', { work_expense_id: b.work_expense_id });
      return { work_expense_id: b.work_expense_id, existing: false, linked: true };
    }
    if (!doc.work_id) return reply.code(400).send({ error: 'Нужен work_id' });
    const { insertWorkExpense } = require('../services/work-expense-writer');
    const expense = await insertWorkExpense(db, {
      work_id: doc.work_id,
      category: b.category || 'materials',
      subcategory: b.subcategory || 'other',
      amount: num(doc.amount_gross) || num(b.amount),
      date: doc.invoice_date || today(),
      description: b.description || `Doc Hub #${doc.id} ${doc.invoice_number || ''}`.trim(),
      supplier: doc.counterparty_name || null,
      doc_number: doc.invoice_number || null,
      vat_rate: doc.has_vat ? num(doc.vat_rate) : 0,
      vat_amount: num(doc.vat_amount),
      amount_ex_vat: num(doc.amount_net),
      payment_method: b.payment_method || 'bank',
      source_table: 'doc_registry',
      source_id: doc.id,
      source_key: `doc_registry:${doc.id}`,
      status: 'pending',
      created_by: req.user.id
    });
    await db.query(`UPDATE doc_registry SET work_expense_id=$2, updated_by=$3, updated_at=NOW() WHERE id=$1`,
      [id, expense.id, req.user.id]);
    await audit(db, id, req.user.id, 'create_expense', { work_expense_id: expense.id });
    return { work_expense_id: expense.id, expense, existing: false };
  });
};
