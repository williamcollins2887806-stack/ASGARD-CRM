/**
 * API-клиент страницы /pm-balance.
 * Источник: vanilla `public/assets/js/pm_balance.js` (478 строк, AsgardPmBalancePage).
 *
 * Бэкенд (`src/routes/payroll-dashboard.js`, ROLES: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH):
 *   GET /api/payroll-dashboard/pm-balance         → { pms: [...] }
 *   GET /api/payroll-dashboard/pm-balance/:pm_id  → { pm_id, items: {...} }
 *
 * Поля в списке (вычисляем сами `cash_out` = sum того, что вышло):
 *   pm_id, pm_name
 *   cash_in              — получено из кассы (cash_requests received/reporting)
 *   se_cash_in           — наличные от самозанятых (se_transfers completed/returned)
 *   cash_out_expenses    — расходы (cash_expenses)
 *   cash_out_returns     — возвраты в кассу (cash_returns)
 *   cash_out_salaries    — выдано рабочим наличкой (worker_payments cash/paid)
 *   balance              — на руках = cash_in + se_cash_in − sum(out)
 */
import { api } from '@/api/client';

/** GET /api/payroll-dashboard/pm-balance — нормализуем поля под старую вью. */
export function loadPmBalanceList() {
  return api('/api/payroll-dashboard/pm-balance')
    .then((d) => {
      const list = Array.isArray(d?.pms) ? d.pms
        : Array.isArray(d?.balances) ? d.balances
        : Array.isArray(d) ? d : [];
      return list.map((pm) => {
        const cash_in = Number(pm.cash_in) || 0;
        const se_cash_in = Number(pm.se_cash_in) || 0;
        // Единый отток: backend отдаёт cash_out (= расходы подотчёт + выплаты рабочим
        // + прямые расходы РП work_expenses_direct). Фолбэк для старых backend'ов —
        // сумма компонентов (обязательно включая work_expenses_direct, иначе занижение).
        const cash_out = pm.cash_out != null
          ? Number(pm.cash_out) || 0
          : (Number(pm.cash_out_expenses) || 0) + (Number(pm.cash_out_salaries) || 0) + (Number(pm.work_expenses_direct) || 0);
        // Возвраты в кассу — ОТДЕЛЬНО (не входят в cash_out, иначе двойной счёт).
        const cash_returned = pm.cash_returned != null
          ? Number(pm.cash_returned) || 0
          : (Number(pm.cash_out_returns) || 0);
        const balance = pm.balance != null ? Number(pm.balance) : (cash_in + se_cash_in - cash_out - cash_returned);
        return {
          ...pm,
          pm_id: pm.pm_id ?? pm.id,
          pm_name: pm.pm_name ?? pm.name,
          cash_in,
          se_cash_in,
          cash_out,
          cash_returned,
          balance
        };
      });
    });
}

/** GET /api/payroll-dashboard/pm-balance/:pm_id — детальные операции. */
export function loadPmBalanceDetail(pmId) {
  return api(`/api/payroll-dashboard/pm-balance/${pmId}`).then((d) => {
    // Бэк может возвращать поля либо в верхнем уровне (старый формат vanilla), либо в items.
    const items = d?.items || {};
    return {
      pm_id: d?.pm_id ?? Number(pmId),
      pm_name: d?.pm_name || d?.name || null,
      balance: d?.balance ?? null,
      cash_in: Number(d?.cash_in) || 0,
      se_cash_in: Number(d?.se_cash_in) || 0,
      cash_out: Number(d?.cash_out) || 0,
      cash_returned: Number(d?.cash_returned) || 0,
      cash_requests:    d?.cash_requests    || items.cash_requests    || [],
      se_returns:       d?.se_returns       || d?.se_transfer_returns || items.se_transfers || [],
      handovers:        d?.handovers        || items.handovers        || [],
      salary_payments:  d?.salary_payments  || d?.worker_payments     || items.worker_payments || [],
      expenses:         d?.expenses         || d?.cash_expenses       || items.cash_expenses || [],
      cash_returns:     d?.cash_returns     || items.cash_returns     || []
    };
  });
}

export function rub(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', maximumFractionDigits: 0
  }).format(num);
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function balanceTone(n) {
  const num = Number(n) || 0;
  if (num > 0) return 'approved';
  if (num < 0) return 'rejected';
  return 'draft';
}

export function buildMonthOptions() {
  const now = new Date();
  const opts = [{ value: '', label: 'Все месяцы' }];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const lbl = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    opts.push({ value: val, label: lbl });
  }
  return opts;
}
