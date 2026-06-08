'use strict';

/**
 * work-status helper — толерантная классификация статусов работ.
 *
 * На проде work_status — свободный текст, реально встречаются РАЗНЫЕ вокабуляры:
 *   канон (settings): Новая, Подготовка, Мобилизация, В работе, На паузе, Подписание акта, Работы сдали, Закрыт
 *   живые варианты:   Завершена, Закрыта, Приостановлена, Оплата, Планирование, Отменена/Отменено и др.
 *
 * Чтобы фильтры «активные / закрытые / отменённые» не промахивались из-за разнобоя,
 * здесь — единый источник правды. Данные НЕ меняем (нормализация — отдельным шагом).
 */

// Закрытые/завершённые (работа доведена до конца)
const CLOSED = [
  'Закрыт', 'Закрыта', 'Закрыто',
  'Работы сдали', 'Завершена', 'Завершено', 'Завершен', 'Завершён',
  'Сдан', 'Сдана', 'Сдано'
];

// Отменённые
const CANCELLED = [
  'Отменена', 'Отменено', 'Отменён', 'Отменен', 'Отмена'
];

// Активные (в работе/подготовке) — канон
const ACTIVE = [
  'Новая', 'Подготовка', 'Мобилизация', 'В работе', 'На паузе', 'Подписание акта'
];

// нормализация для сравнения: trim + lower (ловит «в работе»/«В работе», лишние пробелы)
function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

const _CLOSED_N = new Set(CLOSED.map(norm));
const _CANCELLED_N = new Set(CANCELLED.map(norm));
const _CLOSED_OR_CANCELLED_N = new Set([...CLOSED, ...CANCELLED].map(norm));

function isClosed(status) { return _CLOSED_N.has(norm(status)); }
function isCancelled(status) { return _CANCELLED_N.has(norm(status)); }
function isClosedOrCancelled(status) { return _CLOSED_OR_CANCELLED_N.has(norm(status)); }
function isActive(status) { return !isClosedOrCancelled(status); }

/**
 * SQL-фрагмент «работа НЕ закрыта и НЕ отменена» (толерантно, без учёта регистра/пробелов).
 * Использование: WHERE deleted_at IS NULL AND ${notClosedSql('work_status')}
 * Возвращает строку с уже-подставленным именем колонки (имя из кода, не из пользовательского ввода).
 */
function notClosedSql(col) {
  const list = [...CLOSED, ...CANCELLED].map(s => `'${s.replace(/'/g, "''")}'`).join(',');
  return `(btrim(lower(${col})) NOT IN (${[...CLOSED, ...CANCELLED].map(s => `lower('${s.replace(/'/g, "''")}')`).join(',')}))`;
}
/** SQL-фрагмент «работа закрыта или отменена» */
function closedSql(col) {
  return `(btrim(lower(${col})) IN (${[...CLOSED, ...CANCELLED].map(s => `lower('${s.replace(/'/g, "''")}')`).join(',')}))`;
}

module.exports = {
  CLOSED, CANCELLED, ACTIVE,
  isClosed, isCancelled, isClosedOrCancelled, isActive,
  notClosedSql, closedSql, norm
};
