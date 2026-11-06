'use strict';

/**
 * ASGARD CRM — TKP Parser
 *
 * Принимает буфер загруженного файла (PDF / DOCX / XLSX / XLS / JPG / PNG / WEBP)
 * и возвращает структурированные данные ТКП для предзаполнения формы.
 *
 * Пайплайн:
 *   1. Извлечь текст: pdf-parse / mammoth / exceljs / прямое чтение / OCR
 *   2. Прогнать текст через AI-провайдер с промптом "распарси ТКП → JSON"
 *   3. Вернуть { ok, text_extracted, parsed, confidence, warnings, ai_diagnostics }
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const aiProvider = require('./ai-provider');

const SUPPORTED_TEXT  = new Set(['.pdf', '.doc', '.docx', '.xlsx', '.xls', '.txt', '.csv', '.rtf']);
const SUPPORTED_IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff']);

const MAX_TEXT_CHARS = 100000;

const PARSE_SYSTEM = 'Ты — парсер коммерческих предложений. Извлекаешь данные из текста КП и возвращаешь СТРОГО валидный JSON без markdown-блоков и без пояснений.';

const PARSE_PROMPT = `Тебе дан текст коммерческого предложения (ТКП / КП). Извлеки данные в JSON.
Если поле отсутствует — оставь null. Не выдумывай.

Схема ответа (только JSON, без markdown):
{
  "subject": "Тема/название КП",
  "customer_name": "ООО ...",
  "customer_inn": "10 или 12 цифр или null",
  "customer_address": "... или null",
  "contact_person": "ФИО или null",
  "contact_phone": "телефон или null",
  "contact_email": "email или null",
  "work_description": "Краткое описание работ (1-3 предложения) или null",
  "items": [{"name":"...","unit":"усл.","qty":1,"price":280000,"total":280000}],
  "subtotal": 0,
  "vat_pct": 20,
  "vat_sum": 0,
  "total_sum": 0,
  "deadline": "срок выполнения текстом или null",
  "validity_days": 30,
  "payment_terms": "условия оплаты или null",
  "notes": "примечания или null"
}

ТЕКСТ ТКП:
`;

const REFINE_PROMPT_EXTRA = `

РЕЖИМ УТОЧНЯЮЩЕГО РАСПОЗНАВАНИЯ:
Текст получен повторным OCR (возможно с повышенным DPI). Будь особенно внимателен к:
- ИНН (ровно 10 или 12 цифр), названиям организаций, адресам
- суммам, НДС, таблицам позиций
- срокам и условиям оплаты
Не выдумывай поля, которых нет в тексте.
`;

const CONFIDENCE_FIELDS = [
  'subject', 'customer_name', 'customer_inn',
  'items', 'total_sum', 'deadline', 'payment_terms', 'work_description'
];

function _truthy(v) {
  if (v === true || v === 1) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * Извлечь текст из буфера по типу файла.
 * @param {Buffer} buf
 * @param {string} originalName
 * @param {{ forceOcr?: boolean, mode?: string }} opts
 * @returns {{ text: string, usedOcr: boolean, ocrDiagnostics?: object }}
 */
/**
 * Старый Word .doc (OLE2) через LibreOffice.
 *
 * mammoth понимает только .docx, а .doc — это OLE-контейнер. Раньше такие
 * файлы давали 0 символов: ТЗ АО «АЗП» на 5,8 МБ не читалось вообще.
 * Конвертируем сначала в docx (mammoth даёт чистый текст), затем в txt.
 */
function _docViaLibreOffice(buf, originalName) {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-'));
  try {
    const src = path.join(tmpDir, 'in.doc');
    fs.writeFileSync(src, buf);

    const bins = [
      'soffice', 'libreoffice', '/usr/bin/soffice', '/usr/bin/libreoffice',
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
    ];

    for (const bin of bins) {
      const profile = path.join(tmpDir, 'prof');
      fs.mkdirSync(profile, { recursive: true });
      const base = [
        '--headless', '--norestore', '--nolockcheck',
        `-env:UserInstallation=file://${profile.replace(/\\/g, '/')}`
      ];

      // 1) txt:Text — самый простой и надёжный путь для .doc.
      const rTxt = spawnSync(bin, base.concat(['--convert-to', 'txt:Text', '--outdir', tmpDir, src]),
        { timeout: 90000, encoding: 'utf8' });
      if (!rTxt.error && rTxt.status === 0) {
        const txt = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith('.txt'));
        if (txt) {
          const text = String(fs.readFileSync(path.join(tmpDir, txt), 'utf8') || '')
            .replace(/^\uFEFF/, '').trim();
          if (text.length >= 20) return text.slice(0, MAX_TEXT_CHARS);
        }
      }

      // 2) docx + mammoth — если txt-фильтр недоступен.
      const rDocx = spawnSync(bin, base.concat(['--convert-to', 'docx', '--outdir', tmpDir, src]),
        { timeout: 90000, encoding: 'utf8' });
      if (!rDocx.error && rDocx.status === 0) {
        const docx = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith('.docx'));
        if (docx) {
          try {
            const mammoth = require('mammoth');
            const m = mammoth.extractRawText({ buffer: fs.readFileSync(path.join(tmpDir, docx)) });
            const text = String((m && m.value) || '').trim();
            if (text.length >= 20) return text.slice(0, MAX_TEXT_CHARS);
          } catch (_) { /* пробуем следующий бинарь */ }
        }
      }
    }
    return '';
  } catch (_) {
    return '';
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

/**
 * Старый .xls через LibreOffice → CSV → текст.
 *
 * ExcelJS читает только .xlsx (это zip с XML), а .xls — это OLE-контейнер,
 * на котором он падает. Раньше такие документы загружались с 0 символов,
 * и анализ не видел объёмов. LibreOffice конвертирует .xls в CSV.
 */
function _xlsViaLibreOffice(buf, originalName) {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xls-'));
  try {
    const src = path.join(tmpDir, 'in' + (path.extname(originalName || '') || '.xls'));
    fs.writeFileSync(src, buf);

    // Ищем бинарь: на Linux это soffice/libreoffice, на Windows — в Program Files.
    const candidates = [
      'soffice', 'libreoffice',
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
    ];
    let done = false;
    for (const bin of candidates) {
      const profile = path.join(tmpDir, 'prof');
      fs.mkdirSync(profile, { recursive: true });
      const r = spawnSync(bin, [
        '--headless', '--norestore', '--nolockcheck',
        `-env:UserInstallation=file://${profile.replace(/\\/g, '/')}`,
        '--convert-to', 'csv:Text - txt - csv (StarCalc)',
        '--outdir', tmpDir, src
      ], { timeout: 90000, encoding: 'utf8' });
      if (r.error || r.status !== 0) continue;
      const csv = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith('.csv'));
      if (!csv) continue;
      const text = String(fs.readFileSync(path.join(tmpDir, csv), 'utf8') || '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .slice(0, MAX_TEXT_CHARS);
      if (text.trim().length >= 20) { done = true; return text; }
    }
    return done ? '' : '';
  } catch (_) {
    return '';
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function _extractText(buf, originalName, opts = {}) {  const ext = path.extname(originalName || '').toLowerCase();
  const forceOcr = !!opts.forceOcr;
  const refine = (opts.mode || 'initial') === 'refine';

  if (ext === '.pdf') {
    if (!forceOcr) {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buf);
        const text = (data.text || '').trim();
        if (text.length >= 200) return { text, usedOcr: false };
      } catch (_) {}
    }

    const pdfOcr = require('./pdf-ocr');
    const tmpPath = path.join(os.tmpdir(), `tkp_parse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`);
    try {
      fs.writeFileSync(tmpPath, buf);
      const ocrOpts = refine
        ? { dpi: 200, retryEmptyDpi: 250 }
        : { dpi: 100, retryEmptyDpi: 0, noFallback: true };
      const ocrResult = await pdfOcr.ocrPdfPath(tmpPath, originalName, ocrOpts);
      const text = typeof ocrResult === 'string' ? ocrResult : (ocrResult.text || '');
      const ocrDiagnostics = typeof ocrResult === 'object' ? ocrResult.diagnostics : undefined;
      return { text, usedOcr: true, ocrDiagnostics };
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }

  if (ext === '.doc') {
    // Старый Word (OLE2, сигнатура D0CF11E0). mammoth его не читает,
    // ExcelJS не при чём. Без этой ветки документ давал 0 символов
    // (проверено на ТЗ АО «АЗП», 5,8 МБ → 4177 символов через LibreOffice).
    const viaLo = _docViaLibreOffice(buf, originalName);
    if (viaLo && viaLo.length >= 20) return { text: viaLo, usedOcr: false };
    return { text: '', usedOcr: false };
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: buf });
    return { text: result.value || '', usedOcr: false };
  }

  if (ext === '.xlsx' || ext === '.xls') {
    // Сначала пробуем ExcelJS: он понимает .xlsx, но НЕ старый OLE .xls.
    // ВАЖНО: ExcelJS падает на файлах с картинками ("Cannot read properties
    // of undefined (reading 'anchors')") и на OLE .xls ("Can't find end of
    // central directory"). Оба случая теперь уходят в xlsx-библиотеку
    // и LibreOffice вместо тихого провала в 0 символов.
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      let text = '';
      wb.eachSheet((sheet) => {
        if (text.length >= MAX_TEXT_CHARS) return;
        text += `\n=== ${sheet.name} ===\n`;
        sheet.eachRow((row) => {
          if (text.length >= MAX_TEXT_CHARS) return;
          const vals = [];
          row.eachCell({ includeEmpty: false }, (cell) => {
            const v = cell.value;
            if (v == null) return;
            if (typeof v === 'object' && v.text) vals.push(String(v.text));
            else if (typeof v === 'object' && v.result != null) vals.push(String(v.result));
            else if (typeof v === 'object' && v.error) vals.push(String(v.error));
            else if (typeof v !== 'object') vals.push(String(v));
          });
          if (vals.length) text += vals.join(' | ') + '\n';
        });
      });
      if (String(text).trim().length >= 20) return { text, usedOcr: false };
    } catch (_) { /* падение ExcelJS — идём дальше, не сдаёмся */ }

    // Запасной путь 1: SheetJS (xlsx) — читает и .xlsx, и старый .xls,
    // и не спотыкается на картинках.
    try {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
      let text = '';
      for (const name of wb.SheetNames) {
        if (text.length >= MAX_TEXT_CHARS) break;
        const sheet = wb.Sheets[name];
        if (!sheet) continue;
        text += `\n=== ${name} ===\n`;
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        text += String(csv || '').slice(0, MAX_TEXT_CHARS - text.length);
      }
      if (String(text).trim().length >= 20) return { text, usedOcr: false };
    } catch (_) { /* нет SheetJS или файл битый */ }

    // Запасной путь 2: старый .xls (OLE) через LibreOffice.
    const viaLo = _xlsViaLibreOffice(buf, originalName);
    if (viaLo && viaLo.length >= 20) return { text: viaLo, usedOcr: false };

    return { text: '', usedOcr: false };
  }

  if (ext === '.txt' || ext === '.csv' || ext === '.rtf') {
    return { text: buf.toString('utf-8'), usedOcr: false };
  }

  if (SUPPORTED_IMAGE.has(ext)) {
    const pdfOcr = require('./pdf-ocr');
    // mime резолвит pdf-ocr по sniff/расширению (TIFF→PNG внутри)
    const text = await pdfOcr.ocrImageBuffer(buf, null, originalName);
    return { text, usedOcr: true };
  }

  throw new Error('Неподдерживаемый тип файла: ' + ext);
}

/**
 * Парсит буфер загруженного ТКП.
 *
 * @param {{ buf: Buffer, originalName: string, mime?: string, force_ocr?: boolean|string, mode?: string }} opts
 */
async function parseTkpBuffer({ buf, originalName, mime, force_ocr, mode }) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (!SUPPORTED_TEXT.has(ext) && !SUPPORTED_IMAGE.has(ext)) {
    throw new Error('Неподдерживаемый тип файла: ' + (ext || 'без расширения'));
  }

  const forceOcr = _truthy(force_ocr);
  const parseMode = (mode === 'refine') ? 'refine' : 'initial';
  const warnings = [];

  let textResult;
  try {
    textResult = await _extractText(buf, originalName, { forceOcr, mode: parseMode });
  } catch (err) {
    return {
      ok: false,
      reason: 'extract_failed',
      text_extracted: '',
      parsed: null,
      confidence: 0,
      warnings: [err.message],
      ai_diagnostics: { error: 'extract_failed', message: err.message, mode: parseMode, force_ocr: forceOcr }
    };
  }

  const text = textResult.text || '';
  if (text.length < 50) {
    return {
      ok: false,
      reason: 'too_short',
      text_extracted: text,
      parsed: null,
      confidence: 0,
      warnings: ['Извлечено слишком мало текста (<50 символов). Попробуйте повторное сканирование.'],
      ai_diagnostics: {
        reason: 'too_short',
        used_ocr: textResult.usedOcr,
        mode: parseMode,
        force_ocr: forceOcr,
        ocr: textResult.ocrDiagnostics || null
      }
    };
  }

  const trimmed = text.substring(0, MAX_TEXT_CHARS);
  if (textResult.usedOcr && textResult.ocrDiagnostics && textResult.ocrDiagnostics.empty_pages > 0) {
    warnings.push('Часть страниц распознана слабо — можно запустить уточняющее сканирование.');
  }

  const prompt = PARSE_PROMPT + (parseMode === 'refine' ? REFINE_PROMPT_EXTRA : '') + trimmed;

  const ai = await aiProvider.complete({
    system: PARSE_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4000,
    temperature: 0.1
  });

  let parsed = null;
  try {
    let s = (ai.text || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.substring(a, b + 1);
    parsed = JSON.parse(s);
  } catch (e) {
    return {
      ok: false,
      reason: 'json_parse_failed',
      text_extracted: trimmed,
      parsed: null,
      confidence: 0,
      warnings: ['AI вернул невалидный JSON. Попробуйте повторное сканирование.'],
      ai_diagnostics: {
        error: 'json_parse_failed',
        raw: (ai.text || '').substring(0, 500),
        mode: parseMode,
        force_ocr: forceOcr,
        used_ocr: textResult.usedOcr,
        ocr: textResult.ocrDiagnostics || null
      }
    };
  }

  let filled = 0;
  for (const k of CONFIDENCE_FIELDS) {
    const v = parsed[k];
    if (v !== null && v !== undefined && v !== '' &&
        !(Array.isArray(v) && v.length === 0) &&
        v !== 0) {
      filled++;
    }
  }
  const confidence = filled / CONFIDENCE_FIELDS.length;
  if (confidence < 0.4) {
    warnings.push('Низкая уверенность распознавания — проверьте поля вручную или пересканируйте.');
  }

  return {
    ok: true,
    reason: null,
    text_extracted: trimmed,
    parsed,
    confidence,
    warnings,
    ai_diagnostics: {
      model: ai.model,
      tokens: ai.usage,
      used_ocr: textResult.usedOcr,
      mode: parseMode,
      force_ocr: forceOcr,
      file: { name: originalName, mime, size: buf.length },
      ocr: textResult.ocrDiagnostics || null
    }
  };
}

/**
 * Только извлечение текста (без AI-парсинга ТКП). Для ТЗ / архивов в Quick.
 * PDF: текстовый слой → иначе быстрый batched OCR (dpi 90, без повторных ретраев).
 */
async function extractTextOnly({ buf, originalName, force_ocr, allowOcr }) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (!SUPPORTED_TEXT.has(ext) && !SUPPORTED_IMAGE.has(ext)) {
    return { text: '', usedOcr: false, unsupported: true, ext };
  }
  const canOcr = allowOcr !== false;
  try {
    if (ext === '.pdf') {
      if (!force_ocr) {
        try {
          const pdfParse = require('pdf-parse');
          const data = await pdfParse(buf);
          const text = String(data.text || '').trim();
          if (text.length >= 200) {
            return { text: text.substring(0, MAX_TEXT_CHARS), usedOcr: false, unsupported: false, ext };
          }
        } catch (_) { /* fallthrough */ }
      }
      if (!canOcr) {
        return { text: '', usedOcr: false, unsupported: false, ext, skippedOcr: true };
      }
      const pdfOcr = require('./pdf-ocr');
      const tmpPath = path.join(os.tmpdir(), `tkpq_ocr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`);
      try {
        fs.writeFileSync(tmpPath, buf);
        // Быстрый профиль: один проход, батчи страниц, без DPI-retry и без same-model fallback
        const ocrResult = await pdfOcr.ocrPdfPath(tmpPath, originalName, {
          dpi: 90,
          batchSize: 6,
          concurrency: 4,
          noFallback: true,
          retryEmptyDpi: 0,
          maxPages: 80
        });
        const text = typeof ocrResult === 'string' ? ocrResult : (ocrResult.text || '');
        return {
          text: String(text).substring(0, MAX_TEXT_CHARS),
          usedOcr: true,
          unsupported: false,
          ext,
          diagnostics: typeof ocrResult === 'object' ? ocrResult.diagnostics : undefined
        };
      } finally {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
    }

    if (SUPPORTED_IMAGE.has(ext)) {
      if (!canOcr) return { text: '', usedOcr: false, unsupported: false, ext, skippedOcr: true };
      const r = await _extractText(buf, originalName, { forceOcr: true });
      return {
        text: String(r.text || '').substring(0, MAX_TEXT_CHARS),
        usedOcr: !!r.usedOcr,
        unsupported: false,
        ext
      };
    }

    // docx/xlsx/txt — без OCR
    const r = await _extractText(buf, originalName, { forceOcr: false });
    return {
      text: String(r.text || '').substring(0, MAX_TEXT_CHARS),
      usedOcr: false,
      unsupported: false,
      ext
    };
  } catch (e) {
    return { text: '', usedOcr: false, unsupported: false, error: e.message, ext };
  }
}

module.exports = { parseTkpBuffer, extractTextOnly };
