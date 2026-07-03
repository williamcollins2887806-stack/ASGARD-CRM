/**
 * API-клиент страницы /payroll-dashboard (Финансы персонала).
 * Источник: vanilla `public/assets/js/payroll_dashboard.js` (445 строк, AsgardPayrollDashboard).
 *
 * Бэкенд (`src/routes/payroll-dashboard.js`, доступ ADMIN/DIRECTOR_GEN/DIRECTOR_COMM/BUH):
 *   GET   /summary/:year/:month                — KPI (заработано/перевод/возврат/касса)
 *   GET   /cash-calc/:year/:month              — таблица расчёта кассы по каждому рабочему
 *   GET   /se-transfers/:year/:month           — операции с самозанятыми за месяц
 *   GET   /self-employed-limits                — годовые лимиты СЗ
 *   POST  /se-transfers                        — создать перевод (work_transfer/agreement_transfer)
 *   PUT   /se-transfers/:id/confirm-transfer   — деньги переведены
 *   PUT   /se-transfers/:id/confirm-return     — наличные получены (возврат закрыт)
 *   PUT   /se-transfers/:id/cancel             — отменить операцию
 *
 *   GET   /api/admin/system/settings/finance-limits          — текущие лимиты
 *   PUT   /api/admin/system/settings/finance-limits          — изменить лимиты
 */
import { api } from '@/api/client';

export const ACCESS_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];
export const LIMIT_EDITORS = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

export const TRANSFER_STATUSES = {
  planned:     { label: 'Запланировано',  tone: 'draft' },
  transferred: { label: 'Переведено',     tone: 'sent' },
  returned:    { label: 'Возврат получен', tone: 'approved' },
  completed:   { label: 'Завершено',      tone: 'approved' },
  cancelled:   { label: 'Отменено',       tone: 'rejected' }
};

export const OPERATION_TYPES = {
  work_transfer:      'За работу',
  agreement_transfer: 'По договорённости'
};

export const OPERATION_OPTIONS = [
  { value: '',                   label: 'Все операции' },
  { value: 'work_transfer',      label: 'За работу' },
  { value: 'agreement_transfer', label: 'По договорённости' }
];

export const CASH_CALC_TABS = [
  { id: 'all',           label: 'Все' },
  { id: 'self_employed', label: 'Самозанятые' },
  { id: 'official',      label: 'Официальные' },
  { id: 'cash',          label: 'Наличка' }
];

export const PAY_TYPE_META = {
  self_employed: { label: 'Самозанятый', tone: 'sent' },
  official:      { label: 'Официальный', tone: 'approved' },
  cash:          { label: 'Наличка',     tone: 'paid' }
};

/* ─── Endpoints ─── */

export function getSummary(year, month) {
  return api(`/api/payroll-dashboard/summary/${year}/${month}`);
}

export function getCashCalc(year, month) {
  return api(`/api/payroll-dashboard/cash-calc/${year}/${month}`);
}

/**
 * GET /api/payroll-dashboard/payouts-by-source — выплаты с разбивкой по источникам.
 * Возвращает:
 *   {
 *     summary: { pm_cash, company_bank, company_se, auto_fot, total },
 *     workers: [{
 *       employee_id, fio, is_officially_employed, is_self_employed,
 *       accrued_total, by_source: { pm_cash, company_bank, company_se, auto_fot },
 *       to_pay_remainder
 *     }]
 *   }
 *
 * source_kind в by_source — pm_cash_legacy уже склеен с pm_cash на бэке;
 * фронту перед использованием полезно всё равно проверить (страховка).
 */
export function getPayoutsBySource({ work_id, from, to, pm_id } = {}) {
  const q = new URLSearchParams();
  if (work_id != null && work_id !== '') q.set('work_id', String(work_id));
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (pm_id != null && pm_id !== '') q.set('pm_id', String(pm_id));
  const qs = q.toString();
  return api(`/api/payroll-dashboard/payouts-by-source${qs ? '?' + qs : ''}`);
}

export function getSeTransfers(year, month) {
  return api(`/api/payroll-dashboard/se-transfers/${year}/${month}`)
    .then((d) => d.transfers || d.items || d || []);
}

export function getSelfEmployedLimits() {
  return api('/api/payroll-dashboard/self-employed-limits');
}

export function createSeTransfer(payload) {
  return api('/api/payroll-dashboard/se-transfers', { method: 'POST', body: payload });
}

/**
 * POST /api/payroll-dashboard/se-transfers/bulk — массовая выплата СЗ (раздел 2 API_SPEC_BULK_SE.md).
 *
 *   body: {
 *     year, month,
 *     transfers: [
 *       {
 *         employee_id, work_id|null, operation_type: 'work_transfer'|'agreement_transfer',
 *         transfer_amount, earned_amount, remainder_destination: 'pm'|'company',
 *         comment?
 *       }, ...
 *     ]
 *   }
 *
 *   Response: { batch_id, summary{...}, transfers[], errors[{index, employee_id, error}] }
 *
 * Per-item errors не валят запрос — возвращаются в errors[], успешные — в transfers[].
 * silent:true чтобы 400/409 не дублировались в toast — модалка сама подсветит строки.
 */
export function createSeTransfersBulk(body) {
  return api('/api/payroll-dashboard/se-transfers/bulk', {
    method: 'POST',
    body,
    silent: true
  });
}

export function confirmTransfer(id) {
  return api(`/api/payroll-dashboard/se-transfers/${id}/confirm-transfer`, { method: 'PUT' });
}

export function confirmReturn(id) {
  return api(`/api/payroll-dashboard/se-transfers/${id}/confirm-return`, { method: 'PUT' });
}

export function cancelTransfer(id) {
  return api(`/api/payroll-dashboard/se-transfers/${id}/cancel`, { method: 'PUT' });
}

export function getFinanceLimits() {
  return api('/api/admin/system/settings/finance-limits')
    .catch(() => ({ monthly: 350000, yearly: 2400000 }));
}

export function setFinanceLimits(monthly, yearly) {
  return api('/api/admin/system/settings/finance-limits', {
    method: 'PUT',
    body: { monthly, yearly }
  });
}

/* ─── Хелперы ─── */

export function fmtMoney(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ₽';
}

export function fmtPeriod(year, month) {
  const d = new Date(year, month - 1);
  return d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
}

export function statusMeta(s) {
  return TRANSFER_STATUSES[s] || { label: s || '—', tone: 'draft' };
}

export function payTypeMeta(t) {
  return PAY_TYPE_META[t] || { label: t || '—', tone: 'draft' };
}

export function shiftPeriod(year, month, delta) {
  let y = year, m = month + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}
