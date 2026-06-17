/**
 * API-клиент страницы /buh-registry — Реестр расходов (BUH).
 * Источник: vanilla `public/assets/js/buh_registry.js` (~560 строк).
 *
 * Endpoints:
 *   GET /api/expenses/work?limit=10000      — все расходы по работам
 *   PUT /api/expenses/work/:id              — обновить расход (doc_number, invoice_*)
 *   GET /api/works?limit=2000               — справочник работ
 *   GET /api/users?limit=200                — справочник пользователей
 */
import { api } from '@/api/client';

// Категории расходов — 1:1 с vanilla buh_registry.js
export const EXPENSE_CATEGORIES = [
  { key: 'fot',           label: 'ФОТ',          color: 'var(--err)',    icon: '👷' },
  { key: 'logistics',     label: 'Логистика',    color: 'var(--amber)',  icon: '🚚' },
  { key: 'accommodation', label: 'Проживание',   color: 'var(--purple)', icon: '🏨' },
  { key: 'transfer',      label: 'Трансфер',     color: 'var(--cyan)',   icon: '🚗' },
  { key: 'chemicals',     label: 'Химия',        color: 'var(--ok)',     icon: '🧪' },
  { key: 'equipment',     label: 'Оборудование', color: 'var(--info)',   icon: '🔧' },
  { key: 'subcontract',   label: 'Субподряд',    color: 'var(--purple)', icon: '🤝' },
  { key: 'tickets',       label: 'Билеты',       color: 'var(--ok)',     icon: '✈' },
  { key: 'materials',     label: 'Материалы',    color: 'var(--cyan)',   icon: '📦' },
  { key: 'cash',          label: 'Наличные',     color: 'var(--orange)', icon: '💵' },
  { key: 'per_diem',      label: 'Суточные',     color: 'var(--amber)',  icon: '🍽' },
  { key: 'other',         label: 'Прочее',       color: 'var(--t-3)',    icon: '📋' }
];

export const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

export const INVOICE_STATUS_OPTIONS = [
  { value: '',     label: 'Все' },
  { value: 'need', label: '⏳ Нужна СФ' },
  { value: 'got',  label: '✓ СФ получена' },
  { value: 'none', label: '— СФ не нужна' }
];

export function loadWorkExpenses() {
  return api('/api/expenses/work?limit=10000')
    .then((d) => d.expenses || [])
    .catch(() => []);
}

export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

export function loadUsers() {
  return api('/api/users?limit=200')
    .then((d) => d.users || d.items || [])
    .catch(() => []);
}

export function updateWorkExpense(id, payload) {
  return api(`/api/expenses/work/${id}`, { method: 'PUT', body: payload });
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

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function getCategory(key) {
  return EXPENSE_CATEGORIES.find((c) => c.key === key) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
}

/* ─── Экспорт CSV ────────────────────────────────────────────────────── */

export function exportExpensesToCsv(expenses, { worksMap, usersMap }, filename = 'expenses.csv') {
  const headers = [
    'Дата', 'Категория', 'Сумма', 'Заказчик', 'Работа',
    'Статус работы', 'Поставщик', '№ документа',
    'Комментарий', 'Нужна СФ', 'СФ получена', 'Кто внёс'
  ];

  const rows = expenses.map((e) => {
    const w = worksMap?.[e.work_id];
    const creator = usersMap?.[e.created_by];
    const cat = getCategory(e.category);
    return [
      e.date || '',
      cat.label,
      e.amount || 0,
      w?.customer_name || w?.customer || '',
      w?.work_title || '',
      w?.work_status || '',
      e.supplier || '',
      e.doc_number || '',
      e.notes || e.comment || '',
      e.invoice_needed ? 'Да' : 'Нет',
      e.invoice_received ? 'Да' : 'Нет',
      creator?.name || creator?.login || ''
    ];
  });

  const esc = (v) => {
    const s = String(v ?? '');
    if (s.includes(';') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
