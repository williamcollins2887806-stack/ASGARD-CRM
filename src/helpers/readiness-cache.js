'use strict';

/**
 * Общий in-memory кэш батч-summary готовности работ (work-readiness).
 * Вынесен в отдельный модуль, чтобы works.js мог инвалидировать запись
 * при смене статуса/назначений работы (раньше кэш жил 60с и показывал
 * устаревший in_prep после перехода в «В работе»).
 *
 * ⚠️ in-process: в кластере (несколько воркеров) у каждого свой кэш.
 *    Для текущего одно-процессного деплоя достаточно.
 */

const _cache = new Map(); // workId -> { at, data }
const TTL = 60 * 1000;

function get(workId) {
  const c = _cache.get(workId);
  if (c && (Date.now() - c.at) < TTL) return c.data;
  return null;
}
function set(workId, data) { _cache.set(workId, { at: Date.now(), data }); }
function invalidate(workId) { if (workId != null) _cache.delete(Number(workId)); }
function clear() { _cache.clear(); }

module.exports = { get, set, invalidate, clear, TTL };
