import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Форматирование денег */
export function formatMoney(x, opts = {}) {
  const n = Number(x) || 0;
  if (opts.short) {
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (abs >= 1e9) return sign + (abs/1e9).toFixed(1) + ' млрд ₽';
    if (abs >= 1e6) return sign + (abs/1e6).toFixed(1) + ' млн ₽';
    if (abs >= 1e3) return sign + (abs/1e3).toFixed(0) + ' тыс ₽';
  }
  return n.toLocaleString('ru-RU') + ' ₽';
}

/** Форматирование даты */
export function formatDate(d, style = 'short') {
  if (!d) return '—';
  const dt = new Date(d);
  if (style === 'short') return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return dt.toLocaleDateString('ru-RU');
}

/** Относительное время */
export function relativeTime(date) {
  const diff = Math.round((Date.now() - new Date(date)) / 1000);
  if (diff < 60) return 'только что';
  if (diff < 3600) return Math.floor(diff/60) + ' мин назад';
  if (diff < 86400) return Math.floor(diff/3600) + ' ч назад';
  return Math.floor(diff/86400) + ' дн назад';
}

/** Склонение */
export function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}
