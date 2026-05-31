/**
 * ASGARD CRM — Mimir Conductor: агент «Аналитик ТЗ» (Сессия 4, Шаг 4.2)
 * ═══════════════════════════════════════════════════════════════════════════
 * Читает распарсенные документы и выдаёт СТРУКТУРИРОВАННУЮ СВОДКУ проекта.
 * НЕ считает смету — только извлекает факты. Использует Sonnet 4.6, для очень
 * больших документов (>100к символов) — модель с большим контекстом.
 *
 * Артефакт: tz_summary (схема в SYSTEM_PROMPT).
 *
 * STUB-режим (dev, баланс не тратится): completeWithStream возвращает
 * синтетический текст, поэтому реальный JSON-парс невозможен. В этом случае
 * агент собирает детерминированную правдоподобную сводку из стартового
 * контекста (наименование/объёмы — заглушки, помеченные как demo). Поток
 * мыслей при этом всё равно прогоняется через completeWithStream для War Room.
 * На живых ключах (сессия 08) — реальный JSON от модели.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const { parseStrictJson, thoughtSink } = require('./_util');

const SYSTEM_PROMPT = `Ты — Аналитик ТЗ ООО «Асгард Сервис».
Твоя единственная задача — прочитать прикреплённые документы (ТЗ, договор,
ведомости, спецификации) и выдать СТРУКТУРИРОВАННУЮ СВОДКУ проекта.

ТЫ НЕ СЧИТАЕШЬ СМЕТУ. Ты только извлекаешь факты.

═══ ДИСЦИПЛИНА ═══
Если в документах не указано — поле НЕ ЗАПОЛНЯЙ (null или []). НЕ ВЫДУМЫВАЙ.
Если нашёл противоречие (разные данные в разных документах) — внеси в
clarifications с channel="CUSTOMER".

═══ МЕЖДУ ШАГАМИ ═══
Между разделами анализа выдавай одну короткую строку
"THOUGHT: <что я сейчас делаю одним предложением на русском>".

═══ ФОРМАТ ОТВЕТА ═══
Верни СТРОГО JSON по схеме:
{
  "summary": "1-2 предложения общего описания",
  "object": { "name": "...", "address": "...", "city": "...", "type": "..." },
  "customer": { "name": "...", "requires_STO_compliance": true|false, "STO_codes": [] },
  "scope": {
    "main_works": [ { "type": "...", "object": "...", "volume": 0, "volume_unit": "..." } ],
    "method": [],
    "deposit_type": "...",
    "has_subcontract_signals": true|false
  },
  "conditions": {
    "regime": "1_smena|2_smena|24_7",
    "has_OZP": true|false, "has_hazardous": true|false, "has_hot_work": true|false,
    "operating_facility": true|false, "weather_constraints": "...", "weight_limits": "..."
  },
  "permits_required": [],
  "timing": { "start": "YYYY-MM-DD|null", "end": "YYYY-MM-DD|null", "duration_days": null, "hard_deadline": true|false },
  "equipment_mentioned_in_tz": [ { "name": "...", "purpose": "...", "required": true|false } ],
  "materials_provided_by_customer": [],
  "has_volumes": true|false,
  "key_findings": ["5-8 важных нюансов"],
  "clarifications": [ { "channel":"CUSTOMER", "question_ru":"...", "why_we_ask":"...", "impact_rub":0, "blocking":true|false } ]
}`;

/** Детерминированная сводка для stub-режима (без расхода баланса). */
function buildStubSummary(parsedDocs) {
  const totalChars = parsedDocs.reduce((s, d) => s + (d.content_chars || 0), 0);
  return {
    summary: `[demo] Сводка ТЗ собрана в stub-режиме по ${parsedDocs.length} документ(ам) (${totalChars} симв). Реальная модель не вызывалась.`,
    object: { name: null, address: null, city: null, type: null },
    customer: { name: null, requires_STO_compliance: false, STO_codes: [] },
    scope: { main_works: [], method: [], deposit_type: null, has_subcontract_signals: false },
    conditions: {
      regime: '1_smena', has_OZP: false, has_hazardous: false, has_hot_work: false,
      operating_facility: false, weather_constraints: null, weight_limits: null
    },
    permits_required: [],
    timing: { start: null, end: null, duration_days: null, hard_deadline: false },
    equipment_mentioned_in_tz: [],
    materials_provided_by_customer: [],
    has_volumes: false,
    key_findings: ['stub-режим: факты из ТЗ не извлекались (баланс не тратится)'],
    clarifications: []
  };
}

async function run({ requiredArtifacts, onThought }) {
  // requiredArtifacts[at] — это уже content артефакта (см. tool-executor.callAgent)
  const parsedArt = requiredArtifacts.parsed_documents || {};
  const parsedDocs = Array.isArray(parsedArt.documents) ? parsedArt.documents : [];
  const totalChars = parsedDocs.reduce((s, d) => s + (d.content_chars || 0), 0);

  // Выбор модели: при очень больших документах — модель с большим контекстом.
  // (gemini-2-5-pro в плане → web-search-fast/gemini-2.5-flash: единственный
  //  реально доступный большой контекст через routerai; см. models-config.)
  const model = totalChars > 100000 ? 'web-search-fast' : 'sonnet-4-6';
  onThought(`Анализирую ${parsedDocs.length} документ(ов) (${totalChars} симв) через ${model}`);

  const userMessage = parsedDocs.length
    ? 'Документы проекта:\n\n' +
      parsedDocs
        .filter((d) => d.content)
        .map((d) => `═══ ${d.name} (${d.content_chars} симв) ═══\n${d.content}`)
        .join('\n\n')
    : 'Документы к проекту не приложены. Верни сводку с null/[] во всех полях и пометь в summary, что данных нет.';

  const result = await aiProvider.completeWithStream({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    model,
    onThought: (t) => onThought(t),
    onText: thoughtSink((t) => onThought(t))
  });

  // STUB: модель не возвращает валидный JSON → детерминированная сводка.
  if (result._stub || aiProvider.isStubMode()) {
    onThought('stub-режим: собираю демонстрационную сводку ТЗ');
    const stub = buildStubSummary(parsedDocs);
    return { ...stub, key_findings: stub.key_findings };
  }

  // LIVE: парсим строгий JSON модели.
  const parsed = parseStrictJson(result.text);
  return {
    summary: parsed.summary || 'Сводка ТЗ',
    key_findings: parsed.key_findings || [],
    ...parsed
  };
}

module.exports = { run };
