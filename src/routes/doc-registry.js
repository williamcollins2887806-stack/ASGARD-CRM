'use strict';

/**
 * Doc Hub API — doc_registry (+ audit). Не путать с payment_invoices.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { randomUUID } = require('crypto');
const { enrichCatalogFromLines } = require('../services/catalog-from-invoice');
const excelSvc = require('../services/doc-registry-excel');
const ExcelJS = require('exceljs');
const { visibilitySql, assertDocVisible, canUseScopeAll } = require('../lib/doc-visibility');
const traffic = require('../lib/doc-traffic');
const { isTrafficLightEnabled } = require('../lib/feature-flags');
const reconSvc = require('../services/doc-reconciliation');

let normalizeUploadUrl = (p) => p;
try { ({ normalizeUploadUrl } = require('../utils/upload-url')); } catch (_) { /* optional */ }

const ALLOWED = [
  'ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR',
  'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'PROC', 'WAREHOUSE', 'OFFICE_MANAGER'
];
const WH_ROLES = new Set(['WAREHOUSE', 'ADMIN', 'BUH']);
const WH_CHAIN = ['none', 'await', 'received', 'to_office', 'buh_ok'];
const JSON_COLS = new Set(['attachments', 'parsed_json', 'closing_json', 'onec_payload', 'payment_schedule']);
const WRITE_COLS = [
  'dir', 'package_type', 'ops_status', 'invoice_number', 'invoice_date',
  'counterparty_name', 'counterparty_email', 'counterparty_phone',
  'supplier_id', 'customer_id', 'work_id', 'contract_id', 'contract_mode', 'contract_label',
  'contract_date', 'contract_has_scan', 'contract_has_original',
  'amount_gross', 'amount_net', 'vat_amount', 'vat_rate', 'has_vat',
  'payment_due_at', 'sf_due_at', 'delivery_due_at', 'delivery_note', 'pay_status',
  'closing_json', 'receive_channel', 'reconciliation_note', 'vitya_state', 'spend_kind',
  'purpose_customer', 'purpose_asgard', 'purpose_consumables', 'comment_text',
  'wh_status', 'procurement_id', 'payment_invoice_id', 'office_expense_id',
  'work_expense_id', 'billing_invoice_id', 'billing_act_id',
  'attachments', 'original_path_url', 'parsed_json',
  'is_incomplete', 'incomplete_reasons', 'onec_id', 'onec_synced_at', 'onec_payload',
  'edo_status', 'edo_external_id', 'doc_owner_id', 'pm_id',
  // V394: условия оплаты/СФ/акты (correction_* — только через action, не здесь).
  'payment_kind', 'payment_schedule', 'sf_basis', 'service_done_at', 'no_payment_terms',
  'sf_requested_at', 'sf_received_at', 'recon_requested_at', 'recon_received_at', 'recon_due_at',
  'currency', 'amount_currency',
  // D-306: свободная подпись «чьими руками внесено» внутри общего аккаунта.
  'doc_owner_note'
];

// D-306c: автор подписи НЕ принимается из тела запроса — только из сессии.
// Иначе клиент мог бы подписаться чужим именем и увидеть чужие подсказки.
const OWNER_NOTE_AUTHOR_COL = 'doc_owner_note_by';

const JOIN_SQL = `SELECT d.*,
  COALESCE(w.work_title, w.object_name) AS work_title,
  w.work_number AS work_number,
  uo.name AS doc_owner_name, up.name AS pm_name,
  -- D-362 (заказчик 23.10.2026): «реестр не видит, что счёт уже в оплате или у
  -- директора». Реестр отдавал только payment_invoice_id — по нему нельзя было
  -- отличить «заявки нет» от «ждёт директора» от «ждёт оплаты». Теперь статус
  -- заявки едет вместе со строкой: список и карточка показывают этап, а кнопка
  -- «В очередь оплаты» не даёт создать вторую заявку.
  pi.status AS payment_invoice_status,
  pi.payment_status AS payment_invoice_pay_status,
  pi.amount AS payment_invoice_amount,
  pi.due_date AS payment_invoice_due
 FROM doc_registry d
 LEFT JOIN works w ON w.id = d.work_id
 LEFT JOIN users uo ON uo.id = d.doc_owner_id
 LEFT JOIN users up ON up.id = d.pm_id
 LEFT JOIN payment_invoices pi ON pi.id = d.payment_invoice_id AND COALESCE(pi.status,'') <> 'rejected'`;

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function today() { return new Date().toISOString().slice(0, 10); }

// V394 (план, S6): контроль «есть срок оплаты ИЛИ галочка оплачено» включается
// настройкой и применяется ТОЛЬКО к строкам, созданным не раньше указанной даты —
// иначе весь исторический архив разом станет «неполным» (синим).
const NO_PAYMENT_TERMS_ENABLED = process.env.DOC_NO_PAYMENT_TERMS === '1';
const NO_PAYMENT_TERMS_SINCE = process.env.DOC_NO_PAYMENT_TERMS_SINCE
  ? new Date(process.env.DOC_NO_PAYMENT_TERMS_SINCE)
  : new Date('2026-10-20T00:00:00Z');

/** Человекочитаемое имя строки реестра для уведомлений. */
function docLabel(row) {
  if (!row) return 'документ';
  const n = row.invoice_number ? `Счёт ${row.invoice_number}` : `Документ #${row.id}`;
  return row.counterparty_name ? `${n} · ${row.counterparty_name}` : n;
}

/**
 * Уведомить владельца/РП строки (doc_owner_id или pm_id) — не автора действия.
 * Тихая ошибка: уведомление не должно ломать основное действие.
 */
async function notifyDocOwner(db, row, title, message) {
  try {
    const target = row.doc_owner_id || row.pm_id;
    if (!target) return;
    const { createNotification } = require('../services/notify');
    await createNotification(db, {
      user_id: target, title, message: message || '', type: 'doc_registry',
      link: `#/doc-hub?doc_id=${row.id}`
    });
  } catch (e) { /* уведомление не критично */ }
}

function normalizeVatRate(raw, hasVat) {
  if (!hasVat) return 0;
  if (raw == null || raw === '') return 0.22;
  let rate = num(raw);
  if (rate > 1) rate = rate / 100;
  if (rate < 0) rate = 0;
  const allowed = [0, 0.05, 0.1, 0.2, 0.22];
  const hit = allowed.find((a) => Math.abs(a - rate) < 0.0001);
  return hit != null ? hit : 0.22;
}

function computeAmounts(b = {}) {
  const hasVat = !(b.has_vat === false || b.has_vat === 'false' || b.has_vat === 0 || b.has_vat === '0');
  const rate = normalizeVatRate(b.vat_rate, hasVat);
  const gross = num(b.amount_gross);
  if (!hasVat) {
    return { amount_gross: gross, amount_net: gross, vat_amount: 0, vat_rate: 0, has_vat: false };
  }
  if (b.amount_net != null && b.amount_net !== '' && Number.isFinite(parseFloat(b.amount_net))) {
    const net = num(b.amount_net);
    const vat = (b.vat_amount != null && b.vat_amount !== '')
      ? num(b.vat_amount)
      : Math.max(0, +(gross - net).toFixed(2));
    return { amount_gross: gross, amount_net: net, vat_amount: vat, vat_rate: rate, has_vat: true };
  }
  if (rate === 0) {
    return { amount_gross: gross, amount_net: gross, vat_amount: 0, vat_rate: 0, has_vat: true };
  }
  const net = +(gross / (1 + rate)).toFixed(2);
  return { amount_gross: gross, amount_net: net, vat_amount: +(gross - net).toFixed(2), vat_rate: rate, has_vat: true };
}

function calcIncomplete(row) {
  const r = [];
  if (!(row.invoice_number || '').toString().trim()) r.push('no_invoice_number');
  // D-350 (23.10.2026): сумма 0 — это НЕ «полная карточка».
  // На проде документ #1608 («Учебный комбинат Магистр») имел amount_gross=0,
  // is_incomplete=false и пустые причины: ИИ не нашёл сумму, а валидация
  // промолчала. Такой счёт нельзя ни оплатить, ни сверить — он обязан быть
  // помечен, иначе молча уйдёт в работу.
  if (!(Number(row.amount_gross) > 0)) r.push('no_amount');
  if (!row.invoice_date) r.push('no_invoice_date');
  if (!(row.counterparty_name || '').toString().trim()) r.push('no_counterparty');
  const mode = row.contract_mode || 'none';
  // once/general/none не дают no_contract; только linked без contract_id
  if (mode === 'linked' && !row.contract_id) r.push('no_contract');
  // no_payment_due убран (D-238): срок оплаты в Excel почти не заполнен,
  // из-за этого 100% реестра горело «неполным».
  // V394 (план, S6): новая причина no_payment_terms — но ТОЛЬКО для строк,
  // созданных после включения контроля (иначе массовое посинение архива).
  if (NO_PAYMENT_TERMS_ENABLED && !row.no_payment_terms && !row.payment_due_at
      && String(row.payment_kind || '') !== 'partial'
      && row.created_at && new Date(row.created_at) >= NO_PAYMENT_TERMS_SINCE) {
    r.push('no_payment_terms');
  }
  const sk = row.spend_kind || 'work';
  const needsWork = sk === 'work';
  if (row.dir === 'in' && needsWork && !row.work_id && !row.purpose_asgard && !row.purpose_consumables) {
    r.push('no_work');
  }
  // D-333 (заказчик 21.10.2026): «если стоит расход на проект, но не заполнен сам
  // проект — просим дозаполнить, чтобы расходы не пропустились и точно упали в проект».
  //
  // Проблема реальная: `autoWorkExpense` при пустом work_id МОЛЧА возвращал null —
  // счёт оплачивался, расход в проект не попадал и нигде не подсвечивался.
  //
  // НО подсвечивать надо ТОЛЬКО платежи, а не весь архив: на проде 203 строки без
  // объекта, из них 196 — исторический импорт БЕЗ заявки на оплату (расхода по ним
  // не будет в принципе). Их синение — ложный шум (класс D-238).
  // Условие: есть привязанная заявка (значит счёт реально идёт в оплату) и
  // расход по объекту ожидается.
  if (row.dir === 'in' && !row.work_id && row.payment_invoice_id) {
    const exempt = row.purpose_asgard || row.purpose_consumables
      || String(row.spend_kind || '') === 'office';
    if (!exempt && !r.includes('no_work')) r.push('no_work_for_expense');
  }
  return { is_incomplete: r.length > 0, incomplete_reasons: r };
}

/**
 * P0 (верификатор 17.10.2026): файлы актов сверки — конфиденциальные (суммы,
 * печати, реквизиты). Раньше они лежали в `uploads/doc-hub/`, а весь `uploads/`
 * раздаётся статикой БЕЗ авторизации → файл акта выкачивался анонимом по
 * предсказуемому URL, ACL-прокси обходился.
 * Здесь — приватный подкаталог, который статика не отдаёт вовсе (см. onRequest
 * барьер в src/index.js); доступ только через ACL-роут.
 */
const PRIVATE_UPLOAD_SUBDIR = 'private';
const RECON_SUBDIR = 'recon';
function reconPrivateDir() {
  return path.join(process.env.UPLOAD_DIR || './uploads', PRIVATE_UPLOAD_SUBDIR, RECON_SUBDIR);
}

function normPath(p) { return normalizeUploadUrl(p) || p; }

/**
 * P0 (верификатор 17.10.2026): безопасный путь к файлу внутри uploads.
 * Класс дефекта — path traversal: `file_url = 'uploads/../.env'` читал ЛЮБОЙ файл
 * от имени бухгалтера (JWT_SECRET, DB_PASSWORD) мимо ACL и whitelist типов.
 * Здесь жёстко:
 *   • отбрасываем ведущее `uploads/` и любой абсолютный/дисковый префикс;
 *   • запрещаем `..` и NUL;
 *   • resolve и проверка, что итог ЛЕЖИТ ВНУТРИ uploads (а не просто «начинается с»);
 *   • необязательно — ограничение подкаталогом (doc-hub).
 * @returns {string|null} абсолютный путь или null, если путь недопустим
 */
function safeUploadPath(fileUrl, opts = {}) {
  const raw = String(fileUrl || '').trim();
  if (!raw || raw.includes('\u0000')) return null;
  // Убираем схему, ведущие слэши и префикс uploads/ — путь должен быть относительным.
  let rel = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[\\/]+/, '').replace(/^uploads[\\/]/i, '');
  if (/^[a-z]:/i.test(rel)) return null;            // дисковый путь Windows (C:...)
  rel = rel.replace(/\\/g, '/');
  if (rel.split('/').some((seg) => seg === '..')) return null;  // никакого выхода наверх
  const base = path.resolve(process.env.UPLOAD_DIR || './uploads');
  const full = path.resolve(base, rel);
  // Строгая проверка границы: внутри base (а не «начинается с base»).
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  if (opts.subdir) {
    const sub = path.resolve(base, String(opts.subdir));
    if (full !== sub && !full.startsWith(sub + path.sep)) return null;
  }
  return full;
}

/**
 * S4: текстовые поля реестра приходят из писем/ИИ и видны другим (баннер, дайджест).
 * Хранится plain-text: срезаем HTML-теги и управляющие символы, ограничиваем длину.
 * Полноценный sanitize-html тут не нужен — поле не HTML, но нельзя хранить разметку.
 */
const sanitizeHtmlLib = require('sanitize-html');
function sanitizeText(v, maxLen = 4000) {
  if (v == null) return v;
  const s = String(v);
  if (!s) return s;
  // Убираем HTML-теги и оставляем чистый текст (без разметки).
  const plain = sanitizeHtmlLib(s, { allowedTags: [], allowedAttributes: {} });
  return plain.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, maxLen);
}
const TEXT_COLS = new Set([
  'counterparty_name', 'counterparty_email', 'counterparty_phone', 'comment_text',
  'contract_label', 'delivery_note', 'receive_channel', 'reconciliation_note',
  'vitya_state', 'invoice_number', 'onec_id', 'edo_status', 'edo_external_id',
  'doc_owner_note'
]);

/** Рекурсивная очистка строк внутри объектов/массивов (N3). */
function sanitizeDeep(v, depth = 0) {
  if (depth > 6) return v;
  if (typeof v === 'string') return sanitizeText(v, 2000);
  if (Array.isArray(v)) return v.map((x) => sanitizeDeep(x, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = sanitizeDeep(v[k], depth + 1);
    return o;
  }
  return v;
}

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
  // S4: санитайз текстовых полей (из писем/ИИ/ручного ввода) перед записью.
  for (const k of TEXT_COLS) {
    if (out[k] !== undefined && out[k] !== null) out[k] = sanitizeText(out[k]);
  }
  // N3: вложенные структуры (attachments/closing_json/parsed_json/onec_payload)
  // тоже несут тексты и рендерятся в UI — чистим строки рекурсивно.
  for (const k of ['attachments', 'closing_json', 'parsed_json', 'onec_payload']) {
    if (out[k] !== undefined && out[k] !== null) out[k] = sanitizeDeep(out[k]);
  }
  if (b.line_items && out.parsed_json === undefined) out.parsed_json = b.line_items;
  return out;
}

function decorate(row, viewerId) {
  if (!row) return row;
  const t = today();
  const payDue = row.payment_due_at ? String(row.payment_due_at).slice(0, 10) : null;
  const sfDue = row.sf_due_at ? String(row.sf_due_at).slice(0, 10) : null;
  // Светофор — единое ядро (src/lib/doc-traffic.js). Если трафик уже посчитан
  // SQL-выражением (d.traffic), не дублируем; иначе считаем JS-зеркалом.
  const trafficInfo = row.traffic ? { color: row.traffic } : traffic.trafficOf({ ...row, ...(payDue ? { payment_due_at: payDue } : {}), ...(sfDue ? { sf_due_at: sfDue } : {}) }, { today: t });
  const out = {
    ...row,
    original_path_url: normPath(row.original_path_url),
    overdue_pay: !!(payDue && payDue < t && traffic.payDeadlineActive(row)),
    overdue_sf: !!(sfDue && sfDue < t && !row.sf_received_at && ['wait_sf', 'wait_closing'].includes(row.ops_status)),
    traffic: trafficInfo.color,
    traffic_reason: trafficInfo.reason
  };
  // D-306c (заказчик 20.10.2026): «эти фильтры другие не должны видеть —
  // только пользователь их видит». Подпись под-ответственного приватна:
  // чужую не отдаём наружу вовсе (ни в списке, ни в карточке), иначе коллега
  // на общем аккаунте АГПЗ увидит ФИО соседа и сможет его подставить.
  // Автор подписи тоже не уходит на фронт — это рабочая привязка, не данные.
  if (viewerId != null) {
    const mine = Number(row.doc_owner_note_by) === Number(viewerId);
    if (!mine) out.doc_owner_note = null;
    out.doc_owner_note_mine = mine;
  }
  delete out.doc_owner_note_by;
  return out;
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
      lines, supplierName: doc.counterparty_name, supplierId: doc.supplier_id, userId, source: 'quote',
      docRegistryId: doc.id, invoiceDate: doc.invoice_date, invoiceNumber: doc.invoice_number
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
      source: 'quote',
      docRegistryId: doc.id, invoiceDate: doc.invoice_date, invoiceNumber: doc.invoice_number
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

async function findDup(db, row) {  if (!row.invoice_number || !row.invoice_date) return null;
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

function buildFilters(q, userId, role) {
  const params = [];
  let where = ' WHERE d.deleted_at IS NULL';
  // Единая матрица видимости (S1/S2): scope=all доступен не всем ролям,
  // принадлежность строки проверяется по роли, а не только по doc_owner/pm.
  where += visibilitySql(params, role, userId, { scope: q.scope });
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
  // Мультивыбор ответственных: doc_owner_id=1,2,3 / pm_id=1,2 (см. фильтр в UI)
  const manyIds = (col, raw) => {
    const vals = String(raw).split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    if (!vals.length) return;
    params.push(vals);
    where += ` AND ${col} = ANY($${params.length}::int[])`;
  };
  if (q.doc_owner_id) manyIds('d.doc_owner_id', q.doc_owner_id);
  if (q.pm_id) manyIds('d.pm_id', q.pm_id);
  // D-306: под-ответственный — свободная подпись внутри общего аккаунта.
  // D-306c (заказчик 20.10.2026): «эти фильтры другие не должны видеть —
  // только пользователь их видит». Поэтому фильтр идёт ТОЛЬКО по своим
  // подписям: чужие «Пираев С.» на том же аккаунте в выдачу не подмешиваются.
  // Мультивыбор тех же значений, что в подсказках (см. /owner-notes).
  // Сравнение без регистра: «Пираев С.» == «пираев с.».
  // Разделитель в query — «||», потому что в ФИО бывает запятая
  // («Иванов И., Петров П.»), и split по запятой развалил бы фильтр.
  if (q.owner_note) {
    const notes = String(q.owner_note).split('||').map((s) => s.trim()).filter(Boolean);
    if (notes.length) {
      params.push(notes.map((s) => s.toLowerCase()));
      const iP = params.length;
      params.push(userId);
      where += ` AND lower(BTRIM(COALESCE(d.doc_owner_note,''))) = ANY($${iP}::text[])`
        + ` AND d.${OWNER_NOTE_AUTHOR_COL} = $${params.length}`;
    }
  }
  // Отдельный режим «мои строки» для подписи не нужен: фронт подставляет
  // ФИО пользователя в тот же owner_note (он знает своё имя из сессии).
  if (q.counterparty) { params.push(`%${q.counterparty}%`); where += ` AND d.counterparty_name ILIKE $${params.length}`; }
  if (q.q) {
    params.push(`%${q.q}%`);
    const i = params.length;
    where += ` AND (d.counterparty_name ILIKE $${i} OR d.invoice_number ILIKE $${i} OR COALESCE(d.comment_text,'') ILIKE $${i} OR COALESCE(w.work_title,w.object_name,'') ILIKE $${i})`;
  }
  const t = today();
  // Светофор — единое SQL-ядро (см. src/lib/doc-traffic.js).
  const payOver = traffic.overduePaySql('d');
  const sfOver = traffic.overdueSfSql('d');
  if (q.overdue_pay === '1' || q.overdue_pay === 'true') where += ` AND ${payOver}`;
  if (q.overdue_sf === '1' || q.overdue_sf === 'true') where += ` AND ${sfOver}`;
  const qColor = String(q.traffic || '').toLowerCase();
  if (['red', 'blue', 'yellow', 'green'].includes(qColor)) {
    where += ` AND (${traffic.trafficSql('d')}) = '${qColor}'`;
  }
  // План §12: фильтр/светофор за флагом. Флаг проверяется в роуте (buildFilters
  // не async) — см. вызов в GET /; здесь только парсинг параметра.
  if (q.incomplete === '1' || q.incomplete === 'true') where += ' AND d.is_incomplete';
  if (q.no_onec === '1' || q.no_onec === 'true') where += ` AND (d.onec_id IS NULL OR trim(d.onec_id)='')`;

  // D-383: письма для ОБС — НЕ отдельные строки реестра счетов.
  //
  // Дефект (заказчик 27.10.2026: «почему я в реестре счетов вижу ИСХ... разве
  // исх это счёт?»). При генерации письма создавалась строка doc_registry с
  // package_type='letter' и dir='out', и она попадала в общий список наравне
  // со счетами: в колонке «Счёт» стояло «Исх. 261027-09», сумма 0 ₽, статус
  // «Закрыто». Читать реестр стало невозможно.
  //
  // Правильно: письмо — ВЛОЖЕНИЕ счёта. Фильтр добавлен в buildFilters
  // (см. блок D-383 там). Здесь только комментарий, чтобы не дублировать код.


  // D-378: способ оплаты. Значения фиксированные, подстановки нет.
  const paySrc = String(q.payment_source || '').toLowerCase();
  if (paySrc === 'obs' || paySrc === 'regular') {
    where += ` AND d.payment_source = '${paySrc}'`;
  }
  // «Без письма ОБС» — очередь на генерацию: ОБС выбран, письма ещё нет.
  // Именно этот фильтр нужен Диме, чтобы одной кнопкой видеть, где работать.
  if (q.obs_letter_missing === '1' || q.obs_letter_missing === 'true') {
    where += ` AND d.payment_source = 'obs'
               AND COALESCE(d.obs_letter_doc_id, 0) = 0
               AND d.obs_letter_status IN ('none','failed')`;
  }
  const kpi = (q.kpi || '').toLowerCase();
  if (kpi === 'pay') where += ` AND ${payOver}`;
  else if (kpi === 'sf') where += ` AND (d.ops_status IN ('wait_sf','wait_closing') OR (${sfOver}))`;
  else if (kpi === 'wh') where += ` AND d.wh_status IN ('await','received','to_office')`;
  else if (kpi === 'out') where += ` AND d.dir='out'`;
  else if (kpi === '1c' || kpi === 'no_1c') where += ` AND (d.onec_id IS NULL OR trim(d.onec_id)='')`;
  else if (kpi === 'incomplete') where += ' AND d.is_incomplete';

  // D-383: письма для ОБС — НЕ строки реестра счетов.
  //
  // Дефект (заказчик 27.10.2026: «почему я в реестре счетов вижу ИСХ... разве
  // исх это счёт?»). При генерации письма создавалась строка doc_registry с
  // package_type='letter' и dir='out', и она попадала в общий список наравне
  // со счетами: «Счёт Исх. 261027-09», 0 ₽, «Закрыто».
  //
  // Письмо — ВЛОЖЕНИЕ счёта. Строка остаётся в базе (на неё ссылается
  // obs_letter_doc_id, из неё берётся файл), но в списке не показывается.
  // `include_letters=1` — только для отладки и выгрузок.
  const includeLetters = String(q.include_letters || '') === '1' || String(q.include_letters || '') === 'true';
  if (!includeLetters) {
    where += ` AND d.package_type <> 'letter'`;
  }

  // Quarters by document date (invoice_date), not created_at
  const qtr = parseInt(q.quarter, 10);
  if (qtr >= 1 && qtr <= 4) {
    params.push(qtr);
    where += ` AND d.invoice_date IS NOT NULL AND EXTRACT(QUARTER FROM d.invoice_date)=$${params.length}`;
  }
  const year = parseInt(q.year, 10);
  if (year >= 2000 && year <= 2100) {
    params.push(year);
    where += ` AND d.invoice_date IS NOT NULL AND EXTRACT(YEAR FROM d.invoice_date)=$${params.length}`;
  }
  return { where, params };
}

module.exports = async function docRegistryRoutes(fastify) {
  const db = fastify.db || fastify.pg;
  const auth = { preHandler: [fastify.requireRoles(ALLOWED)] };

  /**
   * D-334: создать/связать расход проекта для строки реестра, если появился объект.
   * ═══════════════════════════════════════════════════════════════════════════
   * Вызывается при сохранении карточки (PUT) и при привязке объекта в заявке.
   *
   * ПОРЯДОК (как просил заказчик — «сначала проверяем, потом привязываем»):
   *   1. уже есть work_expense_id → ничего не делаем;
   *   2. есть расход с ключом `invoice:<docId>` → связываем;
   *   3. есть расход по тому же объекту с тем же номером документа и суммой
   *      (защита от дублей, D-328) → связываем;
   *   4. иначе создаём новый расход.
   *
   * @returns {Promise<number|null>} id расхода
   */
  async function ensureExpenseForDoc(db2, log, doc, userId) {
    if (!doc || !doc.id || !doc.work_id) return null;
    if (doc.work_expense_id) return doc.work_expense_id;
    if (String(doc.dir || '') !== 'in') return null;          // исходящие — не расход
    if (!(Number(doc.amount_gross) > 0)) return null;

    // 2. Расход уже создан по этому счёту (любой путь: оплата или ручная привязка).
    const byKey = await db2.query(
      `SELECT id FROM work_expenses
        WHERE source_table='doc_registry' AND source_key=$1
          AND COALESCE(status,'') <> 'rejected'
        LIMIT 1`, [`invoice:${doc.id}`]);
    if (byKey.rows[0]) {
      await db2.query(
        `UPDATE doc_registry SET work_expense_id=$2, updated_at=NOW()
          WHERE id=$1 AND work_expense_id IS NULL`, [doc.id, byKey.rows[0].id]);
      return byKey.rows[0].id;
    }

    // 3. Тот же счёт мог быть заведён под другой строкой реестра (дубль-строка).
    const invNo = String(doc.invoice_number || '').trim();
    if (invNo) {
      const byMatch = await db2.query(
        `SELECT id FROM work_expenses
          WHERE work_id=$1
            AND lower(trim(coalesce(doc_number,''))) = lower($2)
            AND abs(amount - $3) < 0.01
            AND COALESCE(status,'') <> 'rejected'
          LIMIT 1`, [doc.work_id, invNo, Number(doc.amount_gross)]);
      if (byMatch.rows[0]) {
        await db2.query(
          `UPDATE doc_registry SET work_expense_id=$2, updated_at=NOW()
            WHERE id=$1 AND work_expense_id IS NULL`, [doc.id, byMatch.rows[0].id]);
        log?.info?.(`[doc-registry] расход для #${doc.id} связан с существующим #${byMatch.rows[0].id}`);
        return byMatch.rows[0].id;
      }
    }

    // 4. Создаём.
    const { insertWorkExpense } = require('../services/work-expense-writer');
    const hasVat = doc.has_vat !== false && Number(doc.vat_amount) > 0;
    const expense = await insertWorkExpense(db2, {
      work_id: doc.work_id,
      category: doc.spend_kind === 'office' ? 'office'
        : doc.spend_kind === 'warehouse' ? 'materials' : 'materials',
      subcategory: 'other',
      amount: Number(doc.amount_gross) || 0,
      date: doc.invoice_date ? String(doc.invoice_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
      description: `Счёт ${doc.invoice_number || ('#' + doc.id)}${doc.counterparty_name ? ': ' + doc.counterparty_name : ''}`,
      supplier: doc.counterparty_name || null,
      doc_number: doc.invoice_number || null,
      payment_method: 'bank',
      vat_rate: hasVat ? Number(doc.vat_rate) : null,
      vat_amount: hasVat ? Number(doc.vat_amount) : null,
      source_table: 'doc_registry',
      source_id: doc.id,
      source_key: `invoice:${doc.id}`,
      created_by: userId || doc.created_by || null
    });
    if (expense && expense.id) {
      await db2.query(
        `UPDATE doc_registry SET work_expense_id=$2, updated_at=NOW()
          WHERE id=$1 AND work_expense_id IS NULL`, [doc.id, expense.id]);
      log?.info?.(`[doc-registry] создан расход #${expense.id} по счёту #${doc.id} (объект ${doc.work_id})`);
      return expense.id;
    }
    return null;
  }

  /**
   * D-335: офисный/складской счёт без объекта не должен теряться из картины компании.
   * Создаёт запись в office_expenses (реестр офисных расходов) и связывает её со строкой.
   *
   * Правила:
   *   1. только входящие, только spend_kind='office' (офис/АХО), без work_id;
   *   2. уже связан → возвращаем id;
   *   3. та же сумма + номер документа уже есть в реестре → связываем, не дублируем;
   *   4. статус: документ уже оплачен/в оплате → 'approved' (согласование пройдено),
   *      иначе 'pending' (попадёт директору на согласование, как обычный офисный расход).
   *
   * @returns {Promise<number|null>} id офисного расхода
   */
  async function ensureOfficeExpenseForDoc(db2, log, doc, userId) {
    if (!doc || !doc.id) return null;
    if (doc.office_expense_id) return doc.office_expense_id;
    if (String(doc.dir || '') !== 'in') return null;
    if (doc.work_id) return null;
    if (String(doc.spend_kind || '') !== 'office') return null;
    const amount = Number(doc.amount_gross) || 0;
    if (!(amount > 0)) return null;

    // 3. Дубль по номеру + сумме (+дата, если известна).
    const invNo = String(doc.invoice_number || '').trim();
    const dup = await db2.query(
      `SELECT id FROM office_expenses
        WHERE abs(amount - $1) < 0.01
          AND COALESCE(doc_number,'') = COALESCE($2,'')
          AND ($3::date IS NULL OR date = $3::date)
        LIMIT 1`, [amount, invNo, doc.invoice_date || null]);
    if (dup.rows[0]) {
      await db2.query(
        `UPDATE doc_registry SET office_expense_id=$2, updated_at=NOW()
          WHERE id=$1 AND office_expense_id IS NULL`, [doc.id, dup.rows[0].id]);
      log?.info?.(`[doc-registry] офисный расход #${doc.id} связан с существующим #${dup.rows[0].id}`);
      return dup.rows[0].id;
    }

    // 4. Создаём. Историю (документ уже в оплате/оплачен) не гоним через согласование повторно.
    const alreadyApproved = ['wait_pay', 'wait_closing', 'wait_sf', 'paid'].includes(String(doc.ops_status || ''))
      || ['paid', 'wait', 'in_progress'].includes(String(doc.pay_status || ''));
    // D-336: категория по контрагенту, а не «прочее по умолчанию» — иначе расход
    // не виден в разрезе реестра офисных расходов.
    const { classifyOfficeCategory } = require('../services/office-category');
    const category = classifyOfficeCategory({
      counterparty: doc.counterparty_name,
      description: doc.comment_text
    });
    const { rows } = await db2.query(
      `INSERT INTO office_expenses
         (category, description, amount, total_amount, vat_amount, date, supplier, counterparty,
          status, source, created_by, created_at, doc_number, document_number)
       VALUES ($9, $1, $2, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $5,
               $6, 'doc_hub', $7, NOW(), $8, $8)
       RETURNING id`,
      [
        doc.comment_text || `Счёт ${invNo || ('#' + doc.id)}${doc.counterparty_name ? ': ' + doc.counterparty_name : ''}`,
        amount,
        Number(doc.vat_amount) || 0,
        doc.invoice_date || null,
        doc.counterparty_name || null,
        alreadyApproved ? 'approved' : 'pending',
        userId || doc.created_by || null,
        invNo || null,
        category
      ]
    );
    const oeId = rows[0].id;
    await db2.query(
      `UPDATE doc_registry SET office_expense_id=$2, updated_at=NOW()
        WHERE id=$1 AND office_expense_id IS NULL`, [doc.id, oeId]);
    log?.info?.(`[doc-registry] создан офисный расход #${oeId} по счёту #${doc.id} (${amount} ₽)`);
    return oeId;
  }

  /**
   * N3: ответ о дубле не раскрывает id чужой строки (оракул существования).
   * Факт дубля сообщаем всегда, id — только если строка видна роли.
   */
  async function dupBody(db, req, dup) {
    if (!dup) return { error: 'Дубликат' };
    const visible = await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, dup.id);
    return visible ? { error: 'Дубликат', existing_id: dup.id } : { error: 'Дубликат' };
  }

  /**
   * S2: строку может открыть/изменить только тот, кому она видна по матрице.
   * Возвращает doc либо отправляет 404 и возвращает null.
   */
  async function loadVisibleDoc(req, reply, id) {
    if (isNaN(id)) { reply.code(400).send({ error: 'Неверный ID' }); return null; }
    const ok = await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id);
    if (!ok) { reply.code(404).send({ error: 'Не найдено' }); return null; }
    const { rows } = await db.query(`${JOIN_SQL} WHERE d.id=$1 AND d.deleted_at IS NULL`, [id]);
    if (!rows[0]) { reply.code(404).send({ error: 'Не найдено' }); return null; }
    return rows[0];
  }

  fastify.get('/', auth, async (req) => {
    const q = req.query || {};
    const { where, params } = buildFilters(q, req.user.id, req.user.role);
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    // ── Сортировка реестра (заказчик 19.10.2026) ──────────────────────────
    // Было жёстко `invoice_date DESC`. Нужна сортировка и по ДАТЕ ВНЕСЕНИЯ
    // (created_at), и по сумме, и в обе стороны. ТОЛЬКО белый список — никакой
    // подстановки пользовательской строки в SQL.
    const SORT_COLS = { invoice_date: 'd.invoice_date', created_at: 'd.created_at', id: 'd.id', amount_gross: 'd.amount_gross' };
    const sortRaw = String(q.sort || 'invoice_date').toLowerCase();
    const sortCol = SORT_COLS[sortRaw] || SORT_COLS.invoice_date;
    const orderRaw = String(q.order || 'desc').toLowerCase();
    const orderDir = orderRaw === 'asc' ? 'ASC' : 'DESC';
    const sort = sortRaw in SORT_COLS ? sortRaw : 'invoice_date';
    const orderSql = `ORDER BY ${sortCol} ${orderDir} NULLS LAST, d.id DESC`;
    // D-306: НЕ использовать String.replace() с шаблонной строкой-заменой —
    // в SQL светофора есть regex с `$'` (`!~ '^[А-ЯЁ]...$'`), и replace трактует
    // `$'` как «остаток строки», вставляя JOIN_SQL в середину выражения.
    // Результат: с 20.10.2026 список реестра падал 500 у ВСЕХ ролей
    // («syntax error at or near "no"»). Подстановка только через функцию.
    const listSql = JOIN_SQL.replace('SELECT d.*,', () => `SELECT d.*, (${traffic.trafficSql('d')}) AS traffic,`);
    const [cnt, list] = await Promise.all([
      db.query(`SELECT COUNT(*)::int n FROM doc_registry d LEFT JOIN works w ON w.id=d.work_id${where}`, params),
      db.query(`${listSql}${where} ${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit])
    ]);
    // План §12: флаг отдаётся фронту, чтобы UI показывал светофор/корректировки
    // только когда фича включена. Данные (traffic) приходят всегда — их не жалко.
    const enabled = await isTrafficLightEnabled(db);
    return { items: list.rows.map((r) => decorate(r, req.user.id)), total: cnt.rows[0].n, page, limit, sort, traffic_light: enabled };
  });

  fastify.get('/kpi', auth, async (req) => {
    const q = { ...(req.query || {}) };
    delete q.kpi; delete q.overdue_pay; delete q.overdue_sf; delete q.incomplete; delete q.no_onec; delete q.wh_status; delete q.dir;
    const { where, params } = buildFilters(q, req.user.id, req.user.role);
    const t = today();
    params.push(t);
    const ti = `$${params.length}`;
    const tSql = traffic.trafficSql('d');
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS "all",
        COUNT(*) FILTER (WHERE d.payment_due_at IS NOT NULL AND d.payment_due_at::date < ${ti}::date
          AND COALESCE(d.pay_status,'none') NOT IN ('paid','n_a'))::int AS pay,
        COUNT(*) FILTER (WHERE d.ops_status IN ('wait_sf','wait_closing')
          OR (d.sf_due_at IS NOT NULL AND d.sf_due_at::date < ${ti}::date
              AND d.ops_status IN ('wait_sf','wait_closing')))::int AS sf,
        COUNT(*) FILTER (WHERE d.sf_due_at IS NOT NULL AND d.sf_due_at::date < ${ti}::date
          AND d.ops_status IN ('wait_sf','wait_closing'))::int AS sf_overdue,
        COUNT(*) FILTER (WHERE d.wh_status IN ('await','received','to_office'))::int AS wh,
        COUNT(*) FILTER (WHERE d.dir='out')::int AS out,
        COUNT(*) FILTER (WHERE d.onec_id IS NULL OR trim(d.onec_id)='')::int AS no_1c,
        COUNT(*) FILTER (WHERE d.is_incomplete)::int AS incomplete,
        COUNT(*) FILTER (WHERE (${tSql}) = 'red')::int AS traffic_red,
        COUNT(*) FILTER (WHERE (${tSql}) = 'blue')::int AS traffic_blue,
        COUNT(*) FILTER (WHERE (${tSql}) = 'yellow')::int AS traffic_yellow,
        COUNT(*) FILTER (WHERE (${tSql}) = 'green')::int AS traffic_green
       FROM doc_registry d LEFT JOIN works w ON w.id=d.work_id${where}`,
      params
    );
    return rows[0] || { all: 0, pay: 0, sf: 0, wh: 0, out: 0, no_1c: 0, incomplete: 0, traffic_red: 0, traffic_blue: 0, traffic_yellow: 0, traffic_green: 0 };
  });

  fastify.get('/facets', auth, async (req) => {
    const scope = ((req.query || {}).scope || 'mine').toLowerCase();
    const params = [];
    let scopeSql = ' WHERE d.deleted_at IS NULL';
    // Единая матрица видимости (S1): фасеты не должны показывать чужое.
    scopeSql += visibilitySql(params, req.user.role, req.user.id, { scope });
    try {
      const [cp, ops, owners, pms, works, notes] = await Promise.all([
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
        ),
        // D-306c: подсказки под-ответственных — ТОЛЬКО свои подписи.
        // Заказчик: «эти фильтры другие не должны видеть». Поэтому в SQL
        // жёстко автор = текущий пользователь: подпись, которую вписала
        // коллега на том же аккаунте АГПЗ, сюда не попадает.
        db.query(
          `SELECT BTRIM(d.doc_owner_note) AS note, count(*)::int AS n
             FROM doc_registry d ${scopeSql}
              AND d.doc_owner_note IS NOT NULL AND BTRIM(d.doc_owner_note) <> ''
              AND d.doc_owner_note_by = $${params.length + 1}
            GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 300`,
          [...params, req.user.id]
        )
      ]);
      return {
        counterparties: cp.rows.map((r) => r.name).filter(Boolean),
        ops_status: ops.rows.map((r) => r.ops_status).filter(Boolean),
        doc_owners: owners.rows,
        pms: pms.rows,
        works: works.rows,
        // D-306: подсказки под-ответственных с числом строк, чтобы в фильтре
        // было видно «Пираев С. · 12». Собираем из уже введённых значений —
        // справочник не нужен, как в Excel.
        owner_notes: notes.rows
      };
    } catch (e) {
      fastify.log.warn('[doc-registry] facets: ' + (e && e.message));
      return { counterparties: [], ops_status: [], doc_owners: [], pms: [], works: [] };
    }
  });

  /**
   * V394: экран «Входящие СФ» для кладовщика — минимум полей.
   * Все входящие СФ, ожидающие получения/подтверждения. Роль WAREHOUSE/ADMIN/BUH.
   */
  /**
   * D-306: подсказки под-ответственных для карточки документа.
   * Заказчик: «в следующий документ зашли и выбрали либо прошлое фио, либо
   * новое написали — и уже стало 2».
   *
   * D-306c (заказчик 20.10.2026): «эти фильтры другие не должны видеть —
   * только внутри аккаунта, только пользователь их видит». Поэтому отдаём
   * ТОЛЬКО подписи текущего пользователя (doc_owner_note_by = он из сессии).
   * Подпись, которую вписала коллега на том же аккаунте АГПЗ, сюда не попадает.
   * Приоритет в списке — подписи того же аккаунта; чужие аккаунты не скрываем,
   * это его собственный рабочий список.
   * Свободный ввод не ограничиваем: чего нет в списке — вводится руками.
   */
  fastify.get('/owner-notes', auth, async (req) => {
    const p = [];
    const vis = visibilitySql(p, req.user.role, req.user.id, { scope: 'all' });
    const ownerId = parseInt((req.query || {}).doc_owner_id, 10);
    // Автор подписи — только из сессии, никогда из query (иначе чужой список).
    p.push(req.user.id);
    const iAuthor = p.length;
    p.push(Number.isFinite(ownerId) ? ownerId : null);
    const iOwner = p.length;
    const { rows } = await db.query(
      `SELECT BTRIM(d.doc_owner_note) AS note,
              count(*)::int AS n,
              bool_or(d.doc_owner_id = $${iOwner}) AS same_owner
         FROM doc_registry d
        WHERE d.deleted_at IS NULL
          AND d.doc_owner_note IS NOT NULL AND BTRIM(d.doc_owner_note) <> ''
          AND d.doc_owner_note_by = $${iAuthor}
          ${vis}
        GROUP BY 1
        ORDER BY bool_or(d.doc_owner_id = $${iOwner}) DESC, count(*) DESC, 1
        LIMIT 200`, p
    );
    return { notes: rows.map((r) => ({ note: r.note, count: r.n, same_owner: r.same_owner })) };
  });

  fastify.get('/incoming-sf', auth, async (req, reply) => {
    if (!WH_ROLES.has(req.user.role)) {
      return reply.code(403).send({ error: 'Экран доступен складу, бухгалтерии и админу' });
    }
    const q = req.query || {};
    const p = [];
    let where = ` WHERE d.deleted_at IS NULL AND d.dir='in'
      AND (d.ops_status IN ('wait_sf','wait_closing') OR d.sf_received_at IS NOT NULL)`;
    where += visibilitySql(p, req.user.role, req.user.id, { scope: q.scope });
    if (q.only_pending === '1') where += ` AND d.sf_received_at IS NULL`;
    const { rows } = await db.query(
      `SELECT d.id, d.invoice_number, d.invoice_date, d.counterparty_name, d.supplier_id,
              d.amount_gross, d.sf_due_at, d.sf_received_at, d.ops_status, d.wh_status,
              d.spend_kind, d.doc_owner_id, d.attachments, d.original_path_url,
              u.name AS owner_name
         FROM doc_registry d LEFT JOIN users u ON u.id = d.doc_owner_id
        ${where} ORDER BY d.sf_due_at NULLS LAST, d.id DESC LIMIT 300`, p);
    return {
      items: rows.map((r) => ({
        id: r.id, invoice_number: r.invoice_number, invoice_date: r.invoice_date,
        counterparty_name: r.counterparty_name, amount: Number(r.amount_gross) || 0,
        sf_due_at: r.sf_due_at, sf_received_at: r.sf_received_at,
        ops_status: r.ops_status, wh_status: r.wh_status, owner_name: r.owner_name,
        scan: r.original_path_url || (Array.isArray(r.attachments) && r.attachments[0]
          ? (typeof r.attachments[0] === 'string' ? r.attachments[0] : (r.attachments[0].url || r.attachments[0].path))
          : null)
      })),
      total: rows.length
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Архив и график (паритет с «Выплатами», замечание заказчика 16.10.2026).
  // ─────────────────────────────────────────────────────────────────────────

  /** Годы, по которым есть строки (для селектора архива). */
  fastify.get('/archive/years', auth, async (req) => {
    const p = [];
    const vis = visibilitySql(p, req.user.role, req.user.id, { scope: (req.query || {}).scope });
    const { rows } = await db.query(
      `SELECT DISTINCT EXTRACT(YEAR FROM COALESCE(d.invoice_date, d.created_at::date))::int AS y
         FROM doc_registry d WHERE d.deleted_at IS NULL${vis}
        ORDER BY 1 DESC LIMIT 12`, p);
    return { years: rows.map((r) => r.y).filter(Boolean) };
  });

  /** Сводка за месяц: суммы по видам расхода и по светофору. */
  fastify.get('/archive/:year/:month', auth, async (req) => {
    const y = parseInt(req.params.year, 10);
    const m = parseInt(req.params.month, 10);
    if (!y || !m || m < 1 || m > 12) return { rows: [] };
    const p = [y, m];
    const vis = visibilitySql(p, req.user.role, req.user.id, { scope: (req.query || {}).scope });
    const tSql = traffic.trafficSql('d');
    const { rows } = await db.query(
      `SELECT d.spend_kind,
              count(*)::int AS cnt,
              sum(d.amount_gross)::numeric AS amount,
              count(*) FILTER (WHERE (${tSql})='red')::int AS red,
              count(*) FILTER (WHERE (${tSql})='blue')::int AS blue,
              count(*) FILTER (WHERE (${tSql})='yellow')::int AS yellow,
              count(*) FILTER (WHERE (${tSql})='green')::int AS green
         FROM doc_registry d
        WHERE d.deleted_at IS NULL
          AND EXTRACT(YEAR FROM COALESCE(d.invoice_date, d.created_at::date))=$1
          AND EXTRACT(MONTH FROM COALESCE(d.invoice_date, d.created_at::date))=$2${vis}
        GROUP BY d.spend_kind ORDER BY 3 DESC NULLS LAST`, p);
    const totals = rows.reduce((a, r) => ({
      cnt: a.cnt + r.cnt, amount: a.amount + (Number(r.amount) || 0),
      red: a.red + r.red, blue: a.blue + r.blue, yellow: a.yellow + r.yellow, green: a.green + r.green
    }), { cnt: 0, amount: 0, red: 0, blue: 0, yellow: 0, green: 0 });
    return { year: y, month: m, rows, totals };
  });

  /** Помесячный ряд: документы (сумма) и оплачено — для графика. */
  fastify.get('/monthly-series/:year', auth, async (req) => {
    const y = parseInt(req.params.year, 10);
    if (!y) return { series: [] };
    const p = [y];
    const vis = visibilitySql(p, req.user.role, req.user.id, { scope: (req.query || {}).scope });
    const { rows } = await db.query(
      `SELECT EXTRACT(MONTH FROM COALESCE(d.invoice_date, d.created_at::date))::int AS mon,
              count(*)::int AS cnt,
              COALESCE(sum(d.amount_gross),0)::numeric AS docs,
              COALESCE(sum(d.amount_gross) FILTER (WHERE d.pay_status IN ('paid','n_a')),0)::numeric AS paid
         FROM doc_registry d
        WHERE d.deleted_at IS NULL
          AND EXTRACT(YEAR FROM COALESCE(d.invoice_date, d.created_at::date))=$1${vis}
        GROUP BY 1 ORDER BY 1`, p);
    const series = Array.from({ length: 12 }, (_, i) => {
      const hit = rows.find((r) => r.mon === i + 1);
      return { mon: i + 1, cnt: hit ? hit.cnt : 0, docs: hit ? Number(hit.docs) : 0, paid: hit ? Number(hit.paid) : 0 };
    });
    return { year: y, series };
  });

  /**
   * D-291 (заказчик 20.10.2026): «Я не нашёл график оплат — ты его не сделал?»
   * Верно, не было. Теперь: счета с известным сроком оплаты, сгруппированные
   * по дням, плюс сводка KPI (просрочено / на этой неделе / в этом месяце).
   * Источник срока: payment_due_at; для частичной оплаты — ближайший неоплаченный
   * этап из payment_schedule.
   */
  /**
   * D-292 (заказчик 20.10.2026): «я рассчитывал, что график будет показывать
   * ТОЛЬКО счета, которые согласовал директор».
   *
   * Было две ошибки:
   *  1) Источником был doc_registry.payment_due_at. Но согласование живёт в
   *     payment_invoices (awaiting_dir → pending_payment), а у реестра своя
   *     жизнь: срок заполнен лишь у 2 из 1518 неоплаченных, и в него попадали
   *     счета, которые директор ЕЩЁ НЕ согласовал (awaiting_dir).
   *  2) В KPI/списке оказывались несогласованные счета на суммы, которые
   *     никогда не пойдут в оплату.
   *
   * Теперь источник истины — payment_invoices:
   *    • include approved=true (по умолчанию) → только status='pending_payment'
   *      (директор согласовал, ждёт оплаты) + уже оплаченные, если запрошены;
   *    • approved=false → режим «на согласовании» (awaiting_dir), чтобы было
   *      видно, что ещё не подтверждено, — но НЕ смешивая с оплатой.
   *
   * Срок берём payment_invoices.due_date; если пусто — подтягиваем из
   * реестра (doc_registry.payment_due_at) как фолбэк. Для частичной оплаты —
   * ближайший неоплаченный этап payment_schedule.
   */
  fastify.get('/payment-schedule', auth, async (req) => {
    const q = req.query || {};
    const now = new Date();
    const from = q.from || new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const to = q.to || new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10);
    // Какие статусы показываем: только согласованные (по умолчанию) или только
    // ожидающие решения директора.
    const approvedOnly = String(q.approved == null ? 'true' : q.approved) !== 'false';
    const inclPaid = String(q.paid || '') === '1';

    const p = [];
    const statuses = approvedOnly
      ? (inclPaid ? ['pending_payment', 'paid'] : ['pending_payment'])
      : ['awaiting_dir'];
    p.push(statuses);
    const pStatuses = 1;

    // Общий круг видимости строк реестра (та же матрица, что в списке документов).
    // Проверяем по doc_registry, потому что видимость описана для её колонок.
    //
    // D-318: $1 уже занят массивом статусов, а `visibilitySql` нумерует свои
    // параметры ОТ НАЧАЛА переданного массива. Если дать ей отдельный массив,
    // для РП/HEAD_PM/HEAD_TO получалось `d.doc_owner_id = $1`, где $1 — это
    // `["pending_payment"]::text[]`, и Postgres отвечал 42883
    // «operator does not exist: integer = text[]» → график отдавал 503.
    //
    // Правильно (как во всех остальных роутах файла): передать ТОТ ЖЕ массив
    // `p`, в который уйдут параметры запроса, — тогда нумерация сквозная.
    const vis = visibilitySql(p, req.user.role, req.user.id, { scope: 'all' });

    // D-318b (верификатор 21.10.2026): прежняя клауза `(d.id IS NULL OR …)`
    // пускала ЛЮБУЮ заявку без привязанной строки реестра всем ролям. В режиме
    // «не согласованные» это отдавало РП чужие суммы (проверено: 5 заявок на
    // 505 790 ₽). Заявка без реестра принадлежит своему инициатору — по нему и
    // ограничиваем. Если видимость полная (`vis === ''`), ограничения нет.
    let linkClause = '';
    if (vis) {
      p.push(req.user.id);
      linkClause = ` AND ((d.id IS NOT NULL AND (true${vis})) OR (d.id IS NULL AND pi.created_by = $${p.length}))`;
    }

    const { rows } = await db.query(
      `SELECT pi.id, pi.status, pi.payment_status, pi.invoice_number, pi.amount,
              pi.due_date, pi.supplier_name, pi.pay_timing,
              pi.doc_registry_id, pi.created_by,
              d.payment_due_at AS reg_due, d.payment_kind, d.payment_schedule,
              u.name AS owner_name
         FROM payment_invoices pi
         LEFT JOIN doc_registry d ON d.id = pi.doc_registry_id AND d.deleted_at IS NULL
         LEFT JOIN users u ON u.id = COALESCE(d.doc_owner_id, pi.created_by)
        WHERE pi.status = ANY($${pStatuses}::text[])
          AND COALESCE(pi.payment_status,'') <> 'rejected'
          ${linkClause}
        ORDER BY COALESCE(pi.due_date, d.payment_due_at) ASC NULLS LAST, pi.id ASC`,
      p);

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));

    // Счета БЕЗ срока — не прячем: показываем отдельной группой «срок не указан»,
    // иначе согласованный счёт исчезает из графика и кажется потерянным.
    const items = rows.map((r) => {
      let due = iso(r.due_date || r.reg_due);
      let amount = Number(r.amount) || 0;
      if (String(r.payment_kind || '') === 'partial' && r.payment_schedule) {
        let sched = r.payment_schedule;
        if (typeof sched === 'string') { try { sched = JSON.parse(sched); } catch (_) { sched = null; } }
        if (Array.isArray(sched)) {
          const next = sched
            .filter((s) => s && !s.paid_at && s.due_at)
            .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))[0];
          if (next) { due = iso(next.due_at); amount = Number(next.amount) || amount; }
        }
      }
      const dueDate = due ? new Date(due + 'T00:00:00') : null;
      const overdue = !!(dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < today);
      return {
        id: r.id,
        registry_id: r.doc_registry_id || null,
        counterparty_name: r.supplier_name || '—',
        invoice_number: r.invoice_number,
        amount,
        amount_total: Number(r.amount) || 0,
        due_at: due || null,
        has_due: !!due,
        overdue,
        owner_name: r.owner_name || null,
        payment_kind: r.payment_kind || null,
        status: r.status,
        pay_status: r.payment_status || null,
        approved: r.status === 'pending_payment' || r.status === 'paid'
      };
    });

    // Группировка по дням — только счета С ДАТОЙ (бессрочные в календарь не лезут).
    const byDay = {};
    for (const it of items) {
      if (!it.due_at) continue;
      const k = it.due_at;
      if (!byDay[k]) byDay[k] = { date: k, count: 0, amount: 0, overdue: false, ids: [] };
      byDay[k].count += 1;
      byDay[k].amount += it.amount;
      byDay[k].ids.push(it.id);
      if (it.overdue) byDay[k].overdue = true;
    }

    // KPI.
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const sum = (arr) => arr.reduce((a, x) => a + x.amount, 0);
    const withDue = items.filter((x) => x.has_due);
    const inRange = (x, a, b) => {
      if (!x.has_due) return false;
      const d = new Date(x.due_at + 'T00:00:00');
      return !Number.isNaN(d.getTime()) && d >= a && d <= b;
    };
    const kpi = {
      overdue: { count: items.filter((x) => x.overdue).length, amount: sum(items.filter((x) => x.overdue)) },
      week: { count: withDue.filter((x) => inRange(x, today, weekEnd)).length, amount: sum(withDue.filter((x) => inRange(x, today, weekEnd))) },
      month: { count: withDue.filter((x) => inRange(x, today, monthEnd)).length, amount: sum(withDue.filter((x) => inRange(x, today, monthEnd))) },
      no_due: { count: items.filter((x) => !x.has_due).length, amount: sum(items.filter((x) => !x.has_due)) },
      total: { count: items.length, amount: sum(items) }
    };

    return {
      from, to, today: iso(today),
      approved_only: approvedOnly,
      items, byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
      kpi
    };
  });


  const RECON_ROLES = new Set(['BUH', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR', 'OFFICE_MANAGER']);

  /** Настройки регламента актов (не хардкод). */
  async function reconSettings() {
    const keys = ['doc_recon_quarter_deadline_day', 'doc_recon_year_deadline'];
    const { rows } = await db.query(`SELECT key, value_json FROM settings WHERE key = ANY($1::text[])`, [keys]);
    const m = {};
    for (const r of rows) {
      let v = r.value_json;
      try { v = JSON.parse(v); } catch (_) { /* строка как есть */ }
      m[r.key] = v;
    }
    return {
      quarterDay: parseInt(m.doc_recon_quarter_deadline_day, 10) || 10,
      yearDeadline: (typeof m.doc_recon_year_deadline === 'string' && m.doc_recon_year_deadline) || '01-15'
    };
  }

  /** Список актов: план (по контрагентам с оборотами за период) + сохранённые. */
  fastify.get('/reconciliation', auth, async (req) => {
    const q = req.query || {};
    const year = parseInt(q.year, 10) || new Date().getFullYear();
    const quarter = parseInt(q.quarter, 10) || 0;
    const cfg = await reconSettings();
    // FAIL-3 (верификатор 17.10): сохранённые акты содержат balance_rub и
    // file_url подписанного файла — их видят ТОЛЬКО привилегированные роли
    // (как и деталь). Раньше SELECT * отдавал чужой акт любому PM.
    const canSeeSaved = canUseScopeAll(req.user.role);
    let saved = [];
    if (canSeeSaved) {
      const sRes = await db.query(
        `SELECT * FROM doc_reconciliation_acts WHERE period_year=$1 AND period_quarter=$2 ORDER BY due_at NULLS LAST`,
        [year, quarter]);
      saved = sRes.rows;
    }
    // Кандидаты: контрагенты с документами (оплата/услуга) за период.
    const { from, to } = reconSvc.periodRange(year, quarter);
    const p = [from, to];
    // ВАЖНО (найдено 17.10 при проверке в браузере): акт сверки — бухгалтерская
    // функция по КОНТРАГЕНТУ, а не личный список. С scope='mine' бухгалтер видел
    // ПУСТОЙ список (строки заведены не им), хотя в детали суммы были. Для
    // привилегированных — всегда period целиком, как уже сделано в /detail.
    const listScope = canUseScopeAll(req.user.role) ? 'all' : (q.scope || 'mine');
    const vis = visibilitySql(p, req.user.role, req.user.id, { scope: listScope });
    // Кандидаты по ИНН.
    const { rows: cands } = await db.query(
      `SELECT d.counterparty_inn AS inn, max(d.counterparty_name) AS name,
              count(*)::int AS docs, sum(d.amount_gross)::numeric AS amount,
              sum(CASE WHEN d.pay_status IN ('paid','n_a') THEN d.amount_gross ELSE 0 END)::numeric AS paid_sum
         FROM doc_registry d
        WHERE d.deleted_at IS NULL AND d.dir='in'
          AND COALESCE(d.invoice_date, d.service_done_at) BETWEEN $1::date AND $2::date
          AND (d.pay_status IN ('paid','n_a') OR d.service_done_at IS NOT NULL)${vis}
        GROUP BY d.counterparty_inn HAVING d.counterparty_inn IS NOT NULL AND d.counterparty_inn <> ''
        ORDER BY 4 DESC NULLS LAST LIMIT 500`,
      p
    ).catch(() => ({ rows: [] }));
    // P2 (верификатор 17.10): контрагенты БЕЗ ИНН раньше выпадали из списка
    // (HAVING отсекал пустой ИНН) — вкладка была пуста, хотя деталь по имени
    // работала. Добавляем вторую группу: по нормализованному имени.
    const { rows: candsByName } = await db.query(
      `SELECT max(d.counterparty_inn) AS inn, max(d.counterparty_name) AS name,
              count(*)::int AS docs, sum(d.amount_gross)::numeric AS amount,
              sum(CASE WHEN d.pay_status IN ('paid','n_a') THEN d.amount_gross ELSE 0 END)::numeric AS paid_sum
         FROM doc_registry d
        WHERE d.deleted_at IS NULL AND d.dir='in'
          AND COALESCE(d.invoice_date, d.service_done_at) BETWEEN $1::date AND $2::date
          AND (d.pay_status IN ('paid','n_a') OR d.service_done_at IS NOT NULL)${vis}
          AND (d.counterparty_inn IS NULL OR d.counterparty_inn = '')
          AND COALESCE(trim(d.counterparty_name),'') <> ''
        GROUP BY lower(trim(d.counterparty_name))
        ORDER BY 4 DESC NULLS LAST LIMIT 500`,
      p
    ).catch(() => ({ rows: [] }));
    for (const c of candsByName) cands.push(c);
    // Сумма взаимозачётов по актам периода — чтобы баланс в СПИСКЕ совпадал
    // с балансом в детали (раньше в списке стояло «—», а внутри были суммы).
    const adjByInn = new Map();
    const adjByName = new Map();
    for (const s of saved) {
      const list = Array.isArray(s.manual_adjustments) ? s.manual_adjustments : [];
      const sum = list.reduce((a, x) => a + (Number(x && x.amount) || 0), 0);
      if (s.counterparty_inn) adjByInn.set(s.counterparty_inn, Math.round(sum * 100) / 100);
      else if (s.counterparty_name) adjByName.set(String(s.counterparty_name).trim().toLowerCase(), Math.round(sum * 100) / 100);
    }
    const byKey = new Map();
    for (const c of cands) {
      const paidSum = Number(c.paid_sum) || 0;
      const docsSum = Number(c.amount) || 0;
      // Ключ: при наличии ИНН — по ИНН, иначе по нормализованному имени (как в saved).
      const key = c.inn ? c.inn : ('name:' + String(c.name || '').trim().toLowerCase());
      const adj = adjByInn.get(c.inn) || adjByName.get(String(c.name || '').trim().toLowerCase()) || 0;
      byKey.set(key, {
        inn: c.inn || null, name: c.name, docs: c.docs, amount: docsSum, paid_sum: paidSum,
        balance_rub: Math.round((paidSum - docsSum + adj) * 100) / 100,
        due_at: reconSvc.periodDeadline(year, quarter, cfg),
        status: null, received_at: null
      });
    }
    for (const s of saved) {
      const k = s.counterparty_inn || ('name:' + String(s.counterparty_name || '').toLowerCase());
      const cur = byKey.get(k) || {
        inn: s.counterparty_inn, name: s.counterparty_name, docs: 0, amount: 0, paid_sum: 0,
        balance_rub: Math.round((adjByName.get(String(s.counterparty_name || '').trim().toLowerCase()) || 0) * 100) / 100
      };
      cur.due_at = s.due_at || cur.due_at;
      cur.status = s.status; cur.received_at = s.received_at;
      // file_url отдаём флагом (есть/нет) + имя файла; сам файл — через ACL-прокси по act_id,
      // прямые /uploads/ не авторизованы (см. /reconciliation/:id/file).
      cur.has_file = !!s.file_url;
      cur.file_name = (s.file_meta && s.file_meta.name) || null;
      cur.adjustments_count = Array.isArray(s.manual_adjustments) ? s.manual_adjustments.length : 0;
      cur.act_id = s.id;
      byKey.set(k, cur);
    }
    return {
      period: { year, quarter, ...reconSvc.periodRange(year, quarter) },
      due_at: reconSvc.periodDeadline(year, quarter, cfg),
      items: Array.from(byKey.values())
    };
  });

  /** Детальная сверка по контрагенту: документы + баланс. */
  fastify.get('/reconciliation/detail', auth, async (req) => {
    const q = req.query || {};
    const year = parseInt(q.year, 10) || new Date().getFullYear();
    const quarter = parseInt(q.quarter, 10) || 0;
    // Верификатор 17.10: деталь ДОЛЖНА уважать матрицу видимости — иначе PM
    // получал обороты по чужим контрагентам (утечка сумм до ~5 млн ₽).
    // Для привилегированных (BUH/ADMIN/директора) акт сверки — бухгалтерская
    // функция по КОНТРАГЕНТУ, а не личный список: они видят период целиком
    // (scope='all'). Не-привилегированные (PM/PROC/TO/WAREHOUSE) остаются
    // ограничены своей матрицей независимо от scope.
    const reconScope = canUseScopeAll(req.user.role) ? 'all' : (q.scope || 'mine');
    // act_id (если акт уже сохранён) — чтобы учесть взаимозачёты в балансе.
    let actId = null;
    if (q.inn) {
      const a = await db.query(`SELECT id FROM doc_reconciliation_acts WHERE counterparty_inn=$1 AND period_year=$2 AND period_quarter=$3`, [q.inn, year, quarter]).catch(() => ({ rows: [] }));
      actId = a.rows[0] ? a.rows[0].id : null;
    } else if (q.name) {
      const a = await db.query(`SELECT id FROM doc_reconciliation_acts WHERE lower(trim(counterparty_name))=$1 AND period_year=$2 AND period_quarter=$3`, [String(q.name).trim().toLowerCase(), year, quarter]).catch(() => ({ rows: [] }));
      actId = a.rows[0] ? a.rows[0].id : null;
    }
    const detail = await reconSvc.buildReconciliation(db, {
      inn: q.inn || null, name: q.name || null, year, quarter, actId,
      role: req.user.role, userId: req.user.id, scope: reconScope
    });
    const cfg = await reconSettings();
    // Флаг наличия файла акта + имя — для кнопки скачивания (сам файл через ACL).
    let has_file = false; let file_name = null;
    if (actId) {
      const fm = await db.query(`SELECT file_url, file_meta FROM doc_reconciliation_acts WHERE id=$1`, [actId]).catch(() => ({ rows: [] }));
      if (fm.rows[0] && fm.rows[0].file_url) {
        has_file = true;
        file_name = (fm.rows[0].file_meta && fm.rows[0].file_meta.name) || null;
      }
    }
    return { ...detail, act_id: actId, has_file, file_name, due_at: reconSvc.periodDeadline(year, quarter, cfg) };
  });

  /** Отметить «запрошен» / «получен» + приложить файл от контрагента. */
  fastify.post('/reconciliation/status', auth, async (req, reply) => {
    if (!RECON_ROLES.has(String(req.user.role || '').toUpperCase())) {
      return reply.code(403).send({ error: 'Доступно бухгалтерии, офису и директорам' });
    }
    const b = req.body || {};
    const year = parseInt(b.year, 10); const quarter = parseInt(b.quarter, 10) || 0;
    if (!year) return reply.code(400).send({ error: 'year обязателен' });
    const status = ['planned', 'requested', 'received', 'overdue'].includes(b.status) ? b.status : 'requested';
    const inn = b.inn || null;
    const name = b.name || null;
    if (!inn && !name) return reply.code(400).send({ error: 'inn или name обязательны' });
    const cfg = await reconSettings();
    const dueAt = reconSvc.periodDeadline(year, quarter, cfg);
    // upsert по уникальному ключу (ИНН либо нормализованное имя)
    const existing = await db.query(
      inn
        ? `SELECT id FROM doc_reconciliation_acts WHERE counterparty_inn=$1 AND period_year=$2 AND period_quarter=$3`
        : `SELECT id FROM doc_reconciliation_acts WHERE lower(trim(counterparty_name))=$1 AND period_year=$2 AND period_quarter=$3`,
      [inn || String(name).trim().toLowerCase(), year, quarter]);
    const fields = {
      counterparty_inn: inn, counterparty_name: name, period_year: year, period_quarter: quarter,
      due_at: dueAt, status,
      received_at: status === 'received' ? new Date().toISOString() : null,
      received_by: status === 'received' ? req.user.id : null,
      // P0 (верификатор 17.10): file_url принимаем ТОЛЬКО если он безопасен (внутри
      // uploads). Иначе значение вида `uploads/../.env` отравило бы базу и дало
      // чтение произвольных файлов при скачивании.
      file_url: b.file_url ? (() => { const p = safeUploadPath(b.file_url); return p ? normPath(b.file_url) : null; })() : null,
      comment: sanitizeText(String(b.comment || ''), 2000)
    };
    // гарантируем, что requested_at выставлен при первом запросе
    fields.requested_at = b.requested_at || new Date().toISOString().slice(0, 10);
    fields.requested_by = req.user.id;
    let actId;
    if (existing.rows[0]) {
      const set = Object.keys(fields).map((k, i) => `${k}=$${i + 1}`).join(', ');
      const { rows } = await db.query(
        `UPDATE doc_reconciliation_acts SET ${set}, updated_at=NOW() WHERE id=$${Object.keys(fields).length + 1} RETURNING *`,
        [...Object.values(fields), existing.rows[0].id]);
      actId = rows[0].id;
    } else {
      const cols = Object.keys(fields);
      const { rows } = await db.query(
        `INSERT INTO doc_reconciliation_acts (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        Object.values(fields));
      actId = rows[0].id;
    }
    await audit(db, actId, req.user.id, 'recon_' + status, { inn, name, year, quarter });
    // A2 (светофор по актам): поле recon_due_at в doc_registry до этого НИКТО не
    // заполнял — ветка «акт не получен → красный/жёлтый» в doc-traffic.js была мёртвой.
    // Теперь при запросе акта помечаем документы контрагента за период: срок + запрос.
    // При получении — снимаем срок (акт закрыт). Это делает светофор живым.
    try {
      const { from, to } = reconSvc.periodRange(year, quarter);
      const mp = [from, to];
      let mw = `deleted_at IS NULL AND dir='in'
        AND COALESCE(invoice_date, service_done_at) BETWEEN $1::date AND $2::date`;
      if (inn) { mp.push(inn); mw += ` AND counterparty_inn=$${mp.length}`; }
      else { mp.push(String(name).trim().toLowerCase()); mw += ` AND lower(trim(counterparty_name))=$${mp.length}`; }
      if (status === 'received') {
        await db.query(
          `UPDATE doc_registry SET recon_received_at=CURRENT_DATE, recon_due_at=NULL, updated_at=NOW()
            WHERE ${mw} AND (recon_received_at IS NULL OR recon_received_at < CURRENT_DATE)`, mp);
      } else {
        mp.push(dueAt);
        await db.query(
          `UPDATE doc_registry SET recon_due_at=$${mp.length}::date,
             recon_requested_at=COALESCE(recon_requested_at, CURRENT_DATE), updated_at=NOW()
            WHERE ${mw} AND recon_received_at IS NULL`, mp);
      }
    } catch (e) {
      fastify.log.warn('[doc-registry] recon traffic mark: ' + (e && e.message));
    }
    return { ok: true, act_id: actId, status };
  });

  /**
   * Загрузка файла акта от контрагента (бухгалтерия).
   * Безопасность — класс D-220: расширение из белого списка (не из имени клиента),
   * лимит размера, файл кладём в uploads/doc-hub/, раздаём только через ACL-прокси.
   */
  fastify.post('/reconciliation/file', auth, async (req, reply) => {
    if (!RECON_ROLES.has(String(req.user.role || '').toUpperCase())) {
      return reply.code(403).send({ error: 'Загружать акт может бухгалтерия, офис и директора' });
    }
    const b = {};
    let filePart = null;
    if (typeof req.isMultipart === 'function' && req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file' && !filePart) {
          filePart = { buffer: await part.toBuffer(), filename: part.filename, mimetype: part.mimetype };
        } else if (part.fieldname) b[part.fieldname] = part.value;
      }
    } else {
      Object.assign(b, req.body || {});
    }
    const year = parseInt(b.year, 10);
    const quarter = parseInt(b.quarter, 10) || 0;
    const inn = b.inn || null;
    const name = b.name || null;
    if (!year) return reply.code(400).send({ error: 'year обязателен' });
    if (!inn && !name) return reply.code(400).send({ error: 'inn или name обязательны' });
    if (!filePart || !filePart.buffer) return reply.code(400).send({ error: 'Файл не загружен' });
    if (filePart.buffer.length > 20 * 1024 * 1024) return reply.code(413).send({ error: 'Файл больше 20 МБ' });

    const { safeStoredExt, safeContentType } = require('../lib/upload-ext');
    const ext = safeStoredExt(filePart.mimetype, filePart.filename, { allow: 'doc' });
    if (!ext) return reply.code(415).send({ error: 'Недопустимый тип файла' });

    const dir = reconPrivateDir();
    await fsp.mkdir(dir, { recursive: true }, { mode: 0o700 });
    const fname = `recon_${year}_${quarter || 'y'}_${randomUUID()}${ext}`;
    await fsp.writeFile(path.join(dir, fname), filePart.buffer, { mode: 0o600 });
    // Путь храним БЕЗ публичного префикса uploads/ — файл вне статики; ACL-роут
    // собирает путь через safeUploadPath и знает про private/recon.
    const url = `${PRIVATE_UPLOAD_SUBDIR}/${RECON_SUBDIR}/${fname}`;

    const cfg = await reconSettings();
    const dueAt = reconSvc.periodDeadline(year, quarter, cfg);
    const fileMeta = {
      name: String(b.name_file || filePart.filename || fname).replace(/[<>"'`]/g, '').slice(0, 200),
      size: filePart.buffer.length,
      mimetype: safeContentType(ext, filePart.mimetype),
      uploaded_at: new Date().toISOString(),
      by: req.user.id
    };
    {
      const existing = await db.query(
        inn
          ? `SELECT id FROM doc_reconciliation_acts WHERE counterparty_inn=$1 AND period_year=$2 AND period_quarter=$3`
          : `SELECT id FROM doc_reconciliation_acts WHERE lower(trim(counterparty_name))=$1 AND period_year=$2 AND period_quarter=$3`,
        [inn || String(name).trim().toLowerCase(), year, quarter]);
      let actId;
      if (existing.rows[0]) {
        const { rows } = await db.query(
          `UPDATE doc_reconciliation_acts
              SET file_url=$2, file_meta=$3::jsonb, status='received', received_at=NOW(), received_by=$4, updated_at=NOW()
            WHERE id=$1 RETURNING *`,
          [existing.rows[0].id, url, JSON.stringify(fileMeta), req.user.id]);
        actId = rows[0].id;
      } else {
        const { rows } = await db.query(
          `INSERT INTO doc_reconciliation_acts
             (counterparty_inn, counterparty_name, period_year, period_quarter, due_at,
              status, file_url, file_meta, received_at, received_by)
           VALUES ($1,$2,$3,$4,$5::date,'received',$6,$7::jsonb,NOW(),$8) RETURNING *`,
          [inn, name, year, quarter, dueAt, url, JSON.stringify(fileMeta), req.user.id]);
        actId = rows[0].id;
      }
      // Светофор: помечаем получение акта на всех документах контрагента за период,
      // чтобы просрочка акта исчезла из красных строк (поле читает doc-traffic.js).
      const { from, to } = reconSvc.periodRange(year, quarter);
      const markParams = [from, to];
      let markWhere = `deleted_at IS NULL AND dir='in' AND COALESCE(invoice_date, service_done_at) BETWEEN $1::date AND $2::date`;
      if (inn) { markParams.push(inn); markWhere += ` AND counterparty_inn=$${markParams.length}`; }
      else { markParams.push(String(name).trim().toLowerCase()); markWhere += ` AND lower(trim(counterparty_name))=$${markParams.length}`; }
      await db.query(
        `UPDATE doc_registry SET recon_received_at=CURRENT_DATE, recon_due_at=NULL, updated_at=NOW()
          WHERE ${markWhere} AND (recon_received_at IS NULL OR recon_received_at < CURRENT_DATE)`,
        markParams).catch(() => {});
      await audit(db, actId, req.user.id, 'recon_file_upload', { year, quarter, inn, name, size: fileMeta.size });
      return { ok: true, act_id: actId, file_url: url, file_name: fileMeta.name, status: 'received' };
    }
  });

  /** Скачивание файла акта — только через ACL (прямой /uploads/ не авторизован). */
  fastify.get('/reconciliation/:id/file', auth, async (req, reply) => {
    if (!RECON_ROLES.has(String(req.user.role || '').toUpperCase())) {
      return reply.code(403).send({ error: 'Файл акта доступен бухгалтерии, офису и директорам' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows } = await db.query(`SELECT file_url, file_meta, counterparty_name FROM doc_reconciliation_acts WHERE id=$1`, [id]);
    if (!rows[0] || !rows[0].file_url) return reply.code(404).send({ error: 'Файл не найден' });
    // P0 (верификатор 17.10.2026): path traversal. Раньше путь склеивался напрямую,
    // и file_url вида `uploads/../.env` читал ЛЮБОЙ файл от имени бухгалтера
    // (JWT_SECRET, DB_PASSWORD…). Теперь: resolve + проверка границы каталога.
    // Файлы актов лежат в приватном private/recon (вне статики) — ограничиваем и им.
    const fsPath = safeUploadPath(rows[0].file_url, { subdir: path.join(PRIVATE_UPLOAD_SUBDIR, RECON_SUBDIR) })
      || safeUploadPath(rows[0].file_url, { subdir: 'doc-hub' })
      || safeUploadPath(rows[0].file_url);
    if (!fsPath) return reply.code(400).send({ error: 'Недопустимый путь к файлу' });
    if (!fs.existsSync(fsPath)) return reply.code(404).send({ error: 'Файл отсутствует на диске' });
    const ext = path.extname(fsPath).toLowerCase();
    const { safeContentType } = require('../lib/upload-ext');
    const ct = safeContentType(ext, null);
    const name = (rows[0].file_meta && rows[0].file_meta.name) || path.basename(fsPath);
    reply.header('Content-Type', ct);
    reply.header('Content-Disposition', `${ct === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(name)}"`);
    return reply.send(fs.createReadStream(fsPath));
  });

  /**
   * Взаимозачёты акта (manual_adjustments): добавить/удалить ручную корректировку.
   * Влияет на баланс: Σ оплат − Σ документов + Σ корректировок.
   */
  fastify.post('/reconciliation/adjustment', auth, async (req, reply) => {
    if (!RECON_ROLES.has(String(req.user.role || '').toUpperCase())) {
      return reply.code(403).send({ error: 'Взаимозачёты ведёт бухгалтерия, офис и директора' });
    }
    const b = req.body || {};
    const year = parseInt(b.year, 10);
    const quarter = parseInt(b.quarter, 10) || 0;
    const inn = b.inn || null;
    const name = b.name || null;
    const actIdIn = parseInt(b.act_id, 10);
    // Находим акт: по переданному id либо по контрагенту+периоду. Если акта ещё
    // нет, а бухгалтер добавляет взаимозачёт — акт создаём (он и так нужен).
    let actId = Number.isFinite(actIdIn) ? actIdIn : null;
    if (!actId) {
      if (!year || (!inn && !name)) return reply.code(400).send({ error: 'Нужен act_id либо year + inn/name' });
      const cfg = await reconSettings();
      const dueAt = reconSvc.periodDeadline(year, quarter, cfg);
      const found = await db.query(
        inn
          ? `SELECT id FROM doc_reconciliation_acts WHERE counterparty_inn=$1 AND period_year=$2 AND period_quarter=$3`
          : `SELECT id FROM doc_reconciliation_acts WHERE lower(trim(counterparty_name))=$1 AND period_year=$2 AND period_quarter=$3`,
        [inn || String(name).trim().toLowerCase(), year, quarter]);
      actId = found.rows[0] ? found.rows[0].id : (await db.query(
        `INSERT INTO doc_reconciliation_acts (counterparty_inn, counterparty_name, period_year, period_quarter, due_at, status, requested_at, requested_by)
         VALUES ($1,$2,$3,$4,$5::date,'planned',CURRENT_DATE,$6) RETURNING id`,
        [inn, name, year, quarter, dueAt, req.user.id])).rows[0].id;
    }
    const { rows: act } = await db.query(`SELECT id, manual_adjustments FROM doc_reconciliation_acts WHERE id=$1`, [actId]);
    if (!act[0]) return reply.code(404).send({ error: 'Акт не найден' });
    const list = Array.isArray(act[0].manual_adjustments) ? [...act[0].manual_adjustments] : [];
    if (b.remove_at != null) {
      const idx = parseInt(b.remove_at, 10);
      if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return reply.code(400).send({ error: 'Неверный индекс корректировки' });
      list.splice(idx, 1);
    } else {
      const amount = Number(b.amount);
      if (!Number.isFinite(amount) || amount === 0) return reply.code(400).send({ error: 'amount — ненулевое число' });
      const note = sanitizeText(String(b.note || '').trim(), 500);
      if (!note) return reply.code(400).send({ error: 'Комментарий обязателен: что за взаимозачёт' });
      list.push({ amount: Math.round(amount * 100) / 100, note, at: new Date().toISOString(), by: req.user.id });
    }
    const { rows } = await db.query(
      `UPDATE doc_reconciliation_acts SET manual_adjustments=$2::jsonb, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [actId, JSON.stringify(list)]);
    await audit(db, actId, req.user.id, 'recon_adjustment', { removed: b.remove_at != null });
    return { ok: true, act_id: actId, manual_adjustments: rows[0].manual_adjustments };
  });

  fastify.post('/check-duplicate', auth, async (req) => {
    const hit = await findDup(db, req.body || {});
    if (!hit) return { duplicate: false };
    // N3 (v2, верификатор 16.10): пре-проверка не должна быть оракулом
    // существования чужой строки. Если строка не видна роли — для неё это
    // «дубликата нет»; реальный конфликт всё равно поймает POST/PUT (409,
    // без чужого id) на уровне БД. Иначе перебором пар (поставщик, №) можно
    // узнать, у кого что есть, даже не зная id.
    const visible = await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, hit.id);
    return visible ? { duplicate: true, id: hit.id } : { duplicate: false };
  });

  fastify.post('/export-1c', auth, async (req, reply) => {
    const ids = Array.isArray((req.body || {}).ids)
      ? req.body.ids.map((x) => parseInt(x, 10)).filter((n) => !isNaN(n)) : [];
    const params = [];
    // F2: экспорт обязан уважать видимость (иначе дампит все несвязанные строки любой роли).
    const vis = visibilitySql(params, req.user.role, req.user.id, { scope: req.query && req.query.scope });
    let sql = `SELECT d.id,d.dir,d.invoice_number,d.invoice_date,d.counterparty_name,d.amount_gross,d.amount_net,d.vat_amount,d.work_id,d.onec_id,d.ops_status
               FROM doc_registry d WHERE d.deleted_at IS NULL${vis}`;
    if (ids.length) { params.push(ids); sql += ` AND d.id=ANY($${params.length}::int[])`; }
    else sql += ` AND (d.onec_id IS NULL OR trim(d.onec_id)='')`;
    const { rows } = await db.query(sql + ' ORDER BY d.id', params);
    // S4: CSV formula injection — значения, начинающиеся с =,+,-,@,\t, префиксуем '.
    const esc = (v) => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const head = 'id;dir;invoice_number;invoice_date;counterparty_name;amount_gross;amount_net;vat_amount;work_id;onec_id;ops_status';
    const body = rows.map((r) =>
      [r.id, r.dir, r.invoice_number, r.invoice_date, r.counterparty_name, r.amount_gross, r.amount_net, r.vat_amount, r.work_id, r.onec_id, r.ops_status].map(esc).join(';')
    );
    const csv = [head, ...body].join('\n');
    reply.header('Content-Type', 'application/json; charset=utf-8');
    return { csv, count: rows.length };
  });

  /**
   * Выгрузка реестра в Excel по форме исходного файла «Реестр счетов 2026»
   * (27 колонок). Работает СТРОГО по текущим фильтрам и берёт ВСЕ совпавшие
   * строки (не только загруженную страницу) — «убрали фильтр → все строки».
   */
  fastify.get('/export-xlsx', auth, async (req, reply) => {
    const { where, params } = buildFilters(req.query || {}, req.user && req.user.id, req.user && req.user.role);
    const { rows } = await db.query(`${JOIN_SQL}${where} ORDER BY d.invoice_date NULLS LAST, d.id`, params);

    const vatLabel = (r) => {
      if (r.has_vat === false) return 'нет';
      const rate = r.vat_rate != null ? Number(r.vat_rate) : 0;
      if (!rate) return 'нет';
      return Math.round(rate * 100) + '%';
    };
    const clos = (r, field) => {
      let arr = r.closing_json;
      if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (_) { arr = []; } }
      if (!Array.isArray(arr) || !arr.length) return '';
      const v = arr[0][field];
      return v == null ? '' : v;
    };
    const iso = (v) => (v ? String(v).slice(0, 10) : '');

    const HEADERS = [
      'Ответственный за документы', 'Ответственный за работу', 'Объект', '№ счёта', 'Дата счёта',
      'Сумма', 'НДС', 'Контрагент', 'Контрагент — E-mail', 'Контрагент — Телефон', 'Договор',
      'Дата договора', 'Договор — Скан', 'Договор — Оригинал', 'Для Вити — Состояние',
      'Для Вити — Доставка', 'Для Вити — Срок доставки', 'Для Вити — Комментарий',
      'Назначение закупаемых ТМЦ — На объект Заказчика', 'Назначение закупаемых ТМЦ — Собственность "АСГАРД"',
      'Назначение закупаемых ТМЦ — Расходники', 'Закрывающие документы — Номер',
      'Закрывающие документы — Дата', 'Закрывающие документы — Сумма',
      'Закрывающие документы — Способ получения', 'Акт сверки', 'СРОК ОПЛАТЫ'
    ];
    const yesNo = (b) => (b ? 'да' : '');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Реестр счетов');
    ws.addRow(HEADERS);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    for (const r of rows) {
      ws.addRow([
        r.doc_owner_name || '', r.pm_name || '', r.work_title || '', r.invoice_number || '', iso(r.invoice_date),
        Number(r.amount_gross) || 0, vatLabel(r), r.counterparty_name || '', r.counterparty_email || '', r.counterparty_phone || '',
        r.contract_label || '', iso(r.contract_date), yesNo(r.contract_has_scan), yesNo(r.contract_has_original),
        r.vitya_state || '', r.delivery_note || '', iso(r.delivery_due_at), '',
        yesNo(r.purpose_customer), yesNo(r.purpose_asgard), yesNo(r.purpose_consumables),
        clos(r, 'no'), iso(clos(r, 'date')), clos(r, 'sum') === '' ? '' : Number(clos(r, 'sum')) || 0,
        r.receive_channel || '', r.reconciliation_note || '', iso(r.payment_due_at)
      ]);
    }

    const buf = await wb.xlsx.writeBuffer();
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="doc-registry.xlsx"')
      .header('Cache-Control', 'no-store');
    return reply.send(Buffer.from(buf));
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
      // S2: нельзя писать в чужую строку (write-IDOR) — проверяем видимость.
      if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, docId))) {
        unmatched++; items.push({ id: docId, onec_id: onecId, status: 'forbidden' }); continue;
      }
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
    // S2: dry-run не должен быть оракулом существования чужих строк —
    // показываем только те дубли, что видит текущая роль.
    const res = await excelSvc.dryRun(db, rows);
    if (res && Array.isArray(res.items)) {
      const params = [];
      const vis = visibilitySql(params, req.user.role, req.user.id, { scope: 'all' });
      try {
        const visible = new Set((await db.query(
          `SELECT d.id FROM doc_registry d WHERE d.deleted_at IS NULL${vis}`, params)).rows.map((r) => r.id));
        const hiddenFound = [];
        for (const it of res.items) {
          if (it && it.existing_id && !visible.has(it.existing_id)) { hiddenFound.push(it.existing_id); it.existing_id = null; if (it.action === 'skip-duplicate') it.action = 'needs-manual'; }
        }
        if (hiddenFound.length) res.hidden_duplicates = hiddenFound.length;
      } catch (_) { /* не валим dry-run из-за проверки */ }
    }
    return res;
  });

  fastify.post('/excel/apply', auth, async (req, reply) => {
    const rows = (req.body && req.body.rows) || [];
    if (!Array.isArray(rows)) return reply.code(400).send({ error: 'rows[]' });
    // S2/S4: apply создаёт строки с произвольным doc_owner_id и без санитайза —
    // разрешаем только привилегированным ролям и санитайзим строки.
    if (!canUseScopeAll(req.user.role)) {
      return reply.code(403).send({ error: 'Импорт Excel доступен только офису, бухгалтерии, директорам и админу' });
    }
    const cleaned = rows.map((r) => {
      const o = { ...r };
      for (const k of Object.keys(o)) {
        if (['counterparty_name', 'counterparty_email', 'counterparty_phone', 'comment_text', 'contract_label', 'invoice_number'].includes(k) && typeof o[k] === 'string') {
          o[k] = sanitizeText(o[k]);
        }
      }
      return o;
    });
    return excelSvc.apply(db, cleaned, req.user.id);
  });

  fastify.post('/', auth, async (req, reply) => {
    const b = req.body || {};
    if (!b.dir || !['in', 'out'].includes(b.dir)) return reply.code(400).send({ error: 'invalid_dir', message: 'Не указано направление документа.', hint: 'Выберите «входящий» или «исходящий» и повторите.' });
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
    // D-306c: при создании подпись, если её вписали, принадлежит автору —
    // иначе она стала бы «ничьей» и не показалась бы даже ему.
    if (String(draft.doc_owner_note || '').trim()) draft[OWNER_NOTE_AUTHOR_COL] = req.user.id;
    const dup = await findDup(db, draft);
    if (dup) return reply.code(409).send(await dupBody(db, req, dup));

    const cols = [...Object.keys(draft).filter((k) => WRITE_COLS.includes(k) || k === 'created_by' || k === 'updated_by' || k === OWNER_NOTE_AUTHOR_COL)];
    const vals = cols.map((k) => bindVal(k, draft[k]));
    try {
      const { rows } = await db.query(
        `INSERT INTO doc_registry(${cols.join(',')}) VALUES(${cols.map((k, i) => cast(k, i + 1)).join(',')}) RETURNING *`,
        vals
      );
      await audit(db, rows[0].id, req.user.id, 'create', { id: rows[0].id });
      maybeScheduleParse(fastify, db, rows[0], req.user.id);
      return decorate(rows[0], req.user.id);
    } catch (e) {
      if (e.code === '23505') {
        const again = await findDup(db, draft);
        return reply.code(409).send(await dupBody(db, req, again));
      }
      throw e;
    }
  });

  fastify.get('/:id', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const row = await loadVisibleDoc(req, reply, id);
    if (!row) return reply;
    return decorate(row, req.user.id);
  });

  fastify.put('/:id', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id))) {
      return reply.code(404).send({ error: 'Не найдено' });
    }
    const cur = await db.query('SELECT * FROM doc_registry WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const b = req.body || {};
    const merged = { ...cur.rows[0], ...pickBody(b) };
    if (['amount_gross', 'has_vat', 'vat_rate', 'amount_net', 'vat_amount'].some((k) => b[k] !== undefined)) {
      Object.assign(merged, computeAmounts({ ...cur.rows[0], ...b }));
    }
    Object.assign(merged, calcIncomplete(merged));
    const dup = await findDup(db, { ...merged, excludeId: id });
    if (dup) return reply.code(409).send(await dupBody(db, req, dup));

    const patch = { ...pickBody(b), ...computeAmounts({ ...cur.rows[0], ...b }), ...calcIncomplete(merged), updated_by: req.user.id };
    // D-306c: автор подписи ставится из сессии, а не из тела. Если подпись
    // изменили — автором становится тот, кто изменил (значит, он её и видит).
    // Если подпись не трогали — автора не перезаписываем, иначе одна правка
    // суммы «отбирала» бы у коллеги его собственный список ФИО.
    if (patch.doc_owner_note !== undefined) {
      const nextNote = String(patch.doc_owner_note == null ? '' : patch.doc_owner_note).trim();
      const prevNote = String(cur.rows[0].doc_owner_note == null ? '' : cur.rows[0].doc_owner_note).trim();
      if (nextNote !== prevNote) {
        patch[OWNER_NOTE_AUTHOR_COL] = nextNote ? req.user.id : null;
      }
    }
    const keys = Object.keys(patch);
    if (!keys.length) return decorate(cur.rows[0], req.user.id);
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

      // D-334 (заказчик 21.10.2026): «если объект подставит пользователь —
      // расход автоматически привяжется? Нужно так: сначала проверить, и если
      // такой счёт не привязан, то привязать автоматически».
      //
      // Было: расход создавался ТОЛЬКО при оплате (autoWorkExpense в
      // payment-invoices). Если объект дозаполняли в карточке позже — расход
      // не появлялся до оплаты, а если счёт уже был оплачен без объекта,
      // расход не создавался ВООБЩЕ.
      // Теперь: как только у строки появляется объект, сразу проверяем, есть ли
      // расход по этому счёту, и если нет — создаём/связываем автоматически.
      // Идемпотентно: повторное сохранение второй расход не сделает.
      if (rows[0].work_id && !rows[0].work_expense_id && rows[0].dir === 'in') {
        try {
          await ensureExpenseForDoc(db, fastify.log, rows[0], req.user.id);
          // Перечитываем — мог появиться work_expense_id.
          const fresh = await db.query('SELECT * FROM doc_registry WHERE id=$1', [id]);
          if (fresh.rows[0]) return decorate(fresh.rows[0], req.user.id);
        } catch (e) {
          fastify.log.warn('[doc-registry] ensureExpenseForDoc: ' + (e && e.message));
        }
      }

      // D-335 (заказчик 21.10.2026): «если офис — эти расходы попадают в реестр
      // офисных расходов? их тоже нельзя терять, директору важна картина по
      // компании в целом». Офисный счёт без объекта раньше не попадал никуда:
      // work_expenses создаётся только с work_id, а office_expenses — только
      // вручную. Теперь офисный счёт сразу заводит запись в реестре офисных
      // расходов и связывается с ней. Идемпотентно, дубль по номеру+сумме.
      if (rows[0].spend_kind === 'office' && !rows[0].office_expense_id && rows[0].dir === 'in') {
        try {
          await ensureOfficeExpenseForDoc(db, fastify.log, rows[0], req.user.id);
          const fresh = await db.query('SELECT * FROM doc_registry WHERE id=$1', [id]);
          if (fresh.rows[0]) return decorate(fresh.rows[0], req.user.id);
        } catch (e) {
          fastify.log.warn('[doc-registry] ensureOfficeExpenseForDoc: ' + (e && e.message));
        }
      }
      return decorate(rows[0], req.user.id);
    } catch (e) {
      if (e.code === '23505') {
        const again = await findDup(db, { ...merged, excludeId: id });
        return reply.code(409).send(await dupBody(db, req, again));
      }
      throw e;
    }
  });

  fastify.delete('/:id', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id))) {
      return reply.code(404).send({ error: 'Не найдено' });
    }
    // D-327 (заказчик 21.10.2026): «удалить можно только те позиции, где ты
    // стоишь ответственным за документы». Раньше удаление было доступно лишь
    // складу/корректировкам, а РП — ответственному за строку — нет.
    // Правило: привилегированные роли (ведут реестр) ИЛИ ответственный за
    // документ (doc_owner_id) ИЛИ автор ещё не проведённой строки.
    {
      const who = await db.query(
        'SELECT doc_owner_id, created_by, ops_status FROM doc_registry WHERE id=$1', [id]);
      const row = who.rows[0];
      const r = String(req.user.role || '').toUpperCase();
      const priv = ['ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR', 'OFFICE_MANAGER', 'WAREHOUSE'];
      const isOwner = row && Number(row.doc_owner_id) === Number(req.user.id);
      const isAuthorDraft = row && Number(row.created_by) === Number(req.user.id)
        && ['draft', 'new', ''].includes(String(row.ops_status || ''));
      if (!priv.includes(r) && !isOwner && !isAuthorDraft) {
        return reply.code(403).send({
          error: 'Удалять можно только свои документы',
          hint: 'Строку может удалить её ответственный за документы, автор черновика, склад, бухгалтерия или админ.'
        });
      }
    }
    const {
      assertSafeBillingDelete,
      hardDeleteBillingForDoc
    } = require('../services/doc-registry-upsert');
    const gate = await assertSafeBillingDelete(db, { docId: id });
    if (!gate.ok) return reply.code(gate.code || 409).send({ error: gate.error });
    const { rows } = await db.query(
      `UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW(), updated_by=$2
       WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [id, req.user.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    // F4 full sync: удаление в хабе → hard-delete связанных счёт/акт
    try {
      await hardDeleteBillingForDoc(db, rows[0]);
    } catch (e) {
      fastify.log.warn('[doc-registry] billing hard-delete: ' + (e && e.message));
    }
    await audit(db, id, req.user.id, 'delete', {
      billing_invoice_id: rows[0].billing_invoice_id,
      billing_act_id: rows[0].billing_act_id
    });
    return { ok: true, id };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // D-291 (заказчик 20.10.2026): «И что за архив? туда попадают удалённые
  // строки? и как удалить строку?» — раньше удалять было НЕЛЬЗЯ из интерфейса
  // вовсе, а восстановления не существовало. DELETE делал soft-delete, но
  // строка исчезала навсегда для пользователя.
  // Теперь: корзина со списком удалённых и восстановление одной кнопкой.
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.get('/trash', auth, async (req) => {
    const p = [];
    const vis = visibilitySql(p, req.user.role, req.user.id, { scope: 'all' });
    const { rows } = await db.query(
      `SELECT d.id, d.dir, d.counterparty_name, d.counterparty_inn, d.invoice_number, d.invoice_date,
              d.amount_gross, d.deleted_at, d.doc_owner_id,
              u.name AS owner_name, du.name AS deleted_by_name
         FROM doc_registry d
         LEFT JOIN users u  ON u.id = d.doc_owner_id
         LEFT JOIN users du ON du.id = d.updated_by
        WHERE d.deleted_at IS NOT NULL${vis}
        ORDER BY d.deleted_at DESC
        LIMIT 300`, p);
    return {
      items: rows.map((r) => ({
        id: r.id,
        dir: r.dir,
        counterparty_name: r.counterparty_name,
        counterparty_inn: r.counterparty_inn,
        invoice_number: r.invoice_number,
        invoice_date: r.invoice_date,
        amount_gross: r.amount_gross,
        deleted_at: r.deleted_at,
        owner_name: r.owner_name || null,
        deleted_by_name: r.deleted_by_name || null
      })),
      total: rows.length
    };
  });

  fastify.post('/:id/restore', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    // Строка удалена, поэтому assertDocVisible (он смотрит deleted_at IS NULL)
    // не подходит — проверяем видимость по владельцу/РП вручную.
    const cur = await db.query(
      'SELECT id, doc_owner_id, pm_id, dir, counterparty_name FROM doc_registry WHERE id=$1 AND deleted_at IS NOT NULL',
      [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'В корзине такой строки нет' });
    const fullVis = typeof canUseScopeAll === 'function' && canUseScopeAll(req.user.role);
    const mine = Number(cur.rows[0].doc_owner_id) === Number(req.user.id)
      || Number(cur.rows[0].pm_id) === Number(req.user.id);
    if (!fullVis && !mine) return reply.code(403).send({ error: 'Нет прав на восстановление' });

    const { rows } = await db.query(
      `UPDATE doc_registry SET deleted_at=NULL, updated_by=$2, updated_at=NOW()
        WHERE id=$1 AND deleted_at IS NOT NULL RETURNING id, dir, counterparty_name`,
      [id, req.user.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'В корзине такой строки нет' });
    await audit(db, id, req.user.id, 'restore', {});
    return { ok: true, id, item: rows[0] };
  });

  fastify.post('/:id/upload', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id))) {
      return reply.code(404).send({ error: 'Не найдено' });
    }
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
    // S3: расширение берём из MIME/белого списка (класс D-220), а не из имени клиента —
    // иначе `evil.html`/USER.svg исполнялись бы в домене CRM.
    const { safeStoredExt, safeContentType } = require('../lib/upload-ext');
    const ext = safeStoredExt(filePart.mimetype, filePart.filename, { allow: 'doc' });
    if (!ext) return reply.code(400).send({ error: 'Недопустимый тип файла' });
    if (filePart.buffer.length > 20 * 1024 * 1024) {
      return reply.code(413).send({ error: 'Файл больше 20 МБ' });
    }
    const fname = `doc_${id}_${randomUUID()}${ext}`;
    await fsp.writeFile(path.join(dir, fname), filePart.buffer);
    const url = normPath(`uploads/doc-hub/${fname}`);
    const att = {
      url,
      name: String(metaName || filePart.filename || fname).replace(/[<>"'`]/g, '').slice(0, 200),
      mimetype: safeContentType(ext, filePart.mimetype),
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
    return decorate(rows[0], req.user.id);
  });

  fastify.post('/:id/parse-catalog', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id))) {
      return reply.code(404).send({ error: 'Не найдено' });
    }
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
    // V394: кладовщик отмечает получение СФ по ВСЕЙ входящей почте, а матрица
    // видимости WAREHOUSE сужает его до «складского» (офисные/клиентские строки
    // он не видит) — иначе экран «Входящие СФ» был бы нерабочим (план §9.1).
    // Поэтому для receive_sf проверяем право экрана, а не общую видимость строки.
    if (b.action === 'receive_sf') {
      if (!WH_ROLES.has(req.user.role)) {
        return reply.code(403).send({ error: 'Отмечать получение СФ может только склад, бухгалтерия или админ' });
      }
      const eligible = await db.query(
        `SELECT 1 FROM doc_registry
          WHERE id=$1 AND deleted_at IS NULL AND dir='in'
            AND (ops_status IN ('wait_sf','wait_closing') OR sf_received_at IS NOT NULL) LIMIT 1`, [id]);
      if (!eligible.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    } else if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id))) {
      return reply.code(404).send({ error: 'Не найдено' });
    }
    const { rows: found } = await db.query('SELECT * FROM doc_registry WHERE id=$1 AND deleted_at IS NULL', [id]);
    const doc = found[0];
    if (!doc) return reply.code(404).send({ error: 'Не найдено' });

    // ── Корректировка: запросить / снять (BUH/ADMIN/DIRECTOR_*) ──────────────
    if (b.action === 'correction') {
      // План §12: за фичефлагом. Выключен → старое поведение (действие недоступно).
      if (!(await isTrafficLightEnabled(db))) {
        return reply.code(409).send({ error: 'Корректировки выключены (фичефлаг feature_doc_traffic_light)', disabled: true });
      }
      const corrRoles = new Set(['BUH', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR']);
      if (!corrRoles.has(String(req.user.role || '').toUpperCase())) {
        return reply.code(403).send({ error: 'Запрашивать корректировку может только бухгалтерия, директор или админ' });
      }
      const kind = ['sf', 'act', 'both'].includes(b.kind) ? b.kind : null;
      const isClear = b.clear === true || b.clear === 'true' || b.state === 'resolved';
      if (isClear) {
        const { rows } = await db.query(
          `UPDATE doc_registry SET correction_state='resolved', correction_at=NOW(), correction_by=$2,
             updated_by=$2, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, req.user.id]);
        await audit(db, id, req.user.id, 'correction_resolved', {});
        await notifyDocOwner(db, rows[0], `✅ Корректировка снята: ${docLabel(rows[0])}`);
        return { ok: true, state: 'resolved', doc: decorate(rows[0], req.user.id) };
      }
      const comment = sanitizeText(String(b.comment || '').trim(), 2000);
      if (!kind) return reply.code(400).send({ error: 'Укажите тип корректировки: sf | act | both' });
      if (!comment) return reply.code(400).send({ error: 'Комментарий обязателен: опишите, что именно неверно' });
      const { rows } = await db.query(
        `UPDATE doc_registry SET correction_state='requested', correction_kind=$3, correction_comment=$4,
           correction_at=NOW(), correction_by=$2, updated_by=$2, updated_at=NOW()
         WHERE id=$1 RETURNING *`, [id, req.user.id, kind, comment]);
      await audit(db, id, req.user.id, 'correction_requested', { kind });
      const label = kind === 'both' ? 'СФ и АКТ' : kind === 'act' ? 'АКТ' : 'СФ';
      await notifyDocOwner(db, rows[0], `🚩 ${label} НЕ КОРРЕКТЕН: ${docLabel(rows[0])}`, comment);
      return { ok: true, state: 'requested', kind, doc: decorate(rows[0], req.user.id) };
    }

    // Блокировка действий при незакрытой корректировке.
    const CORR_BLOCKED = ['pay', 'sf', 'mark_paid', 'receive_sf'];
    if (CORR_BLOCKED.includes(b.action) && String(doc.correction_state || '') === 'requested') {
      const kind = doc.correction_kind === 'act' ? 'АКТ' : doc.correction_kind === 'both' ? 'СФ и АКТ' : 'СФ';
      return reply.code(409).send({
        error: `Действие заблокировано: ${kind} помечен как НЕ КОРРЕКТЕН`,
        correction_state: 'requested', correction_kind: doc.correction_kind,
        correction_comment: doc.correction_comment, hint: 'Снимите корректировку после исправления контрагентом.'
      });
    }

    if (b.action === 'pay') {
      // E2/E2b: создать payment_invoices из карточки хаба (не только redirect в пустую очередь)
      //
      // D-363 (заказчик 23.10.2026): «счёт попадает в очередь сам, через заявку;
      // нужно, чтобы два раза не отправить». Защита в ТРИ уровня:
      //   1) у строки уже есть ЖИВАЯ заявка (draft/awaiting_dir/pending_payment/paid)
      //      → НЕ создаём вторую, только переходим к ней. Раньше проверялось лишь
      //      «status !== rejected», но не «а если она уже в оплате?» — кнопка
      //      молча открывала её, и человек думал, что отправил заново.
      //   2) ищем заявку по ДОКУМЕНТУ (doc_registry_id), даже если ссылка в строке
      //      потерялась: так ловим рассинхрон после ручных правок.
      //   3) режим БЕЗ СОГЛАСОВАНИЯ запрещён: нельзя создать сразу pending_payment,
      //      минуя директора — деньги уходят без контроля.
      if (doc.payment_invoice_id) {
        const { rows: existingPay } = await db.query(
          `SELECT id, status FROM payment_invoices WHERE id=$1`,
          [doc.payment_invoice_id]
        );
        if (existingPay[0] && existingPay[0].status !== 'rejected') {
          const st = String(existingPay[0].status || '');
          const redirect = `#/approval-payment?id=${existingPay[0].id}`;
          await audit(db, id, req.user.id, 'quick_pay', { redirect, reused: true, status: st });
          // Говорим ЧЕСТНО, на каком этапе счёт: иначе кажется, что отправили снова.
          const label = {
            draft: 'черновик заявки',
            awaiting_dir: 'на согласовании у директора',
            pending_payment: 'согласовано, ждёт оплаты бухгалтерией',
            paid: 'оплачено'
          }[st] || st;
          return {
            redirect,
            payment_invoice_id: existingPay[0].id,
            reused: true,
            already: true,
            status: st,
            message: `Счёт уже в оплате: ${label}. Вторая заявка не создаётся.`
          };
        }
      }
      // 2) По документу: живая заявка могла остаться без ссылки в строке.
      {
        const { rows: byDoc } = await db.query(
          `SELECT id, status FROM payment_invoices
            WHERE doc_registry_id=$1 AND status NOT IN ('rejected')
            ORDER BY (status='paid') DESC, id DESC LIMIT 1`, [id]).catch(() => ({ rows: [] }));
        if (byDoc[0]) {
          await db.query(`UPDATE doc_registry SET payment_invoice_id=$2, updated_at=NOW()
                           WHERE id=$1 AND payment_invoice_id IS NULL`, [id, byDoc[0].id]).catch(() => {});
          return {
            redirect: `#/approval-payment?id=${byDoc[0].id}`,
            payment_invoice_id: byDoc[0].id,
            reused: true,
            already: true,
            status: byDoc[0].status,
            message: 'Счёт уже в оплате — вторая заявка не создаётся.'
          };
        }
      }
      const amount = num(doc.amount_gross);
      if (!(amount > 0)) {
        return reply.code(400).send({ error: 'Укажите сумму документа перед отправкой на оплату' });
      }
      let filePath = doc.original_path_url || null;
      let fileName = null;
      const atts = attachmentsOf(doc);
      if (atts.length) {
        const a = atts[0];
        const url = typeof a === 'string' ? a : (a && (a.url || a.path));
        if (url) {
          filePath = filePath || url;
          fileName = typeof a === 'object' ? (a.name || a.filename || null) : null;
        }
      }
      if (!filePath) {
        return reply.code(400).send({
          error: 'Прикрепите скан счёта (вложение) перед отправкой на оплату'
        });
      }
      // D-333 (заказчик 21.10.2026): «если стоит расход на проект, но не заполнен
      // сам проект — просим дозаполнить, чтобы расходы не пропустились».
      //
      // Отправка счёта в оплату БЕЗ объекта означала бы: деньги уйдут, а расход
      // в проект не создастся (autoWorkExpense молча возвращал null). Поэтому
      // требуем объект — либо явную отметку, что это не проектный расход.
      {
        const exemptKind = String(doc.spend_kind || '') === 'office';
        const exemptFlag = doc.purpose_asgard === true || doc.purpose_consumables === true;
        if (!doc.work_id && !exemptKind && !exemptFlag) {
          return reply.code(409).send({
            error: 'no_work',
            message: 'Укажите объект (работу) — иначе расход не попадёт в проект',
            hint: 'В карточке документа выберите «Работа / объект». Если расход не проектный — отметьте «Собственность АСГАРД» или «Расходники».',
            code: 'no_work_for_expense'
          });
        }
      }
      const basisType = doc.work_id ? 'work' : (doc.purpose_asgard || doc.purpose_consumables ? 'other' : 'other');
      const basisText = [
        doc.invoice_number ? `Счёт ${doc.invoice_number}` : `Документ #${doc.id}`,
        doc.counterparty_name || null,
        doc.comment_text || null
      ].filter(Boolean).join(' · ');
      // N1 (v2, верификатор 16.10): «захват слота» и вставка заявки — в ОДНОЙ
      // транзакции с блокировкой строки. Прежний вариант (UPDATE ... WHERE
      // payment_invoice_id IS NULL, затем отдельный INSERT и второй UPDATE)
      // не атомарен: пока второй UPDATE не прошёл, конкурентные запросы снова
      // видят payment_invoice_id IS NULL → 2-4 параллельных клика = 2-4 заявки.
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        // Блокируем строку реестра до конца транзакции: конкурент ждёт здесь.
        const locked = await client.query(
          `SELECT id, payment_invoice_id FROM doc_registry
            WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
          [id]
        );
        if (!locked.rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'Не найдено' });
        }
        if (locked.rows[0].payment_invoice_id) {
          await client.query('ROLLBACK');
          const pid = locked.rows[0].payment_invoice_id;
          await audit(db, id, req.user.id, 'quick_pay', { redirect: `#/approval-payment?id=${pid}`, reused: true });
          return { redirect: `#/approval-payment?id=${pid}`, payment_invoice_id: pid, reused: true };
        }
        const { rows: payRows } = await client.query(
          `INSERT INTO payment_invoices(
             status, supplier_name, supplier_id, amount, due_date, file_path, file_name,
             basis_type, basis_text, work_id, procurement_id,
             line_items_json, requires_payment, created_by, pay_timing, doc_registry_id
           ) VALUES (
             'awaiting_dir', $1, $2, $3, $4::date, $5, $6,
             $7, $8, $9, $10,
             $11::jsonb, true, $12, 'immediate', $13
           ) RETURNING *`,
          [
            doc.counterparty_name || null,
            doc.supplier_id || null,
            amount,
            doc.payment_due_at || null,
            filePath,
            fileName,
            basisType,
            basisText,
            doc.work_id || null,
            doc.procurement_id || null,
            JSON.stringify(Array.isArray(doc.parsed_json) ? doc.parsed_json : []),
            req.user.id,
            id
          ]
        );
        const pay = payRows[0];
        await client.query(
          `UPDATE doc_registry SET payment_invoice_id=$2,
             pay_status=CASE WHEN pay_status='paid' THEN pay_status ELSE 'wait' END,
             updated_by=$3, updated_at=NOW() WHERE id=$1`,
          [id, pay.id, req.user.id]
        );
        await client.query('COMMIT');
        const redirect = `#/approval-payment?id=${pay.id}`;
        await audit(db, id, req.user.id, 'quick_pay', { redirect, payment_invoice_id: pay.id, created: true });
        return { redirect, payment_invoice_id: pay.id };
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) { /* уже откатили */ }
        throw e;
      } finally {
        client.release();
      }
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
      return decorate(rows[0], req.user.id);
    }

    if (b.action === 'unmark_sf') {
      // Снять отметку «СФ получена»: убрать закрывающий из closing_json
      // (последний добавленный), вернуть статус «ждём закрывающие».
      let closing = doc.closing_json;
      if (typeof closing === 'string') try { closing = JSON.parse(closing); } catch (_) { closing = []; }
      if (!Array.isArray(closing)) closing = closing ? [closing] : [];
      if (!closing.length) return reply.code(400).send({ error: 'Нет отмеченных закрывающих' });
      const removed = closing.pop();
      const ops = (doc.ops_status === 'done' && !closing.length) ? 'wait_closing' : doc.ops_status;
      const { rows } = await db.query(
        `UPDATE doc_registry SET closing_json=$2::jsonb, ops_status=$3, updated_by=$4, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, JSON.stringify(closing), ops, req.user.id]
      );
      await audit(db, id, req.user.id, 'quick_unmark_sf', { ops, removed: removed || null });
      return decorate(rows[0], req.user.id);
    }

    if (b.action === 'mark_paid') {
      // Ручная отметка «оплачено» — без вложения и без очереди согласования
      // (для старых оплат, где цепочка не нужна).
      const allowed = ['ADMIN', 'BUH', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR'];
      if (!allowed.includes(req.user.role)) {
        return reply.code(403).send({ error: 'Отметить оплату может бухгалтерия, администратор или директор' });
      }
      const { rows } = await db.query(
        `UPDATE doc_registry SET pay_status='paid', ops_status=CASE
           WHEN ops_status IN ('wait_pay','wait_sf','wait_closing','draft') THEN 'done' ELSE ops_status END,
           updated_by=$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [id, req.user.id]
      );
      await audit(db, id, req.user.id, 'quick_mark_paid', { manual: true, note: 'отмечено вручную, без согласования' });
      return decorate(rows[0], req.user.id);
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
      return decorate({ ...rows[0], ...inc }, req.user.id);
    }

    // V394: кладовщик отметил «СФ получена» (первый шаг двухшагового флоу).
    // Отметку получает владелец/бухгалтерия и подтверждает (второй шаг, action=sf).
    if (b.action === 'receive_sf') {
      if (!WH_ROLES.has(req.user.role)) return reply.code(403).send({ error: 'Только склад / бух / admin' });
      const { rows } = await db.query(
        `UPDATE doc_registry SET sf_received_at = COALESCE(sf_received_at, CURRENT_DATE),
           wh_status = CASE WHEN wh_status IN ('none','await') THEN 'received' ELSE wh_status END,
           updated_by=$2, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, req.user.id]
      );
      await audit(db, id, req.user.id, 'wh_receive_sf', {});
      await notifyDocOwner(db, rows[0], `📦 Кладовщик отметил получение СФ: ${docLabel(rows[0])}`,
        'Требуется подтверждение ответственного за документы.');
      return decorate(rows[0], req.user.id);
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
      return decorate(rows[0], req.user.id);
    }

    return reply.code(400).send({ error: 'action: sf|unmark_sf|due|wh|pay|mark_paid' });
  });

  fastify.post('/:id/link-expense', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id))) {
      return reply.code(404).send({ error: 'Не найдено' });
    }
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
    // expense-dedup-object (17.10.2026): ключ `invoice:<id>` ловит дубль между
    // ручной привязкой и авто-расходом после оплаты. Но у старых записей ключ
    // другой (`doc_registry:<id>`) — дополнительно проверяем по работе+сумме+номеру,
    // чтобы не задвоить уже существующий расход.
    // ВАЖНО: у work_expenses НЕТ deleted_at — фильтровать по нему нельзя (упало бы и молча съелось).
    const dup = await db.query(
      `SELECT id FROM work_expenses
        WHERE work_id=$1
          AND COALESCE(source_key,'') <> $2
          AND ABS(amount - $3::numeric) < 0.01
          AND ($4::varchar IS NULL OR doc_number IS NULL OR doc_number = $4)
        LIMIT 1`,
      [doc.work_id, `invoice:${doc.id}`, num(doc.amount_gross) || num(b.amount) || 0, doc.invoice_number || null]
    ).catch(() => ({ rows: [] }));
    if (dup.rows[0]) {
      await db.query(`UPDATE doc_registry SET work_expense_id=$2, updated_by=$3, updated_at=NOW() WHERE id=$1 AND work_expense_id IS NULL`,
        [id, dup.rows[0].id, req.user.id]).catch(() => {});
      await audit(db, id, req.user.id, 'link_expense_found', { work_expense_id: dup.rows[0].id });
      return { work_expense_id: dup.rows[0].id, existing: true, found_by_match: true };
    }
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
      // ЕДИНЫЙ ключ расхода по счёту (см. expense-dedup-object, 17.10.2026):
      // тот же ключ ставит autoWorkExpense после оплаты. Иначе один счёт давал
      // ДВА расхода по объекту (ручная привязка + авто-после-оплаты).
      source_key: `invoice:${doc.id}`,
      status: 'pending',
      created_by: req.user.id,
      // V439: amount_gross — сумма С НДС (см. computeAmounts). Явно фиксируем базу,
      // иначе форма/отчёт угадывают её по контексту и получают расхождение (#406).
      vat_basis: doc.has_vat ? 'gross' : 'net'
    });
    await db.query(`UPDATE doc_registry SET work_expense_id=$2, updated_by=$3, updated_at=NOW() WHERE id=$1`,
      [id, expense.id, req.user.id]);
    await audit(db, id, req.user.id, 'create_expense', { work_expense_id: expense.id });
    return { work_expense_id: expense.id, expense, existing: false };
  });

  /**
   * GET /:id/file — отдать файл строки реестра (счёт, скан, вложение).
   *
   * D-382 (запрос заказчика 27.10.2026: «чтобы он мог скачать счета и
   * документы»). У реестра не было своего роута файла: `/api/doc-registry/:id/file`
   * возвращал 404, потому что такой маршрут есть только у payment-invoices
   * (файл ЗАЯВКИ, не строки реестра). Дима видел строки, но открыть скан
   * не мог.
   *
   * Источник файла, в порядке приоритета:
   *   1. `attachments[0].url` — вложения строки;
   *   2. `original_path_url` — скан счёта, загруженный при создании.
   *
   * Путь проверяется через safeUploadPath: файл обязан лежать внутри uploads/,
   * иначе это чтение произвольного файла сервера от имени сотрудника.
   */
  fastify.get('/:id/file', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Неверный ID' });

    if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id))) {
      return reply.code(404).send({ error: 'Не найдено' });
    }

    const { rows } = await db.query(
      `SELECT id, attachments, original_path_url, invoice_number
         FROM doc_registry WHERE id=$1 AND deleted_at IS NULL`, [id]);
    const doc = rows[0];
    if (!doc) return reply.code(404).send({ error: 'Не найдено' });

    let atts = doc.attachments;
    if (typeof atts === 'string') { try { atts = JSON.parse(atts); } catch (_) { atts = []; } }
    if (!Array.isArray(atts)) atts = [];

    const first = atts.find((a) => a && (a.url || a.path)) || null;
    const url = (first && (first.url || first.path)) || doc.original_path_url;
    if (!url) return reply.code(404).send({ error: 'Файл не приложен' });

    let decoded = String(url);
    try { decoded = decodeURIComponent(url); } catch (_) { /* как есть */ }

    const fsPath = safeUploadPath(decoded, { subdir: 'doc-hub' })
      || safeUploadPath(decoded, { subdir: path.join('doc-hub', 'obs-letters') })
      || safeUploadPath(decoded);
    if (!fsPath) return reply.code(400).send({ error: 'Недопустимый путь к файлу' });
    if (!fs.existsSync(fsPath)) return reply.code(404).send({ error: 'Файл отсутствует на диске' });

    // D-383: выгрузка в Word. Заказчик 27.10.2026: «нужно не только в PDF,
    // но и в Word». PDF нельзя редактировать, а бухгалтерии и юристам часто
    // нужно поправить формулировку или вставить в свой документ, поэтому
    // рядом с PDF отдаём DOCX.
    //
    // Конверсия: PDF → текст (pdftotext) → DOCX (mammoth не умеет собирать,
    // поэтому используем libreoffice: PDF → DOCX напрямую). LibreOffice
    // есть на проде (24.2.7). Файл готовится по запросу и кэшируется рядом
    // с исходником, чтобы не конвертировать один и тот же счёт повторно.
    const wantDocx = String((req.query && req.query.format) || '').toLowerCase() === 'docx';
    if (wantDocx) {
      const basePath = fsPath.replace(/\.[^.]+$/, '');
      const cached = `${basePath}.docx`;
      const docxName = `${path.basename(basePath)}.docx`;

      const sendDocx = (buf) => {
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(docxName)}"`);
        reply.header('X-Asgard-Docx-Note', 'text-only');
        return reply.send(buf);
      };

      // Кэш: повторный запрос того же счёта не конвертируем заново.
      // D-384: письмо для ОБС отдаём с ОФИЦИАЛЬНОГО БЛАНКА (шаблон
      // customer-letter-tpl.docx: логотип, реквизиты, подпись, печать),
      // а не текстом из PDF. Текстовый DOCX остаётся запасным вариантом
      // для счетов поставщиков, у которых нет бланка АСГАРД.
      if (fs.existsSync(cached)) return sendDocx(fs.readFileSync(cached));

      try {
        // Письмо для ОБС: официальный бланк через docxtemplater.
        if (doc.package_type === 'letter' || kind === 'letter') {
          // Для письма нужен РОДИТЕЛЬСКИЙ счёт: у письма package_type='letter',
          // а данные (объект, договор, позиции) — в счёте.
          const parent = (await db.query(
            `SELECT id FROM doc_registry WHERE obs_letter_doc_id = $1 AND deleted_at IS NULL LIMIT 1`,
            [id])).rows[0];
          const srcId = parent ? parent.id : id;
          const { generateObsLetterDocx } = require('../services/obs-letter-docx');
          const buf = await generateObsLetterDocx(db, srcId, {
            number: String(doc.invoice_number || '').replace(/^Исх\.\s*/i, '') || undefined,
          });
          try { fs.writeFileSync(cached, buf); } catch (_) { /* кэш не критичен */ }
          return sendDocx(buf);
        }

        const { pdfToDocxBuffer } = require('../services/pdf-to-docx');
        const buf = pdfToDocxBuffer(fsPath, doc.invoice_number || path.basename(basePath));
        try { fs.writeFileSync(cached, buf); } catch (_) { /* кэш не критичен */ }
        return sendDocx(buf);
      } catch (e) {
        return reply.code(500).send({
          error: 'Не удалось подготовить Word',
          detail: String(e.message || e).slice(0, 200),
        });
      }
    }

    const ext = path.extname(fsPath).toLowerCase();
    const { safeContentType } = require('../lib/upload-ext');
    const ct = safeContentType(ext, null);
    const name = (first && first.name) || path.basename(fsPath);
    reply.header('Content-Type', ct);
    reply.header('Content-Disposition',
      `${ct === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(name)}"`);
    return reply.send(fs.createReadStream(fsPath));
  });

  // ─── D-381: договоры субподряда и лимиты существенности ─────────────────
  //
  // Кто может менять способ оплаты и выбирать договор: бухгалтерия и
  // директора. Объявлено ДО роутов, которые это используют.
  const OBS_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

  // Директор и бухгалтерия должны видеть остаток лимита по каждому договору
  // и выбрать договор ПЕРЕД созданием письма. Если лимит выработан, ОБС по
  // этому договору запрещён — расход идёт другим путём.
  //
  // Почему не хардкод: у АСГАРД два действующих договора с ГСП Ремонт
  // (КР320п26 на 1,5 млн и КР-433п26 на 3 млн), и список будет меняться.
  fastify.get('/subcontracts', auth, async (req) => {
    const workId = parseInt(req.query && req.query.work_id, 10) || null;

    const params = [];
    let where = 'a.is_active = TRUE';
    if (Number.isFinite(workId)) {
      params.push(workId);
      where += ` AND (a.work_id = $${params.length} OR a.work_id IS NULL)`;
    }

    const { rows } = await db.query(
      `SELECT a.id, a.number, a.agreement_date, a.customer_name, a.work_id,
              a.limit_amount, a.currency, a.note,
              s.spent_amount, s.remaining, s.used_pct, s.exhausted
         FROM subcontract_agreements a, subcontract_limit_state(a.id) s
        WHERE ${where}
        ORDER BY a.agreement_date DESC`, params);

    return {
      items: rows.map((r) => ({
        ...r,
        limit_amount: Number(r.limit_amount) || 0,
        spent_amount: Number(r.spent_amount) || 0,
        remaining: Number(r.remaining) || 0,
        used_pct: Number(r.used_pct) || 0,
        exhausted: !!r.exhausted,
      })),
    };
  });

  /**
   * PATCH /:id/subcontract — выбрать договор для строки реестра.
   * body: { subcontract_id: number | null }
   *
   * Выбор делает директор (или бухгалтерия) ДО формирования письма: в письме
   * должно стоять основание конкретного договора, а лимит считается по нему.
   */
  fastify.patch('/:id/subcontract', { preHandler: [fastify.requireRoles(OBS_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });

    const raw = req.body && req.body.subcontract_id;
    const subId = raw === null || raw === undefined || raw === '' ? null : parseInt(raw, 10);
    if (subId !== null && isNaN(subId)) {
      return reply.code(400).send({ error: 'subcontract_id: число или null' });
    }

    if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id))) {
      return reply.code(404).send({ error: 'Не найдено' });
    }

    if (subId !== null) {
      const sc = await db.query(
        `SELECT a.id, a.number, a.limit_amount,
                s.spent_amount, s.remaining, s.exhausted
           FROM subcontract_agreements a, subcontract_limit_state(a.id) s
          WHERE a.id = $1 AND a.is_active = TRUE`, [subId]);
      const a = sc.rows[0];
      if (!a) return reply.code(404).send({ error: 'Договор не найден или неактивен' });

      // Лимит выработан — ОБС по этому договору запрещён.
      if (a.exhausted) {
        return reply.code(409).send({
          error: `Лимит существенности по договору ${a.number} выработан`,
          detail: `Лимит ${a.limit_amount}, использовано ${a.spent_amount}. ОБС по этому договору недоступен.`,
          subcontract_id: a.id,
          exhausted: true,
        });
      }
    }

    const { rows } = await db.query(
      `UPDATE doc_registry SET subcontract_id=$2, updated_by=$3, updated_at=NOW()
        WHERE id=$1 RETURNING id, subcontract_id`,
      [id, subId, req.user.id]);

    await audit(db, id, req.user.id, 'subcontract_set', { subcontract_id: subId });
    return { ok: true, ...rows[0] };
  });

  // РП, офис, инициатор счёта — не могут: это выбор платёжного контура,
  // а не свойство заявки. Каждая смена пишется в аудит, чтобы на вопрос
  // «кто переключил на ОБС» был ответ с именем и временем.
  // (OBS_ROLES объявлен выше, в блоке D-381 — он нужен и там.)

  /**
   * GET /:id/letter-file — отдать PDF письма для ОБС.
   *
   * D-378 (дефект от верификатора 25.10.2026): фронт открывал
   * `/api/doc-registry/:id/file`, но такого роута не было — 404. Плюс
   * `window.open` не передаёт Bearer-токен, поэтому нужен не прямой URL,
   * а blob через fetch с заголовком.
   *
   * Отдаём файл ACL-роутом: проверяем видимость документа и что запрошенный
   * документ — действительно письмо (package_type='letter'), а не любая
   * строка реестра. Путь берём из attachments[0].url и валидируем, что он
   * лежит внутри uploads/ (защита от path traversal).
   */
  fastify.get('/:id/letter-file', auth, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Неверный ID' });

    // D-378 (дефект от верификатора 25.10.2026): проверка видимости по САМОМУ
    // письму не пускала бухгалтерию — письмо создаётся от имени инициатора
    // (PM), у него doc_owner_id пустой, и BUH получал 404 на собственном
    // документе. Правильно: если человек видит СЧЁТ, он видит и его письмо.
    // Поэтому видимость проверяем по счёту-родителю; прямое письмо без
    // родителя — по обычной матрице.
    const parent = await db.query(
      `SELECT id FROM doc_registry
        WHERE obs_letter_doc_id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
    const parentId = parent.rows[0] && parent.rows[0].id;

    const ctx = { role: req.user.role, userId: req.user.id };
    const visible = parentId
      ? await assertDocVisible(db, ctx, parentId)
      : await assertDocVisible(db, ctx, id);
    if (!visible) return reply.code(404).send({ error: 'Не найдено' });

    const { rows } = await db.query(
      `SELECT id, package_type, attachments, original_path_url, invoice_number
         FROM doc_registry WHERE id=$1 AND deleted_at IS NULL`, [id]);
    const doc = rows[0];
    if (!doc) return reply.code(404).send({ error: 'Не найдено' });
    if (doc.package_type !== 'letter') {
      return reply.code(400).send({ error: 'Это не письмо для ОБС' });
    }

    let atts = doc.attachments;
    if (typeof atts === 'string') { try { atts = JSON.parse(atts); } catch (_) { atts = []; } }
    if (!Array.isArray(atts)) atts = [];
    const first = atts[0] || null;
    const url = (first && (first.url || first.path)) || doc.original_path_url;
    if (!url) return reply.code(404).send({ error: 'Файл письма не найден' });

    // D-378: url в attachments хранится как публичный адрес и содержит
    // кириллицу в percent-encoding (`%D0%9E%D0%91%D0%A1_...`). Файловая
    // система работает с настоящими именами, поэтому декодируем — иначе
    // safeUploadPath ищет файл с литеральным «%D0%9E» и не находит его.
    let decoded = String(url);
    try { decoded = decodeURIComponent(url); } catch (_) { /* оставляем как есть */ }

    // Файл обязан лежать внутри uploads/ — иначе это попытка прочитать
    // произвольный файл сервера от имени сотрудника.
    const fsPath = safeUploadPath(decoded, { subdir: path.join('doc-hub', 'obs-letters') })
      || safeUploadPath(decoded, { subdir: 'doc-hub' });
    if (!fsPath) return reply.code(400).send({ error: 'Недопустимый путь к файлу' });

    // D-384: Word для письма ОБС — с ОФИЦИАЛЬНОГО БЛАНКА, а не текст из PDF.
    // Заказчик 27.10.2026: «нужен нормальный ворд, как шаблон Димы 1в1 на оф
    // бланке с логотипом». Шаблон — templates/customer-letter-tpl.docx,
    // тот же, что у всей исходящей переписки: логотип, реквизиты, подпись.
    const wantDocx = String((req.query && req.query.format) || '').toLowerCase() === 'docx';
    if (wantDocx) {
      const srcId = parentId || id;
      try {
        const { generateObsLetterDocx } = require('../services/obs-letter-docx');
        const buf = await generateObsLetterDocx(db, srcId, {
          number: String(doc.invoice_number || '').replace(/^Исх\.\s*/i, '') || undefined,
        });
        const base = String((first && first.name) || path.basename(fsPath)).replace(/\.[^.]+$/, '');
        const docxName = /\.docx$/i.test(base) ? base : `${base}.docx`;
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(docxName)}"`);
        return reply.send(buf);
      } catch (e) {
        return reply.code(500).send({
          error: 'Не удалось подготовить Word',
          detail: String(e.message || e).slice(0, 200),
        });
      }
    }

    if (!fs.existsSync(fsPath)) return reply.code(404).send({ error: 'Файл отсутствует на диске' });

    const { safeContentType } = require('../lib/upload-ext');
    const ct = safeContentType('.pdf', null);
    const name = (first && first.name) || path.basename(fsPath);
    reply.header('Content-Type', ct);
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    return reply.send(fs.createReadStream(fsPath));
  });

  // Способ оплаты меняют ТОЛЬКО бухгалтерия и директора (решение 24.10.2026).

  /**
   * PATCH /:id/payment-source — сменить способ оплаты.
   * body: { payment_source: 'regular' | 'obs' }
   *
   * При 'regular' письмо не требуется: статус письма сбрасывается в 'none',
   * ссылка на письмо НЕ стирается — если письмо уже сформировано, оно остаётся
   * в карточке как документ, просто перестаёт быть обязательным.
   */
  fastify.patch('/:id/payment-source', { preHandler: [fastify.requireRoles(OBS_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });

    const src = String((req.body && req.body.payment_source) || '').toLowerCase();
    if (src !== 'regular' && src !== 'obs') {
      return reply.code(400).send({ error: "payment_source: 'regular' | 'obs'" });
    }

    if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id))) {
      return reply.code(404).send({ error: 'Не найдено' });
    }

    const found = await db.query(
      'SELECT id, payment_source, obs_letter_status, obs_letter_doc_id FROM doc_registry WHERE id=$1 AND deleted_at IS NULL', [id]);
    const doc = found.rows[0];
    if (!doc) return reply.code(404).send({ error: 'Не найдено' });

    const prev = doc.payment_source || 'regular';
    if (prev === src) {
      return { ok: true, payment_source: src, changed: false, obs_letter_status: doc.obs_letter_status };
    }

    // D-378 (дефект от верификатора 25.10.2026): при уходе на 'regular' статус
    // становился 'none', и при возврате на 'obs' восстановить 'ready' было
    // нельзя — плашка показывала «Письма нет» при живом письме в реестре и
    // предлагала сделать дубль.
    //
    // Теперь состояние письма НЕ зависит от текущего способа оплаты: если
    // письмо реально существует (obs_letter_doc_id указывает на живую строку),
    // статус остаётся 'ready' независимо от того, что выбрано сейчас.
    let hasLiveLetter = false;
    if (doc.obs_letter_doc_id) {
      const l = await db.query(
        'SELECT id FROM doc_registry WHERE id=$1 AND deleted_at IS NULL AND package_type=$2',
        [doc.obs_letter_doc_id, 'letter']);
      hasLiveLetter = !!l.rows[0];
    }

    const nextLetterStatus = hasLiveLetter
      ? 'ready'
      : (doc.obs_letter_status === 'generating' ? 'generating' : 'none');

    const { rows } = await db.query(
      `UPDATE doc_registry
          SET payment_source=$2, obs_letter_status=$3, updated_by=$4, updated_at=NOW()
        WHERE id=$1 RETURNING id, payment_source, obs_letter_status, obs_letter_doc_id`,
      [id, src, nextLetterStatus, req.user.id]);

    await audit(db, id, req.user.id, 'payment_source', { from: prev, to: src });

    return { ok: true, changed: true, ...rows[0] };
  });

  /**
   * POST /:id/obs-letter — сформировать (или пересобрать) письмо для ОБС.
   *
   * Отвечает СРАЗУ: генерация PDF занимает секунды, и держать запрос всё это
   * время нельзя — UI показывает серую плашку «Формируется…» и опрашивает
   * GET /:id. Так же ведёт себя согласование директора.
   *
   * Идемпотентность: повторный вызов при статусе 'generating' не запускает
   * вторую генерацию (иначе два Chrome-процесса на один и тот же документ).
   */
  // D-378: POST без тела. Fastify на уровне проекта отвечает 400
  // FST_ERR_CTP_EMPTY_JSON_BODY, если пришёл content-type: application/json
  // с пустым телом — схема роута это не переопределяет. Поэтому фронт
  // обязан слать хотя бы «{}» (см. doc-hub.js: api(..., { method:'POST' })
  // без body → шлём {}). Здесь оставляем схему-«разрешение» на случай,
  // если клиент придёт без тела вовсе.
  fastify.post('/:id/obs-letter', {
    preHandler: [fastify.requireRoles(OBS_ROLES)],
    schema: { body: { type: 'object', additionalProperties: true, nullable: true } },
  }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });

    if (!(await assertDocVisible(db, { role: req.user.role, userId: req.user.id }, id))) {
      return reply.code(404).send({ error: 'Не найдено' });
    }

    const found = await db.query(
      `SELECT id, invoice_number, payment_source, obs_letter_status, obs_letter_doc_id, subcontract_id
         FROM doc_registry WHERE id=$1 AND deleted_at IS NULL`, [id]);
    const doc = found.rows[0];
    if (!doc) return reply.code(404).send({ error: 'Не найдено' });

    if (doc.obs_letter_status === 'generating') {
      return { status: 'generating', already: true };
    }

    // Обычный счёт: письмо не требуется. Не запускаем генерацию молча —
    // говорим прямо, чтобы пользователь не ждал плашку, которой не будет.
    if (doc.payment_source !== 'obs') {
      return reply.code(409).send({
        error: 'Счёт оплачивается с расчётного счёта — письмо ОБС не требуется',
        hint: "Сначала переключите способ оплаты на 'obs'",
      });
    }

    // D-381: лимит существенности. Если договор выбран и лимит выработан —
    // ОБС запрещён, письмо не формируем. Проверяем ДО захвата, чтобы не
    // оставить документ в статусе «Формируется…» навсегда.
    if (doc.subcontract_id) {
      const lim = await db.query(
        `SELECT s.exhausted, s.remaining, a.number, a.limit_amount, s.spent_amount
           FROM subcontract_agreements a, subcontract_limit_state(a.id) s
          WHERE a.id = $1`, [doc.subcontract_id]);
      const L = lim.rows[0];
      if (L && L.exhausted) {
        return reply.code(409).send({
          error: `Лимит существенности по договору ${L.number} выработан`,
          detail: `Лимит ${L.limit_amount} руб., использовано ${L.spent_amount} руб. ОБС недоступен.`,
          exhausted: true,
        });
      }
    }

    // D-378 (P2 от верификатора 25.10.2026): здесь был SELECT → UPDATE без
    // условия. Два одновременных клика «Сформировать» оба проходили проверку
    // и запускали ДВА Chrome, плодя письма-дубли. Теперь захват — атомарный:
    // статус переводится в 'generating' ТОЛЬКО если письма ещё нет и
    // генерация не идёт. Если строка не обновилась — второй вызов уходит.
    //
    // D-378 (второй раунд, P2 от третьего верификатора): условие
    // `obs_letter_doc_id = 0` блокировало пересборку НАВСЕГДА, если ссылка
    // осталась на удалённое письмо (soft-delete). Пользователь видел вечное
    // «Формируется…», второе нажатие возвращало already:true, выхода через
    // интерфейс не было. Теперь мёртвая ссылка (письмо удалено/не существует)
    // считается отсутствующей — пересборка разрешена.
    const claim = await db.query(
      `UPDATE doc_registry
          SET obs_letter_status='generating', obs_letter_error=NULL,
              updated_by=$2, updated_at=NOW()
        WHERE id=$1
          AND COALESCE(obs_letter_status, 'none') <> 'generating'
          AND (
                COALESCE(obs_letter_doc_id, 0) = 0
                OR NOT EXISTS (
                     SELECT 1 FROM doc_registry l
                      WHERE l.id = doc_registry.obs_letter_doc_id
                        AND l.deleted_at IS NULL
                   )
              )
        RETURNING id`, [id, req.user.id]);

    if (!claim.rowCount) {
      return { status: 'generating', already: true };
    }

    await audit(db, id, req.user.id, 'obs_letter_start', {});
    const obsLetter = require('../services/obs-letter');
    const fastifyRef = fastify;
    const docId = id;
    const userId = req.user.id;

    // Запускаем в фоне и НЕ ждём: ответ уже ушёл в UI.
    setImmediate(async () => {
      try {
        const res = await obsLetter.generateObsLetterPdf(fastifyRef.db || fastifyRef.pg, docId);

        // Письмо живёт в том же реестре отдельной строкой (dir='out'),
        // чтобы попасть в карточку вложением и в общую нумерацию исходящих.
        const ins = await fastifyRef.db.query(
          `INSERT INTO doc_registry
             (dir, package_type, ops_status, pay_status, counterparty_name,
              amount_gross, amount_net, vat_amount, vat_rate, has_vat,
              spend_kind, created_by, updated_by, receive_channel, comment_text,
              invoice_number, invoice_date, attachments)
           VALUES
             ('out','letter','done','n_a',$1,
              0,0,0,0,false,
              'work',$2,$2,'manual',$3,
              $4,$5,$6)
           RETURNING id`,
          [
            'Для ОБС по счёту № ' + (doc.invoice_number || docId),
            userId,
            'Письмо для оплаты через ОБС по счёту № ' + (doc.invoice_number || docId),
            'Исх. ' + res.number,
            new Date(),
            // D-378: в attachments — ПУБЛИЧНЫЙ url (/uploads/...), а не
            // абсолютный путь на диске. Абсолютный путь nginx не раздаёт,
            // поэтому клик по письму открывал SPA-заглушку вместо PDF.
            JSON.stringify([{ name: res.fileName, url: res.url, kind: 'obs_letter' }]),
          ]
        );
        const letterDocId = ins.rows[0] && ins.rows[0].id;

        await fastifyRef.db.query(
          `UPDATE doc_registry
              SET obs_letter_status='ready', obs_letter_doc_id=$2, obs_letter_error=NULL, updated_at=NOW()
            WHERE id=$1`, [docId, letterDocId || null]);

        await audit(fastifyRef.db, docId, userId, 'obs_letter_ready',
          { letter_doc_id: letterDocId, number: res.number, url: res.url });
        fastifyRef.log.info(`[obs-letter] готово: doc=${docId} письмо=${letterDocId} №${res.number}`);
      } catch (e) {
        const msg = String(e && e.message || e).slice(0, 500);
        fastifyRef.log.error(`[obs-letter] сбой doc=${docId}: ${msg}`);
        try {
          await fastifyRef.db.query(
            `UPDATE doc_registry SET obs_letter_status='failed', obs_letter_error=$2, updated_at=NOW()
              WHERE id=$1`, [docId, msg]);
          await audit(fastifyRef.db, docId, userId, 'obs_letter_failed', { error: msg });
        } catch (e2) {
          fastifyRef.log.error(`[obs-letter] не смог записать статус сбоя: ${e2.message}`);
        }
      }
    });

    return { status: 'generating', id };
  });
};
