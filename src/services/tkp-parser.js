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
 *   3. Вернуть { text_extracted, parsed, confidence, ai_diagnostics }
 *
 * Намеренно НЕ используем estimateChat.parseDocumentContent —
 * она sandbox-ит путь к UPLOAD_BASE_DIR, а мы работаем с буфером в памяти.
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const aiProvider = require('./ai-provider');

const SUPPORTED_TEXT  = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.txt', '.csv', '.rtf']);
const SUPPORTED_IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const MAX_TEXT_CHARS = 20000; // AI-лимит на входной текст одного ТКП

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

// Поля, по заполненности которых считаем confidence
const CONFIDENCE_FIELDS = [
  'subject', 'customer_name', 'customer_inn',
  'items', 'total_sum', 'deadline', 'payment_terms', 'work_description'
];

/**
 * Извлечь текст из буфера по типу файла.
 * Для PDF сначала пробуем text-layer, при неудаче — OCR.
 * @returns {{ text: string, usedOcr: boolean }}
 */
async function _extractText(buf, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();

  if (ext === '.pdf') {
    // Попытка 1: текстовый слой
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buf);
      const text = (data.text || '').trim();
      if (text.length >= 200) return { text, usedOcr: false };
    } catch (_) {}

    // Попытка 2: OCR (скан без текстового слоя)
    const pdfOcr = require('./pdf-ocr');
    const tmpPath = path.join(os.tmpdir(), `tkp_parse_${Date.now()}.pdf`);
    try {
      fs.writeFileSync(tmpPath, buf);
      const text = await pdfOcr.ocrPdfPath(tmpPath, originalName);
      return { text, usedOcr: true };
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
          else vals.push(String(v));
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
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const pdfOcr = require('./pdf-ocr');
    const text = await pdfOcr.ocrImageBuffer(buf, mime, originalName);
    return { text, usedOcr: true };
  }

  throw new Error('Неподдерживаемый тип файла: ' + ext);
}

/**
 * Парсит буфер загруженного ТКП.
 *
 * @param {{ buf: Buffer, originalName: string, mime?: string }} opts
 * @returns {Promise<{
 *   text_extracted: string,
 *   parsed: object|null,
 *   confidence: number,
 *   ai_diagnostics: object
 * }>}
 */
async function parseTkpBuffer({ buf, originalName, mime }) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (!SUPPORTED_TEXT.has(ext) && !SUPPORTED_IMAGE.has(ext)) {
    throw new Error('Неподдерживаемый тип файла: ' + (ext || 'без расширения'));
  }

  // Шаг 1 — извлечь текст
  let textResult;
  try {
    textResult = await _extractText(buf, originalName);
  } catch (err) {
    return {
      text_extracted: '',
      parsed: null,
      confidence: 0,
      ai_diagnostics: { error: 'extract_failed', message: err.message }
    };
  }

  const text = textResult.text || '';
  if (text.length < 50) {
    return {
      text_extracted: text,
      parsed: null,
      confidence: 0,
      ai_diagnostics: { reason: 'too_short', used_ocr: textResult.usedOcr }
    };
  }

  const trimmed = text.substring(0, MAX_TEXT_CHARS);

  // Шаг 2 — AI-парсинг
  const ai = await aiProvider.complete({
    system: PARSE_SYSTEM,
    messages: [{ role: 'user', content: PARSE_PROMPT + trimmed }],
    maxTokens: 4000,
    temperature: 0.1
  });

  let parsed = null;
  try {
    let s = (ai.text || '').trim();
    // Убрать возможный markdown-блок
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    // Взять первый JSON-объект
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.substring(a, b + 1);
    parsed = JSON.parse(s);
  } catch (e) {
    return {
      text_extracted: trimmed,
      parsed: null,
      confidence: 0,
      ai_diagnostics: {
        error: 'json_parse_failed',
        raw: (ai.text || '').substring(0, 500)
      }
    };
  }

  // Шаг 3 — confidence по доле заполненных ключевых полей
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

  return {
    text_extracted: trimmed,
    parsed,
    confidence,
    ai_diagnostics: {
      model: ai.model,
      tokens: ai.usage,
      used_ocr: textResult.usedOcr,
      file: { name: originalName, mime, size: buf.length }
    }
  };
}

module.exports = { parseTkpBuffer };
