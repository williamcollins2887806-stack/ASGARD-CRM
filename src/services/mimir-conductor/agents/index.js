/**
 * ASGARD CRM — Mimir Conductor: реестр реализаций агентов (Сессия 2, Шаг 2.6)
 * ═══════════════════════════════════════════════════════════════════════════
 * Мапит agent_name → реализация (объект с методом `run(opts)`).
 *
 * В Сессии 2 ВСЕ агенты используют универсальный мок `_mock.js`. По мере
 * реализации (сессии 4-7) добавляй сюда реальные модули:
 *
 *   const REAL = {
 *     tz_analyst: require('./tz_analyst'),
 *     resource_planner: require('./resource_planner'),
 *     ...
 *   };
 *
 * и `getAgentImpl` будет отдавать реальную реализацию, иначе — мок.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const mock = require('./_mock');

// Реальные реализации (заменяют мок точечно).
// Сессия 4 — 5 ядерных агентов (MVP end-to-end просчёта).
// Сессия 6 — +12 расширенных агентов (RAG-нормы, рынок, логистика, допуски).
const REAL = {
  // Сессия 4 — ядро:
  document_parser: require('./document_parser'),
  tz_analyst: require('./tz_analyst'),
  crew_composer: require('./crew_composer'),
  labor_calculator: require('./labor_calculator'),
  final_consolidator: require('./final_consolidator'),
  // Сессия 6 — расширенные:
  drawings_reader: require('./drawings_reader'),
  gatekeeper: require('./gatekeeper'),
  resource_planner: require('./resource_planner'),
  method_validator: require('./method_validator'),
  site_conditions: require('./site_conditions'),
  warehouse_matcher: require('./warehouse_matcher'),
  market_search: require('./market_search'),
  procurement_analyzer: require('./procurement_analyzer'),
  routing_planner: require('./routing_planner'),
  travel_pricer: require('./travel_pricer'),
  permits_planner: require('./permits_planner'),
  indirects_calculator: require('./indirects_calculator'),
  // Сессия 7 — финмодель, риски, адвокат, аналоги, нормоконтроль, расширенные python:
  risk_quantifier: require('./risk_quantifier'),
  financial_modeler: require('./financial_modeler'),
  devils_advocate: require('./devils_advocate'),
  historical_comparator: require('./historical_comparator'),
  contract_decomposer: require('./contract_decomposer'),
  norms_compliance: require('./norms_compliance'),
  pre_mob_calculator: require('./pre_mob_calculator'),
  standby_estimator: require('./standby_estimator'),
  consumables_calculator: require('./consumables_calculator'),
  executive_docs_planner: require('./executive_docs_planner'),
  warranty_reserve: require('./warranty_reserve'),
  quality_control_planner: require('./quality_control_planner'),
  marine_permits: require('./marine_permits')
  // Остаётся моком: site_access_planner (вне объёма Сессии 7).
};

/**
 * Вернуть реализацию агента по имени. Пока всё, что не реализовано, — мок.
 * @param {string} agentName
 * @returns {{run: Function}}
 */
function getAgentImpl(agentName) {
  return REAL[agentName] || mock;
}

module.exports = { getAgentImpl, mock };
