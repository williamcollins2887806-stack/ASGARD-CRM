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

const { extractInvoice, extractInvoiceLines } = require('./invoice-extract');
const { classifyDocument } = require('./doc-classifier');
const { parsePaymentIntent, parseDeliveryHint } = require('./payment-intent');
const { matchContract, matchWork } = require('./contract-match');
const { enrichCatalogFromLines } = require('./catalog-from-invoice');

/** Порог уверенности (настройка email_parse_confidence_min, fallback 0.7). */
async function confidenceMin(db) {
  try {
    const r = await db.query(`SELECT value_json FROM settings WHERE key='email_parse_confidence_min' LIMIT 1`);
    if (r.rows[0]) { let v = r.rows[0].value_json; try { v = JSON.parse(v); } catch (_) {} const n = parseFloat(v); if (Number.isFinite(n)) return n; }
  } catch (_) {}
  return 0.7;
}

/**
 * V408: объект из ТЕМЫ письма. Инициаторы пишут «МЛСП, Замена факельного оголовка:
 * счет от WILDBERRIES», а в самом счёте объекта нет (Wildberries/Ozon его не пишут).
 * Берём часть темы ДО служебных «хвостов» (счёт/счет/оплата/№/от) и отбрасываем
 * префиксы пересылки (Fwd:/Re:/FW:). Если осмысленного текста нет — null.
 * @param {string} subject
 * @returns {string|null}
 */
function extractWorkHintFromSubject(subject) {
  let s = String(subject || '').trim();
  if (!s) return null;
  // Снимаем префиксы пересылки/ответа (их может быть несколько).
  s = s.replace(/^\s*((fwd?|fw|re|пересылка|ответ)\s*:\s*)+/i, '').trim();
  // Обрезаем служебный хвост: «: счет от …», «— счёт №…», «оплата по счёту…».
  s = s.split(/\s*[:—–-]\s*(?:сч[её]т|оплат|invoice|плат[её]ж)/i)[0];
  // И просто «, счет от WILDBERRIES» без двоеточия.
  s = s.split(/\s+сч[её]т\b/i)[0];
  s = s.replace(/[.,;:]+$/g, '').trim();
  // Отбрасываем мусор и слишком короткие строки.
  if (s.length < 3) return null;
  if (/^(сч[её]т|оплата|invoice|без темы|no subject)$/i.test(s)) return null;
  return s.slice(0, 160);
}

/**
 * V407: определить инициатора заявки по адресу отправителя.
 *
 * Зачем: раньше во всех путях стояло `userId || 1` → ответственным за документ
 * становился ADMIN, хотя письмо послал РП. Заказчик 18.10.2026: «это почта РП
 * Андросова, по логике он должен быть ответственным за доки».
 *
 * ВАЖНО: одна и та же почта может быть у НЕСКОЛЬКИХ пользователей (в тестовой БД
 * `n.androsov@asgard-service.com` есть у ADMIN, FIELD_WORKER и HEAD_TO).
 * Поэтому выбор детерминированный и осмысленный:
 *   1) пользователь с этой почтой, на которого заведены РАБОТЫ (pm_id) — он и есть РП;
 *   2) иначе — самый «профильный» по роли (PM/HEAD_PM/PROC/TO → BUH → остальные);
 *   3) иначе — самый ранний (самый старый аккаунт: обычно это основной сотрудник).
 * Ничего не выдумываем: если почта чужая (внешний поставщик) — вернём null,
 * и вызывающий код решит сам (заявку всё равно создадим).
 */
async function resolveSenderUserId(db, email) {
  let from = String((email && (email.from_email || email.from)) || '').trim().toLowerCase();
  // Подстраховка: объект письма может прийти без адреса отправителя (разные пути
  // вызова передают то `email`, то только `email.id`). Тогда читаем из БД —
  // иначе инициатор молча свалится в fallback и им станет админ.
  if (!from && email && email.id) {
    try {
      const r = await db.query(`SELECT from_email FROM emails WHERE id=$1`, [email.id]);
      if (r.rows[0]) from = String(r.rows[0].from_email || '').trim().toLowerCase();
    } catch (_) { /* нет письма — работаем как есть */ }
  }
  const addr = (from.match(/<([^>]+)>/) || [null, from])[1];
  if (!addr || !addr.includes('@')) return null;
  try {
    // V410: сначала таблица алиасов (почта → пользователь). Сюда попадают
    // нестандартные адреса: корпоративные алиасы (pd@ = Путков) и личные почты
    // сотрудников. Заполняется автоматически при переназначении ответственного.
    const al = await db.query(
      `SELECT user_id FROM user_email_aliases WHERE lower(email)=$1 AND user_id IS NOT NULL LIMIT 1`,
      [addr]);
    if (al.rows[0]) return al.rows[0].user_id;
    // 1) корпоративная почта пользователя;
    const { rows } = await db.query(
      `SELECT u.id, u.role,
              (SELECT count(*) FROM works w WHERE w.pm_id = u.id AND w.deleted_at IS NULL) AS works_cnt
         FROM users u
        WHERE lower(u.email) = $1 AND u.is_active IS NOT FALSE
        ORDER BY works_cnt DESC, u.id ASC
        LIMIT 10`,
      [addr]
    );
    if (rows.length) {
      const owner = rows.find((r) => Number(r.works_cnt) > 0);
      if (owner) return owner.id;
      const byRole = ['PM', 'HEAD_PM', 'PROC', 'TO', 'HEAD_TO', 'BUH', 'OFFICE_MANAGER']
        .map((role) => rows.find((r) => String(r.role) === role)).find(Boolean);
      if (byRole) return byRole.id;
      return rows[0].id;
    }
    // 2) личная почта сотрудника (employees.email → employees.user_id → users).
    const emp = await db.query(
      `SELECT u.id, u.role,
              (SELECT count(*) FROM works w WHERE w.pm_id = u.id AND w.deleted_at IS NULL) AS works_cnt
         FROM employees e JOIN users u ON u.id = e.user_id
        WHERE lower(e.email) = $1 AND u.is_active IS NOT FALSE
        ORDER BY works_cnt DESC, u.id ASC
        LIMIT 10`,
      [addr]
    );
    if (emp.rows.length) {
      const owner = emp.rows.find((r) => Number(r.works_cnt) > 0);
      if (owner) return owner.id;
      const byRole = ['PM', 'HEAD_PM', 'PROC', 'TO', 'HEAD_TO', 'BUH', 'OFFICE_MANAGER']
        .map((role) => emp.rows.find((r) => String(r.role) === role)).find(Boolean);
      if (byRole) return byRole.id;
      return emp.rows[0].id;
    }
    // 3) Почта не привязана ни к пользователю, ни к сотруднику.
    // Заказчик 19.10.2026: НЕ отдаём заявку админу (сотрудник её не увидит).
    // Назначаем ОФИС-МЕНЕДЖЕРА (Тумаева) — она сама переназначит ответственного.
    const fallback = await resolveOfficeManagerId(db);
    return fallback;
  } catch (_) {
    return null;
  }
}

/**
 * Фолбэк-ответственный, когда отправитель письма не опознан.
 * Офис-менеджер (настройка `doc_fallback_owner_user_id`, иначе первый активный
 * OFFICE_MANAGER по id). Заказчик 19.10.2026: ей передаём счёт и она меняет
 * ответственного — лучше, чем «уйдёт админу и потеряется».
 */
async function resolveOfficeManagerId(db) {
  try {
    const s = await db.query(`SELECT value_json FROM settings WHERE key='doc_fallback_owner_user_id' LIMIT 1`);
    if (s.rows[0]) {
      let v = s.rows[0].value_json; try { v = JSON.parse(v); } catch (_) {}
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) return n;
    }
  } catch (_) { /* нет настройки — берём по роли */ }
  try {
    const r = await db.query(
      `SELECT id FROM users WHERE role='OFFICE_MANAGER' AND is_active IS NOT FALSE ORDER BY id ASC LIMIT 1`);
    return r.rows[0] ? r.rows[0].id : null;
  } catch (_) {
    return null;
  }
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
  // V412 (заказчик 18.10.2026): «нужен не костыль с регулярками, а система, которая
  // ПОНИМАЕТ, что к чему относится». Основной путь — ИИ-извлечение по строгому
  // JSON-контракту; регулярки (`extractInvoice`) остаются ФОЛБЭКОМ (когда ИИ недоступен
  // или не дал поля) и перекрёстной проверкой расхождений.
  let parsed = extractInvoice(text || '');
  let aiUsed = false;
  try {
    const aiEx = require('./invoice-ai-extract');
    const ai = await aiEx.extractByAI(text || '', { db });
    if (ai && ai.ok && ai.data) {
      const merged = aiEx.mergeWithRegex(ai.data, parsed);
      parsed = merged.parsed;
      parsed._ai_warnings = (ai.warnings || []).concat(merged.conflicts || []);
      parsed._ai_confidence = ai.confidence;
      aiUsed = true;
    }
  } catch (e) {
    // ИИ недоступен — тихо едем на регулярках (не ломаем приём счёта).
    try { console.warn('[intake] AI-extract: ' + (e && e.message)); } catch (_) {}
  }
  parsed._ai_used = aiUsed;
  parsed._kind = cls.kind;
  parsed._is_invoice = cls.is_invoice;
  // V412: уверенность с учётом ИИ — если модель дала ключевые поля, не считаем
  // строку «не распознанной» из-за того, что регулярки не нашли банк.
  if (aiUsed && parsed._ai_confidence != null) {
    parsed.confidence = Math.max(parsed.confidence || 0, parsed._ai_confidence);
  }
  // V407 (тест заказчика 18.10.2026): инициатор — ТОТ, КТО ПРИСЛАЛ письмо,
  // а не жёстко админ (`userId || 1`). Иначе ответственным за доки становился
  // ADMIN, хотя письмо послал РП. Резолвим по from_email → users.email, затем по
  // личной почте сотрудника (employees.email) — счета шлют и с неё.
  const senderUserId = userId || await resolveSenderUserId(db, email);
  // Заказчик 19.10.2026: если почта отправителя не привязана — ответственным ставим
  // ОФИС-МЕНЕДЖЕРА (Тумаева), она переназначит. Помечаем это, чтобы было видно.
  if (!senderUserId) {
    try {
      const fromRaw = String((email && (email.from_email || email.from)) || '').toLowerCase();
      parsed._ai_warnings = (parsed._ai_warnings || []).concat(['initiator_unresolved:' + fromRaw.slice(0, 80)]);
      console.warn(`[intake] инициатор не найден по почте «${fromRaw}» — назначен офис-менеджер (переназначит)`);
    } catch (_) { /* не критично */ }
  }
  // V404: срок из тела письма инициатора («оплати завтра / срочно / через 2 месяца»).
  // Текст письма и текст вложения могут отличаться — берём тело письма отдельно.
  const emailBody = email && (email.body_text || email.body) || '';
  // V408 (живой тест 18.10.2026): у письма от РП было ПУСТОЕ тело, а объект указан
  // В ТЕМЕ — «Fwd: МЛСП, Замена факельного оголовка: счет от WILDBERRIES».
  // Тема — тоже часть письма инициатора: берём её в разбор (объект, срок, просьба).
  const emailSubject = (email && email.subject) || '';
  const intent = parsePaymentIntent(String(emailBody || emailSubject || text || ''));
  parsed._intent = intent;
  // V411: срок ДОСТАВКИ из тела письма («доставка в краснодар будет 16.10») —
  // это отдельное поле реестра `delivery_due_at`, не срок оплаты.
  const delivery = parseDeliveryHint(String(emailBody || text || ''));
  parsed._delivery = delivery;
  // Объект из темы, если в счёте его нет (типично для Wildberries/Ozon-счетов).
  if (!parsed.work_hint && emailSubject) {
    const hint = extractWorkHintFromSubject(emailSubject);
    if (hint) parsed.work_hint = hint;
  }
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

  // Замечание заказчика 17.10.2026: «все счета должны обрабатываться».
  // Прежний критерий (общая уверенность >= 0.7) блокировал заявку, если в счёте
  // не было банковских реквизитов (БИК/р-с) — хотя это НЕ повод не платить:
  // реквизиты бухгалтерия дозаполнит. Заявку создаём, когда есть то, без чего
  // платить нельзя: СУММА и контрагент (имя или ИНН). Остальное — на вычитку.
  const hasCore = parsed.amount_gross != null && !!(parsed.counterparty_name || parsed.inn);
  const lowConfidence = !hasCore;
  const needsReview = hasCore && parsed.confidence < confMin;
  if (dryRun) return { status: lowConfidence ? 'needs_manual' : 'ok', parsed, needs_review: needsReview, dry_run: true };

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
  // FAIL-1 (верификатор 19.10.2026): карточка ПРОДАВЦА вычисляется ЗДЕСЬ, до ветки
  // создания документа. Раньше переменная объявлялась внутри `if (!docId)`, а
  // читалась в блоке каталога ВНЕ него → `ReferenceError: sellerSupplierId is not
  // defined` → `enrichCatalogFromLines` не вызывался вообще, и по маркетплейс-счетам
  // (Wildberries/Ozon, где продавец ≠ получатель) позиции НЕ попадали в номенклатуру.
  let sellerSupplierId = null;
  if (parsed.seller_inn && parsed.seller_inn !== parsed.inn) {
    try {
      const s2 = await db.query(`SELECT id FROM suppliers WHERE inn=$1 AND deleted_at IS NULL LIMIT 1`, [parsed.seller_inn]);
      if (s2.rows[0]) sellerSupplierId = s2.rows[0].id;
    } catch (_) { /* не критично */ }
  }
  // V404: сопоставляем основание из счёта с договором в CRM и объект с работами.
  let contractInfo = { found: false, reason: 'none' };
  if (parsed.contract_basis && parsed.contract_basis.number) {
    contractInfo = await matchContract(db, {
      number: parsed.contract_basis.number,
      counterpartyInn: parsed.inn,
      counterpartyName: parsed.counterparty_name
    }).catch(() => ({ found: false, reason: 'error' }));
  }
  let workInfo = { found: false, reason: 'none' };
  if (parsed.work_hint) {
    workInfo = await matchWork(db, parsed.work_hint).catch(() => ({ found: false, reason: 'error' }));
  }
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
         spend_kind,          doc_owner_id, created_by, updated_by, receive_channel, comment_text,
         contract_mode, contract_id, contract_label, payment_due_at, work_id, delivery_due_at,
         seller_name, seller_inn, payee_name, payee_inn, payee_kpp, parse_engine, parse_warnings)
       VALUES ('in','invoice','wait_sf','wait',$1,$2::date,$3,$4,$5,$6,$7,$8,$9,
               'other',$10,$10,$10,'email',$11,
               $12,$13,$14,$15::date,$16,$17::date,
               $18,$19,$20,$21,$22,$23,$24::jsonb) RETURNING id`,
      [parsed.invoice_number, parsed.invoice_date, cpName, parsed.inn, supplierId,
        gross, net, vat, parsed.has_vat !== false,
        senderUserId, lowConfidence
          ? 'Требует ручной проверки (не распознаны сумма или контрагент)'
          : (needsReview ? 'Распознано, проверьте реквизиты (банк не найден)' : null),
        // V404: договор-основание из счёта. Есть в CRM → linked, нет → once (подсветим).
        parsed.contract_basis ? (contractInfo.found ? 'linked' : 'once') : 'none',
        contractInfo.found ? contractInfo.contract.id : null,
        parsed.contract_basis ? (parsed.contract_basis.number || parsed.contract_basis.raw) : null,
        parsed.payment_due_at || null,
        workInfo.found ? workInfo.work.id : null,
        (parsed._delivery && parsed._delivery.date) || null,
        // V409: ИИ различает продавца товара и получателя платежа (маркетплейсы).
        parsed.seller_name || null,
        parsed.seller_inn || null,
        parsed.payee_name || null,
        parsed.payee_inn || null,
        parsed.payee_kpp || null,
        parsed._ai_used ? 'ai' : 'regex',
        JSON.stringify(parsed._ai_warnings || [])]);
    docId = insDoc.rows[0].id;
    createdDoc = true;
    // Если договор не найден, но номер указан — пометим строку неполной (жёлтый/синий).
    if (parsed.contract_basis && !contractInfo.found) {
      try {
        await db.query(
          `UPDATE doc_registry
             SET is_incomplete=true,
                 incomplete_reasons=(SELECT array_agg(DISTINCT x) FROM unnest(
                   COALESCE(incomplete_reasons,'{}'::text[]) || ARRAY['contract_not_found']) AS x)
           WHERE id=$1`, [docId]);
      } catch (_) { /* не критично */ }
    }
    // Запоминаем supplier_id для заявки.
    if (supplierId) parsed._supplierId = supplierId;
  } else {
    // V408 (живой тест 18.10.2026): документ УЖЕ был в реестре (пришёл ранее),
    // поэтому ветка создания пропускалась — и вместе с ней терялись объект,
    // договор и срок из ЭТОГО письма. Дозаполняем только пустые поля: ручные
    // значения не затираем (принцип «связывать, а не дублировать»).
    try {
      const patch = [];
      const vals = [];
      if (workInfo.found && workInfo.work) { vals.push(workInfo.work.id); patch.push(`work_id=COALESCE(work_id, $${vals.length})`); }
      if (parsed.payment_due_at) { vals.push(parsed.payment_due_at); patch.push(`payment_due_at=COALESCE(payment_due_at, $${vals.length}::date)`); }
      if (parsed.contract_basis) {
        if (contractInfo.found) {
          vals.push(contractInfo.contract.id); patch.push(`contract_id=COALESCE(contract_id, $${vals.length})`);
          vals.push('linked'); patch.push(`contract_mode=$${vals.length}`);
        } else {
          vals.push('once'); patch.push(`contract_mode=COALESCE(NULLIF(contract_mode,'none'), $${vals.length})`);
        }
        vals.push(parsed.contract_basis.number || parsed.contract_basis.raw); patch.push(`contract_label=COALESCE(contract_label, $${vals.length})`);
      }
      // V409: продавец/получатель платежа и движок разбора — дозаполняем, если пусто
      // (документ мог прийти ранее, до внедрения ИИ-разбора).
      if (parsed.seller_name) { vals.push(parsed.seller_name); patch.push(`seller_name=COALESCE(seller_name, $${vals.length})`); }
      if (parsed.seller_inn) { vals.push(parsed.seller_inn); patch.push(`seller_inn=COALESCE(seller_inn, $${vals.length})`); }
      if (parsed.payee_name) { vals.push(parsed.payee_name); patch.push(`payee_name=COALESCE(payee_name, $${vals.length})`); }
      if (parsed.payee_inn) { vals.push(parsed.payee_inn); patch.push(`payee_inn=COALESCE(payee_inn, $${vals.length})`); }
      if (parsed.payee_kpp) { vals.push(parsed.payee_kpp); patch.push(`payee_kpp=COALESCE(payee_kpp, $${vals.length})`); }
      // parse_engine/parse_warnings: ИИ-результат важнее старой метки регулярного разбора.
      if (parsed._ai_used) {
        vals.push('ai'); patch.push(`parse_engine=$${vals.length}`);
        vals.push(JSON.stringify(parsed._ai_warnings || [])); patch.push(`parse_warnings=$${vals.length}::jsonb`);
      }
      if (patch.length) {
        vals.push(docId);
        await db.query(`UPDATE doc_registry SET ${patch.join(', ')}, updated_at=NOW() WHERE id=$${vals.length}`, vals);
      }
    } catch (e) {
      console.warn('[intake] дозаполнение существующей строки: ' + (e && e.message));
    }
  }

  // Заявка на оплату — только при приемлемой уверенности.
  let paymentId = null;
  if (!lowConfidence) {
    const existPay = await db.query(`SELECT id FROM payment_invoices WHERE doc_registry_id=$1`, [docId]);
    if (existPay.rows[0]) {
      paymentId = existPay.rows[0].id;
      // V406 (живой тест 18.10.2026): заявка УЖЕ была (повторный счёт/повторное письмо) —
      // ветка создания пропускалась, и сохранённое «Добро» к ней не применялось.
      // Применяем отложенное согласие и здесь: заявка могла ещё ждать решения.
      try {
        const thr = require('./approval-thread');
        const srcEmail = emailId ? (await db.query(`SELECT thread_id FROM emails WHERE id=$1`, [emailId])).rows[0] : null;
        await thr.applyPendingGrants(db, {
          paymentId,
          sourceEmailId: emailId,
          threadKey: (srcEmail && srcEmail.thread_id) || null
        });
      } catch (e) { console.warn('[intake] applyPendingGrants (existing): ' + (e && e.message)); }
    } else {
      const basis = parsed.invoice_number
        ? `Счёт ${parsed.invoice_number}${parsed.invoice_date ? ' от ' + parsed.invoice_date : ''}`
        : 'Счёт из письма';
      // V404: срок оплаты — приоритет у просьбы инициатора из письма, затем у счёта.
      const timing = intent.timing === 'deferred' ? 'deferred' : 'immediate';
      const dueDate = intent.due_date || parsed.payment_due_at || null;
      // V409 (проверка заказчика 18.10.2026): ФАЙЛ счёта не прикреплялся к заявке —
      // бухгалтерия и директор не могли открыть скан (GET /:id/file → 404), хотя
      // вложение в письме есть. Берём путь вложения письма и кладём в заявку:
      // `file_path` — реальный путь на диске, `file_name` — имя для скачивания.
      let filePath = null; let fileName = null;
      if (attachmentId) {
        try {
          const at = await db.query(`SELECT filename, file_path FROM email_attachments WHERE id=$1`, [attachmentId]);
          if (at.rows[0] && at.rows[0].file_path) {
            fileName = at.rows[0].filename || null;
            // Путь приводим к виду «uploads/...», который понимает /:id/file.
            filePath = String(at.rows[0].file_path).startsWith('uploads/')
              ? String(at.rows[0].file_path)
              : 'uploads/' + String(at.rows[0].file_path).replace(/^\/?uploads\//, '');
          }
        } catch (_) { /* без файла заявка всё равно создаётся */ }
      }
      const insPay = await db.query(
        `INSERT INTO payment_invoices(status, payment_status, supplier_name, supplier_id, amount, requires_payment,
           created_by, pay_timing, due_date, basis_type, basis_text, doc_registry_id, source_email_id, source_attachment_id,
           initiator_intent, initiator_note, contract_basis_number, contract_basis_date, contract_missing,
           work_hint, work_id, invoice_number, invoice_date, vat_amount, file_path, file_name)
         VALUES ('awaiting_dir','awaiting_dir',$1,$2,$3,true,$4,$5,$6::date,'other',$7,$8,$9,$10,
                 $11,$12,$13,$14::date,$15,$16,$17,$18,$19::date,$20,$21,$22) RETURNING id`,
        [parsed.counterparty_name, parsed._supplierId || null, parsed.amount_gross, senderUserId || 1,
          timing, dueDate, basis, docId, emailId, attachmentId,
          intent.intent !== 'none' ? intent.intent : null,
          intent.matched || null,
          parsed.contract_basis ? parsed.contract_basis.number : null,
          parsed.contract_basis ? parsed.contract_basis.date : null,
          !!(parsed.contract_basis && !contractInfo.found),
          parsed.work_hint || null,
          workInfo.found ? workInfo.work.id : null,
          parsed.invoice_number || null,
          parsed.invoice_date || null,
          parsed.vat_amount != null ? parsed.vat_amount : null,
          filePath, fileName]);
      paymentId = insPay.rows[0].id;
      // V406: если согласующий уже ответил «Добро» ДО появления заявки — применяем
      // сохранённое согласие сразу, чтобы заявка не висела несогласованной.
      try {
        const thr = require('./approval-thread');
        const srcEmail = emailId ? (await db.query(`SELECT thread_id, message_id FROM emails WHERE id=$1`, [emailId])).rows[0] : null;
        await thr.applyPendingGrants(db, {
          paymentId,
          sourceEmailId: emailId,
          threadKey: (srcEmail && srcEmail.thread_id) || null
        });
      } catch (e) { console.warn('[intake] applyPendingGrants: ' + (e && e.message)); }
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

  // V406 (FAIL верификатора 17.10.2026): позиции счёта ОБЯЗАНЫ попадать в
  // номенклатуру автоматически, а не по ручному вызову. Заказчик: «все счета
  // должны наполнять номенклатуру: позиции, количество, цена, дата, поставщик».
  // Позиции берём детерминированным парсером; если он ничего не нашёл — AI-fallback
  // (тот же, что у кнопки «В каталог»). Ошибка парсинга не должна съесть заявку.
  let catalog = null;
  if (docId && !parsed._lines_done) {
    try {
      let lines = Array.isArray(parsed.lines) ? parsed.lines : [];
      if (!lines.length) {
        lines = await aiLines(String(text || '').slice(0, 14000)).catch(() => []);
      }
      if (lines.length) {
        catalog = await enrichCatalogFromLines(db, {
          lines,
          // V409: в историю закупок («что почём купили») идёт ПРОДАВЕЦ товара,
          // а не получатель платежа (у маркетплейсов это разные лица).
          supplierName: parsed.seller_name || parsed.counterparty_name,
          // FAIL-1: у маркетплейса платим получателю, а покупаем у продавца — карточка
          // поставщика должна быть продавца (иначе имя продавца + карточка получателя).
          supplierId: (parsed.seller_inn && parsed.seller_inn !== parsed.inn)
            ? (sellerSupplierId || null)
            : (parsed._supplierId || null),
          userId: senderUserId,
          source: 'quote',
          docRegistryId: docId,
          invoiceDate: parsed.invoice_date,
          invoiceNumber: parsed.invoice_number
        });
        // Строка документа: сохраняем позиции и снимаем пометку «ждём разбора».
        await db.query(
          `UPDATE doc_registry SET parsed_json=$2::jsonb, updated_at=NOW() WHERE id=$1`,
          [docId, JSON.stringify(lines)]);
      }
    } catch (e) {
      // Номенклатура — не блокер платежа: фиксируем и идём дальше.
      try { await db.query(`UPDATE doc_registry SET incomplete_reasons=(SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(incomplete_reasons,'{}'::text[]) || ARRAY['catalog_parse_pending']) AS x), is_incomplete=true WHERE id=$1`, [docId]); } catch (_) {}
    }
  }

  return {
    status: lowConfidence ? 'needs_manual' : 'created',
    intake_id: journal.rows[0] ? journal.rows[0].id : null,
    doc_id: docId, created_doc: createdDoc, payment_invoice_id: paymentId, parsed, catalog
  };
}

/** AI-разбор позиций (fallback, когда детерминированный парсер не сработал). */
async function aiLines(text) {
  if (!String(text || '').trim()) return [];
  try {
    const aiProvider = require('./ai-provider');
    const r = await aiProvider.complete({
      system: 'Извлеки из текста счёта список позиций. Верни СТРОГО JSON {"items":[{"name":"","article":"","quantity":1,"unit":"шт","unit_price":0}]} без markdown.',
      messages: [{ role: 'user', content: 'Счёт:\n\n' + text }],
      maxTokens: 4000,
      temperature: 0.1
    });
    const m = (r && r.text || '').match(/\{[\s\S]*\}/);
    const j = m ? JSON.parse(m[0]) : null;
    return j && Array.isArray(j.items) ? j.items : [];
  } catch (_) {
    return [];
  }
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

module.exports = { intakeOne, intakeEmail, confidenceMin, resolveSenderUserId, extractWorkHintFromSubject };
