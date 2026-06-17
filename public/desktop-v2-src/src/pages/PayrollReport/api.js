/**
 * API-клиент страницы /reports/payroll (PayrollReport).
 * Источник: vanilla `public/assets/js/payments-report.js`.
 *
 * Endpoints:
 *   GET /api/payroll-report/labor?period=YYYY-MM   — ФОТ по объектам
 *   GET /api/payroll-report/debts?period=YYYY-MM   — задолженности по сотрудникам
 *   GET /api/worker-payments/reports/payroll/:y/:m — Сводный табель (существующий)
 */
import { api } from '@/api/client';

export const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
                            'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
export const MONTH_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                           'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export const STATUS_LABELS = {
  pending:   '🟡 Ожидает',
  paid:      '🟢 Выплачено',
  confirmed: '✅ Подтв.',
  cancelled: '⚫ Отменено'
};

export function fmtMoneyR(n) {
  if (!Number.isFinite(+n)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

/** Сводный табель — существующий endpoint worker-payments. */
export async function loadPayrollReport(year, month) {
  return api(`/api/worker-payments/reports/payroll/${year}/${month}`, { silent: true });
}

/** ФОТ по объектам — новый endpoint payroll-report/labor. */
export async function loadLaborByObjects(year, month) {
  const period = `${year}-${String(month).padStart(2, '0')}`;
  return api(`/api/payroll-report/labor?period=${period}`, { silent: true });
}

/** Задолженности — новый endpoint payroll-report/debts. */
export async function loadDebts(year, month) {
  const period = `${year}-${String(month).padStart(2, '0')}`;
  return api(`/api/payroll-report/debts?period=${period}`, { silent: true });
}
