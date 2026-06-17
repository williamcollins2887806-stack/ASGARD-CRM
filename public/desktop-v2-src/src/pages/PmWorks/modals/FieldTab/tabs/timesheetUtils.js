/**
 * Shared utilities for Timesheet (vanilla parity).
 * Источник: `public/assets/js/field-tab.js:1510-1519` (SHIFT_TYPES + _shiftIcon).
 */

export const SHIFT_TYPES = [
  { value: 'day',     icon: '☀',  label: 'День',     bg: '',                            hours: 11, defaultPts: 13 },
  { value: 'night',   icon: '🌙', label: 'Ночь',     bg: 'rgba(59,130,246,0.12)',       hours: 11, defaultPts: 13 },
  { value: 'half',    icon: '½',  label: 'Полдня',   bg: 'rgba(107,114,128,0.10)',      hours: 6,  defaultPts: 6  },
  { value: 'road',    icon: '🚗', label: 'Дорога',   bg: 'rgba(96,165,250,0.10)',       hours: 0,  defaultPts: 6  },
  { value: 'standby', icon: '⏳', label: 'Ожидание', bg: 'rgba(245,158,11,0.10)',       hours: 0,  defaultPts: 6  }
];

export function getShiftMeta(value) {
  return SHIFT_TYPES.find((s) => s.value === value) || SHIFT_TYPES[0];
}

export function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽';
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
