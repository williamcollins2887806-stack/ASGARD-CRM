'use strict';

/**
 * src/services/backfill-lines.js
 *
 * D-380: автоматическое дозаполнение номенклатуры счетов.
 *
 * ЗАЧЕМ. Счёт может создаться без позиций (`line_items_json = []`), даже если
 * всё остальное распозналось. Причины:
 *   • кончились деньги на ИИ-API (реальный случай 24–27.10.2026);
 *   • провайдер вернул ошибку, письмо попало в инфраструктурный сбой;
 *   • скан без текстового слоя, OCR вернул только итог;
 *   • счёт загружен файлом, а не пришёл письмом.
 *
 * Последствие функциональное: заявка есть, сумма верна, платить можно —
 * но бухгалтерии нечего сопоставить с УПД, в реестре не видно, за что платим.
 *
 * ЧТО ДЕЛАЕТ. Идёт по счетам БЕЗ позиций и восстанавливает их из документа:
 *   1. текстовый слой PDF через `pdftotext` — бесплатно и точно;
 *   2. если слоя нет — локальный OCR через `tesseract` — тоже бесплатно;
 *   3. платный ИИ — только при явном флаге `useAi`.
 *
 * Суммы НЕ подгоняются под итог: если сумма строк расходится с суммой счёта,
 * это сигнал, а не повод переписать цифры.
 *
 * ВЫЗОВ. Автоматически из `imap.js` при старте сервиса и раз в сутки —
 * поэтому после пополнения баланса ИИ достаточно перезапуска, ручная работа
 * не нужна. Плюс руками: `node tools/backfill_invoice_lines.js`.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// Строки, которые не являются позициями.
const SKIP_LINE = /^(итого|всего|в том числе|ндс|сумма|наименование|№|поставщик|покупатель|руководитель|бухгалтер|менеджер)/i;
// Колонтитулы, реквизиты, даты — в позиции не попадают.
const JUNK_LINE = /(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}|gmt|инн|кпп|бик|р\/с|к\/с|тел\.|www\.|@|e-?mail|страниц|лист)/i;

/**
 * Разобрать позиции из текста счёта.
 *
 * Консервативно: лучше вернуть меньше строк, чем выдумать лишнюю. Позиция
 * должна иметь порядковый номер, осмысленное наименование (букв больше
 * половины) и денежную сумму.
 *
 * @param {string} text
 * @returns {Array<{name:string,quantity:number|null,unit:string|null,sum:number,article:null,unit_price:number|null}>}
 */
function parseLines(text) {
  if (!text) return [];
  const out = [];

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length < 12) continue;
    if (SKIP_LINE.test(line)) continue;
    if (JUNK_LINE.test(line)) continue;

    const m = line.match(/^(\d{1,3})[.)\s]+(.+)$/);
    if (!m) continue;
    const rest = m[2];

    const nums = [...rest.matchAll(/(\d[\d\s]*[.,]\d{2})/g)].map((x) => x[1]);
    if (!nums.length) continue;

    const nameEnd = rest.search(/\s{2,}\d|\s\d+[\.,]\d{2}/);
    const name = (nameEnd > 0 ? rest.slice(0, nameEnd) : rest).replace(/\s{2,}/g, ' ').trim();
    if (name.length < 5) continue;

    const words = name.split(/\s+/).filter((w) => w.length > 1);
    if (words.length < 2) continue;

    // Наименование не должно состоять из цифр и дефисов («-- -- --»).
    const letters = (name.match(/[А-Яа-яЁёA-Za-z]/g) || []).length;
    if (letters < name.length * 0.5) continue;

    const sum = num(nums[nums.length - 1]);
    if (!sum || sum < 1) continue;

    const qtyM = rest.match(/(\d+[.,]?\d*)\s*(шт|т|кг|г|м3|м2|м|л|чел|пар|компл|услуг|рулон|меш)/i);
    const qty = qtyM ? num(qtyM[1]) : null;

    out.push({
      name: name.slice(0, 300),
      quantity: qty,
      unit: qtyM ? qtyM[2].toLowerCase() : null,
      sum,
      article: null,
      unit_price: qty ? Math.round((sum / qty) * 100) / 100 : null,
    });
  }

  // OCR иногда повторяет строку — убираем дубли по имени+сумме.
  const seen = new Set();
  return out.filter((x) => {
    const k = `${x.name}|${x.sum}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Текст документа: текстовый слой, при его отсутствии — локальный OCR. */
function readDocText(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return { text: '', src: 'no_file' };

  let text = '';
  try {
    text = execFileSync('pdftotext', ['-layout', absPath, '-'], {
      encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    });
  } catch (_) { text = ''; }
  if (text.trim().length >= 120) return { text, src: 'text_layer' };

  const prefix = path.join('/tmp', 'bf_' + process.pid + '_' + Date.now());
  try {
    execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '3', absPath, prefix]);
    const dir = path.dirname(prefix);
    const base = path.basename(prefix);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(base)).sort();

    const parts = [];
    for (const f of files) {
      try {
        parts.push(execFileSync('tesseract', [path.join(dir, f), '-', '-l', 'rus', '--psm', '6'],
          { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
      } catch (_) { /* страница не распозналась */ }
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* */ }
    }
    const ocr = parts.join('\n');
    if (ocr.trim().length > text.trim().length) return { text: ocr, src: 'tesseract' };
    return { text, src: text.trim() ? 'text_layer' : 'ocr_empty' };
  } catch (_) {
    return { text, src: text.trim() ? 'text_layer' : 'ocr_failed' };
  }
}

/** Абсолютный путь к файлу счёта: вложение письма либо файл заявки. */
async function resolveFilePath(db, root, pi) {
  if (pi.source_attachment_id) {
    const a = (await db.query(
      'SELECT file_path, original_filename FROM email_attachments WHERE id=$1',
      [pi.source_attachment_id])).rows[0];
    if (a && a.file_path) {
      const rel = String(a.file_path).startsWith('uploads/')
        ? a.file_path
        : 'uploads/' + String(a.file_path).replace(/^\/?uploads\//, '');
      return { abs: path.join(root, rel), name: a.original_filename };
    }
  }
  if (pi.file_path) {
    const rel = String(pi.file_path).startsWith('uploads/')
      ? pi.file_path
      : 'uploads/' + String(pi.file_path).replace(/^\/?uploads\//, '');
    return { abs: path.join(root, rel), name: pi.file_name };
  }
  return null;
}

/**
 * Дозаполнить номенклатуру у счетов без позиций.
 *
 * @param {object} db — pg pool/клиент
 * @param {object} [opts]
 * @param {number} [opts.limit=50]     — максимум счетов за прогон
 * @param {string[]} [opts.ids]        — конкретные заявки
 * @param {boolean} [opts.apply=true]  — записывать ли результат
 * @param {boolean} [opts.useAi=false] — разрешить платный ИИ как последний шаг
 * @param {string} [opts.root]         — корень проекта
 * @returns {Promise<{scanned:number, filled:number, failed:number, details:Array}>}
 */
async function backfillInvoiceLines(db, opts = {}) {
  const root = opts.root || process.cwd();
  const limit = Math.max(1, Math.min(Number(opts.limit) || 50, 500));
  const apply = opts.apply !== false;
  const useAi = !!opts.useAi;
  const ids = Array.isArray(opts.ids) && opts.ids.length ? opts.ids : null;

  const params = [];
  let where = `pi.status <> 'rejected'`;
  if (ids) {
    params.push(ids);
    where += ` AND pi.id = ANY($${params.length}::int[])`;
  }
  params.push(limit);

  const rows = (await db.query(
    `SELECT pi.id, pi.invoice_number, pi.amount, pi.source_attachment_id,
            pi.file_path, pi.file_name, pi.doc_registry_id,
            jsonb_array_length(COALESCE(pi.line_items_json,'[]'::jsonb)) AS n_lines
       FROM payment_invoices pi
      WHERE ${where}
        AND jsonb_array_length(COALESCE(pi.line_items_json,'[]'::jsonb)) = 0
      ORDER BY pi.id
      LIMIT $${params.length}`, params)).rows;

  const details = [];
  let filled = 0;
  let failed = 0;

  for (const pi of rows) {
    const rec = {
      id: pi.id,
      invoice_number: pi.invoice_number,
      amount: Number(pi.amount) || 0,
      lines: 0,
      source: null,
      sum_lines: 0,
      mismatch: 0,
      ok: false,
      error: null,
    };

    // 1. Что уже извлёк intake (денег не тратит).
    let lines = [];
    try {
      const intake = (await db.query(
        `SELECT parse_raw FROM doc_email_intake
          WHERE payment_invoice_id=$1 ORDER BY id DESC LIMIT 1`, [pi.id])).rows[0];
      if (intake && intake.parse_raw) {
        const raw = intake.parse_raw;
        const cand = Array.isArray(raw) ? raw : (raw.lines || raw.items || []);
        if (Array.isArray(cand) && cand.length) {
          lines = cand.map((l) => ({
            name: String(l.name || l.title || l.description || '').slice(0, 300),
            quantity: num(l.quantity || l.qty),
            unit: l.unit || null,
            sum: num(l.sum || l.amount || l.total),
            article: l.article || null,
            unit_price: num(l.unit_price || l.price),
          })).filter((l) => l.name && l.sum);
          if (lines.length) rec.source = 'intake.parse_raw';
        }
      }
    } catch (_) { /* нет таблицы или записи — идём дальше */ }

    // 2. Текст документа: слой или локальный OCR.
    if (!lines.length) {
      try {
        const file = await resolveFilePath(db, root, pi);
        if (file && file.abs && fs.existsSync(file.abs)) {
          const { text, src } = readDocText(file.abs);
          lines = parseLines(text);
          if (lines.length) rec.source = src;
          else rec.source = src;
        } else {
          rec.source = 'no_file';
        }
      } catch (e) {
        rec.error = String(e.message).slice(0, 200);
      }
    }

    // 3. Платный ИИ — только по явному разрешению и только если пусто.
    if (!lines.length && useAi) {
      try {
        const ai = require('./invoice-ai-extract');
        const file = await resolveFilePath(db, root, pi);
        if (file && file.abs) {
          const parsed = await ai.extractFromPdf(file.abs);
          const cand = (parsed && (parsed.lines || parsed.items)) || [];
          lines = cand.map((l) => ({
            name: String(l.name || '').slice(0, 300),
            quantity: num(l.quantity),
            unit: l.unit || null,
            sum: num(l.sum),
            article: l.article || null,
            unit_price: num(l.unit_price),
          })).filter((l) => l.name && l.sum);
          if (lines.length) rec.source = 'ai';
        }
      } catch (e) {
        rec.error = 'ai: ' + String(e.message).slice(0, 160);
      }
    }

    if (!lines.length) { failed++; details.push(rec); continue; }

    rec.lines = lines.length;
    rec.sum_lines = Math.round(lines.reduce((s, l) => s + (Number(l.sum) || 0), 0) * 100) / 100;
    rec.mismatch = Math.round(Math.abs(rec.sum_lines - rec.amount) * 100) / 100;

    if (apply) {
      try {
        await db.query(
          'UPDATE payment_invoices SET line_items_json=$2::jsonb, updated_at=NOW() WHERE id=$1',
          [pi.id, JSON.stringify(lines)]);
        if (pi.doc_registry_id) {
          // В реестре позиции живут в parsed_json.lines — туда же, чтобы
          // карточка документа показывала то же, что заявка.
          await db.query(
            `UPDATE doc_registry
                SET parsed_json = COALESCE(parsed_json,'{}'::jsonb) || jsonb_build_object('lines',$2::jsonb),
                    updated_at = NOW()
              WHERE id=$1`,
            [pi.doc_registry_id, JSON.stringify(lines)]).catch(() => {});
        }
        rec.ok = true;
        filled++;
      } catch (e) {
        rec.error = 'write: ' + String(e.message).slice(0, 160);
        failed++;
      }
    } else {
      rec.ok = true;
      filled++;
    }
    details.push(rec);
  }

  return { scanned: rows.length, filled, failed, details };
}

module.exports = { backfillInvoiceLines, parseLines, readDocText };
