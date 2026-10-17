'use strict';

/**
 * V398 (Часть II): оркестратор intake — письмо со счётом → заявка + реестр.
 * ═══════════════════════════════════════════════════════════════════════════
 * Конвейер: email (+вложения) → OCR/vision → extractInvoice → антидубль →
 *   doc_email_intake → doc_registry («дозаполнить») → payment_invoices(awaiting_dir).
 *
 * Инварианты:
 *   • каждый счёт письма — ОТДЕЛЬНАЯ запись (N вложений = N заявок);
 *   • антидубль в 3 слоя: (1) UNIQUE doc_email_intake(email_id,attachment_id);
 *     (2) совпадение с уже существующим doc_registry → только СВЯЗАТЬ;
 *     (3) UNIQUE payment_invoices.doc_registry_id;
 *   • низкая уверенность разбора → не создаём платёж, помечаем needs_manual;
 *   • реестр — со статусом «дозаполнить» (is_incomplete = true там, где нужно).
 */

const { extractInvoice } = require('./invoice-extract');
const { classifyDocument } = require('./doc-classifier');

/** Порог уверенности (настройка email_parse_confidence_min, fallback 0.7). */
async function confidenceMin(db) {
  try {
    const r = await db.query(`SELECT value_json FROM settings WHERE key='email_parse_confidence_min' LIMIT 1`);
    if (r.rows[0]) { let v = r.rows[0].value_json; try { v = JSON.parse(v); } catch (_) {} const n = parseFloat(v); if (Number.isFinite(n)) return n; }
  } catch (_) {}
  return 0.7;
}

/** Ссылка на email/attachment (можно передать как id, так и объекты). */
function ids(email, attachment) {
  return {
    emailId: email && (email.id || email) || null,
    attachmentId: attachment && (attachment.id || attachment) || null
  };
}

/**
 * Обработать одно вложение-счёт.
 * @param {object} db
 * @param {{email:object, attachment:object, text:string, userId?:number, dryRun?:boolean}} opts
 */
async function intakeOne(db, { email, attachment, text, userId = null, dryRun = false }) {
  const { emailId, attachmentId } = ids(email, attachment);
  // Замечание заказчика 17.10: в папке были НЕ только счета (сертификаты,
  // заявки, счёта-договоры). Сначала определяем ТИП — платёжные документы
  // идут в заявку и реестр, остальное НЕ попадает в очередь оплаты.
  const cls = classifyDocument(text || '');
  const parsed = extractInvoice(text || '');
  parsed._kind = cls.kind;
  parsed._is_invoice = cls.is_invoice;
  const confMin = await confidenceMin(db);

  // Не счёт (сертификат/акт/договор/УПД/накладная) — не создаём заявку.
  if (!cls.is_invoice && cls.kind !== 'unknown') {
    if (dryRun) return { status: 'skipped', kind: cls.kind, parsed, dry_run: true };
    // Пишем в журнал как «не счёт» (для отладки), без заявки и реестра.
    if (emailId && attachmentId) {
      await db.query(
        `INSERT INTO doc_email_intake(email_id, attachment_id, status, parse_raw, error)
         VALUES ($1,$2,'rejected',$3::jsonb,$4)
         ON CONFLICT (email_id, attachment_id) WHERE email_id IS NOT NULL AND attachment_id IS NOT NULL
         DO NOTHING`, [emailId, attachmentId, JSON.stringify(parsed), 'not_invoice:' + cls.kind]);
    }
    return { status: 'not_invoice', kind: cls.kind, matched_rule: cls.reason, parsed };
  }

  // Слой 1: уже обрабатывали эту пару письмо+вложение?
  if (emailId && attachmentId) {
    const seen = await db.query(
      `SELECT id, doc_id, payment_invoice_id FROM doc_email_intake WHERE email_id=$1 AND attachment_id=$2`,
      [emailId, attachmentId]);
    if (seen.rows[0]) {
      return { status: 'already', intake_id: seen.rows[0].id, doc_id: seen.rows[0].doc_id, payment_invoice_id: seen.rows[0].payment_invoice_id, parsed };
    }
  }

  const lowConfidence = parsed.confidence < confMin || (parsed.amount_gross == null);
  if (dryRun) return { status: lowConfidence ? 'needs_manual' : 'ok', parsed, dry_run: true };

  // Слой 2: есть ли уже такая строка в реестре (по ИНН+номер+дата+сумма)?
  let docId = null;
  if (parsed.invoice_number && parsed.amount_gross != null) {
    const dupParams = [parsed.amount_gross];
    let dupWhere = `deleted_at IS NULL AND amount_gross=$1 AND dir='in'`;
    if (parsed.invoice_number) { dupParams.push(String(parsed.invoice_number).toLowerCase()); dupWhere += ` AND lower(trim(coalesce(invoice_number,''))) = $${dupParams.length}`; }
    if (parsed.inn) { dupParams.push(parsed.inn); dupWhere += ` AND counterparty_inn = $${dupParams.length}`; }
    const dup = await db.query(`SELECT id FROM doc_registry WHERE ${dupWhere} LIMIT 1`, dupParams);
    if (dup.rows[0]) docId = dup.rows[0].id;
  }

  let createdDoc = false;
  if (!docId) {
    // counterparty_name/amount_gross NOT NULL — при неудачном разборе подставляем
    // читаемые заглушки, чтобы строка всё равно попала в реестр (needs_manual).
    const cpName = parsed.counterparty_name || (parsed.inn ? ('ИНН ' + parsed.inn) : 'Контрагент не распознан');
    const gross = parsed.amount_gross != null ? parsed.amount_gross : 0;
    const net = parsed.amount_net != null ? parsed.amount_net : gross;
    const vat = parsed.vat_amount != null ? parsed.vat_amount : 0;
    // Ищем поставщика по ИНН — чтобы в заявке/модалке были реквизиты для платёжки.
    let supplierId = null;
    if (parsed.inn) {
      try {
        const s = await db.query(`SELECT id FROM suppliers WHERE inn=$1 AND deleted_at IS NULL LIMIT 1`, [parsed.inn]);
        if (s.rows[0]) {
          supplierId = s.rows[0].id;
          // Если в карточке нет банковских реквизитов — заполняем из распознанного
          // счёта (иначе бухгалтеру нечего копировать в платёжку).
          const patch = [];
          const pv = [];
          if (parsed.bik) { pv.push(parsed.bik); patch.push(`bik = COALESCE(NULLIF(bik,''), $${pv.length})`); }
          if (parsed.rs) { pv.push(parsed.rs); patch.push(`rs = COALESCE(NULLIF(rs,''), $${pv.length})`); }
          if (parsed.ks) { pv.push(parsed.ks); patch.push(`ks = COALESCE(NULLIF(ks,''), $${pv.length})`); }
          if (parsed.bank_name) { pv.push(parsed.bank_name); patch.push(`bank_name = COALESCE(NULLIF(bank_name,''), $${pv.length})`); }
          if (patch.length) {
            pv.push(supplierId);
            await db.query(`UPDATE suppliers SET ${patch.join(', ')}, updated_at=NOW() WHERE id=$${pv.length}`, pv).catch(() => {});
          }
        }
      } catch (_) { /* не критично */ }
    }
    const insDoc = await db.query(
      `INSERT INTO doc_registry(dir, package_type, ops_status, pay_status, invoice_number, invoice_date,
         counterparty_name, counterparty_inn, supplier_id, amount_gross, amount_net, vat_amount, has_vat,
         spend_kind, doc_owner_id, created_by, updated_by, receive_channel, comment_text)
       VALUES ('in','invoice','wait_sf','wait',$1,$2::date,$3,$4,$5,$6,$7,$8,$9,
               'other',$10,$10,$10,'email',$11) RETURNING id`,
      [parsed.invoice_number, parsed.invoice_date, cpName, parsed.inn, supplierId,
        gross, net, vat, parsed.has_vat !== false,
        userId, lowConfidence ? 'Требует ручной проверки (низкая уверенность разбора)' : null]);
    docId = insDoc.rows[0].id;
    createdDoc = true;
    // Запоминаем supplier_id для заявки.
    if (supplierId) parsed._supplierId = supplierId;
  }

  // Заявка на оплату — только при приемлемой уверенности.
  let paymentId = null;
  if (!lowConfidence) {
    const existPay = await db.query(`SELECT id FROM payment_invoices WHERE doc_registry_id=$1`, [docId]);
    if (existPay.rows[0]) {
      paymentId = existPay.rows[0].id;
    } else {
      const basis = parsed.invoice_number
        ? `Счёт ${parsed.invoice_number}${parsed.invoice_date ? ' от ' + parsed.invoice_date : ''}`
        : 'Счёт из письма';
      const insPay = await db.query(
        `INSERT INTO payment_invoices(status, payment_status, supplier_name, supplier_id, amount, requires_payment,
           created_by, pay_timing, basis_type, basis_text, doc_registry_id, source_email_id, source_attachment_id)
         VALUES ('awaiting_dir','awaiting_dir',$1,$2,$3,true,$4,'immediate','other',$5,$6,$7,$8) RETURNING id`,
        [parsed.counterparty_name, parsed._supplierId || null, parsed.amount_gross, userId || 1, basis, docId, emailId, attachmentId]);
      paymentId = insPay.rows[0].id;
      // TTL 72ч.
      try { require('./doc-approval-ttl').stampExpiry(db, paymentId); } catch (_) {}
      // Обратная связь в реестре: строка ↔ заявка (иначе карточка и архив не видят оплату).
      try {
        await db.query(`UPDATE doc_registry SET payment_invoice_id=$2, updated_at=NOW() WHERE id=$1 AND payment_invoice_id IS NULL`, [docId, paymentId]);
      } catch (_) { /* не критично */ }
    }
  }

  // Слой 3: журнал intake (UNIQUE email+attachment ловит гонку).
  // ВАЖНО: индекс частичный (WHERE ... IS NOT NULL) — ON CONFLICT обязан
  // повторять это условие, иначе Postgres не сопоставит индекс.
  const journal = await db.query(
    `INSERT INTO doc_email_intake(email_id, attachment_id, doc_id, payment_invoice_id, counterparty_inn,
       invoice_number, invoice_date, amount_gross, parse_confidence, parse_raw, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10::jsonb,$11)
     ON CONFLICT (email_id, attachment_id) WHERE email_id IS NOT NULL AND attachment_id IS NOT NULL
     DO NOTHING RETURNING id`,
    [emailId, attachmentId, docId, paymentId, parsed.inn, parsed.invoice_number, parsed.invoice_date,
      parsed.amount_gross, parsed.confidence, JSON.stringify(parsed),
      lowConfidence ? 'needs_manual' : 'parsed']);

  return {
    status: lowConfidence ? 'needs_manual' : 'created',
    intake_id: journal.rows[0] ? journal.rows[0].id : null,
    doc_id: docId, created_doc: createdDoc, payment_invoice_id: paymentId, parsed
  };
}

/**
 * Обработать письмо целиком: каждый счёт — отдельная запись.
 * @param {Array<{attachment:object, text:string}>} invoices — по одному на вложение-счёт
 */
async function intakeEmail(db, { email, invoices, userId = null }) {
  const results = [];
  for (const inv of (invoices || [])) {
    results.push(await intakeOne(db, { email, attachment: inv.attachment, text: inv.text, userId }));
  }
  const created = results.filter((r) => r.status === 'created').length;
  const needsManual = results.filter((r) => r.status === 'needs_manual').length;
  const already = results.filter((r) => r.status === 'already').length;
  return { count: results.length, created, needs_manual: needsManual, already, results };
}

module.exports = { intakeOne, intakeEmail, confidenceMin };
