/**
 * ASGARD CRM — Mimir Conductor: системный промпт Conductor
 * ═══════════════════════════════════════════════════════════════════════════
 * Промпт главного мозга — «Главный сметчик ООО Асгард Сервис». Он не считает
 * сам: ставит задачи агентам, читает их отчёты, задаёт уточнения, в финале
 * вызывает emit_final_estimate.
 *
 * Опус-архитектура (19.06.2026): шаблон вынесен в
 * `templates/prompts/PROMPT-conductor-v2.md`, общий модуль норм —
 * `MODULE-norms-asgard-v1.md`. Подстановка — через `src/services/prompt-loader.js`.
 *
 * Шаблон содержит литеральные `${...}`-вставки в блоках <context>/required —
 * мы их РУЧНО подставляем в `substitutions` (как plain text), так как наш
 * loader не выполняет JS, а только подменяет `{{key}}`. Поэтому для совместимости
 * мы транслируем все `${...}` пары в самом V2-шаблоне в `{{...}}` ключи на этапе
 * рендера (см. _normalizeTemplate); если файла нет — fallback на legacy inline.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { getRequiredAgents } = require('../hard-rules');
const promptLoader = require('../../prompt-loader');

function _money(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 'не задан';
  return Math.round(n).toLocaleString('ru-RU') + ' ₽';
}

/**
 * Построить системный промпт Conductor.
 *
 * @param {Object} ctx — { work, contract_value, documents }
 * @param {Object|null} tzSummary — артефакт аналитика ТЗ (content)
 * @param {Object} complexityFlags
 * @returns {string}
 */
function buildConductorSystemPrompt(ctx, tzSummary, complexityFlags = {}) {
  try {
    const w = (ctx && ctx.work) || {};
    const required = getRequiredAgents(tzSummary, ctx?.contract_value, complexityFlags);

    // PROMPT-conductor-v2.md содержит `${...}`-литералы (Опус так оставил),
    // которые на сервере мы заменяем post-loader регэкспом. Берём строку через
    // loader (он уже встроит NORMS_MODULE), затем превращаем `${expr}` в текст.
    let tpl = promptLoader.buildPrompt('PROMPT-conductor-v2.md', {});

    const replacements = [
      ["${w.id ?? '—'}",                String(w.id ?? '—')],
      ["${w.work_title || 'без названия'}", String(w.work_title || 'без названия')],
      ["${w.customer_name || '—'}",     String(w.customer_name || '—')],
      ["${w.object_name || '—'}",       String(w.object_name || '—')],
      ["${w.city || '—'}",              String(w.city || '—')],
      ["${w.start_plan || '—'}",        String(w.start_plan || '—')],
      ["${w.end_plan || '—'}",          String(w.end_plan || '—')],
      ["${_money(ctx.contract_value)}", _money(ctx?.contract_value)],
      ["${(ctx.documents || []).length}", String((ctx?.documents || []).length)],
      ["${tzSummary ? JSON.stringify(tzSummary, null, 2) : '(tz_summary ещё не готов)'}",
        tzSummary ? JSON.stringify(tzSummary, null, 2) : '(tz_summary ещё не готов)'],
      ["${JSON.stringify(complexityFlags, null, 2)}",
        JSON.stringify(complexityFlags || {}, null, 2)],
      ["${required.join(', ')}",
        Array.isArray(required) && required.length ? required.join(', ') : '(жёстких требований нет)']
    ];
    for (const [from, to] of replacements) {
      tpl = tpl.split(from).join(to);
    }
    return tpl;
  } catch (e) {
    console.warn(`[mimir-conductor] buildConductorSystemPrompt failed via prompt-loader: ${e.message}. Fallback на legacy.`);
    return buildConductorSystemPrompt_legacy(ctx, tzSummary, complexityFlags);
  }
}

/**
 * LEGACY: старая inline-версия системного промпта Conductor (до Опус-архитектуры).
 * Сохранена как fallback и для возможного дебага. НЕ удалять.
 */
function buildConductorSystemPrompt_legacy(ctx, tzSummary, complexityFlags = {}) {
  const w = ctx.work || {};
  const required = getRequiredAgents(tzSummary, ctx.contract_value, complexityFlags);

  return `Ты — Главный сметчик ООО «Асгард Сервис».
15 лет опыта на промышленных подрядах в нефтегазе, химии, металлургии.
Твоя задача — собрать максимально точную и обоснованную смету по этому проекту.

═══ ТВОЙ ПОДХОД ═══

Ты НЕ считаешь сам. У тебя есть бригада узких специалистов (агентов),
каждый — лучший в своём деле. Ты их главный инженер: ставишь задачи,
читаешь их отчёты, при необходимости перезапускаешь, задаёшь уточнения
руководителю проекта (ask_pm) или заказчику (ask_customer). В финале ты
собираешь итог и выдаёшь команду emit_final_estimate.

═══ КОНТЕКСТ ПРОЕКТА ═══

Работа #${w.id ?? '—'}: ${w.work_title || 'без названия'}
Заказчик: ${w.customer_name || '—'}
Объект: ${w.object_name || '—'}, ${w.city || '—'}
Период: ${w.start_plan || '—'} → ${w.end_plan || '—'}
Контракт: ${_money(ctx.contract_value)}
Документов приложено: ${(ctx.documents || []).length}

═══ ЧТО УЖЕ ИЗВЕСТНО (от агента «Аналитик ТЗ») ═══

${tzSummary ? JSON.stringify(tzSummary, null, 2) : '(tz_summary ещё не готов)'}

═══ ФЛАГИ СЛОЖНОСТИ ═══

${JSON.stringify(complexityFlags, null, 2)}

═══ ОБЯЗАТЕЛЬНЫЕ АГЕНТЫ ПО ПРАВИЛАМ ═══

На основе флагов и стоимости ты ОБЯЗАН запустить:
${required.join(', ')}

(legacy fallback — полный текст смотри в git history до 19.06.2026)`;
}

module.exports = { buildConductorSystemPrompt, buildConductorSystemPrompt_legacy };
