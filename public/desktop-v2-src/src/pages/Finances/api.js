/**
 * API-клиент страницы /finances — Финансовая аналитика (Расходы / Поступления).
 *
 * Источник: vanilla `public/assets/js/finances.js` (~530 строк).
 *
 * Endpoints (см. `src/routes/expenses.js`, `src/routes/works.js`):
 *   GET /api/expenses/work?date_from=YYYY-01-01&date_to=YYYY-12-31&limit=10000
 *   GET /api/expenses/office?date_from=…&date_to=…&limit=10000
 *   GET /api/works?limit=2000
 *
 * RBAC: ADMIN, BUH, DIRECTOR_* (на клиенте + бекенд требует authenticate).
 */
import { api } from '@/api/client';

export const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
export const MONTHS_FULL  = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Категории расходов по работам — 1:1 с vanilla finances.js
export const EXPENSE_CATEGORIES = [
  { key: 'fot',           label: 'ФОТ',          color: 'var(--err)',    icon: '👷' },
  { key: 'per_diem',      label: 'Суточные',     color: 'var(--amber)',  icon: '🍽' },
  { key: 'cash',          label: 'Наличные',     color: 'var(--orange)', icon: '💵' },
  { key: 'materials',     label: 'Материалы',    color: 'var(--cyan)',   icon: '📦' },
  { key: 'tickets',       label: 'Билеты',       color: 'var(--ok)',     icon: '✈' },
  { key: 'accommodation', label: 'Проживание',   color: 'var(--info)',   icon: '🏨' },
  { key: 'chemicals',     label: 'Химия',        color: 'var(--purple)', icon: '🧪' },
  { key: 'equipment',     label: 'Оборудование', color: 'var(--purple)', icon: '🔧' },
  { key: 'subcontract',   label: 'Субподряд',    color: 'var(--orange)', icon: '🤝' },
  { key: 'transfer',      label: 'Трансфер',     color: 'var(--cyan)',   icon: '🚗' },
  { key: 'other',         label: 'Прочее',       color: 'var(--t-3)',    icon: '📋' }
];

// Алиасы категорий из vanilla (реальные синонимы из БД)
const CAT_ALIASES = {
  'payroll':    'fot',
  'fot_tax':    'fot',
  'chemistry':  'chemicals',
  'transport':  'transfer',
  'Материалы':  'materials'
};
export function normCat(c) {
  const mapped = CAT_ALIASES[c] || c || 'other';
  return EXPENSE_CATEGORIES.some((x) => x.key === mapped) ? mapped : 'other';
}

/* ─── Данные ─────────────────────────────────────────────────────────── */

export function loadWorkExpenses(year) {
  const dateFrom = `${year}-01-01`;
  const dateTo   = `${year}-12-31`;
  const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, limit: '10000' });
  return api('/api/expenses/work?' + q.toString())
    .then((d) => d.expenses || [])
    .catch(() => []);
}

export function loadOfficeExpenses(year) {
  const dateFrom = `${year}-01-01`;
  const dateTo   = `${year}-12-31`;
  const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, limit: '10000' });
  return api('/api/expenses/office?' + q.toString())
    .then((d) => d.expenses || [])
    .catch(() => []);
}

export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

/* ─── Агрегация ──────────────────────────────────────────────────────── */

/**
 * Считает агрегаты за год: помесячные суммы (income + expenses)
 * и распределение расходов по категориям (по месяцам + общее).
 */
export function collectData(year, { works, workExpenses, officeExpenses }) {
  const data = {
    expenses: { months: Array(12).fill(0), categories: {}, byMonth: [] },
    income:   { months: Array(12).fill(0) }
  };

  EXPENSE_CATEGORIES.forEach((c) => { data.expenses.categories[c.key] = 0; });
  for (let i = 0; i < 12; i++) {
    data.expenses.byMonth[i] = {};
    EXPENSE_CATEGORIES.forEach((c) => { data.expenses.byMonth[i][c.key] = 0; });
  }

  // Доходы по работам (advance_date_fact + payment_date_fact)
  for (const w of works) {
    const advanceDate = w.advance_date_fact ? new Date(w.advance_date_fact) : null;
    const paymentDate = w.payment_date_fact ? new Date(w.payment_date_fact) : null;

    if (advanceDate && advanceDate.getFullYear() === year) {
      data.income.months[advanceDate.getMonth()] += Number(w.advance_received || 0);
    }
    if (paymentDate && paymentDate.getFullYear() === year) {
      data.income.months[paymentDate.getMonth()] += Number(w.balance_received || 0);
    }
  }

  // Расходы — work_expenses + office_expenses
  const addExpense = (exp) => {
    const d = exp.date ? new Date(exp.date) : (exp.created_at ? new Date(exp.created_at) : null);
    if (!d || d.getFullYear() !== year) return;
    const m = d.getMonth();
    const amount = Number(exp.amount) || 0;
    const cat = normCat(exp.category);
    data.expenses.months[m] += amount;
    if (data.expenses.byMonth[m][cat] !== undefined) {
      data.expenses.byMonth[m][cat] += amount;
    } else {
      data.expenses.byMonth[m].other += amount;
    }
  };

  for (const e of workExpenses)   addExpense(e);
  for (const e of officeExpenses) addExpense(e);

  // Сводим за год
  for (let i = 0; i < 12; i++) {
    EXPENSE_CATEGORIES.forEach((c) => {
      data.expenses.categories[c.key] += data.expenses.byMonth[i][c.key];
    });
  }

  return data;
}

/* ─── Форматирование ─────────────────────────────────────────────────── */

export function fmtMoney(n) {
  if (!Number.isFinite(+n) || n === 0) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

export function moneyShort(x) {
  if (x === null || x === undefined || x === '') return '0';
  const n = Math.abs(Number(x));
  if (!Number.isFinite(n)) return '0';
  const sign = Number(x) < 0 ? '−' : '';
  if (n >= 1e9) return sign + (n / 1e9).toFixed(1).replace('.0', '') + ' млрд';
  if (n >= 1e6) return sign + (n / 1e6).toFixed(1).replace('.0', '') + ' млн';
  if (n >= 1e3) return sign + (n / 1e3).toFixed(0) + ' тыс';
  return sign + n.toFixed(0);
}
