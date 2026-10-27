'use strict';

/**
 * tools/backfill_invoice_lines.js
 *
 * D-380: дозаполнение номенклатуры в счетах, у которых позиции не распознаны.
 *
 * ЗАЧЕМ. ИИ-распознавание может не сработать по трём причинам:
 *   • кончились деньги на API (реальная ситуация 24–27.10.2026);
 *   • скан плохого качества, OCR вернул только сумму;
 *   • пытались разобрать наше исходящее письмо, а не счёт поставщика.
 * В итоге заявка создана, сумма верная, но `line_items_json` пустой —
 * бухгалтерии нечего сопоставить с УПД, а в реестре не видно, за что платим.
 *
 * ЧТО ДЕЛАЕТ. Идёт по счетам БЕЗ позиций и пытается восстановить их
 * в порядке приоритета источников:
 *   1. `doc_email_intake.parse_raw.lines` — что уже извлёк intake
 *      (даже если не перенёс в заявку). Денег не тратит;
 *   2. текстовый слой PDF — бесплатно, через `pdftotext`;
 *   3. OCR через tesseract — локальный, бесплатный (не ИИ-API);
 *   4. ИИ-распознавание (`invoice-ai-extract`) — только если явно
 *      передан `--ai` И позиций всё ещё нет.
 *
 * ВАЖНО: суммы НЕ пересчитываются и не «улучшаются». Если сумма строк
 * расходится с суммой счёта, позиции всё равно сохраняются, но в отчёт
 * попадает расхождение — молча подгонять цифры под итог нельзя.
 *
 * Запуск:
 *   node tools/backfill_invoice_lines.js            — dry-run
 *   node tools/backfill_invoice_lines.js --apply    — записать
 *   node tools/backfill_invoice_lines.js --apply --ai  — с ИИ-добивкой
 *   node tools/backfill_invoice_lines.js --ids 304,305 --apply
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = process.env.ASGARD_ROOT || '/var/www/asgard-crm';
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env') });
const { Client } = require(path.join(ROOT, 'node_modules/pg'));

const APPLY = process.argv.includes('--apply');
const USE_AI = process.argv.includes('--ai');
const idsArg = (() => {
  const i = process.argv.indexOf('--ids');
  if (i < 0) return null;
  return String(process.argv[i + 1] || '')
    .split(',').map((s) => parseInt(s, 10)).filter(Number.isFinite);
})();

const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Абсолютный путь к файлу счёта: из вложения письма или из заявки. */
async function resolveFile(c, pi) {
  if (pi.source_attachment_id) {
    const a = (await c.query(
      `SELECT file_path, original_filename FROM email_attachments WHERE id=$1`, [pi.source_attachment_id])).rows[0];
    if (a && a.file_path) {
      const rel = String(a.file_path).startsWith('uploads/')
        ? a.file_path
        : 'uploads/' + String(a.file_path).replace(/^\/?uploads\//, '');
      return { abs: path.join(ROOT, rel), name: a.original_filename };
    }
  }
  if (pi.file_path) {
    const rel = String(pi.file_path).startsWith('uploads/')
      ? pi.file_path
      : 'uploads/' + String(pi.file_path).replace(/^\/?uploads\//, '');
    return { abs: path.join(ROOT, rel), name: pi.file_name };
  }
  return null;
}

/** Текст из PDF: сначала текстовый слой (бесплатно), потом локальный OCR. */
function readText(abs) {
  if (!abs || !fs.existsSync(abs)) return { text: '', src: 'нет файла' };
  let text = '';
  try {
    text = execFileSync('pdftotext', ['-layout', abs, '-'], {
      encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    });
  } catch (_) { text = ''; }
  if (text.trim().length >= 120) return { text, src: 'text_layer' };

  // Локальный OCR — не тратит деньги на ИИ.
  try {
    const out = path.join('/tmp', 'bfill_' + process.pid);
    execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '3', abs, out]);
    const files = fs.readdirSync('/tmp').filter((f) => f.startsWith('bfill_' + process.pid)).sort();
    const parts = [];
    for (const f of files) {
      try {
        parts.push(execFileSync('tesseract', [path.join('/tmp', f), '-', '-l', 'rus', '--psm', '6'],
          { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
      } catch (_) { /* страница не распозналась */ }
      try { fs.unlinkSync(path.join('/tmp', f)); } catch (_) {}
    }
    const ocr = parts.join('\n');
    if (ocr.trim().length > text.trim().length) return { text: ocr, src: 'tesseract' };
    return { text, src: text ? 'text_layer' : 'tesseract_empty' };
  } catch (_) {
    return { text, src: text ? 'text_layer' : 'ocr_failed' };
  }
}

/**
 * Разобрать строки таблицы из текста счёта.
 *
 * Правила намеренно консервативные: лучше вернуть меньше позиций, чем
 * выдумать лишнюю. Строка считается позицией, если в ней есть:
 *   • порядковый номер в начале, И
 *   • денежная сумма с копейками (или целое с разделителем тысяч), И
 *   • хотя бы два слова наименования.
 * Итоговые строки («Итого», «Всего к оплате», «НДС») отбрасываются.
 */
function parseLines(text) {
  if (!text) return [];
  const SKIP = /^(итого|всего|в том числе|ндс|сумма|наименование|№|поставщик|покупатель|руководитель|бухгалтер|менеджер)/i;
  // D-380: строки-мусор из колонтитулов и подписей — даты, время, телефоны,
  // реквизиты. Без этого в позиции попадало «06.2027 09:07 GMT+03:00 — 6,2».
  const JUNK = /(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}|gmt|инн|кпп|бик|р\/с|к\/с|тел\.|www\.|@|e-?mail|страниц|лист)/i;
  const out = [];
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length < 12) continue;
    if (SKIP.test(line)) continue;
    if (JUNK.test(line)) continue;

    // «1  Наименование ....  20,2 т  101 900,00  2 058 380,00»
    const m = line.match(/^(\d{1,3})[.)\s]+(.+)$/);
    if (!m) continue;

    const rest = m[2];
    // Все числа с копейками / с разделителями тысяч в строке.
    const nums = [...rest.matchAll(/(\d[\d\s]*[.,]\d{2})/g)].map((x) => x[1]);
    if (!nums.length) continue;

    // Наименование — часть до первого числа.
    const nameEnd = rest.search(/\s{2,}\d|\s\d+[\.,]\d{2}/);
    const name = (nameEnd > 0 ? rest.slice(0, nameEnd) : rest).replace(/\s{2,}/g, ' ').trim();
    if (name.length < 5) continue;
    const words = name.split(/\s+/).filter((w) => w.length > 1);
    if (words.length < 2) continue;

    // D-380: позиция должна быть осмысленной — не «-- -- --» и не цифрами.
    const letters = (name.match(/[А-Яа-яЁёA-Za-z]/g) || []).length;
    if (letters < name.length * 0.5) continue;

    // Сумма позиции — последняя денежная величина в строке (обычно «Сумма»).
    const sumRaw = nums[nums.length - 1];
    const sum = num(sumRaw);
    // Слишком мелкая «сумма» — это остаток колонтитула, а не позиция.
    if (!sum || sum < 1) continue;

    // Количество и единица — если удалось выделить.
    const qtyM = rest.match(/(\d+[.,]?\d*)\s*(шт|т|кг|г|м3|м2|м|л|чел|пар|компл|услуг|рулон|меш)/i);

    out.push({
      name: name.slice(0, 300),
      quantity: qtyM ? num(qtyM[1]) : null,
      unit: qtyM ? qtyM[2].toLowerCase() : null,
      sum,
      article: null,
      unit_price: qtyM && num(qtyM[1]) ? Math.round((sum / num(qtyM[1])) * 100) / 100 : null,
      _source: 'parsed',
    });
  }

  // Дубли по имени+сумме — убираем (OCR иногда повторяет строку).
  const seen = new Set();
  return out.filter((x) => {
    const k = `${x.name}|${x.sum}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL
      || 'postgres://asgard:123456789@localhost/asgard_crm',
  });
  await c.connect();

  console.log(`режим: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}${USE_AI ? ' + ИИ' : ''}`);

  // Кандидаты: заявки без позиций, кроме отклонённых дублей.
  const params = [];
  let where = `pi.status <> 'rejected'`;
  if (idsArg && idsArg.length) {
    params.push(idsArg);
    where += ` AND pi.id = ANY($${params.length}::int[])`;
  }
  const rows = (await c.query(
    `SELECT pi.id, pi.invoice_number, pi.amount, pi.vat_rate, pi.vat_amount,
            pi.source_attachment_id, pi.file_path, pi.file_name, pi.doc_registry_id,
            jsonb_array_length(COALESCE(pi.line_items_json,'[]'::jsonb)) AS n_lines
       FROM payment_invoices pi
      WHERE ${where}
        AND jsonb_array_length(COALESCE(pi.line_items_json,'[]'::jsonb)) = 0
      ORDER BY pi.id`, params)).rows;

  console.log(`\n=== счетов без номенклатуры: ${rows.length} ===\n`);
  if (!rows.length) { await c.end(); return; }

  let filled = 0; let failed = 0;
  for (const pi of rows) {
    console.log(`#${pi.id} ${pi.invoice_number} — ${Number(pi.amount).toLocaleString('ru-RU')} ₽`);

    // 1. Что уже извлёк intake (не тратит денег).
    let lines = [];
    let src = '—';
    const intake = (await c.query(
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
          _source: 'intake.parse_raw',
        })).filter((l) => l.name && l.sum);
        if (lines.length) src = 'intake.parse_raw';
      }
    }

    // 2. Текст документа: слой или локальный OCR.
    if (!lines.length) {
      const file = await resolveFile(c, pi);
      if (file && file.abs && fs.existsSync(file.abs)) {
        const { text, src: textSrc } = readText(file.abs);
        console.log(`   файл: ${String(file.name).slice(0, 50)} | источник: ${textSrc}`);
        lines = parseLines(text);
        if (lines.length) src = textSrc;
      } else {
        console.log('   файл не найден');
      }
    }

    // 3. ИИ — только по явному флагу, и только если всё ещё пусто.
    if (!lines.length && USE_AI) {
      try {
        const ai = require(path.join(ROOT, 'src/services/invoice-ai-extract'));
        const file = await resolveFile(c, pi);
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
            _source: 'ai',
          })).filter((l) => l.name && l.sum);
          if (lines.length) src = 'ai';
        }
      } catch (e) {
        console.log('   ИИ: ' + String(e.message).slice(0, 80));
      }
    }

    if (!lines.length) {
      console.log('   ✗ позиции не восстановлены');
      failed++;
      continue;
    }

    const sumLines = lines.reduce((s, l) => s + (Number(l.sum) || 0), 0);
    const diff = Math.abs(sumLines - Number(pi.amount));
    const cmp = diff < 0.05 ? 'OK' : `расхождение ${diff.toFixed(2)}`;
    console.log(`   ✓ позиций ${lines.length} (${src}), сумма строк ${sumLines.toLocaleString('ru-RU')} — ${cmp}`);
    for (const l of lines.slice(0, 4)) {
      console.log(`      • ${String(l.name).slice(0, 70)} — ${Number(l.sum).toLocaleString('ru-RU')}`);
    }
    if (lines.length > 4) console.log(`      … ещё ${lines.length - 4}`);

    if (APPLY) {
      // Пишем в заявку и в строку реестра. Сумму счёта НЕ трогаем:
      // если сумма строк не сходится — это сигнал человеку, а не повод
      // подогнать цифры.
      const clean = lines.map(({ _source, ...rest }) => rest);
      try {
        await c.query(
          `UPDATE payment_invoices SET line_items_json=$2::jsonb, updated_at=NOW() WHERE id=$1`,
          [pi.id, JSON.stringify(clean)]);
        if (pi.doc_registry_id) {
          await c.query(
            `UPDATE doc_registry SET parsed_json = COALESCE(parsed_json,'{}'::jsonb) || jsonb_build_object('lines',$2::jsonb),
                    updated_at=NOW() WHERE id=$1`,
            [pi.doc_registry_id, JSON.stringify(clean)]).catch(() => {});
        }
        console.log('   → записано');
        filled++;
      } catch (e) {
        console.log('   ✗ запись: ' + e.message);
        failed++;
      }
    }
    console.log('');
  }

  console.log(`=== итог: восстановлено ${filled}, не удалось ${failed} из ${rows.length} ===`);
  if (!APPLY) console.log('(dry-run) для записи: --apply');

  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
