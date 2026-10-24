import { create } from 'zustand';

/** Цвет строки статуса/фона под каждую тему — совпадает с :root и .light. */
const THEME_COLOR = { dark: '#0a0a0c', light: '#F2F2F7' };

/**
 * Применяет тему к документу: класс на <html> и meta theme-color.
 * theme-color влияет на строку статуса iOS в standalone и на адресную строку
 * Android — при переключении темы он обязан меняться, иначе светлая тема
 * остаётся с чёрной полосой сверху.
 */
function applyTheme(next) {
  document.documentElement.classList.toggle('light', next === 'light');
  const color = THEME_COLOR[next] || THEME_COLOR.dark;
  let meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
  /**
   * Фон документа = обычный фон страницы, а НЕ цвет тап-бара.
   *
   * 23.10.2026: раньше здесь стоял цвет бара, и это была МАСКИРОВКА «зазора»
   * внизу. Полоса под баром физически есть; покраска в цвет бара делала бар
   * визуально толще (52px + 51px) и «то жирным, то узким» при самопочинке
   * вьюпорта. Заказчик отверг верно — геометрию цветом не чинят.
   *
   * 24.10.2026: сдвиг бара вниз (`--tabbar-lift`) ОТКАЧЕН. На iOS `position: fixed`
   * обрезается по layout viewport: при сдвиге −51px от бара оставалось видно 1px
   * из 52 (замер: tools/_test-fixed-clip.js). Заказчик увидел это как «половина
   * тап-бара не видна». Бар стоит на `bottom: 0` и виден целиком.
   * Цветовое решение «шва» — в AppSplash (последний стоп градиента = --bg-primary).
   */
  document.documentElement.style.backgroundColor = color;
}

export const useThemeStore = create((set) => ({
  theme: localStorage.getItem('asgard_theme') || 'dark',

  toggleTheme: () => {
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('asgard_theme', next);
      applyTheme(next);
      return { theme: next };
    });
  },

  initTheme: () => {
    const saved = localStorage.getItem('asgard_theme') || 'dark';
    applyTheme(saved);
    set({ theme: saved });
  },
}));

/**
 * Установлено ли приложение как PWA (iOS Safari — navigator.standalone,
 * остальные — display-mode: standalone/fullscreen/minimal-ui).
 */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.navigator.standalone === true) return true;
  if (typeof window.matchMedia !== 'function') return false;
  return ['standalone', 'fullscreen', 'minimal-ui'].some((m) =>
    window.matchMedia(`(display-mode: ${m})`).matches
  );
}

/**
 * Помечает документ признаком standalone: класс на <html>, а не на внутреннем
 * div. Это важно для CSS: правила вида `.is-standalone body` матчатся только
 * если класс лежит на корне документа (иначе селектор потомка не находит узел).
 */
export function applyStandaloneClass() {
  if (typeof document === 'undefined') return false;
  const on = isStandalone();
  document.documentElement.classList.toggle('is-standalone', on);
  return on;
}
