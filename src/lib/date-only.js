'use strict';

/**
 * Нормализация календарных дат (DATE без времени).
 * Используется в permits и других модулях — единый парсер для API/UI/PostgreSQL.
 */

/** YYYY-MM-DD или null; не бросает исключений */
function toDateOnly(val) {
  if (val == null || val === '') return null;

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;

    // Отсечь заведомо битые значения (slice(0,10) на ISO с offset давал "+082026-02")
    if (/^[+-]\d/.test(trimmed)) return null;

    // YYYY-MM-DD (опционально с временем / Z / offset)
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const y = +iso[1];
      const mo = +iso[2];
      const day = +iso[3];
      if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
      const probe = new Date(Date.UTC(y, mo - 1, day));
      if (
        Number.isNaN(probe.getTime()) ||
        probe.getUTCFullYear() !== y ||
        probe.getUTCMonth() !== mo - 1 ||
        probe.getUTCDate() !== day
      ) {
        return null;
      }
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }

    // DD.MM.YYYY или DD/MM/YYYY
    const ru = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
    if (ru) {
      let day = +ru[1];
      let mo = +ru[2];
      let y = +ru[3];
      if (y < 100) y += y >= 70 ? 1900 : 2000;
      if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
      const probe = new Date(Date.UTC(y, mo - 1, day));
      if (
        Number.isNaN(probe.getTime()) ||
        probe.getUTCFullYear() !== y ||
        probe.getUTCMonth() !== mo - 1 ||
        probe.getUTCDate() !== day
      ) {
        return null;
      }
      return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    return null;
  }

  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    try {
      return val.toISOString().slice(0, 10);
    } catch (_) {
      return null;
    }
  }

  return null;
}

/** Для <input type="date"> и JSON API — всегда YYYY-MM-DD или '' */
function dateInputValue(val) {
  return toDateOnly(val) || '';
}

/** Нормализовать поля date-only в объекте ответа API */
function normalizeRowDates(row, fields) {
  if (!row || typeof row !== 'object') return row;
  for (const f of fields) {
    if (row[f] != null) row[f] = toDateOnly(row[f]);
  }
  return row;
}

module.exports = { toDateOnly, dateInputValue, normalizeRowDates };
