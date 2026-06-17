/**
 * API-клиент страницы /all-works — Свод Контрактов.
 * Источник: vanilla `public/assets/js/all_works.js` (312 строк).
 * Для руководства видны все работы (без фильтра по pm_id со стороны клиента).
 */
import { api } from '@/api/client';

// Backend хранит work_status как русский string. English value были мёртвым кодом —
// фильтр по 'closed'/'finished' никогда не возвращал старые работы.
// Полный список включает legacy-окончания (Завершена/Сдан) которые встречаются в БД,
// см. vanilla pm_works.js:1090, buh_registry.js:291.
export const WORK_STATUSES = [
  { value: 'Новая',           label: 'Новая' },
  { value: 'Подготовка',      label: 'Подготовка' },
  { value: 'Мобилизация',     label: 'Мобилизация' },
  { value: 'В работе',        label: 'В работе' },
  { value: 'На паузе',        label: 'На паузе' },
  { value: 'Подписание акта', label: 'Подписание акта' },
  { value: 'Работы сдали',    label: 'Работы сдали' },
  { value: 'Закрыт',          label: 'Закрыта' },
  { value: 'Закрыта',         label: 'Закрыта (legacy)' },
  { value: 'Закрыто',         label: 'Закрыто (legacy)' },
  { value: 'Завершена',       label: 'Завершена' },
  { value: 'Завершено',       label: 'Завершено' },
  { value: 'Завершен',        label: 'Завершен (м.р.)' },
  { value: 'Завершён',        label: 'Завершён (м.р.)' },
  { value: 'Сдан',            label: 'Сдан' },
  { value: 'Сдана',           label: 'Сдана' },
  { value: 'Сдано',           label: 'Сдано' },
  { value: 'Отменена',        label: 'Отменена' },
  { value: 'Отменено',        label: 'Отменено' },
  { value: 'Отменён',         label: 'Отменён' },
  { value: 'Отменен',         label: 'Отменен (без ё)' },
  { value: 'Отмена',          label: 'Отмена' }
];

export const PERIOD_PRESETS = [
  { value: 'all',       label: 'Всё время' },
  { value: 'today',     label: 'Сегодня' },
  { value: 'week',      label: 'Неделя' },
  { value: 'month',     label: 'Месяц' },
  { value: 'quarter',   label: 'Квартал' },
  { value: 'year',      label: 'Год' }
];

export function loadWorks(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 1000));
  return api(`/api/works?${q.toString()}`).then((d) => d.works || d.items || []);
}

export function loadUsers(role) {
  const q = role ? `?role=${role}&limit=200` : '?limit=200';
  return api('/api/users' + q).then((d) => d.users || d.items || []).catch(() => []);
}

export function loadTenders() {
  return api('/api/tenders?limit=1000').then((d) => d.tenders || d.items || []).catch(() => []);
}

/* ─── Хелперы фильтрации ─── */

export function filterByPeriod(works, period) {
  if (!period || period === 'all') return works;
  const now = Date.now();
  const day = 86400000;
  const cutoff = {
    today: now - day,
    week: now - 7 * day,
    month: now - 30 * day,
    quarter: now - 90 * day,
    year: now - 365 * day
  }[period];
  if (!cutoff) return works;
  return works.filter((w) => {
    const c = w.start_date && new Date(w.start_date).getTime();
    if (Number.isFinite(c) && c >= cutoff) return true;
    const c2 = w.created_at && new Date(w.created_at).getTime();
    return Number.isFinite(c2) && c2 >= cutoff;
  });
}

export function filterByQuery(works, q) {
  if (!q || !q.trim()) return works;
  const lq = q.trim().toLowerCase();
  return works.filter((w) =>
    (w.customer_name || '').toLowerCase().includes(lq) ||
    (w.customer || '').toLowerCase().includes(lq) ||
    (w.work_title || '').toLowerCase().includes(lq) ||
    String(w.id).includes(lq)
  );
}

export function filterByMatch(works, key, value) {
  if (!value) return works;
  return works.filter((w) => String(w[key] ?? '') === String(value));
}

/* ─── Форматирование ─── */

export function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

/**
 * Экспорт в CSV на клиенте (Excel понимает CSV с BOM, разделитель ';' для RU-locale).
 */
export function exportWorksToCsv(works, pmsById, filename = 'all-works.csv') {
  const rows = [
    ['ID', 'Заказчик', 'Работа', 'РП', 'Статус', 'Контракт ₽', 'Получено ₽', 'Старт', 'План', 'Факт']
  ];
  for (const w of works) {
    const pm = pmsById?.[w.pm_id];
    const received = (Number(w.advance_received || 0) + Number(w.balance_received || 0)) || 0;
    rows.push([
      w.id,
      w.customer_name || w.customer || '',
      w.work_title || '',
      pm?.name || pm?.login || '',
      w.work_status || '',
      Math.round(Number(w.contract_value || 0)),
      Math.round(received),
      w.start_in_work_date ? new Date(w.start_in_work_date).toLocaleDateString('ru-RU') : '',
      w.end_plan ? new Date(w.end_plan).toLocaleDateString('ru-RU') : '',
      w.end_fact ? new Date(w.end_fact).toLocaleDateString('ru-RU') : ''
    ]);
  }
  const esc = (v) => {
    const s = String(v ?? '');
    if (s.includes(';') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
