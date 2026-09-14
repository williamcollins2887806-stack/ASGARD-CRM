export { formatMoney as fmtMoney } from '@/lib/money';
/**
 * Shared utilities for Timesheet (vanilla parity).
 * Источник: `public/assets/js/field-tab.js:1510-1519` (SHIFT_TYPES + _shiftIcon).
 */

export const SHIFT_TYPES = [
  { value: 'day',        icon: '☀',  label: 'День',      bg: '',                             hours: 11, defaultPts: 13, editable: true },
  { value: 'night',      icon: '🌙', label: 'Ночь',      bg: 'rgba(59,130,246,0.12)',        hours: 11, defaultPts: 13, editable: true },
  { value: 'half',       icon: '½',  label: 'Полдня',    bg: 'rgba(107,114,128,0.10)',       hours: 6,  defaultPts: 6,  editable: true },
  { value: 'road',       icon: '🚗', label: 'Дорога',    bg: 'rgba(96,165,250,0.10)',        hours: 0,  defaultPts: 6,  editable: true },
  { value: 'standby',    icon: '⏳', label: 'Ожидание',  bg: 'rgba(245,158,11,0.10)',        hours: 0,  defaultPts: 6,  editable: true },
  // Только отображение этапов из маршрутов (не выбираются в ShiftPopover)
  { value: 'ship',       icon: '🚢', label: 'Корабль',   bg: 'rgba(56,189,248,0.12)',        hours: 0,  defaultPts: 12, editable: false },
  { value: 'helicopter', icon: '🚁', label: 'Вертолёт',  bg: 'rgba(167,139,250,0.12)',       hours: 0,  defaultPts: 6,  editable: false },
  { value: 'warehouse',  icon: '📦', label: 'Склад',     bg: 'rgba(148,163,184,0.12)',       hours: 0,  defaultPts: 10, editable: false },
  { value: 'medical',    icon: '🏥', label: 'Медосмотр', bg: 'rgba(244,114,182,0.12)',       hours: 0,  defaultPts: 7,  editable: false },
  { value: 'training',   icon: '🎓', label: 'Обучение',  bg: 'rgba(251,191,36,0.12)',        hours: 0,  defaultPts: 7,  editable: false }
];

export const EDITABLE_SHIFT_TYPES = SHIFT_TYPES.filter((s) => s.editable !== false);

export function getShiftMeta(value) {
  const key = value === 'travel' ? 'road' : value;
  return SHIFT_TYPES.find((s) => s.value === key) || SHIFT_TYPES[0];
}

export function fmtInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return new Intl.NumberFormat('ru-RU').format(Math.round(v));
}

/* Шкала цветов баллов (vanilla parity). */
export function pointsColor(pts) {
  if (pts >= 18) return '#D4A843';
  if (pts >= 12) return '#10b981';
  if (pts >= 6)  return '#3b82f6';
  return 'var(--t-3)';
}

/* Сдвиг даты в YYYY-MM-DD на N дней. */
export function ymdAddDays(ymd, days) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return (
    date.getFullYear() +
    '-' + String(date.getMonth() + 1).padStart(2, '0') +
    '-' + String(date.getDate()).padStart(2, '0')
  );
}

/* Список дат YYYY-MM-DD от from до to (включительно). */
export function buildDateRange(from, to) {
  const dates = [];
  if (!from || !to) return dates;
  const [yF, mF, dF] = String(from).slice(0, 10).split('-').map(Number);
  const [yT, mT, dT] = String(to).slice(0, 10).split('-').map(Number);
  const cur = new Date(yF, mF - 1, dF);
  const end = new Date(yT, mT - 1, dT);
  while (cur <= end) {
    dates.push(
      cur.getFullYear() +
      '-' + String(cur.getMonth() + 1).padStart(2, '0') +
      '-' + String(cur.getDate()).padStart(2, '0')
    );
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/* День недели (0 = Вс, 1 = Пн … 6 = Сб) для YYYY-MM-DD. */
export function dayOfWeek(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/* Короткая метка дня для шапки таблицы. */
export function dayLabel(ymd) {
  const [, m, d] = String(ymd).slice(0, 10).split('-');
  return `${d}.${m}`;
}

/* Сокращённое название дня недели (Пн/Вт/...). */
export function dowShort(ymd) {
  return ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][dayOfWeek(ymd)];
}

/** Сегодняшняя дата YYYY-MM-DD (локальная). */
export function todayYmd() {
  const t = new Date();
  return (
    t.getFullYear() +
    '-' + String(t.getMonth() + 1).padStart(2, '0') +
    '-' + String(t.getDate()).padStart(2, '0')
  );
}

export function isTodayYmd(ymd) {
  return String(ymd || '').slice(0, 10) === todayYmd();
}

/* Извлечь стандартный per-point из dashboard (tariff.point_value), fallback 500. */
export function extractPointValue(dashboard) {
  if (!dashboard) return 500;
  const pv =
    dashboard?.tariff?.point_value ??
    dashboard?.crew?.[0]?.point_value ??
    null;
  const n = parseFloat(pv);
  return Number.isFinite(n) && n > 0 ? n : 500;
}
