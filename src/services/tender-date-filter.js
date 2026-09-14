'use strict';

/**
 * Единая фильтрация тендеров по дате (сага, hub feed, реестр).
 *
 * Query params:
 *   date_from, date_to  — ISO YYYY-MM-DD (диапазон)
 *   date_field          — created_at | docs_deadline | period
 *   period              — legacy: all, 3d, 7d, 30d, year, year:YYYY, YYYY-MM
 */

const { toDateOnly } = require('../lib/date-only');

const FIELDS = {
  created_at: { col: 'created_at', kind: 'ts' },
  docs_deadline: { col: 'docs_deadline', kind: 'date' },
  period: { col: 'period', kind: 'ym' },
};

function resolveDateField(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'docs_deadline' || s === 'deadline') return 'docs_deadline';
  if (s === 'period' || s === 'plan') return 'period';
  return 'created_at';
}

function _pushRange(alias, fieldKey, dateFrom, dateTo, params) {
  const spec = FIELDS[fieldKey] || FIELDS.created_at;
  const col = `${alias}.${spec.col}`;
  const parts = [];

  if (dateFrom) {
    params.push(dateFrom);
    const p = params.length;
    if (spec.kind === 'ts') parts.push(`${col} >= $${p}::date`);
    else if (spec.kind === 'date') parts.push(`${col} >= $${p}::date`);
    else parts.push(`${col} >= $${p}`);
  }
  if (dateTo) {
    params.push(dateTo);
    const p = params.length;
    if (spec.kind === 'ts') parts.push(`${col} < ($${p}::date + interval '1 day')`);
    else if (spec.kind === 'date') parts.push(`${col} <= $${p}::date`);
    else parts.push(`${col} <= $${p}`);
  }
  return parts.length ? parts.join(' AND ') : null;
}

function _legacyPeriod(alias, fieldKey, period, params) {
  if (!period || period === 'all') return null;
  const spec = FIELDS[fieldKey] || FIELDS.created_at;
  const col = `${alias}.${spec.col}`;

  if (period === '3d') {
    params.push('3 days');
    return spec.kind === 'ym'
      ? `${col} >= to_char(NOW() - $${params.length}::interval, 'YYYY-MM')`
      : `${col} >= NOW() - $${params.length}::interval`;
  }
  if (period === '7d') {
    params.push('7 days');
    return spec.kind === 'ym'
      ? `${col} >= to_char(NOW() - $${params.length}::interval, 'YYYY-MM')`
      : `${col} >= NOW() - $${params.length}::interval`;
  }
  if (period === '30d') {
    params.push('30 days');
    return spec.kind === 'ym'
      ? `${col} >= to_char(NOW() - $${params.length}::interval, 'YYYY-MM')`
      : `${col} >= NOW() - $${params.length}::interval`;
  }
  if (period === 'year') {
    params.push('1 year');
    return spec.kind === 'ym'
      ? `${col} >= to_char(NOW() - $${params.length}::interval, 'YYYY-MM')`
      : `${col} >= NOW() - $${params.length}::interval`;
  }
  if (String(period).startsWith('year:')) {
    const y = parseInt(String(period).slice(5), 10);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) return null;
    if (spec.kind === 'ym') {
      params.push(`${y}-%`);
      return `${col} LIKE $${params.length}`;
    }
    params.push(`${y}-01-01`);
    params.push(`${y + 1}-01-01`);
    const a = params.length - 1;
    const b = params.length;
    return `${col} >= $${a}::date AND ${col} < $${b}::date`;
  }
  if (/^\d{4}-\d{2}$/.test(String(period))) {
    if (spec.kind === 'ym') {
      params.push(String(period));
      return `${col} = $${params.length}`;
    }
    params.push(String(period));
    const p = params.length;
    return `${col} >= ($${p} || '-01')::date AND ${col} < (($${p} || '-01')::date + interval '1 month')`;
  }
  return null;
}

/**
 * @param {string} alias — SQL alias таблицы (t, pt, …)
 * @param {object} query — request.query фрагмент
 * @param {unknown[]} params — массив параметров (mutate)
 * @param {{ createdCol?: string }} [opts] — для feed: имя колонки created (default created_at)
 * @returns {string|null} SQL AND-fragment без ведущего AND
 */
function buildTenderDateWhere(alias, query, params, opts = {}) {
  const fieldKey = resolveDateField(query.date_field);
  const dateFrom = toDateOnly(query.date_from);
  const dateTo = toDateOnly(query.date_to);

  if (dateFrom || dateTo) {
    return _pushRange(alias, fieldKey, dateFrom, dateTo, params);
  }

  const period = query.period;
  if (!period || period === 'all') return null;

  if (fieldKey === 'docs_deadline' && alias !== 't') {
    const createdCol = opts.createdCol || 'created_at';
    const sql = _legacyPeriod(alias, 'created_at', period, params);
    if (sql && createdCol !== 'created_at') {
      return sql.replace(new RegExp(`${alias}\\.created_at`, 'g'), `${alias}.${createdCol}`);
    }
    return sql;
  }

  if (fieldKey !== 'created_at' && fieldKey !== 'period') {
    return _legacyPeriod(alias, fieldKey, period, params);
  }

  const createdCol = opts.createdCol || 'created_at';
  const sql = _legacyPeriod(alias, fieldKey === 'period' ? 'period' : 'created_at', period, params);
  if (fieldKey === 'created_at' && createdCol !== 'created_at' && sql) {
    return sql.replace(new RegExp(`${alias}\\.created_at`, 'g'), `${alias}.${createdCol}`);
  }
  return sql;
}

function formatPeriodSummary(query) {
  const fieldKey = resolveDateField(query.date_field);
  const fieldLabel = fieldKey === 'docs_deadline' ? 'срок подачи' : 'дата внесения';
  const from = toDateOnly(query.date_from);
  const to = toDateOnly(query.date_to);
  if (from || to) {
    const a = from ? from.split('-').reverse().join('.') : '…';
    const b = to ? to.split('-').reverse().join('.') : '…';
    return `${a} — ${b} (${fieldLabel})`;
  }
  const p = query.period;
  if (!p || p === 'all') return 'Все периоды';
  if (p === '3d') return `3 дня (${fieldLabel})`;
  if (p === '7d') return `7 дней (${fieldLabel})`;
  if (p === '30d') return `30 дней (${fieldLabel})`;
  if (p === 'year') return `За год (${fieldLabel})`;
  if (String(p).startsWith('year:')) return `За ${p.slice(5)} (${fieldLabel})`;
  if (/^\d{4}-\d{2}$/.test(String(p))) {
    const [y, m] = String(p).split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return `${d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })} (${fieldLabel})`;
  }
  return String(p);
}

module.exports = {
  buildTenderDateWhere,
  resolveDateField,
  formatPeriodSummary,
  FIELDS,
};
