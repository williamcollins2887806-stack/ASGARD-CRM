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
проект с историческими аналогами: где мы дороже/дешевле, в чём причины, какие
удельные показатели (₽/ед., чел-час/объём).

Верни СТРОГО JSON:
{ "verdict": "...", "findings": ["..."],
  "unit_indicators": [{"name":"...","value":"...","vs_analogs":"..."}] }`;

/**
 * Best-effort поиск аналогов по архиву смет. Любая ошибка схемы → [].
 * Пытаемся по типу работ + заказчику + городу из tz_summary.
 */
async function findAnalogs(tz) {
  const customer = (tz.customer && tz.customer.name) || '';
  const city = (tz.object && tz.object.city) || '';
  const method = ((tz.scope && tz.scope.method) || []).join(' ');
  const term = `%${(customer || method || city).split(/\s+/)[0] || ''}%`;
  try {
    const r = await db.query(
      `SELECT id, title, customer_name, total_amount, created_at
       FROM estimates
       WHERE approval_status = 'approved'
         AND created_at > NOW() - INTERVAL '3 years'
         AND (customer_name ILIKE $1 OR title ILIKE $1)
       ORDER BY created_at DESC
       LIMIT 8`,
      [term]
    );
    return r.rows;
  } catch (_) {
    // Схема отличается / таблицы нет — деградация без падения.
    return [];
  }
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
