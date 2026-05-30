/**
 * ASGARD CRM — Mimir Conductor: универсальный МОК агента (Сессия 2, Шаг 2.6)
 * ═══════════════════════════════════════════════════════════════════════════
 * В Сессии 2 реальных агентов ещё нет (они в сессиях 4-7). Этот мок позволяет
 * проверить, что Conductor умеет вызывать агентов, собирать их артефакты и
 * стримить мысли в War Room. Возвращает правдоподобный типизированный артефакт.
 *
 * Заменяется на реальную реализацию точечно: создаётся `agents/<agent_name>.js`
 * с тем же интерфейсом `run(opts)` и регистрируется в `agents/index.js`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {Object} opts
 * @param {Object} opts.input — вход от Conductor
 * @param {Object} opts.requiredArtifacts — подгруженные обязательные артефакты
 * @param {Function} opts.onThought — (text) => void, стрим мыслей
 * @param {string} opts.agentName
 * @returns {Promise<Object>} артефакт { summary, key_findings, clarifications, mock_data }
 */
async function run({ input, requiredArtifacts, onThought, agentName }) {
  const label = agentName || 'agent';
  onThought(`[МОК ${label}] получил задачу, читаю вход…`);
  await sleep(150);

  const deps = Object.keys(requiredArtifacts || {});
  if (deps.length) onThought(`[МОК ${label}] использую артефакты: ${deps.join(', ')}`);
  await sleep(150);

  onThought(`[МОК ${label}] обработка завершена`);

  return {
    summary: `Мок-артефакт от агента «${label}»`,
    key_findings: [`${label}: ключевой вывод A`, `${label}: ключевой вывод B`],
    clarifications: [], // моки уточнений не поднимают
    mock_data: {
      agent: label,
      input: input || {},
      used_artifacts: deps
    }
  };
}

module.exports = { run };
