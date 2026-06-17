/**
 * API-клиент страницы /auto-reports.
 * Источник: vanilla `public/assets/js/auto_reports.js` (448 LOC).
 *
 * Endpoints (src/routes/reports.js):
 *   GET  /api/reports/generate/monthly?year=&month=
 *   GET  /api/reports/generate/quarterly?year=&quarter=
 *   GET  /api/reports/generate/yearly?year=
 *   GET  /api/reports/download/:type?year=&month|quarter=&format=xlsx
 *   GET  /api/reports/saved
 *   POST /api/reports/auto-generate     (ADMIN, ручной запуск планировщика)
 */
import { api } from '@/api/client';
import { downloadProtected } from '@/api/download';

export const REPORT_TYPES = {
  monthly:   { label: 'Месячный',    icon: '📅' },
  quarterly: { label: 'Квартальный', icon: '📊' },
  yearly:    { label: 'Годовой',     icon: '📈' }
};

export const MONTHS = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                       'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function fmtMoneyR(n) {
  if (!Number.isFinite(+n)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

function buildParams(type, p) {
  const q = new URLSearchParams();
  if (type === 'monthly') {
    q.set('year', p.year);
    q.set('month', p.month);
  } else if (type === 'quarterly') {
    q.set('year', p.year);
    q.set('quarter', p.quarter);
  } else {
    q.set('year', p.year);
  }
  return q.toString();
}

export function generateReport(type, params) {
  return api(`/api/reports/generate/${type}?${buildParams(type, params)}`);
}

export async function downloadReport(type, params) {
  const fnamePart = type === 'monthly' ? `${params.year}_${String(params.month).padStart(2, '0')}`
                  : type === 'quarterly' ? `${params.year}_Q${params.quarter}`
                  : `${params.year}`;
  await downloadProtected(
    `/api/reports/download/${type}?format=xlsx&${buildParams(type, params)}`,
    `report_${type}_${fnamePart}.xlsx`
  );
}

export async function loadSavedReports() {
  try {
    const d = await api('/api/reports/saved');
    return d?.reports || [];
  } catch {
    return [];
  }
}

export function triggerAutoGenerate() {
  return api('/api/reports/auto-generate', { method: 'POST', body: {} });
}

/**
 * Парсинг period_code: '2024-01' (monthly), '2024-Q1' (quarterly), '2024' (yearly).
 * Vanilla auto_reports.js:412..421.
 */
export function parsePeriodCode(code) {
  const s = String(code || '');
  if (s.includes('-Q')) {
    const [y, q] = s.split('-Q');
    return { year: parseInt(y, 10), quarter: parseInt(q, 10) };
  }
  if (s.includes('-')) {
    const [y, m] = s.split('-');
    return { year: parseInt(y, 10), month: parseInt(m, 10) };
  }
  return { year: parseInt(s, 10) };
}
