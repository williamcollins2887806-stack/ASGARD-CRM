/**
 * ASGARD CRM — AI Email Analyzer Service
 * Фаза 9: Анализ входящих писем с помощью ИИ
 *
 * Классифицирует входящие письма по:
 *  - Тип заявки (прямой запрос, тендерная площадка, КП, информация)
 *  - Цвет (green/yellow/red) — рекомендация по приоритету
 *  - Краткое резюме и рекомендация
 */

'use strict';

const db = require('./db');
const aiProvider = require('./ai-provider');
const fs = require('fs');
const path = require('path');

// ── System prompt для анализа входящих писем ─────────────────────────

const ANALYSIS_SYSTEM_PROMPT = `Ты — AI-ассистент компании АСГАРД СЕРВИС (нефтегазовый сервис).
Компания выполняет промышленные работы на объектах нефтегазовой отрасли:
- Промывка трубопроводов и ёмкостей
- Химическая обработка оборудования
- Монтаж/демонтаж технологического оборудования
- Антикоррозийная защита
- Изоляционные работы
- Сварочные работы (НАКС)
- Работы на высоте
- Такелажные и стропальные работы
- Работы в ограниченных пространствах

Твоя задача — проанализировать входящее письмо и классифицировать его.

Верни ответ СТРОГО в JSON формате:
{
  "classification": "direct_request" | "platform_tender" | "commercial_offer" | "information" | "spam" | "personal" | "other",
  "color": "green" | "yellow" | "red",
  "summary": "Краткое описание сути письма (1-2 предложения)",
  "recommendation": "Рекомендация действий (1-2 предложения)",
  "work_type": "Тип работ (если определяется) или null",
  "estimated_budget": число или null,
  "estimated_days": число или null,
  "keywords": ["ключевое_слово_1", "ключевое_слово_2"],
  "confidence": 0.0-1.0
}

Правила цветовой маркировки:
- GREEN: Наш профиль работ, есть потенциал, стоит брать в работу
- YELLOW: Частично наш профиль, нужна дополнительная оценка, сжатые сроки
- RED: Не наш профиль, нет ресурсов, спам, или нерелевантная заявка

Правила классификации:
- direct_request: Прямой запрос на выполнение работ от заказчика
- platform_tender: Тендер с площадки (Закупки44, ЕИС, Сбербанк-АСТ и т.д.)
- commercial_offer: Входящее коммерческое предложение (нам предлагают)
- information: Информационное письмо, уведомление
- spam: Спам, рассылка
- personal: Личное письмо
- other: Другое

ВАЖНО: Отвечай ТОЛЬКО JSON, без markdown-форматирования, без \`\`\`json блоков.`;

// ── Извлечение текста из вложений для классификации ──────────────────

const MAX_EXTRACT_PER_FILE = 3000;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function extractAttachmentTexts(emailId) {
  if (!emailId) return { texts: [], imageBlocks: [] };
  try {
    const attRes = await db.query(
      'SELECT original_filename, mime_type, size, file_path FROM email_attachments WHERE email_id = $1',
      [emailId]
    );
    if (!attRes.rows.length) return { texts: [], imageBlocks: [] };

    const texts = [];
    const imageBlocks = [];

    for (const a of attRes.rows) {
      if (!a.file_path) continue;
      const absPath = path.join(__dirname, '..', '..', a.file_path);
      if (!fs.existsSync(absPath)) continue;

      // Изображения — готовим для Vision
      if (IMAGE_MIMES.includes(a.mime_type) && imageBlocks.length < 3) {
        const stats = fs.statSync(absPath);
        if (stats.size <= 5 * 1024 * 1024) {
          const buf = fs.readFileSync(absPath);
          imageBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: a.mime_type, data: buf.toString('base64') }
          });
        }
        continue;
      }

      // XLSX
      if (a.mime_type?.includes('spreadsheet') || a.mime_type?.includes('ms-excel')
          || a.file_path.endsWith('.xlsx') || a.file_path.endsWith('.xls')) {
        try {
          const ExcelJS = require('exceljs');
          const buf = fs.readFileSync(absPath);
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buf);
          const lines = [];
          workbook.eachSheet((sheet, sheetId) => {
            if (sheetId > 2) return;
            lines.push(`[${sheet.name}]`);
            let cnt = 0;
            sheet.eachRow((row) => {
              if (cnt++ > 100) return;
              const vals = [];
              row.eachCell((cell) => {
                const v = cell.text || cell.value;
                if (v != null && v !== '') vals.push(String(v).trim());
              });
              if (vals.length) lines.push(vals.join(' | '));
            });
          });
          if (lines.length) texts.push(`[${a.original_filename}]\n${lines.join('\n').slice(0, MAX_EXTRACT_PER_FILE)}`);
        } catch (_) {}
        continue;
      }

      // PDF
      if (a.mime_type === 'application/pdf' || a.file_path.endsWith('.pdf')) {
        try {
          const pdfParse = require('pdf-parse');
          const buf = fs.readFileSync(absPath);
          const result = await pdfParse(buf);
          if (result.text) texts.push(`[${a.original_filename}]\n${result.text.slice(0, MAX_EXTRACT_PER_FILE)}`);
        } catch (_) {}
        continue;
      }

      // DOCX
      if (a.file_path.endsWith('.docx') || a.mime_type?.includes('wordprocessingml')) {
        try {
          const mammoth = require('mammoth');
          const buf = fs.readFileSync(absPath);
          const result = await mammoth.extractRawText({ buffer: buf });
          if (result.value) texts.push(`[${a.original_filename}]\n${result.value.slice(0, MAX_EXTRACT_PER_FILE)}`);
        } catch (_) {}
      }
    }

    return { texts, imageBlocks };
  } catch (err) {
    console.warn('[AI-Analyzer] Attachment extraction error:', err.message);
    return { texts: [], imageBlocks: [] };
  }
}

// ── Анализ письма ────────────────────────────────────────────────────

async function analyzeEmail({ emailId, subject, bodyText, fromEmail, fromName, attachmentNames }) {
  const startTime = Date.now();
  let result = null;
  let error = null;

  try {
    // Собираем контекст о загрузке
    const workload = await getWorkloadData();

    // Извлекаем содержимое вложений (текст + изображения)
    const { texts: attachmentTexts, imageBlocks } = await extractAttachmentTexts(emailId);

    const userMessage = buildAnalysisMessage({
      subject, bodyText, fromEmail, fromName, attachmentNames, workload, attachmentTexts
    });

    // Формируем content: текст + (опционально) изображения
    const config = aiProvider.getConfig();
    let messageContent;
    if (imageBlocks.length > 0 && config.hasAnthropicKey) {
      messageContent = [
        { type: 'text', text: userMessage + '\n\nК письму приложены изображения. Учти их содержимое при классификации.' },
        ...imageBlocks
      ];
    } else {
      messageContent = userMessage;
    }

    const response = await aiProvider.complete({
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageContent }],
      maxTokens: 1024,
      temperature: 0.3
    });

    // Парсим JSON-ответ
    result = parseAIResponse(response.text);
    result._raw = {
      model: response.model,
      provider: response.provider,
      usage: response.usage,
      durationMs: response.durationMs
    };

    // Логируем в ai_analysis_log
    await logAnalysis({
      entityType: 'email',
      entityId: emailId || 0,
      analysisType: 'email_classification',
      promptTokens: response.usage?.inputTokens || 0,
      completionTokens: response.usage?.outputTokens || 0,
      model: response.model,
      provider: response.provider,
      durationMs: response.durationMs,
      inputPreview: (subject || '').slice(0, 200),
      outputJson: result
    });

    return result;
  } catch (err) {
    error = err;
    console.error('[AI-Analyzer] Error:', err.message);

    // Логируем ошибку
    await logAnalysis({
      entityType: 'email',
      entityId: emailId || 0,
      analysisType: 'email_classification',
      error: err.message,
      inputPreview: (subject || '').slice(0, 200)
    });

    // Fallback — базовая классификация без AI
    return fallbackClassification({ subject, bodyText, fromEmail });
  }
}

// ── Построение сообщения для AI ──────────────────────────────────────

function buildAnalysisMessage({ subject, bodyText, fromEmail, fromName, attachmentNames, workload, attachmentTexts }) {
  let msg = `ВХОДЯЩЕЕ ПИСЬМО:\n`;
  msg += `От: ${fromName || 'Неизвестно'} <${fromEmail || '?'}>\n`;
  msg += `Тема: ${subject || '(без темы)'}\n\n`;

  if (bodyText) {
    // Ограничиваем длину тела
    const maxLen = 3000;
    const body = bodyText.length > maxLen ? bodyText.slice(0, maxLen) + '...[обрезано]' : bodyText;
    msg += `ТЕКСТ ПИСЬМА:\n${body}\n\n`;
  }

  if (attachmentNames?.length) {
    msg += `ВЛОЖЕНИЯ: ${attachmentNames.join(', ')}\n\n`;
  }

  // Извлечённое содержимое вложений (PDF, DOCX, XLSX)
  if (attachmentTexts?.length) {
    msg += `СОДЕРЖИМОЕ ВЛОЖЕНИЙ:\n${attachmentTexts.join('\n\n').slice(0, 8000)}\n\n`;
  }

  if (workload) {
    msg += `ТЕКУЩАЯ ЗАГРУЗКА КОМПАНИИ:\n`;
    msg += `- Активных работ: ${workload.activeWorks}\n`;
    msg += `- Свободных бригад: ${workload.availableCrews}\n`;
    msg += `- Тендеров в работе: ${workload.activeTenders}\n`;
    if (workload.nextFreeDate) {
      msg += `- Ближайшая свободная дата: ${workload.nextFreeDate}\n`;
    }
    msg += '\n';
  }

  msg += 'Проанализируй письмо и верни JSON с классификацией.';
  return msg;
}

// ── Парсинг ответа AI ────────────────────────────────────────────────

function parseAIResponse(text) {
  if (!text) return fallbackResult();

  // Удаляем markdown-обёртку если есть
  let clean = text.trim();
  if (clean.startsWith('```json')) clean = clean.slice(7);
  if (clean.startsWith('```')) clean = clean.slice(3);
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  clean = clean.trim();

  try {
    const parsed = JSON.parse(clean);
    return {
      classification: parsed.classification || 'other',
      color: ['green', 'yellow', 'red'].includes(parsed.color) ? parsed.color : 'yellow',
      summary: parsed.summary || '',
      recommendation: parsed.recommendation || '',
      work_type: parsed.work_type || null,
      estimated_budget: parsed.estimated_budget || null,
      estimated_days: parsed.estimated_days || null,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
    };
  } catch (e) {
    console.error('[AI-Analyzer] JSON parse error:', e.message);
    return fallbackResult();
  }
}

function fallbackResult() {
  return {
    classification: 'other',
    color: 'yellow',
    summary: 'Не удалось автоматически классифицировать',
    recommendation: 'Требуется ручная проверка',
    work_type: null,
    estimated_budget: null,
    estimated_days: null,
    keywords: [],
    confidence: 0
  };
}

// ── Fallback без AI ──────────────────────────────────────────────────

function fallbackClassification({ subject, bodyText, fromEmail }) {
  const text = ((subject || '') + ' ' + (bodyText || '')).toLowerCase();

  const tenderKeywords = ['тендер', 'конкурс', 'закупк', 'аукцион', 'котировк', 'запрос предложений', 'запрос цен'];
  const workKeywords = ['промывк', 'химическ', 'монтаж', 'демонтаж', 'сварк', 'изоляц', 'антикорроз', 'такелаж', 'строп'];
  const spamKeywords = ['unsubscribe', 'рассылк', 'реклам', 'акция', 'скидк'];

  const isTender = tenderKeywords.some(k => text.includes(k));
  const isWork = workKeywords.some(k => text.includes(k));
  const isSpam = spamKeywords.some(k => text.includes(k));

  if (isSpam) {
    return { classification: 'spam', color: 'red', summary: 'Возможный спам/рассылка', recommendation: 'Архивировать', work_type: null, estimated_budget: null, estimated_days: null, keywords: [], confidence: 0.3 };
  }
  if (isTender) {
    return { classification: 'platform_tender', color: 'yellow', summary: 'Возможный тендер', recommendation: 'Проверить условия', work_type: null, estimated_budget: null, estimated_days: null, keywords: [], confidence: 0.3 };
  }
  if (isWork) {
    return { classification: 'direct_request', color: 'green', summary: 'Возможный запрос на работы', recommendation: 'Рассмотреть', work_type: null, estimated_budget: null, estimated_days: null, keywords: [], confidence: 0.3 };
  }

  return fallbackResult();
}

// ── Данные о загрузке ────────────────────────────────────────────────

async function getWorkloadData() {
  try {
    const [worksRes, tendersRes, employeesRes] = await Promise.all([
      db.query(`SELECT COUNT(*) as cnt FROM works WHERE work_status IN ('В работе','Мобилизация','На объекте')`),
      db.query(`SELECT COUNT(*) as cnt FROM tenders WHERE tender_status IN ('Новый','В работе','Готовим КП')`),
      db.query(`SELECT COUNT(*) as cnt FROM employees WHERE status = 'Свободен' AND is_active = true`)
    ]);

    return {
      activeWorks: parseInt(worksRes.rows[0]?.cnt || 0),
      activeTenders: parseInt(tendersRes.rows[0]?.cnt || 0),
      availableCrews: parseInt(employeesRes.rows[0]?.cnt || 0),
      nextFreeDate: null
    };
  } catch (e) {
    console.error('[AI-Analyzer] Workload query error:', e.message);
    return { activeWorks: 0, activeTenders: 0, availableCrews: 0, nextFreeDate: null };
  }
}

// ── Логирование ──────────────────────────────────────────────────────

async function logAnalysis({ entityType, entityId, analysisType, promptTokens, completionTokens, model, provider, durationMs, inputPreview, outputJson, error }) {
  try {
    await db.query(`
      INSERT INTO ai_analysis_log (
        entity_type, entity_id, analysis_type,
        prompt_tokens, completion_tokens, total_tokens,
        model, provider, duration_ms,
        input_preview, output_json, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      entityType, entityId, analysisType || 'email_classification',
      promptTokens || 0, completionTokens || 0, (promptTokens || 0) + (completionTokens || 0),
      model || null, provider || null, durationMs || 0,
      inputPreview || '', outputJson ? JSON.stringify(outputJson) : null, error || null
    ]);
  } catch (e) {
    console.error('[AI-Analyzer] Log write error:', e.message);
  }
}

// ── Генерация AI-отчёта ──────────────────────────────────────────────

const REPORT_SYSTEM_PROMPT = `Ты — AI-ассистент компании АСГАРД СЕРВИС (нефтегазовый сервис).
Составь краткий деловой отчёт по входящему запросу.

СТРУКТУРА ОТЧЁТА:
1. Заказчик — название организации, контактное лицо
2. Суть запроса — что хотят, какие работы
3. Объект — где нужно выполнить работы (город, предприятие, цех)
4. Объём работ — что именно нужно сделать (перечень)
5. Сроки — когда нужно, дедлайны
6. Особые условия — допуски, требования безопасности, специфика

НЕ ВКЛЮЧАЙ цены, стоимость, суммы.
Пиши кратко, по делу, деловым языком.
Если информации недостаточно — укажи "Данные отсутствуют" для соответствующего пункта.
Отвечай простым текстом без markdown-форматирования.`;

async function generateReport({ subject, bodyText, fromEmail, fromName, attachmentNames }) {
  try {
    let msg = `ВХОДЯЩЕЕ ПИСЬМО:\n`;
    msg += `От: ${fromName || 'Неизвестно'} <${fromEmail || '?'}>\n`;
    msg += `Тема: ${subject || '(без темы)'}\n\n`;

    if (bodyText) {
      const maxLen = 4000;
      const body = bodyText.length > maxLen ? bodyText.slice(0, maxLen) + '...[обрезано]' : bodyText;
      msg += `ТЕКСТ ПИСЬМА:\n${body}\n\n`;
    }

    if (attachmentNames?.length) {
      msg += `ВЛОЖЕНИЯ: ${attachmentNames.join(', ')}\n\n`;
    }

    msg += 'Составь деловой отчёт по этому запросу.';

    const response = await aiProvider.complete({
      system: REPORT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: msg }],
      maxTokens: 2048,
      temperature: 0.3
    });

    return response.text || null;
  } catch (err) {
    console.error('[AI-Analyzer] Report generation error:', err.message);
    return null;
  }
}

module.exports = {
  analyzeEmail,
  generateReport,
  getWorkloadData,
  parseAIResponse,
  ANALYSIS_SYSTEM_PROMPT
};
