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

const SUPPORTED_TEXT  = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.txt', '.csv', '.rtf']);
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
async function _extractText(buf, originalName, opts = {}) {
  const ext = path.extname(originalName || '').toLowerCase();
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

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: buf });
    return { text: result.value || '', usedOcr: false };
  }

  if (ext === '.xlsx' || ext === '.xls') {
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
    return { text, usedOcr: false };
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
