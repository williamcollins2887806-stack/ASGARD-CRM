/**
 * API-клиент для диаграмм Гантта (3 роута).
 * Источник vanilla: public/assets/js/gantt.js + gantt_full.js (renderCalcs/renderWorks/renderCombined).
 */
import { api } from '@/api/client';

export const GANTT_KINDS = {
  calcs:   { title: 'Гантт • Просчёты', motto: 'Сроки видны. Силы рассчитаны. Риск под контролем.', color: 'var(--info)' },
  works:   { title: 'Гантт • Работы',   motto: 'Клятва дана — доведи дело до конца.',               color: 'var(--ok)' },
  objects: { title: 'Гантт • Объекты',  motto: 'Просчёты и работы на одной карте. Путь ясен.',      color: 'var(--gold)' }
};

export const ZOOM_OPTIONS = [
  { value: '12',  label: 'Масштаб: 12 нед' },
  { value: '26',  label: '26 нед' },
  { value: '52',  label: '52 нед' },
  { value: '104', label: '104 нед' }
];

export const PERIOD_OPTIONS = [
  { value: 'custom', label: 'Период: вручную' },
  { value: 'month',  label: 'Текущий месяц' },
  { value: 'year',   label: 'Текущий год' },
  { value: 'last12', label: 'Последние 12 месяцев' },
  { value: 'all',    label: 'Всё время' }
];

export const FILTER_OPTIONS = {
  calcs: [
    { value: 'active', label: 'Активные' },
    { value: 'all',    label: 'Все' },
    { value: 'lost',   label: 'Только отказ/проигрыш' }
  ],
  works: [
    { value: 'active', label: 'Активные' },
    { value: 'all',    label: 'Все' },
    { value: 'done',   label: 'Только завершённые' }
  ],
  objects: [
    { value: 'all',    label: 'Тип: все' },
    { value: 'tender', label: 'Только просчёты' },
    { value: 'work',   label: 'Только работы' }
  ]
};

export function loadWorks() {
  return api('/api/works?limit=1000')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

export function loadTenders() {
  return api('/api/tenders?limit=1000')
    .then((d) => d.tenders || d.items || [])
    .catch(() => []);
}

export function loadPms() {
  return api('/api/users?role=PM&limit=200')
    .then((d) => d.users || d.items || [])
    .catch(() => []);
}

/* ─── Парсинг и работа с датами ─── */
export function parseDate(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function startOfWeek(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function overlap(aStart, aEnd, bStart, bEnd) {
  const a0 = parseDate(aStart) || new Date('1970-01-01'); a0.setHours(0, 0, 0, 0);
  const a1 = parseDate(aEnd) || parseDate(aStart) || a0; a1.setHours(0, 0, 0, 0);
  const b0 = parseDate(bStart) || new Date('1970-01-01'); b0.setHours(0, 0, 0, 0);
  const b1 = parseDate(bEnd) || parseDate(bStart) || b0; b1.setHours(0, 0, 0, 0);
  return a0 <= b1 && b0 <= a1;
}

/* ─── Получение пресета периода ─── */
export function getPresetRange(preset) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (preset === 'month') {
    const a = new Date(now.getFullYear(), now.getMonth(), 1);
    const b = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: isoDate(a), to: isoDate(b) };
  }
  if (preset === 'year') {
    const a = new Date(now.getFullYear(), 0, 1);
    const b = new Date(now.getFullYear(), 11, 31);
    return { from: isoDate(a), to: isoDate(b) };
  }
  if (preset === 'last12') {
    const a = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const b = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: isoDate(a), to: isoDate(b) };
  }
  if (preset === 'all') return { from: '', to: '' };
  return null;
}

/* ─── Преобразование сущностей в строки гантта ─── */
export function tenderToRow(t, startIso) {
  return {
    id: t.id,
    kind: 'tender',
    label: `${t.customer_name || ''} — ${t.tender_title || t.tender_name || ''}`,
    sub: t.tender_status || '',
    status: t.tender_status || '',
    start: t.work_start_plan || t.tender_deadline || startIso,
    end:   t.work_end_plan   || t.work_start_plan || t.tender_deadline || startIso,
    pmId:  t.responsible_pm_id || t.pm_id || null
  };
}

export function workToRow(w, startIso) {
  return {
    id: w.id,
    kind: 'work',
    label: `${w.customer_name || ''} — ${w.work_title || ''}`,
    sub: w.work_status || '',
    status: w.work_status || '',
    start: w.start_in_work_date || w.start_date || w.start_plan || startIso,
    end:   w.end_fact || w.end_plan || w.start_in_work_date || w.start_date || startIso,
    pmId:  w.pm_id || null
  };
}

/* ─── Уникальные статусы из массива ─── */
export function uniqStatuses(items, key) {
  return [...new Set(items.map((it) => it[key]).filter(Boolean))];
}
