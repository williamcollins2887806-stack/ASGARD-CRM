/**
 * ASGARD CRM — AI Email Analyzer Service (Optimized)
 * ═══════════════════════════════════════════════════════════════════════════
 * Классифицирует входящие письма с помощью ИИ
 *
 * Исправления:
 *  - getWorkloadData() использует таблицу users вместо employees
 *  - Улучшенная обработка ошибок при запросах к БД
 */

'use strict';

const db = require('./db');
const aiProvider = require('./ai-provider');

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

// ── Анализ письма ────────────────────────────────────────────────────

async function analyzeEmail({ emailId, subject, bodyText, fromEmail, fromName, attachmentNames }) {
  try {
    const workload = await getWorkloadData();

    const userMessage = buildAnalysisMessage({
      subject, bodyText, fromEmail, fromName, attachmentNames, workload
    });

    const response = await aiProvider.complete({
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1024,
      temperature: 0.3
    });

    const result = parseAIResponse(response.text);
    result._raw = {
      model: response.model,
      provider: response.provider,
      usage: response.usage,
      durationMs: response.durationMs
    };

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
    console.error('[AI-Analyzer] Error:', err.message);

    await logAnalysis({
      entityType: 'email',
      entityId: emailId || 0,
      analysisType: 'email_classification',
      error: err.message,
      inputPreview: (subject || '').slice(0, 200)
    });

    return fallbackClassification({ subject, bodyText, fromEmail });
  }
}

function buildAnalysisMessage({ subject, bodyText, fromEmail, fromName, attachmentNames, workload }) {
  let msg = `ВХОДЯЩЕЕ ПИСЬМО:\n`;
  msg += `От: ${fromName || 'Неизвестно'} <${fromEmail || '?'}>\n`;
  msg += `Тема: ${subject || '(без темы)'}\n\n`;

  if (bodyText) {
    const maxLen = 3000;
    const body = bodyText.length > maxLen ? bodyText.slice(0, maxLen) + '...[обрезано]' : bodyText;
    msg += `ТЕКСТ ПИСЬМА:\n${body}\n\n`;
  }

  if (attachmentNames?.length) {
    msg += `ВЛОЖЕНИЯ: ${attachmentNames.join(', ')}\n\n`;
  }

  if (workload) {
    msg += `ТЕКУЩАЯ ЗАГРУЗКА КОМПАНИИ:\n`;
    msg += `- Активных работ: ${workload.activeWorks}\n`;
    msg += `- Свободных сотрудников: ${workload.availableCrews}\n`;
    msg += `- Тендеров в работе: ${workload.activeTenders}\n`;
    if (workload.nextFreeDate) {
      msg += `- Ближайшая свободная дата: ${workload.nextFreeDate}\n`;
    }
    msg += '\n';
  }

  msg += 'Проанализируй письмо и верни JSON с классификацией.';
  return msg;
}

function parseAIResponse(text) {
  if (!text) return fallbackResult();

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

// ── Данные о загрузке (ИСПРАВЛЕНО: employees → users) ────────────────

async function getWorkloadData() {
  try {
    // Запросы с защитой от отсутствующих таблиц
    const queries = [
      db.query(`SELECT COUNT(*) as cnt FROM works WHERE work_status IN ('В работе','Мобилизация','На объекте')`).catch(() => ({ rows: [{ cnt: 0 }] })),
      db.query(`SELECT COUNT(*) as cnt FROM tenders WHERE tender_status IN ('Новый','В работе','Готовим КП')`).catch(() => ({ rows: [{ cnt: 0 }] })),
      // ИСПРАВЛЕНИЕ: используем users вместо employees (таблица employees не существует)
      db.query(`SELECT COUNT(*) as cnt FROM users WHERE is_active = true AND role IN ('WORKER','FOREMAN','MASTER')`).catch(() => ({ rows: [{ cnt: 0 }] }))
    ];

    const [worksRes, tendersRes, usersRes] = await Promise.all(queries);

    return {
      activeWorks: parseInt(worksRes.rows[0]?.cnt || 0),
      activeTenders: parseInt(tendersRes.rows[0]?.cnt || 0),
      availableCrews: parseInt(usersRes.rows[0]?.cnt || 0),
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
