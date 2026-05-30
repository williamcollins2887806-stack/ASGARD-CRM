'use strict';

/**
 * ASGARD CRM — Мимир: быстрое ТКП (Quick TKP)
 *
 * Принимает ТЗ + историю заказчика → возвращает черновик ТКП:
 *   { chat_response_md, estimate: { subject, items[], subtotal, vat_pct, vat_sum, total_with_vat, ... } }
 *
 * Используется в POST /api/tkp-quick/sessions/:uid/calculate
 * и POST /api/tkp-quick/sessions/:uid/chat
 */

const aiProvider = require('./ai-provider');

const TKP_QUICK_SYSTEM = `Ты Мимир — ведущий инженер-сметчик ООО «Асгард Сервис» (промышленный сервис для нефтегаза).
Твоя задача: составить КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ (ТКП) клиенту на основе его технического задания.

═══ ПРАВИЛА ЦЕНООБРАЗОВАНИЯ ═══
- Маржа НЕ МЕНЕЕ 100% от себестоимости (итоговая цена клиенту = себестоимость × 2 и более).
- Непредвиденные расходы: минимум 12% (буфер безопасности, не снижать).
- СИЗ + спецодежда на каждого рабочего: минимум 25 000 ₽/чел.
- ИТР (РП) — 10 000 ₽/день (фиксировано). ВСЕГДА 1 человек ИТР.
- Дни дороги: 3 000 ₽/чел/день (6 баллов × 500 ₽).
- НДС — из настроек системы (обычно 20%).
- Лучше завысить цену на 10-15%, чем занизить. Заказчик всегда торгуется вниз.

═══ ВЕБ-ПОИСК ═══
Используй обязательно для:
- Актуальных цен материалов/оборудования 2026 (запрашивай с уточнением «цена 2026 Россия»)
- Цен билетов РЖД/авиа на конкретные направления
- Тарифов доставки и аренды спецтехники
- Цен СИЗ и расходных материалов
НЕ выдумывай цены из памяти — твои веса от начала 2025, сейчас 2026.

═══ ФОРМАТ ОТВЕТА ═══
Сначала — краткий анализ задания и обоснование подхода (3-7 предложений, markdown).
Затем JSON-блок с черновиком КП:

\`\`\`json
{
  "subject": "Краткое название КП",
  "work_description": "Описание работ для клиента (1-3 предложения)",
  "items": [
    {"name": "Наименование позиции", "unit": "усл.", "qty": 1, "price": 280000, "total": 280000}
  ],
  "subtotal": 280000,
  "vat_pct": 20,
  "vat_sum": 56000,
  "total_with_vat": 336000,
  "deadline": "10 рабочих дней с момента аванса",
  "payment_terms": "Аванс 50%, остаток по подписании акта",
  "notes": "Примечания (если есть)",
  "validity_days": 30
}
\`\`\`

ВАЖНО: JSON обязателен даже в ответах чата. Если пользователь просит правку — верни ОБНОВЛЁННЫЙ JSON.`;

/**
 * Форматирует историю контрагента из dashboard-ответа в текст для промпта.
 */
function _formatCustomerHistory(data) {
  if (!data) return '';
  const t  = data.tenders   || {};
  const k  = data.tkp       || {};
  const f  = data.finance   || {};
  const tl = data.traffic_light || {};
  const fmt = n => Number(n || 0).toLocaleString('ru-RU');

  return `
═══ ИСТОРИЯ КОНТРАГЕНТА ═══
Статус: ${tl.label || '—'} (${tl.color || 'gray'}) — ${tl.reason || ''}
Тендеры: всего ${t.total || 0}, выиграно ${t.won || 0} (${t.conversion_pct != null ? t.conversion_pct + '%' : '—'}), проиграно ${t.lost || 0}, в работе ${t.in_work || 0}
Сумма выигранных: ${fmt(t.won_sum)} ₽ | В работе: ${fmt(t.in_work_sum)} ₽
ТКП: всего ${k.total || 0}, принято ${k.accepted || 0}, отказ ${k.rejected || 0}, ожидает ${k.awaiting || 0}
Финансы: оплачено актов ${fmt(f.acts_paid_sum)} ₽, неоплачено ${fmt(f.acts_unpaid_sum)} ₽, просроченных счетов ${f.overdue_invoices_cnt || 0}
`.trim();
}

/**
 * Форматирует настройки расчёта в текст для промпта.
 */
function _formatSettings(settings) {
  if (!settings) return '';
  return `\n═══ НАСТРОЙКИ НДС ═══\nНДС: ${settings.vat_pct || 20}%\n`;
}

/**
 * Вытаскивает markdown-часть (до первого ```json блока).
 */
function _extractMarkdown(text) {
  if (!text) return '';
  const idx = text.indexOf('```json');
  return (idx > 0 ? text.substring(0, idx) : text).trim();
}

/**
 * Вытаскивает и парсит JSON-блок из ответа AI.
 */
function _extractEstimate(text) {
  if (!text) return null;
  const m = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (!m) {
    // Попытка найти сырой JSON-объект
    const a = text.lastIndexOf('{'), b = text.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(text.substring(a, b + 1)); } catch (_) {}
    }
    return null;
  }
  try {
    return JSON.parse(m[1]);
  } catch (_) {
    return null;
  }
}

/**
 * Загрузить настройки НДС из БД.
 */
async function _loadSettings(db) {
  const settings = { vat_pct: 20 };
  if (!db) return settings;
  try {
    const r = await db.query("SELECT value_json FROM settings WHERE key = 'vat_default_pct'");
    if (r.rows[0]) settings.vat_pct = parseFloat(r.rows[0].value_json) || 20;
  } catch (_) {}
  return settings;
}

/**
 * Основной вызов: генерация черновика ТКП через AI.
 *
 * @param {object} opts
 * @param {string} opts.tz_text           - ТЗ от пользователя
 * @param {string} [opts.customer_inn]
 * @param {string} [opts.customer_name]
 * @param {object} [opts.customer_data]   - Ответ от /api/customers/:inn/dashboard
 * @param {string} [opts.attachments_text]- OCR текст из прикреплённых файлов
 * @param {Array}  [opts.history]         - История сообщений для чата
 * @param {object} [opts.settings]        - { vat_pct }
 * @param {Function} [opts.onProgress]    - SSE callback
 * @returns {Promise<{chat_response_md, estimate, diagnostics}>}
 */
async function generateEstimate(opts) {
  const {
    tz_text, customer_inn, customer_name,
    customer_data, attachments_text,
    history = [], settings, onProgress = () => {}
  } = opts;

  // Составляем user-сообщение
  let userContent = '';

  if (customer_name || customer_inn) {
    userContent += `Заказчик: ${customer_name || ''}${customer_inn ? ' (ИНН ' + customer_inn + ')' : ''}\n\n`;
  }
  if (customer_data) {
    userContent += _formatCustomerHistory(customer_data) + '\n\n';
  }
  if (attachments_text && attachments_text.trim()) {
    userContent += '═══ ПРИЛОЖЕННЫЕ ДОКУМЕНТЫ (ТЗ, чертежи, спецификации) ═══\n' + attachments_text + '\n\n';
  }
  userContent += '═══ ТЕХНИЧЕСКОЕ ЗАДАНИЕ ═══\n' + (tz_text || '');

  const messages = [
    ...history,
    { role: 'user', content: userContent.trim() }
  ];

  const systemPrompt = TKP_QUICK_SYSTEM + _formatSettings(settings);

  onProgress({ type: 'status', message: '🧠 Мимир анализирует задание и ищет цены...' });

  const result = await aiProvider.runAgentLoop({
    system: systemPrompt,
    messages,
    maxTokens: 32000,
    temperature: 0.4,
    maxIterations: 5,
    webSearchIncludeDomains: [
      'rzd.ru', 'aviasales.ru', 'pulscen.ru', 'tiu.ru',
      'b2b-center.ru', 'wildberries.ru', 'ozon.ru', 'petrovich.ru'
    ],
    onProgress: (p) => {
      if (p.type === 'tool_calls') {
        const queries = p.tool_calls.map(tc => tc.query).filter(Boolean).join(', ');
        onProgress({ type: 'progress', step: 'web_search', message: `🔍 Ищу цены: ${queries || 'web search'}` });
      }
    }
  });

  const text = result.text || '';
  const estimate = _extractEstimate(text);
  const chatMd   = _extractMarkdown(text);

  return {
    chat_response_md: chatMd,
    estimate,
    diagnostics: {
      model: result.model,
      tokens: result.usage,
      iterations: result.agentIterations
    }
  };
}

/**
 * Продолжение диалога (для /chat endpoint).
 * Полностью аналогично generateEstimate но history уже содержит предыдущие повороты.
 */
async function continueChat(opts) {
  return generateEstimate(opts);
}

module.exports = { generateEstimate, continueChat, _loadSettings };
