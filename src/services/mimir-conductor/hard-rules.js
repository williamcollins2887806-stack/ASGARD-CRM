/**
 * ASGARD CRM — Mimir Conductor: Hard rules / предохранители (Сессия 2, Шаг 2.2)
 * ═══════════════════════════════════════════════════════════════════════════
 * Safety floor: список обязательных агентов по флагам сложности и порогам
 * стоимости, и проверка «можно ли финализировать просчёт».
 *
 * Conductor сам решает кого звать (принцип «Conductor решает, а не правила»),
 * но эти правила гарантируют минимум — например, МЛСП → морские допуски.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const cr = require('./conductor-run');

/**
 * Список обязательных агентов на основе tz_summary, стоимости и флагов.
 * @param {Object|null} tzSummary — артефакт tz_analyst (content)
 * @param {number} contractValue — стоимость контракта, ₽
 * @param {Object} complexityFlags
 * @returns {string[]} уникальный список agent_name
 */
function getRequiredAgents(tzSummary, contractValue, complexityFlags = {}) {
  const v = Number(contractValue) || 0;
  const f = complexityFlags || {};
  const required = ['tz_analyst', 'final_consolidator']; // всегда

  if (f.has_OZP) required.push('site_conditions', 'permits_planner');
  if (f.has_welding || f.has_assembly) required.push('quality_control_planner');
  if (f.has_MLSP) required.push('marine_permits', 'devils_advocate');
  if (f.hazardous) required.push('site_conditions');
  if (f.strict_customer) required.push('norms_compliance', 'site_access_planner');
  if (f.has_subcontract_signals) required.push('contract_decomposer');

  // tz_summary может нести собственные сигналы (когда агент уже отработал)
  if (tzSummary?.customer?.requires_STO_compliance) required.push('norms_compliance');
  if (tzSummary?.scope?.has_subcontract_signals) required.push('contract_decomposer');

  // Пороги по стоимости
  if (v > 10000000) required.push('gatekeeper');
  if (v > 30000000) required.push('risk_quantifier');
  if (v > 50000000) required.push('devils_advocate', 'financial_modeler');

  return [...new Set(required)];
}

/**
 * Может ли Conductor финализировать просчёт?
 * Проверяет: все обязательные агенты завершены + нет открытых blocking-уточнений.
 * @param {number} runId
 * @param {number} contractValue
 * @param {Object} complexityFlags
 * @returns {Promise<{ok:boolean, reason?:string, missing?:string[]}>}
 */
async function canFinalize(runId, contractValue, complexityFlags) {
  const tzSummary = await cr.getArtifact(runId, 'tz_summary');
  const required = getRequiredAgents(tzSummary?.content || tzSummary, contractValue, complexityFlags);
  const completed = await cr.getCompletedAgents(runId);
  const missing = required.filter((a) => !completed.includes(a));

  if (missing.length > 0) {
    return { ok: false, reason: `Не запущены обязательные агенты: ${missing.join(', ')}`, missing };
  }

  const blocking = await cr.getBlockingClarifications(runId);
  if (blocking.length > 0) {
    return { ok: false, reason: `Открыто ${blocking.length} блокирующих уточнений`, missing: [] };
  }

  return { ok: true };
}

module.exports = { getRequiredAgents, canFinalize };
