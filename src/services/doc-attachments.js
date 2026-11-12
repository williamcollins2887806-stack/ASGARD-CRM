'use strict';

/**
 * D-348 (заказчик 23.10.2026): «у нас есть строка в реестре на один счёт,
 * а все письма ИСХ по этому счёту, которые пишет Путков или кто-то ещё для
 * обоснования зачем этот счёт, должны идти ВЛОЖЕНИЯМИ к этой строке, а не
 * создавать новую строку».
 * ═══════════════════════════════════════════════════════════════════════════
 * ПРОБЛЕМА. В треде по одному счёту летит переписка: «прошу оплатить»,
 * «согласовано», «перешлите счёт», «во вложении». Раньше каждое письмо с
 * вложением-счётом пыталось создать СВОЮ строку реестра, а письма-обоснования
 * либо отклонялись (not_invoice), либо создавали мусорные строки. Результат:
 *  — на один счёт несколько строк (дубли);
 *  — обоснование («почему платим») терялось, к строке не прикреплялось.
 *
 * РЕШЕНИЕ. Определяем, является ли письмо ОБОСНОВАНИЕМ к уже существующему
 * счёту, и если да — прикрепляем его файлы к строке как вложения, без создания
 * новой строки.
 *
 * Признаки обоснования (любой из, при наличии найденного счёта):
 *   • номер счёта в теме/теле совпал с существующей строкой → это про неё;
 *   • сумма + контрагент совпали с существующей строкой;
 *   • это ОТВЕТ (Re:/Fwd:/in_reply_to) в треде, где счёт уже создан.
 *
 * Что прикрепляем: ВСЕ файлы письма (pdf/docx/xlsx/картинки) — они и есть
 * обоснование (договор, ТЗ, согласование, счёт в другой редакции).
 *
 * Куда: `doc_registry.attachments` (jsonb-массив). Формат элемента:
 *   { name, path, mime, size, email_id, attachment_id, kind, added_at }
 *   kind: 'justification' — обоснование, 'scan' — сам скан счёта.
 *
 * Идемпотентность: по `attachment_id` — повторный проход не задваивает.
 */

/** Разобрать attachments в массив (колонка может быть null/объектом/строкой). */
function asList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (_) { return []; } }
  if (typeof v === 'object') return [v];
  return [];
}

/**
 * Прикрепить файлы письма к строке реестра как обоснование.
 *
 * @param {object} db
 * @param {number} docId — строка реестра (существующий счёт)
 * @param {number|null} emailId — письмо-источник
 * @param {Array<{id:number, filename:string, original_filename?:string, file_path:string,
 *                mime_type?:string, size?:number}>} files
 * @param {{kind?:string, log?:object, note?:string}} [opts]
 * @returns {Promise<{added:number, total:number, skipped:number}>}
 */
async function attachFilesToDoc(db, docId, emailId, files, opts = {}) {
  const log = opts.log;
  const kind = opts.kind || 'justification';
  if (!docId) return { added: 0, total: 0, skipped: 0 };
  const list = Array.isArray(files) ? files.filter((f) => f && (f.file_path || f.id)) : [];
  if (!list.length) return { added: 0, total: 0, skipped: 0 };

  const cur = await db.query(`SELECT attachments FROM doc_registry WHERE id=$1`, [docId]);
  if (!cur.rows[0]) return { added: 0, total: 0, skipped: 0 };
  const existing = asList(cur.rows[0].attachments);

  // Идемпотентность по attachment_id И по пути файла (письмо могли принести дважды).
  const seenIds = new Set(existing.map((x) => x && x.attachment_id).filter(Boolean));
  const seenPaths = new Set(existing.map((x) => x && x.path).filter(Boolean));

  let added = 0, skipped = 0;
  const next = existing.slice();
  for (const f of list) {
    if (f.id && seenIds.has(f.id)) { skipped++; continue; }
    if (f.file_path && seenPaths.has(f.file_path)) { skipped++; continue; }
    next.push({
      name: f.original_filename || f.filename || (f.file_path ? String(f.file_path).split('/').pop() : 'файл'),
      path: f.file_path || null,
      mime: f.mime_type || null,
      size: f.size != null ? Number(f.size) : null,
      email_id: emailId || null,
      attachment_id: f.id || null,
      kind,
      note: opts.note || null,
      added_at: new Date().toISOString()
    });
    if (f.id) seenIds.add(f.id);
    if (f.file_path) seenPaths.add(f.file_path);
    added++;
  }

  if (!added) return { added: 0, total: next.length, skipped };

  await db.query(
    `UPDATE doc_registry SET attachments=$1::jsonb, updated_at=NOW() WHERE id=$2`,
    [JSON.stringify(next), docId]
  );
  log?.info?.(`[attach-justify] к счёту #${docId} прикреплено ${added} файл(ов) из письма #${emailId} (всего ${next.length})`);
  return { added, total: next.length, skipped };
}

/**
 * Найти строку реестра, к которой относится это письмо-обоснование.
 * Ищем ТОЛЬКО среди входящих счетов (dir='in', package_type='invoice'),
 * не удалённых. Приоритет: точный номер счёта → номер+сумма → сумма+контрагент.
 *
 * @param {object} db
 * @param {{invoice_number?:string, amount_gross?:number, counterparty_inn?:string,
 *          counterparty_name?:string, excludeId?:number}} hint
 * @returns {Promise<object|null>}
 */
/**
 * Нормализация номера счёта для сравнения (как в findTargetDoc / дедупе).
 * @param {string} v
 * @returns {string}
 */
function normInvoiceNo(v) {
  return String(v || '').toLowerCase()
    .replace(/[№#"'`«»\s._-]/g, '')
    .replace(/[/\\]+/g, '')
    .replace(/[^0-9a-zа-яё]/gi, '');
}

/**
 * Найти строку реестра по треду письма (in_reply_to / thread_id / References).
 * В шапке модуля это было заявлено; до фикса искали только номер и сумму+ИНН.
 *
 * @param {object} db
 * @param {{email_id?:number, in_reply_to?:string, thread_id?:string, message_id?:string, references_header?:string}} emailHint
 * @returns {Promise<object|null>}
 */
async function findTargetDocByThread(db, emailHint = {}) {
  const emailId = emailHint.email_id != null ? Number(emailHint.email_id) : null;
  let inReply = emailHint.in_reply_to
    ? String(emailHint.in_reply_to).replace(/[<>]/g, '').trim()
    : null;
  let threadId = emailHint.thread_id ? String(emailHint.thread_id).trim() : null;
  let refs = emailHint.references_header ? String(emailHint.references_header) : '';

  if (emailId && (!inReply || !threadId)) {
    const er = await db.query(
      `SELECT in_reply_to, thread_id, references_header, message_id
         FROM emails WHERE id=$1`, [emailId]);
    if (er.rows[0]) {
      if (!inReply && er.rows[0].in_reply_to) {
        inReply = String(er.rows[0].in_reply_to).replace(/[<>]/g, '').trim();
      }
      if (!threadId && er.rows[0].thread_id) threadId = String(er.rows[0].thread_id).trim();
      if (!refs && er.rows[0].references_header) refs = String(er.rows[0].references_header);
    }
  }
  if (!inReply && !threadId && !refs) return null;

  const refIds = [];
  if (inReply) refIds.push(inReply);
  const refMatches = refs.match(/<[^>]+>/g) || [];
  for (const m of refMatches) {
    const id = m.slice(1, -1).trim();
    if (id && !refIds.includes(id)) refIds.push(id);
  }

  // 1) Письма того же треда / по in_reply_to → doc_email_intake.doc_id
  const r = await db.query(`
    SELECT d.id, d.invoice_number, d.amount_gross, d.counterparty_name, d.counterparty_inn,
           d.attachments, d.payment_invoice_id, d.work_id
      FROM emails e
      JOIN doc_email_intake i ON i.email_id = e.id AND i.doc_id IS NOT NULL
      JOIN doc_registry d ON d.id = i.doc_id AND d.deleted_at IS NULL
       AND d.dir='in' AND d.package_type='invoice'
     WHERE ($1::text IS NULL OR e.thread_id = $1)
        OR ($2::text[] IS NOT NULL AND cardinality($2::text[]) > 0
            AND regexp_replace(coalesce(e.message_id,''), '[<>]', '', 'g') = ANY($2::text[]))
     ORDER BY (d.payment_invoice_id IS NOT NULL) DESC, d.id ASC
     LIMIT 1`, [threadId || null, refIds.length ? refIds : null]);
  if (r.rows[0]) return r.rows[0];

  // 2) Вложение уже лежит на карточке с email_id из того же треда
  const r2 = await db.query(`
    SELECT d.id, d.invoice_number, d.amount_gross, d.counterparty_name, d.counterparty_inn,
           d.attachments, d.payment_invoice_id, d.work_id
      FROM emails e
      JOIN doc_registry d ON d.deleted_at IS NULL AND d.dir='in' AND d.package_type='invoice'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(d.attachments,'[]'::jsonb)) a
          WHERE (a->>'email_id')::bigint = e.id
       )
     WHERE ($1::text IS NULL OR e.thread_id = $1)
        OR ($2::text[] IS NOT NULL AND cardinality($2::text[]) > 0
            AND regexp_replace(coalesce(e.message_id,''), '[<>]', '', 'g') = ANY($2::text[]))
     ORDER BY (d.payment_invoice_id IS NOT NULL) DESC, d.id ASC
     LIMIT 1`, [threadId || null, refIds.length ? refIds : null]);
  return r2.rows[0] || null;
}

async function findTargetDoc(db, hint = {}) {
  const num = String(hint.invoice_number || '').trim();
  // 1. Точный номер (нормализованный) — самый надёжный признак.
  if (num) {
    const norm = normInvoiceNo(num);
    if (norm) {
      const r = await db.query(`
        SELECT id, invoice_number, amount_gross, counterparty_name, counterparty_inn,
               attachments, payment_invoice_id, work_id
          FROM doc_registry
         WHERE deleted_at IS NULL AND dir='in' AND package_type='invoice'
           AND lower(regexp_replace(coalesce(invoice_number,''),
                 '[^0-9a-zA-Zа-яА-ЯёЁ/]', '', 'g')) = $1
         ORDER BY (payment_invoice_id IS NOT NULL) DESC, id ASC
         LIMIT 1`, [norm]);
      if (r.rows[0]) return r.rows[0];
    }
  }
  // 2. Сумма + контрагент (ИНН или имя) — когда номер в письме не указан.
  const amount = Number(hint.amount_gross);
  if (amount > 0) {
    const params = [amount];
    let where = `deleted_at IS NULL AND dir='in' AND package_type='invoice' AND abs(amount_gross - $1) < 0.01`;
    const inn = String(hint.counterparty_inn || '').replace(/\D/g, '');
    if (inn) {
      params.push(inn);
      where += ` AND regexp_replace(coalesce(counterparty_inn,''), '\\D', '', 'g') = $${params.length}`;
    }
    if (hint.excludeId) {
      params.push(Number(hint.excludeId));
      where += ` AND id <> $${params.length}`;
    }
    const r = await db.query(
      `SELECT id, invoice_number, amount_gross, counterparty_name, counterparty_inn,
              attachments, payment_invoice_id, work_id
         FROM doc_registry WHERE ${where}
        ORDER BY (payment_invoice_id IS NOT NULL) DESC, id ASC LIMIT 2`, params);
    if (r.rows.length === 1) return r.rows[0];
  }
  // 3. Тред письма (Re:/in_reply_to/thread_id) — когда OCR не дал номер.
  if (hint.email_id || hint.in_reply_to || hint.thread_id) {
    const byThread = await findTargetDocByThread(db, hint);
    if (byThread) return byThread;
  }
  return null;
}

/**
 * D-388: номера счетов, встречающиеся в имени файла.
 *
 * Заказчик 28.10.2026: «и почему 2 счета в одной строчке????». Причина —
 * файлы прикреплялись ко ВСЕМ строкам письма скопом: поставщик прислал одним
 * письмом два счёта (КР-4724 и КР-4536) с УПД, и в строке КР-4724 лежали
 * четыре файла, два из которых — чужой счёт и чужое УПД. Бухгалтерия могла
 * оплатить не тот документ.
 *
 * Разбираем имя файла на «номера» и нормализуем так же, как invoice_number
 * в реестре, чтобы сравнение было прямой проверкой, а не догадкой.
 *
 * @param {string} name — имя файла
 * @returns {string[]} нормализованные номера (возможно, пусто)
 */
function numbersFromFileName(name) {
  const raw = String(name || '');
  if (!raw) return [];
  // Отбрасываем расширение: «КР-4724.pdf» → «КР-4724».
  // Точка внутри номера («12.03_1339 от 12.03.25.pdf») не должна мешать,
  // поэтому отрезаем только ХВОСТОВОЕ расширение, а не первое совпадение.
  const base = raw.replace(/\.(pdf|docx?|xlsx?|jpe?g|png|tiff?|zip|rar|7z)$/i, '');
  const out = new Set();
  const push = (s) => {
    const n = String(s || '').toLowerCase().replace(/[^0-9a-zа-яё\/]/g, '');
    // Слишком короткие номера («12», «1») не считаем признаком: они есть
    // почти в любой дате и в любом артикуле.
    if (n.length >= 4) out.add(n);
  };
  // Шаблоны номеров счетов, встречающиеся у поставщиков АСГАРД:
  //   КР-4724, ДС-26028599, УТ-2399, 0VT/1873865/64915915, A-2127.
  //
  // D-388: границы слова `\b` здесь НЕ годятся. В «12.03_1339» подчёркивание
  // — тоже «слово», поэтому `\b1339` не срабатывает и номер договора терялся,
  // из-за чего чужой договор считался обоснованием счёта. А в «Накладная 2026»
  // шаблон букв ловил хвост слова «дная» и делал номер «дная2026». Поэтому
  // границы заданы явными lookaround: слева и справа не должно быть букв/цифр.
  const patterns = [
    /(?<![\p{L}\p{N}])[\p{L}]{1,4}\s*[-–—]?\s*\d{3,}/giu, // КР-4724, ДС-26028599, A-2127
    /\d+VT\/\d+\/\d+/gi,                                    // 0VT/1873865/64915915
    /(?<!\d)\d{4,}(?!\d)/g,                                 // 1339, 2026, 64915915
  ];
  for (const re of patterns) {
    const found = base.match(re);
    if (found) found.forEach(push);
  }
  return [...out];
}

/**
 * D-388: относится ли файл к счёту с этим номером.
 *
 * Правило трёхзначное, чтобы не приклеить чужое и не потерять своё:
 *   1. В имени файла есть номер, и он совпал с номером счёта — ДА (сильный признак);
 *   2. В имени есть ДРУГИЕ номера, но не номер счёта — НЕТ (это чужой документ);
 *   3. В имени номеров нет вовсе — отдаём вызывающему (договор, ТЗ, скан без
 *      номера): такие файлы считаются обоснованием и крепятся, только если
 *      счёт один в письме. При нескольких счетах — не крепим ни к кому,
 *      чтобы не размножить один и тот же файл по всем строкам.
 *
 * @param {string} fileName
 * @param {string} invoiceNumber
 * @returns {'match'|'other'|'unknown'}
 */
function fileMatchesInvoice(fileName, invoiceNumber) {
  const target = String(invoiceNumber || '').toLowerCase().replace(/[^0-9a-zа-яё\/]/g, '');
  const nums = numbersFromFileName(fileName);
  if (!nums.length) return 'unknown';
  if (!target) return 'unknown';
  // Совпадение по вхождению: «дс-26028599» ↔ «дс26028599»,
  // а также «КР-4724 от 30.09.2026» содержит «кр4724».
  const hit = nums.some((n) => n === target || n.includes(target) || target.includes(n));
  return hit ? 'match' : 'other';
}

module.exports = {
  attachFilesToDoc,
  findTargetDoc,
  findTargetDocByThread,
  normInvoiceNo,
  asList,
  numbersFromFileName,
  fileMatchesInvoice,
};
