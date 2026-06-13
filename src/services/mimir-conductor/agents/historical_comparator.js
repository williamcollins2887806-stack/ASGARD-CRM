/**
 * ASGARD CRM — Mimir Conductor: агент «Архивариус-аналог» (Сессия 7, Шаг 7.1)
 * ═══════════════════════════════════════════════════════════════════════════
 * RAG-поиск похожих проектов в архиве смет (по embeddings, если они посчитаны
 * фоном; иначе — текстовый поиск по типу работ/заказчику/городу). Sonnet 4.6
 * сравнивает текущий проект с аналогами, выявляет аномалии и удельные показатели.
 *
 * Артефакт: analogs_comparison
 *   { summary, key_findings[], analogs[], analysis{verdict,findings,unit_indicators} }
 *
 * Деградация: если архив/схема недоступны — возвращаем «аналоги не найдены»
 * (artifact с пустым списком), НЕ роняя run. STUB — синтетическое сравнение.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const db = require('../../db');
const { parseStrictJson, formatRub } = require('./_util');

const SYSTEM_PROMPT = `Ты — аудитор смет ООО «Асгард Сервис». Сравниваешь текущий
проект с историческими эталонами (mimir_reference_projects, _source='reference') и
архивом смет (_source='estimate'). Эталоны содержат план/факт с реальными цифрами:
duration_planned vs duration_actual, cost_planned vs cost_actual, resources_actual
(ставки бригады, цены материалов, нормы расхода), variance (что/насколько отклонилось)
и insights (lessons_learned, risk_factors_realized, pricing_strategy_for_similar).

ТВОЯ ЗАДАЧА:
1. Найди в эталонах самые близкие по характеру работ, заказчику, объекту, отрасли.
2. Извлеки из них КЛЮЧЕВЫЕ ЦИФРЫ для опоры расчёта (rates, multipliers, materials,
   travel, overheads, margin).
3. Покажи историческое отклонение план/факт и причины — это карта рисков.
4. Выведи pricing_strategy: какую цену для клиента эталон рекомендует для подобной
   работы (insights.pricing_strategy_for_similar или расчёт по факту).

Верни СТРОГО JSON:
{
  "verdict": "Найдено N эталонов, ближайший — '...' (КАО Азот / ...). Применимость: high|medium|low",
  "findings": [
    "В эталоне X фактическая длительность была в Y раз больше плановой из-за ...",
    "Реальные ставки слесаря в эталоне: 6500 ₽/смена × 1.04 × 1.20",
    ...
  ],
  "unit_indicators": [
    {"name": "₽/труба", "value": "...", "vs_analogs": "..."}
  ],
  "applicable_norms": {
    "labor_rates_rub_per_shift": {"ИТР":..., "мастер":..., "слесарь":...},
    "overheads_pct": ...,
    "warranty_pct": ...,
    "margin_min_pct": ...,
    "materials_consumption_rules": ["..."]
  },
  "pricing_recommendation": {
    "min_cost_estimate_rub": ...,
    "recommended_client_price_no_vat_rub": ...,
    "reasoning": "Эталон X показал: себестоимость factor × план. Применяем к нашему объёму ..."
  },
  "risk_buffer_pct_recommended": ...,
  "key_risks_from_history": ["..."]
}`;

/**
 * Best-effort поиск аналогов. Два источника:
 *   1) mimir_reference_projects — НОВЫЙ: золотые эталоны с план/факт/insights
 *   2) estimates — legacy: одобренные сметы по заказчику/типу
 * Пытаемся по типу работ + заказчику + городу + ключевым словам из tz_summary.
 */
async function findAnalogs(tz) {
  const customer = (tz.customer && tz.customer.name) || '';
  const city = (tz.object && tz.object.city) || '';
  const method = ((tz.scope && tz.scope.method) || []).join(' ');
  const mainWorks = ((tz.scope && tz.scope.main_works) || [])
    .map((w) => `${w.type || ''} ${w.object || ''}`).join(' ');
  const fullSearch = `${customer} ${method} ${mainWorks} ${city}`.toLowerCase();

  const references = [];
  const estimates = [];

  // 1) mimir_reference_projects — текстовый поиск по нескольким полям + embedding_text
  try {
    const terms = [customer, method, mainWorks, city]
      .filter((x) => x && x.length > 2)
      .map((x) => x.toLowerCase().split(/\s+/)[0])
      .filter(Boolean);
    if (terms.length) {
      // Поиск с OR по нескольким полям + ILIKE по embedding_text
      const params = [];
      const conds = [];
      terms.forEach((t) => {
        const idx = params.length + 1;
        params.push(`%${t}%`);
        conds.push(`(lower(work_type) ILIKE $${idx} OR lower(customer_name) ILIKE $${idx} OR lower(object_name) ILIKE $${idx} OR lower(COALESCE(embedding_text,'')) ILIKE $${idx} OR lower(industry_sector) ILIKE $${idx})`);
      });
      const sql = `SELECT id, customer_name, object_name, work_type, work_subtype, industry_sector,
                          contract_value_planned, contract_value_actual,
                          contract_value_planned_no_vat, contract_value_actual_no_vat,
                          cost_planned, cost_actual, profit_actual,
                          margin_planned_pct, margin_actual_pct,
                          duration_planned_calendar_days, duration_actual_calendar_days,
                          duration_planned_workshifts, duration_actual_workshifts,
                          crew_size_planned, crew_size_actual,
                          resources_actual, variance, insights, quality_score,
                          notes, created_at
                     FROM mimir_reference_projects
                    WHERE is_active = true AND (${conds.join(' OR ')})
                    ORDER BY quality_score DESC, id DESC
                    LIMIT 5`;
      const r = await db.query(sql, params);
      references.push(...r.rows.map((row) => ({ _source: 'reference', ...row })));
    }
  } catch (e) {
    // Таблица не создана — игнорируем (миграция V202 не применена)
  }

  // 2) estimates — legacy поиск
  try {
    const term = `%${(customer || method || city).split(/\s+/)[0] || ''}%`;
    const r = await db.query(
      `SELECT id, title, customer_name, total_amount, created_at
       FROM estimates
       WHERE approval_status = 'approved'
         AND created_at > NOW() - INTERVAL '3 years'
         AND (customer_name ILIKE $1 OR title ILIKE $1)
       ORDER BY created_at DESC
       LIMIT 5`,
      [term]
    );
    estimates.push(...r.rows.map((row) => ({ _source: 'estimate', ...row })));
  } catch (_) { /* noop */ }

  // Эталоны идут первыми (более ценные), потом legacy estimates
  return [...references, ...estimates];
}

/** Синтетическое сравнение для stub / отсутствия аналогов. */
function stubAnalysis(analogs) {
  return {
    verdict: analogs.length
      ? `Найдено ${analogs.length} близких аналогов; цена в пределах исторического коридора (stub).`
      : 'Прямых аналогов в архиве не найдено — сравнение по удельным показателям недоступно (stub).',
    findings: analogs.length
      ? ['Структура себестоимости сопоставима с прошлыми проектами', 'Существенных аномалий не выявлено (stub)']
      : ['Нет одобренных аналогов за 3 года по этому заказчику/методу'],
    unit_indicators: []
  };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const labor = requiredArtifacts.labor_cost || {};

  onThought('Ищу похожие проекты в архиве смет…');
  const analogs = await findAnalogs(tz);
  onThought(`Найдено ${analogs.length} ближайших аналогов`);

  let analysis;
  if (aiProvider.isStubMode() || analogs.length === 0) {
    analysis = stubAnalysis(analogs);
  } else {
    try {
      const result = await aiProvider.complete({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Текущий проект:\n${JSON.stringify(tz)}\n\nЛейбор:\n${JSON.stringify(labor)}\n\nАналоги:\n${JSON.stringify(analogs)}` }],
        model: 'sonnet-4-6',
        maxTokens: 4000
      });
      analysis = result._stub ? stubAnalysis(analogs) : parseStrictJson(result.text);
    } catch (e) {
      onThought(`⚠ LLM недоступна (${e.message}) — без анализа аналогов`);
      analysis = stubAnalysis(analogs);
    }
  }

  return {
    summary: `Сравнение с ${analogs.length} аналогами. ${analysis.verdict || ''}`.trim(),
    key_findings: analysis.findings || [],
    analogs: analogs.map((a) => ({ id: a.id, title: a.title, customer: a.customer_name, total: a.total_amount && formatRub(a.total_amount) })),
    analysis,
    unit_indicators: analysis.unit_indicators || [],
    clarifications: []
  };
}

module.exports = { run, findAnalogs, stubAnalysis };
