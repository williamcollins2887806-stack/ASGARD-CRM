/**
 * ASGARD CRM — Mimir prompt loader (Опус-архитектура промптов, 19.06.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 * Общий загрузчик файлов промптов из `templates/prompts/`:
 *   - MODULE-norms-asgard-v1.md — единый модуль норм (ЕНиР, R1-R8, цены)
 *   - PROMPT-quick-v4.md         — Quick-просчёт (один агент)
 *   - PROMPT-conductor-v2.md     — Conductor (оркестратор агентов)
 *
 * Mustache-like подстановка `{{placeholder}}`. Сначала встраивается
 * `{{NORMS_MODULE}}` ЦЕЛИКОМ — он может содержать `{{...}}`-плейсхолдеры
 * как СПРАВКУ (work_id/start_date/...), которые НЕ должны подменяться
 * данными конкретной работы (они для агентов кондуктора). Поэтому модуль
 * подставляется первым шагом split-join, а потом `replace` оставляет
 * только плейсхолдеры самого шаблона.
 *
 * Кэш в памяти процесса — файлы читаются один раз. Если нужно обновить
 * без рестарта — `clearCache()`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '../../templates/prompts');
const NORMS_MODULE_FILE = 'MODULE-norms-asgard-v1.md';

const _cache = new Map();

function _read(name) {
  if (_cache.has(name)) return _cache.get(name);
  const p = path.join(PROMPTS_DIR, name);
  const text = fs.readFileSync(p, 'utf8');
  _cache.set(name, text);
  return text;
}

function loadModuleNorms() {
  return _read(NORMS_MODULE_FILE);
}

/**
 * Собрать промпт: подставить {{NORMS_MODULE}} целиком, затем все остальные
 * `{{key}}` из `ctx`. Если ключа нет в `ctx` — заменяется на «—».
 *
 * @param {string} templateName — имя файла в templates/prompts/
 * @param {Object} ctx — объект подстановок { work_id, customer_name, ... }
 * @returns {string} готовый промпт
 */
function buildPrompt(templateName, ctx = {}) {
  let tpl = _read(templateName);
  const norms = loadModuleNorms();
  // 1) Сначала NORMS_MODULE — он содержит свои {{placeholders}}, которые НЕ
  //    являются плейсхолдерами текущего шаблона (это справка для агентов).
  tpl = tpl.split('{{NORMS_MODULE}}').join(norms);
  // 2) Простая подстановка {{key}} → ctx[key]; неизвестные → «—»
  tpl = tpl.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (m, k) => {
    if (k === 'NORMS_MODULE') return m; // уже подставлен
    const v = ctx[k];
    if (v === undefined || v === null || v === '') return '—';
    return String(v);
  });
  return tpl;
}

function clearCache() { _cache.clear(); }

module.exports = { loadModuleNorms, buildPrompt, clearCache, PROMPTS_DIR };
