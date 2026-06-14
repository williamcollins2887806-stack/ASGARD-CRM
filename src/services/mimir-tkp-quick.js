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

const crypto = require('crypto');
const aiProvider = require('./ai-provider');
const db = require('./db');

const TKP_QUICK_SYSTEM = `Ты Мимир — ведущий инженер-сметчик ООО «Асгард Сервис» (промышленный сервис для нефтегаза).
Твоя задача: составить КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ (ТКП) клиенту на основе его технического задания.

═══ ПРАВИЛА ЦЕНООБРАЗОВАНИЯ ═══
- ВСЕГДА используй наши реальные ставки и цены из блока «РЕАЛЬНЫЕ ДАННЫЕ КОМПАНИИ» ниже. Это live-выгрузка из БД.
- Если позиции нет в наших данных — ищи в эталонах (похожие проекты с фактическими ценами).
- Если и в эталонах нет — используй веб-поиск с пометкой «оценка по рынку».
- Маржа берётся из company_profile.financial_policy.min_margin_target_pct (значение в блоке настроек).
- Непредвиденные, накладные, ФОТ-налог, НДС — ТОЛЬКО из company_profile / settings, НЕ выдумывай.
- НЕ ЗАВЫШАЙ И НЕ ЗАНИЖАЙ — стремись к точной цене на основе наших данных. Заказчик уважает обоснованные цифры.

═══ ВЕБ-ПОИСК (только если не нашлось в БД) ═══
Для нестандартных позиций которых нет в нашей тарифной сетке/каталоге:
- Актуальные цены 2026 Россия (b2b-center.ru, pulscen.ru, tiu.ru)
- Билеты РЖД/авиа на конкретные направления
- Аренда спецтехники в регионе объекта
Помечай такие позиции примечанием «web search».

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
 * Загружает live-данные из БД и форматирует для промпта.
 * Цель: дать модели РЕАЛЬНЫЕ ставки/цены/эталоны вместо угадывания.
 * Состав:
 *   1) field_tariff_grid (тарифная сетка позиций)
 *   2) products (топ-50 расходников с last_price)
 *   3) mimir_reference_projects (топ-5 эталонов по похожести work_type)
 *   4) settings.company_profile (финансовая политика: маржа, накладные, ФОТ-налог, НДС)
 * Все цифры — реальные. Без хардкода.
 */
async function _loadCrmContext(tz_text) {
  const parts = [];
  // 1) Тарифная сетка
  try {
    const r = await db.query(
      "SELECT position_name, rate_per_shift FROM field_tariff_grid WHERE is_active = true AND rate_per_shift > 0 ORDER BY rate_per_shift DESC LIMIT 40"
    );
    if (r.rows.length) {
      parts.push('═══ ТАРИФНАЯ СЕТКА (наши реальные ставки за смену из field_tariff_grid) ═══');
      parts.push(r.rows.map(x => `  • ${x.position_name}: ${Number(x.rate_per_shift).toLocaleString('ru-RU')} ₽/смену`).join('\n'));
    }
  } catch (_) {}
  // 2) Каталог расходников
  try {
    const r = await db.query(
      "SELECT name, last_price, unit FROM products WHERE last_price > 0 AND deleted_at IS NULL ORDER BY last_price DESC LIMIT 50"
    );
    if (r.rows.length) {
      parts.push('\n═══ КАТАЛОГ РАСХОДНИКОВ (фактическая цена закупки products.last_price) ═══');
      parts.push(r.rows.map(x => `  • ${x.name}: ${Number(x.last_price).toLocaleString('ru-RU')} ₽/${x.unit || 'шт'}`).join('\n'));
    }
  } catch (_) {}
  // 3) Эталоны — топ-5 по similarity к ТЗ
  try {
    const r = await db.query(
      `SELECT customer_name, object_name, work_type, contract_value_actual, contract_value_actual_no_vat,
              cost_actual, duration_actual_calendar_days, crew_size_actual,
              GREATEST(
                similarity(lower(coalesce(object_name,'')), lower($1)),
                similarity(lower(coalesce(work_type,'')), lower($1)),
                similarity(lower(coalesce(customer_name,'')), lower($1))
              ) AS sim
         FROM mimir_reference_projects
        WHERE is_active = true
        ORDER BY sim DESC NULLS LAST
        LIMIT 5`,
      [String(tz_text || '').slice(0, 500)]
    );
    if (r.rows.length) {
      parts.push('\n═══ ЭТАЛОНЫ (5 самых похожих проектов с фактическими ценами) ═══');
      parts.push(r.rows.map((x, i) => {
        const sum = x.contract_value_actual_no_vat || x.contract_value_actual;
        const cost = x.cost_actual;
        return `  ${i+1}. ${x.customer_name || '?'} | ${(x.object_name || '').slice(0, 80)}\n` +
               `     work_type: ${x.work_type || '?'}, контракт: ${sum ? Number(sum).toLocaleString('ru-RU') + ' ₽' : '?'}, ` +
               `себестоимость: ${cost ? Number(cost).toLocaleString('ru-RU') + ' ₽' : '?'}, ` +
               `длительность: ${x.duration_actual_calendar_days || '?'} дн, бригада: ${x.crew_size_actual || '?'} чел`;
      }).join('\n'));
    }
  } catch (_) {}
  // 4) Финансовая политика компании
  try {
    const r = await db.query("SELECT value_json FROM settings WHERE key = 'company_profile'");
    if (r.rows[0] && r.rows[0].value_json) {
      let cp = r.rows[0].value_json;
      if (typeof cp === 'string') { try { cp = JSON.parse(cp); } catch(_){} }
      const fp = cp && cp.financial_policy || {};
      if (Object.keys(fp).length) {
        parts.push('\n═══ ФИНАНСОВАЯ ПОЛИТИКА КОМПАНИИ (settings.company_profile.financial_policy) ═══');
        const labels = {
          vat_pct: 'НДС (%)', fot_tax_pct: 'ФОТ-налог (%)',
          overheads_pct: 'Накладные (%)', contingency_pct: 'Непредвиденные (%)',
          min_margin_target_pct: 'Минимальная маржа (%)', consumables_pct_of_personnel: 'Расходники от ФОТ (%)'
        };
        parts.push(Object.entries(fp).map(([k, v]) => `  • ${labels[k] || k}: ${v}`).join('\n'));
      }
    }
  } catch (_) {}
  return parts.length ? '\n\n═══ РЕАЛЬНЫЕ ДАННЫЕ КОМПАНИИ (из БД, использовать как источник истины) ═══\n' + parts.join('\n') : '';
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

  // Подгружаем live-данные компании (тарифная сетка, каталог, эталоны, профиль)
  const crmCtx = await _loadCrmContext(tz_text).catch(() => '');

  const messages = [
    ...history,
    { role: 'user', content: userContent.trim() }
  ];

  const systemPrompt = TKP_QUICK_SYSTEM + _formatSettings(settings) + crmCtx;

  onProgress({ type: 'status', message: '🧠 Мимир анализирует задание и ищет цены...' });

  // AI-кэш на уровне результата generateEstimate. Идемпотентность по hash(system+tz+attachments+customer).
  // Если тот же ТЗ → возвращаем сохранённый estimate без повторного вызова AI (детерминизм + экономия).
  const cacheKey = crypto.createHash('sha256').update(
    systemPrompt + '\n#TZ#\n' + (tz_text || '') +
    '\n#ATT#\n' + (attachments_text || '') +
    '\n#CUST#\n' + (customer_name || '') + '|' + (customer_inn || '')
  ).digest('hex');
  try {
    const cached = await db.query(
      "SELECT output_text FROM mimir_ai_cache WHERE input_hash=$1 AND agent_name='tkp_quick' LIMIT 1",
      [cacheKey]
    );
    if (cached.rows[0]) {
      onProgress({ type: 'status', message: '💾 Расчёт из кэша (детерминированно)' });
      await db.query(
        "UPDATE mimir_ai_cache SET hit_count=hit_count+1, last_used_at=NOW() WHERE input_hash=$1",
        [cacheKey]
      ).catch(() => {});
      const parsed = JSON.parse(cached.rows[0].output_text);
      return parsed;
    }
  } catch (_) { /* нет соединения / таблицы — игнор */ }

  const result = await aiProvider.runAgentLoop({
    system: systemPrompt,
    messages,
    maxTokens: 32000,
    temperature: 0,  // КРИТИЧНО для 10/10 reproducibility: было 0.4 → разброс ×6 на одном ТЗ
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

  const payload = {
    chat_response_md: chatMd,
    estimate,
    diagnostics: {
      model: result.model,
      tokens: result.usage,
      iterations: result.agentIterations
    }
  };

  // Сохраним в кэш для будущих повторов
  try {
    await db.query(
      `INSERT INTO mimir_ai_cache (input_hash, model, agent_name, output_text, output_usage)
       VALUES ($1, $2, 'tkp_quick', $3, $4)
       ON CONFLICT (input_hash) DO NOTHING`,
      [cacheKey, result.model || 'unknown', JSON.stringify(payload), result.usage || null]
    );
  } catch (_) { /* игнор */ }

  return payload;
}

/**
 * Продолжение диалога (для /chat endpoint).
 * Полностью аналогично generateEstimate но history уже содержит предыдущие повороты.
 */
async function continueChat(opts) {
  return generateEstimate(opts);
}

module.exports = { generateEstimate, continueChat, _loadSettings };
