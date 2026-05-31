/**
 * ASGARD CRM — Mimir Conductor: парсер ответа заказчика (Сессия 5, Шаг 5.4)
 * ═══════════════════════════════════════════════════════════════════════════
 * Берёт загруженный заказчиком файл-ответ (PDF/DOCX/XLSX/TXT) или вставленный
 * текст и сопоставляет его с нашими открытыми вопросами. Извлечение текста —
 * через уже существующий estimateChat.parseDocumentContent (тот же путь, что у
 * document_parser в Сессии 4). Маппинг — Sonnet 4.6, но в stub-режиме баланс НЕ
 * тратится: возвращается детерминированный «неуверенный» маппинг, который РП
 * подтверждает/правит вручную в UI.
 *
 * Возврат: { matches:[{question_id, answer_text, answer_fragment, confidence, note}],
 *            additional_info }
 * Сохраняется в mimir_customer_letters.reply_parsed_mapping (status PARSED).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');

const db = require('../db');
const aiProvider = require('../ai-provider');
const { parseStrictJson } = require('./agents/_util');
const { getLetterById } = require('./letter-generator');

/** Извлечь текст из загруженного файла ответа. */
async function extractReplyText(replyPath, rawText) {
  if (rawText && String(rawText).trim()) return String(rawText).trim();
  if (!replyPath) return '';

  const ext = path.extname(replyPath).toLowerCase();
  // Простые текстовые форматы читаем напрямую.
  if (['.txt', '.csv'].includes(ext)) {
    try { return fs.readFileSync(replyPath, 'utf8'); } catch (_) { return ''; }
  }
  // Остальное (pdf/docx/xls/xlsx/rtf) — через общий парсер документов.
  try {
    const { parseDocumentContent } = require('../estimateChat');
    const doc = {
      filename: path.basename(replyPath),
      original_name: path.basename(replyPath),
      // parseDocumentContent ожидает путь к файлу в uploads/, но принимает и абсолютный
      path: replyPath
    };
    const content = await parseDocumentContent(doc);
    if (typeof content === 'string') return content;
    if (content && typeof content.text === 'string') return content.text;
    return '';
  } catch (_) {
    // Фолбэк: читаем как utf8 (может быть мусор для бинарных, но не падаем).
    try { return fs.readFileSync(replyPath, 'utf8'); } catch (__) { return ''; }
  }
}

/** Детерминированный маппинг для stub-режима / фолбэка. */
function stubMapping(questions, replyText) {
  const fragment = (replyText || '').slice(0, 200);
  return {
    matches: questions.map((q) => ({
      question_id: Number(q.id),
      answer_text: null,            // не уверены — РП заполнит вручную
      answer_fragment: fragment,
      confidence: 0,
      note: 'stub-режим: автоматическое сопоставление не выполнялось, требуется ручная разметка РП'
    })),
    additional_info: replyText
      ? 'Текст ответа загружен. В stub-режиме модель не вызывалась — заполните ответы вручную.'
      : 'Текст ответа пуст.'
  };
}

/**
 * Распарсить ответ заказчика и сопоставить с вопросами письма.
 * @param {number} letterId
 * @param {string|null} replyPath — путь к загруженному файлу (или null)
 * @param {string|null} rawText — вставленный текст (или null)
 */
async function parseReplyAndMap(letterId, replyPath, rawText) {
  const letter = await getLetterById(letterId);
  if (!letter) throw new Error(`Письмо ${letterId} не найдено`);

  const qIds = (letter.questions_ids || []).map(Number);
  const qres = await db.query(
    'SELECT id, question_ru FROM mimir_clarifications WHERE id = ANY($1)',
    [qIds]
  );
  const questions = qres.rows;

  const replyText = await extractReplyText(replyPath, rawText);

  let mapping;
  if (aiProvider.isStubMode()) {
    mapping = stubMapping(questions, replyText);
  } else {
    const prompt = `Заказчик прислал ответ. Сопоставь его текст с нашими вопросами.

═══ НАШИ ВОПРОСЫ ═══
${questions.map((q) => `Q${q.id}: ${q.question_ru}`).join('\n\n')}

═══ ТЕКСТ ОТВЕТА ЗАКАЗЧИКА ═══
${replyText || '(пусто)'}

═══ ВЕРНИ СТРОГО JSON ═══
{
  "matches": [
    { "question_id": <id>, "answer_text": "<ответ или null>",
      "answer_fragment": "<точная цитата>", "confidence": 0.0-1.0,
      "note": "<если ответ неоднозначный/неполный>" }
  ],
  "additional_info": "<важное помимо вопросов или null>"
}`;
    try {
      const result = await aiProvider.complete({
        system: 'Ты — внимательный аналитик переписки. Извлекаешь ответы заказчика на конкретные вопросы. Возвращаешь только JSON.',
        messages: [{ role: 'user', content: prompt }],
        model: 'sonnet-4-6',
        maxTokens: 4000
      });
      mapping = parseStrictJson(result.text);
      if (!mapping || !Array.isArray(mapping.matches)) mapping = stubMapping(questions, replyText);
    } catch (_) {
      mapping = stubMapping(questions, replyText);
    }
  }

  // Сохраняем результат разбора
  await db.query(
    `UPDATE mimir_customer_letters
        SET reply_parsed_mapping = $1, status = 'PARSED', reply_received_at = NOW(),
            uploaded_reply_path = COALESCE($2, uploaded_reply_path)
      WHERE id = $3`,
    [JSON.stringify(mapping), replyPath || null, letterId]
  );

  try {
    await cr_addEvent(letter.conductor_run_id, 'reply_parsed', {
      letter_id: letterId, matched: (mapping.matches || []).length
    });
  } catch (_) { /* событие не критично */ }

  return mapping;
}

// Ленивая обёртка над conductor-run.addEvent (избегаем циклической ссылки на этапе require).
async function cr_addEvent(runId, type, payload) {
  if (!runId) return;
  const cr = require('./conductor-run');
  await cr.addEvent(runId, null, type, payload);
}

module.exports = { parseReplyAndMap, extractReplyText };
