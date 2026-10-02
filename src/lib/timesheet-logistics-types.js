'use strict';

/**
 * SSoT: типы логистики, которые РП может перезаписать/удалить
 * (полевая вкладка + «Табель моей дружины»). Не трогать medical/warehouse/training.
 * D-249b / D-250.
 */

const LOGISTICS_STAGE_TYPES = Object.freeze([
  'travel', 'road', 'ship', 'helicopter', 'waiting', 'standby'
]);

const LOGISTICS_STAGE_SET = new Set(LOGISTICS_STAGE_TYPES);

/** Канон stage_type в БД (без road/standby алиасов UI). */
const PM_OVERWRITE_STAGE_TYPES = Object.freeze([
  'travel', 'ship', 'helicopter', 'waiting'
]);

const PM_OVERWRITE_SET = new Set(PM_OVERWRITE_STAGE_TYPES);

function normalizeLogisticsType(t) {
  if (!t) return null;
  if (t === 'road') return 'travel';
  if (t === 'standby') return 'waiting';
  return t;
}

function isLogisticsType(t) {
  return LOGISTICS_STAGE_SET.has(t) || PM_OVERWRITE_SET.has(normalizeLogisticsType(t));
}

function isPmOverwriteType(t) {
  const n = normalizeLogisticsType(t);
  return n != null && PM_OVERWRITE_SET.has(n);
}

module.exports = {
  LOGISTICS_STAGE_TYPES,
  LOGISTICS_STAGE_SET,
  PM_OVERWRITE_STAGE_TYPES,
  PM_OVERWRITE_SET,
  normalizeLogisticsType,
  isLogisticsType,
  isPmOverwriteType
};
