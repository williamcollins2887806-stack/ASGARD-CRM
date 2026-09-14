/**
 * Фильтр периода саги тендеров — общая логика React v2 (зеркало tender_period_filter.js).
 * mode: quick | month | range
 */

function pad2(n) { return String(n).padStart(2, '0'); }

export function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function defaultPeriodFilter() {
  return {
    mode: 'month',
    quick: 'month',
    month: ymNow(),
    dateFrom: '',
    dateTo: '',
    dateField: 'created_at',
  };
}

export function buildMonthOptions(count = 12) {
  const out = [{ value: '', label: 'Все тендеры' }];
  const now = new Date();
  out.push({ value: `year:${now.getFullYear()}`, label: `За ${now.getFullYear()} год` });
  out.push({ value: `year:${now.getFullYear() - 1}`, label: `За ${now.getFullYear() - 1} год` });
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    out.push({
      value: ym,
      label: d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
    });
  }
  return out;
}

export const QUICK_PRESETS = [
  { value: 'today', label: '3 дня' },
  { value: 'week', label: '7 дней' },
  { value: 'month', label: '30 дней' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
  { value: 'all', label: 'Всё время' },
];

export function periodToQueryParams(state) {
  const s = state || defaultPeriodFilter();
  const q = { date_field: s.dateField || 'created_at' };
  if (s.mode === 'range') {
    if (s.dateFrom) q.date_from = s.dateFrom;
    if (s.dateTo) q.date_to = s.dateTo;
    if (!q.date_from && !q.date_to) q.period = 'all';
    return q;
  }
  if (s.mode === 'month') {
    q.period = s.month || '';
    if (!q.period) q.period = 'all';
    return q;
  }
  const map = { today: '3d', week: '7d', month: '30d', quarter: 'year', year: 'year', all: 'all' };
  q.period = map[s.quick] || 'all';
  return q;
}

export function appendPeriodQuery(params, state) {
  const q = periodToQueryParams(state);
  Object.entries(q).forEach(([k, v]) => {
    if (v != null && v !== '') params.set(k, String(v));
  });
  return params;
}

export function periodSummary(state) {
  const q = periodToQueryParams(state);
  const field = q.date_field === 'docs_deadline' ? 'срок подачи' : 'дата внесения';
  if (q.date_from || q.date_to) {
    const fmt = (iso) => (iso ? iso.split('-').reverse().join('.') : '…');
    return `${fmt(q.date_from)} — ${fmt(q.date_to)} · ${field}`;
  }
  if (!q.period || q.period === 'all') return 'Все периоды';
  if (q.period === '3d') return `3 дня · ${field}`;
  if (q.period === '7d') return `7 дней · ${field}`;
  if (q.period === '30d') return `30 дней · ${field}`;
  if (q.period === 'year') return `За год · ${field}`;
  if (String(q.period).startsWith('year:')) return `За ${q.period.slice(5)} · ${field}`;
  if (/^\d{4}-\d{2}$/.test(String(q.period))) {
    const [y, m] = String(q.period).split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return `${d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })} · ${field}`;
  }
  return String(q.period);
}

export function periodFilterKey(state) {
  return JSON.stringify(periodToQueryParams(state));
}
