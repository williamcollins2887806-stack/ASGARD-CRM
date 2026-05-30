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

// Реальные реализации появятся здесь в сессиях 4-7.
const REAL = {};

/**
 * Вернуть реализацию агента по имени. Пока всё, что не реализовано, — мок.
 * @param {string} agentName
 * @returns {{run: Function}}
 */
function getAgentImpl(agentName) {
  return REAL[agentName] || mock;
}

module.exports = { getAgentImpl, mock };
