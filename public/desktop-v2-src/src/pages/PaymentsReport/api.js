/**
 * API-клиент страницы /payments-report.
 * Источник: vanilla `public/assets/js/payments-report.js` (287 LOC).
 *
 * Endpoints (src/routes/worker-payments.js):
 *   GET /api/worker-payments/reports/payroll/:year/:month             → table + totals
 *   GET /api/worker-payments/reports/labor-costs/:year/:month         → ФОТ по объектам
 *   GET /api/worker-payments/reports/debts                            → задолженности
 *   GET /api/worker-payments/reports/payroll/:year/:month/export      → XLSX
 *   GET /api/worker-payments/reports/per-diem/:year/:month            → суточные
 */
import { api } from '@/api/client';
import { downloadProtected } from '@/api/download';

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

export const PAYMENT_TYPES = {
  salary:   { label: '💰 ЗП',         tone: 'gold' },
  per_diem: { label: '🌙 Суточные',   tone: 'info' },
  advance:  { label: '💸 Аванс',      tone: 'info' },
  bonus:    { label: '🎁 Премия',     tone: 'ok' },
  penalty:  { label: '⚠️ Удержание',  tone: 'err' }
};

export function fmtMoneyR(n) {
  if (!Number.isFinite(+n)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

export function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '0';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n));
}

export async function loadPayrollReport(year, month) {
  return api(`/api/worker-payments/reports/payroll/${year}/${month}`, { silent: true });
}
export async function loadLaborCosts(year, month) {
  return api(`/api/worker-payments/reports/labor-costs/${year}/${month}`, { silent: true });
}
export async function loadDebts() {
  return api('/api/worker-payments/reports/debts', { silent: true });
}
export async function loadPerDiem(year, month) {
  return api(`/api/worker-payments/reports/per-diem/${year}/${month}`, { silent: true });
}

export async function downloadPayrollExcel(year, month) {
  await downloadProtected(
    `/api/worker-payments/reports/payroll/${year}/${month}/export`,
    `payroll_${year}_${String(month).padStart(2, '0')}.xlsx`
  );
}
