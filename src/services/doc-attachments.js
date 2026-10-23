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
async function findTargetDoc(db, hint = {}) {
  const num = String(hint.invoice_number || '').trim();
  // 1. Точный номер (нормализованный) — самый надёжный признак.
  if (num) {
    const norm = num.toLowerCase().replace(/[№#"'`«»\s._-]/g, '').replace(/[/\\]+/g, '/');
    if (norm) {
      const r = await db.query(`
        SELECT id, invoice_number, amount_gross, counterparty_name, counterparty_inn,
               attachments, payment_invoice_id, work_id
          FROM doc_registry
         WHERE deleted_at IS NULL AND dir='in' AND package_type='invoice'
           AND lower(regexp_replace(coalesce(invoice_number,''),
                 '[^0-9a-zA-Zа-яА-ЯёЁ/]', '', 'g')) = $1
         ORDER BY (payment_invoice_id IS NOT NULL) DESC, id ASC
         LIMIT 1`, [norm.replace(/\//g, '')]);
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
  return null;
}

module.exports = { attachFilesToDoc, findTargetDoc, asList };
