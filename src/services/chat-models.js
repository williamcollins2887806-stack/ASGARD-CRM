'use strict';

/**
 * Реестр моделей для чата Мимира (Хугин + ФАБ).
 *
 * system_mode определяет какой system prompt подаём в /chat-stream:
 *   - 'light' — короткий «Ты Мимир — помощник, отвечай кратко» без БД-контекста,
 *               без истории, без text-to-SQL. Подходит для быстрых вопросов
 *               «как создать тендер», «где посмотреть отчёт» и т.п. Не нагружает
 *               модель, не упирает её в reasoning loop.
 *   - 'full'  — полный prompt из buildSystemPrompt (контекст БД, история чата,
 *               text-to-SQL). Для сложных запросов «сколько мы потратили в мае»,
 *               «покажи маржу по проекту». Дороже, медленнее.
 *
 * Все модели идут через единый прокси «Токенатор» (см. ai-provider.js).
 * Управляется без редеплоя через GET /api/mimir/chat/models (UI-список),
 * но реестр сам в коде — добавляешь модель в массив и она появляется в UI.
 */

// short_hint показывается в UI рядом с моделью (1–4 слова), чтобы пользователь
// сразу понял какие вопросы она потянет, а какие — нет. capabilities — длинная
// подсказка для tooltip/баннера: что умеет, чего не умеет.
const MODELS = [
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    short_hint: '⚡ Быстрая, без данных CRM',
    description: 'Кратко и быстро. Не видит ваши тендеры/работы/финансы — отвечает только на общие вопросы по системе.',
    capabilities: {
      knows_crm_data: false,
      uses_chat_history: false,
      pros: ['Мгновенный ответ', 'Не тратит много токенов', 'Хороша для «как сделать X», «где найти Y»'],
      cons: ['НЕ знает ваши тендеры, работы, финансы, сотрудников', 'НЕ помнит предыдущие сообщения в этом диалоге', 'Не делает SQL-запросы к БД']
    },
    system_mode: 'light'
  },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    short_hint: '🧠 Думающая, с данными CRM',
    description: 'Видит вашу БД, помнит диалог, делает запросы к данным. Дольше отвечает (10–30с), но глубже.',
    capabilities: {
      knows_crm_data: true,
      uses_chat_history: true,
      pros: ['Знает тендеры/работы/финансы/сотрудников', 'Помнит диалог', 'Может посчитать «сколько потратили в мае», «маржа по проекту X»'],
      cons: ['Долгий ответ (10–30с)', 'Дороже по токенам']
    },
    system_mode: 'full',
    default: true                                   // S-4 Stage 2.1 (2026-06-21):
                                                    // дефолт перенесён с gpt-5.4 на gpt-5.5 по
                                                    // [[project-letters-models]] и
                                                    // [[feedback-tokenator-constraints]] —
                                                    // gpt-5.5 единственная стабильная модель
                                                    // у токенатора, остальные дают 400 на параллели.
  },
  {
    id: 'grok-4.20-fast',
    label: 'Grok 4.20 Fast',
    short_hint: '🚀 1M контекст, быстро',
    description: 'Большой контекст 1M, быстрый ответ. Лучше для писем и длинных документов.',
    capabilities: {
      knows_crm_data: true,
      uses_chat_history: true,
      pros: [
        '1M контекст (вдвое больше gpt-5.5)',
        'Быстрый стрим',
        'Подходит для писем по родительскому документу'
      ],
      cons: [
        'Может уступать gpt-5.5 в SQL/русском',
        'Биллинг ×1.6'
      ]
    },
    system_mode: 'full',
    requires_usd_balance: false
  }
  // Модели по USD-балансу Токенатора (Claude Opus/Sonnet/Haiku) — отключены
  // т.к. на USD-балансе у нас пусто (Insufficient balance). Когда пополнится —
  // вернуть сюда нужные модели с system_mode='full'. См. feedback-ai-proxy-name.
];

function getModels() {
  return MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    short_hint: m.short_hint || '',
    description: m.description,
    capabilities: m.capabilities || {},
    system_mode: m.system_mode,
    default: !!m.default,
    requires_usd_balance: !!m.requires_usd_balance
  }));
}

function getModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

function getDefault() {
  return MODELS.find((m) => m.default) || MODELS[0];
}

module.exports = { getModels, getModel, getDefault };
