/**
 * ASGARD CRM — Mobile Design System v3.0
 * Токены, типографика, анимации, темы
 * Референс: finance_v3.jsx (Alfa-Bank × Ozon × Norse)
 * Сессия 1: Foundation — 14.03.2026
 */

const DS = (() => {
  /* ──────────────── ЦВЕТОВЫЕ ТЕМЫ ──────────────── */
  const themes = {
    light: {
      name: 'light',
      bg: '#F2F3F5',
      surface: '#FFFFFF',
      surfaceAlt: '#F7F7FA',
      text: '#1A1A1F',
      textSec: '#6E6E78',
      textTer: '#A8A8B2',
      border: 'rgba(0,0,0,0.06)',
      borderStrong: 'rgba(0,0,0,0.12)',

      // Brand
      red: '#C62828',
      redBright: '#E53935',
      redBg: 'rgba(198,40,40,0.08)',
      redBorder: 'rgba(198,40,40,0.15)',
      blue: '#1E5A99',
      blueBright: '#2B7BD4',
      blueBg: 'rgba(30,90,153,0.08)',
      blueBorder: 'rgba(30,90,153,0.15)',
      gold: '#C49A2A',
      goldBg: 'rgba(196,154,42,0.08)',
      goldBorder: 'rgba(196,154,42,0.15)',
      green: '#1A9F4A',
      greenBg: 'rgba(26,159,74,0.08)',
      greenBorder: 'rgba(26,159,74,0.15)',
      orange: '#E65100',
      orangeBg: 'rgba(230,81,0,0.08)',
      orangeBorder: 'rgba(230,81,0,0.15)',

      // Gradients
      heroGrad: 'linear-gradient(135deg, #0A5DC2 0%, #1565C0 25%, #4A1942 55%, #8B1A1A 78%, #C62828 100%)',
      heroGradSoft: 'linear-gradient(145deg, rgba(10,93,194,0.12) 0%, rgba(198,40,40,0.12) 100%)',
      shimmerGrad: 'linear-gradient(90deg, #F2F3F5 25%, #E0E0E6 50%, #F2F3F5 75%)',

      // Tab bar
      tabBarBg: 'rgba(255,255,255,0.94)',

      // Shadows
      shadow: '0 2px 12px rgba(0,0,0,0.05)',
      shadowHover: '0 8px 24px rgba(0,0,0,0.1)',
      heroShadow: '0 8px 32px rgba(198,40,40,0.2)',
      fabShadow: '0 4px 20px rgba(198,40,40,0.35)',

      // Misc
      inputBg: '#F7F7FA',
      overlay: 'rgba(0,0,0,0.4)',
      selection: 'rgba(30,90,153,0.15)',
    },
    dark: {
      name: 'dark',
      bg: '#0D0D0F',
      surface: '#1A1A1F',
      surfaceAlt: '#222228',
      text: '#F5F5F7',
      textSec: '#8E8E93',
      textTer: '#4A4A50',
      border: 'rgba(255,255,255,0.06)',
      borderStrong: 'rgba(255,255,255,0.12)',

      // Brand
      red: '#E53935',
      redBright: '#FF5252',
      redBg: 'rgba(229,57,53,0.12)',
      redBorder: 'rgba(229,57,53,0.2)',
      blue: '#4A90D9',
      blueBright: '#64B5F6',
      blueBg: 'rgba(74,144,217,0.12)',
      blueBorder: 'rgba(74,144,217,0.2)',
      gold: '#D4A843',
      goldBg: 'rgba(212,168,67,0.12)',
      goldBorder: 'rgba(212,168,67,0.2)',
      green: '#34C759',
      greenBg: 'rgba(52,199,89,0.12)',
      greenBorder: 'rgba(52,199,89,0.2)',
      orange: '#FF9500',
      orangeBg: 'rgba(255,149,0,0.12)',
      orangeBorder: 'rgba(255,149,0,0.2)',

      // Gradients
      heroGrad: 'linear-gradient(135deg, #1A4A8A 0%, #1E5A99 25%, #3A1535 55%, #6B1515 78%, #C62828 100%)',
      heroGradSoft: 'linear-gradient(145deg, rgba(26,74,138,0.15) 0%, rgba(198,40,40,0.15) 100%)',
      shimmerGrad: 'linear-gradient(90deg, #1A1A1F 25%, #363640 50%, #1A1A1F 75%)',

      // Tab bar
      tabBarBg: 'rgba(26,26,31,0.94)',

      // Shadows
      shadow: '0 2px 12px rgba(0,0,0,0.3)',
      shadowHover: '0 8px 24px rgba(0,0,0,0.4)',
      heroShadow: '0 8px 32px rgba(198,40,40,0.3)',
      fabShadow: '0 4px 20px rgba(198,40,40,0.5)',

      // Misc
      inputBg: '#222228',
      overlay: 'rgba(0,0,0,0.6)',
      selection: 'rgba(74,144,217,0.2)',
    }
  };

  /* ──────────────── ТИПОГРАФИКА ──────────────── */
  const typography = {
    xs:    { size: '10px', weight: 500, lineHeight: 1.3 },
    sm:    { size: '12px', weight: 400, lineHeight: 1.4 },
    base:  { size: '14px', weight: 400, lineHeight: 1.5 },
    md:    { size: '16px', weight: 600, lineHeight: 1.3 },
    lg:    { size: '20px', weight: 700, lineHeight: 1.2, letterSpacing: '-0.4px' },
    xl:    { size: '24px', weight: 800, lineHeight: 1.1, letterSpacing: '-0.6px' },
    hero:  { size: '30px', weight: 800, lineHeight: 1.0, letterSpacing: '-1px' },
    label: { size: '10px', weight: 500, lineHeight: 1.3, letterSpacing: '1px', textTransform: 'uppercase' },
  };

  /* ──────────────── ОТСТУПЫ И СКРУГЛЕНИЯ ──────────────── */
  const spacing = {
    xxs: 4,  xs: 8,  sm: 12,  md: 14,  base: 16,  lg: 20,  xl: 24,  xxl: 32,
    page: 20,  // padding по бокам страницы
    gap: 12,   // gap между карточками
  };

  const radius = {
    xs: 4, sm: 8, md: 12, lg: 14, xl: 18, xxl: 20, hero: 20, pill: 44,
  };

  /* ──────────────── Z-INDEX SCALE ──────────────── */
  const zIndex = {
    base: 0,
    dropdown: 10,
    sticky: 50,
    fab: 90,
    overlay: 1000,
    sheet: 1500,
    modal: 2000,
    toast: 2500,
  };

  /* ──────────────── ТЕКУЩАЯ ТЕМА ──────────────── */
  let currentTheme = 'dark';
  let t = themes.dark;

  function setTheme(name) {
    if (!themes[name]) return;
    currentTheme = name;
    t = themes[name];

    // Inject CSS variables
    const root = document.documentElement;
    for (const [key, value] of Object.entries(t)) {
      root.style.setProperty('--' + camelToDash(key), value);
    }

    // Typography variables
    for (const [key, val] of Object.entries(typography)) {
      root.style.setProperty(`--font-${key}-size`, val.size);
      root.style.setProperty(`--font-${key}-weight`, String(val.weight));
      root.style.setProperty(`--font-${key}-lh`, String(val.lineHeight));
      if (val.letterSpacing) root.style.setProperty(`--font-${key}-ls`, val.letterSpacing);
    }

    // Spacing variables
    for (const [key, val] of Object.entries(spacing)) {
      root.style.setProperty(`--sp-${key}`, val + 'px');
    }

    // Radius variables
    for (const [key, val] of Object.entries(radius)) {
      root.style.setProperty(`--r-${key}`, val + 'px');
    }

    // ═══ Set data-theme attribute for desktop CSS rules ═══
    // theme.css has 1000+ rules under html[data-theme="light"]
    root.dataset.theme = name;

    // ═══ Bridge: set desktop CSS primitive variables too ═══
    // design-tokens.css uses --bg1, --bg2, --t1, --t2, --brd etc.
    // Without this, light theme won't work because desktop CSS reads primitives
    root.style.setProperty('--bg0', t.bg);
    root.style.setProperty('--bg1', t.bg);
    root.style.setProperty('--bg2', t.surface);
    root.style.setProperty('--bg3', t.surfaceAlt);
    root.style.setProperty('--bg4', t.surfaceAlt);
    root.style.setProperty('--bg5', t.surfaceAlt);
    root.style.setProperty('--t1', t.text);
    root.style.setProperty('--t2', t.textSec);
    root.style.setProperty('--t3', t.textTer);
    root.style.setProperty('--brd', t.border);
    root.style.setProperty('--brd-m', t.border);
    root.style.setProperty('--bg-input', t.inputBg);
    root.style.setProperty('--bg-surface', t.surface);
    root.style.setProperty('--overlay', t.overlay);

    // Meta theme-color
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement('meta');
      metaTheme.name = 'theme-color';
      document.head.appendChild(metaTheme);
    }
    metaTheme.content = t.bg;

    // Body transition
    document.body.style.transition = 'background-color 0.4s ease, color 0.4s ease';
    document.body.style.backgroundColor = t.bg;
    document.body.style.color = t.text;

    // Store
    if (typeof Store !== 'undefined') Store.set('theme', name);
    try { localStorage.setItem('asgard_theme', name); } catch (_) {}

    // Dispatch event
    window.dispatchEvent(new CustomEvent('asgard:theme', { detail: { theme: name } }));
  }

  function toggleTheme() {
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }

  function getTheme() {
    return currentTheme;
  }

  /* ──────────────── CSS INJECTION ──────────────── */
  function injectStyles() {
    if (document.getElementById('asgard-ds-styles')) return;

    const style = document.createElement('style');
    style.id = 'asgard-ds-styles';
    style.textContent = generateCSS();
    document.head.appendChild(style);

    // Load saved theme or default to dark
    const saved = localStorage.getItem('asgard_theme');
    setTheme(saved || 'dark');
  }

  function generateCSS() {
    return `
/* ═══════════════════════════════════════════
   ASGARD CRM Mobile — Design System CSS
   ═══════════════════════════════════════════ */

/* Font family */
*, *::before, *::after {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  overscroll-behavior: none;
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  position: fixed;
  width: 100%;
  height: 100%;
  background-color: var(--bg);
  color: var(--text);
}

/* ───── Scrollbar hiding ───── */
.asgard-no-scrollbar::-webkit-scrollbar { display: none; }
.asgard-no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

/* ═══════ SHELL LAYOUT ═══════ */
.asgard-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  position: relative;
  overflow: hidden;
  background: var(--bg) !important;
}

.asgard-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  position: relative;
  padding-top: env(safe-area-inset-top);
  background: var(--bg);
}

/* ═══════ PAGE TRANSITIONS ═══════ */
.asgard-page {
  min-height: 100%;
  padding-bottom: 100px;
  will-change: transform, opacity;
  background: var(--bg);
}

.asgard-slide-left {
  animation: asgardSlideLeft 0.35s cubic-bezier(.34,1.56,.64,1) forwards;
}
.asgard-slide-right {
  animation: asgardSlideRight 0.35s cubic-bezier(.34,1.56,.64,1) forwards;
}
.asgard-fade {
  animation: asgardFade 0.25s ease forwards;
}
.asgard-page-exit {
  animation: asgardPageExit 0.3s ease forwards;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

/* ═══════ TAB BAR ═══════ */
.asgard-tabbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  background: var(--tab-bar-bg);
  backdrop-filter: blur(30px) saturate(1.2);
  -webkit-backdrop-filter: blur(30px) saturate(1.2);
  border-top: 1px solid var(--border);
  box-shadow: 0 -10px 32px rgba(0,0,0,0.15);
  padding: 10px 12px 8px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
  position: relative;
  z-index: 100;
  flex-shrink: 0;
}

.asgard-tabbar__item {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  max-width: 76px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 4px 6px;
  border-radius: 18px;
  text-decoration: none;
  color: var(--text-sec);
  position: relative;
  transition: color 0.22s ease, background 0.22s ease, transform 0.22s ease, box-shadow 0.22s ease;
}

.asgard-tabbar__item.active {
  color: var(--text);
  background: linear-gradient(180deg, rgba(255,255,255,0.22) 0%, var(--blue-bg) 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 6px 14px rgba(30,90,153,0.10);
}

.asgard-tabbar__icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.72;
  transition: opacity 0.22s ease, filter 0.22s ease, transform 0.22s ease;
}
.asgard-tabbar__icon svg {
  width: 20px;
  height: 20px;
}

.asgard-tabbar__item.active .asgard-tabbar__icon {
  opacity: 1;
  filter: none;
  transform: translateY(-1px);
}

.asgard-tabbar__label {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.1px;
}

.asgard-tabbar__indicator {
  width: 18px;
  height: 3px;
  border-radius: 999px;
  background: var(--blue);
  opacity: 0;
  transform: scaleX(0.55);
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.asgard-tabbar__item.active .asgard-tabbar__indicator {
  opacity: 1;
  transform: scaleX(1);
}

.asgard-tabbar__badge {
  position: absolute;
  top: 6px;
  right: 10px;
  min-width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--red);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  box-shadow: 0 4px 10px rgba(198,40,40,0.24);
}

/* ═══════ FAB (Mimir) ═══════ */
.asgard-tabbar__fab {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(180deg, var(--red-bright) 0%, var(--red) 100%);
  border: 4px solid rgba(255,255,255,0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: -30px;
  box-shadow: 0 12px 28px rgba(198,40,40,0.28), inset 0 1px 0 rgba(255,255,255,0.24);
  position: relative;
  z-index: 2;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.asgard-tabbar__fab:active {
  transform: translateY(1px) scale(0.94);
  box-shadow: 0 8px 18px rgba(198,40,40,0.22), inset 0 1px 0 rgba(255,255,255,0.24);
}
.asgard-tabbar__fab svg {
  width: 24px;
  height: 24px;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.18));
  stroke-width: 2.35;
}

/* ═══════ PULL TO REFRESH ═══════ */
.asgard-ptr {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: height 0.3s ease;
}
.asgard-ptr__spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--red);
  border-radius: 50%;
  transition: transform 0.1s linear;
}
.asgard-ptr--refreshing .asgard-ptr__spinner {
  animation: asgardSpin 0.8s linear infinite;
}

/* ═══════ SWIPE ACTIONS ═══════ */
.asgard-swipe-inner {
  position: relative;
  z-index: 1;
  background: var(--surface);
  will-change: transform;
}
.asgard-swipe-actions {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  z-index: 0;
}
.asgard-swipe-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  border: none;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

/* ═══════ OVERLAY ═══════ */
.asgard-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  pointer-events: none;
}
.asgard-overlay > * {
  pointer-events: auto;
}

/* ═══════ KEYFRAMES ═══════ */
@keyframes asgardSlideLeft {
  from { transform: translateX(100%); opacity: 0.8; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes asgardSlideRight {
  from { transform: translateX(-30%); opacity: 0.8; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes asgardFade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes asgardPageExit {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(-20%); }
}

@keyframes asgardSlideUp {
  from { transform: translateY(14px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes asgardPopUp {
  from { transform: translateY(4px) scale(0.96); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}

@keyframes asgardFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes asgardShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes asgardSpin {
  to { transform: rotate(360deg); }
}

@keyframes asgardFabPulse {
  0%, 100% { box-shadow: var(--fab-shadow); }
  50% { box-shadow: 0 4px 28px rgba(198,40,40,0.55); }
}

@keyframes asgardShake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

@keyframes asgardSlideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes asgardSlideSheetUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@keyframes asgardGrow {
  from { transform: scaleY(0); transform-origin: bottom; }
  to { transform: scaleY(1); transform-origin: bottom; }
}

@keyframes asgardCountUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes asgardRipple {
  to { transform: scale(2.5); opacity: 0; }
}

/* ═══════ UNIQUE KEYFRAMES (from mobile_v3.css) ═══════ */
@keyframes asgardFadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes asgardBounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
@keyframes asgardBreath {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes asgardSlideSheetDown {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}

/* ═══════ TEXT SAFETY ═══════ */
.asgard-text-safe {
  word-break: break-word;
  hyphens: auto;
  -webkit-hyphens: auto;
}
.asgard-text-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.asgard-text-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.asgard-text-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ═══════ INTERACTIVE STATES ═══════ */
.asgard-pressable:active {
  transform: scale(0.97);
  opacity: 0.85;
}
.asgard-card-hover:active {
  transform: scale(0.98);
  box-shadow: none;
}
.asgard-btn:active {
  transform: scale(0.96);
}
.asgard-btn-mini:active {
  transform: scale(0.92);
}

/* ═══════ RIPPLE ═══════ */
.asgard-ripple {
  position: relative;
  overflow: hidden;
}
.asgard-ripple::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle, rgba(255,255,255,0.15) 10%, transparent 50%);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
.asgard-ripple:active::after {
  opacity: 1;
}

/* ═══════ BOTTOM SHEET HANDLE ═══════ */
.asgard-sheet-handle::before {
  content: '';
  display: block;
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--text-ter, #4A4A50);
  margin: 10px auto 6px;
  opacity: 0.5;
}

/* ═══════ HEADER BACKDROP ═══════ */
.asgard-header {
  backdrop-filter: blur(20px) saturate(1.3);
  -webkit-backdrop-filter: blur(20px) saturate(1.3);
  border-bottom: 0.5px solid rgba(255,255,255,0.08);
}

/* ═══════ SELECTION ═══════ */
::selection { background: var(--selection); }

/* ═══════ SAFE AREAS ═══════ */
@supports (padding: env(safe-area-inset-top)) {
  .asgard-content {
    padding-top: env(safe-area-inset-top);
  }
  .asgard-tabbar {
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
  }
  .asgard-safe-top { padding-top: env(safe-area-inset-top); }
  .asgard-safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
  .asgard-safe-x { padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); }
}

/* ═══════ PRINT ═══════ */
@media print {
  .asgard-tabbar, .asgard-header, .asgard-fab { display: none !important; }
  .asgard-content { overflow: visible !important; }
  body { position: static !important; overflow: visible !important; }
}

/* ═══════ DESKTOP CSS ISOLATION ═══════
   Когда мобильный shell активен, нейтрализуем десктопные глобальные стили.
   Без этого: body::before (градиент), Inter шрифт, input focus glow,
   и другие desktop CSS правила ломают мобильный UI.
   ═══════════════════════════════════════ */

/* Убить десктопную accent-полоску */
html.asgard-mobile body::before {
  display: none !important;
}

/* Сбросить body — мобильный shell управляет через inline */
html.asgard-mobile body {
  min-height: unset !important;
  overflow: hidden !important;
  position: fixed !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* Вернуть системный шрифт — Inter не нужен на мобильном */
html.asgard-mobile,
html.asgard-mobile body,
html.asgard-mobile button,
html.asgard-mobile select,
html.asgard-mobile input,
html.asgard-mobile textarea,
html.asgard-mobile h1, html.asgard-mobile h2,
html.asgard-mobile h3, html.asgard-mobile h4,
html.asgard-mobile h5, html.asgard-mobile h6 {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif !important;
}

/* Сбросить desktop input/select/textarea стили */
html.asgard-mobile input,
html.asgard-mobile select,
html.asgard-mobile textarea {
  width: unset;
  padding: unset;
  border: unset;
  background: unset;
  color: unset;
  font-size: unset;
  transition: unset;
  border-radius: unset;
}

/* Убить десктопный focus-outline (мобильные компоненты ставят свой через JS) */
html.asgard-mobile input:focus,
html.asgard-mobile select:focus,
html.asgard-mobile textarea:focus {
  outline: none;
}

/* Сбросить десктопный checkbox/radio размер */
html.asgard-mobile input[type="checkbox"],
html.asgard-mobile input[type="radio"] {
  width: unset;
  height: unset;
  padding: unset;
}

/* touch-action for all mobile interactive elements */
html.asgard-mobile button,
html.asgard-mobile [role="button"],
html.asgard-mobile a {
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

/* Toggle — явные стили чтобы ничего не перебило */
html.asgard-mobile .asgard-theme-toggle {
  -webkit-appearance: none !important;
  appearance: none !important;
  border: none !important;
  border-radius: 13px !important;
  min-height: 26px !important;
  max-height: 26px !important;
  width: 50px !important;
  padding: 0 !important;
  overflow: hidden !important;
}

/* Ссылки — мобильные компоненты управляют цветом через inline */
html.asgard-mobile a {
  color: inherit;
  text-decoration: none;
}

/* Скроллбар — скрыть полностью на мобильных */
html.asgard-mobile ::-webkit-scrollbar {
  display: none;
}
html.asgard-mobile * {
  scrollbar-width: none;
}

/* ═══════ PORTRAIT LOCK ═══════ */
@media (orientation: landscape) and (max-height: 500px) {
  html.asgard-mobile .asgard-shell {
    display: none !important;
  }
  html.asgard-mobile .asgard-rotate-hint {
    display: flex !important;
  }
}

.asgard-rotate-hint {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: var(--bg, #0D0D0F);
  color: var(--text, #F5F5F7);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}

/* ═══════ CALENDAR GRID ═══════ */
html.asgard-mobile .asgard-calendar-grid {
  display: grid !important;
  grid-template-columns: repeat(7, 1fr) !important;
  gap: 2px !important;
  text-align: center !important;
}

/* ═══════ SAFARI AUTOFILL FIX ═══════ */
@keyframes onAutoFillStart { from {} to {} }
html.asgard-mobile input:-webkit-autofill { animation-name: onAutoFillStart; }

html.asgard-mobile input:-webkit-autofill,
html.asgard-mobile input:-webkit-autofill:hover,
html.asgard-mobile input:-webkit-autofill:focus {
  -webkit-box-shadow: 0 0 0 1000px var(--input-bg, #222228) inset !important;
  -webkit-text-fill-color: var(--text, #F5F5F7) !important;
  transition: background-color 5000s ease-in-out 0s;
  caret-color: var(--text, #F5F5F7);
}

    `;
  }

  /* ──────────────── ANIMATION HELPER ──────────────── */
  function anim(delay = 0) {
    return {
      animation: `asgardSlideUp 0.4s cubic-bezier(.34,1.56,.64,1) ${delay}s both`,
    };
  }

  function animPop(delay = 0) {
    return {
      animation: `asgardPopUp 0.2s cubic-bezier(.34,1.56,.64,1) ${delay}s both`,
    };
  }

  /* ──────────────── STATUS PRESETS ──────────────── */
  const statusColors = {
    success: (theme) => ({ color: theme.green, bg: theme.greenBg, border: theme.greenBorder }),
    danger:  (theme) => ({ color: theme.red, bg: theme.redBg, border: theme.redBorder }),
    warning: (theme) => ({ color: theme.orange, bg: theme.orangeBg, border: theme.orangeBorder }),
    info:    (theme) => ({ color: theme.blue, bg: theme.blueBg, border: theme.blueBorder }),
    neutral: (theme) => ({ color: theme.textTer, bg: theme.surfaceAlt, border: theme.border }),
    gold:    (theme) => ({ color: theme.gold, bg: theme.goldBg, border: theme.goldBorder }),
  };

  function status(type) {
    const fn = statusColors[type] || statusColors.neutral;
    return fn(t);
  }

  /* ──────────────── FONT HELPER ──────────────── */
  function font(scale) {
    const f = typography[scale] || typography.base;
    const style = {
      fontSize: f.size,
      fontWeight: f.weight,
      lineHeight: f.lineHeight,
    };
    if (f.letterSpacing) style.letterSpacing = f.letterSpacing;
    if (f.textTransform) style.textTransform = f.textTransform;
    return style;
  }

  /* ──────────────── THEME TOGGLE COMPONENT ──────────────── */
  function createThemeToggle() {
    const toggle = document.createElement('button');
    toggle.className = 'asgard-theme-toggle';
    toggle.setAttribute('aria-label', 'Переключить тему');

    Object.assign(toggle.style, {
      width: '50px',
      height: '26px',
      borderRadius: '13px',
      border: 'none',
      padding: '0',
      cursor: 'pointer',
      position: 'relative',
      transition: 'background 0.3s ease',
      display: 'flex',
      alignItems: 'center',
      overflow: 'hidden',
      boxSizing: 'border-box',
      flexShrink: '0',
      outline: 'none',
      WebkitTapHighlightColor: 'transparent',
    });

    updateToggleVisual(toggle);

    toggle.addEventListener('click', () => {
      toggleTheme();
      updateToggleVisual(toggle);
    });

    const themeHandler = () => updateToggleVisual(toggle);
    window.addEventListener('asgard:theme', themeHandler);

    // Expose cleanup method
    toggle._cleanup = () => window.removeEventListener('asgard:theme', themeHandler);

    return toggle;
  }

  function updateToggleVisual(toggle) {
    const isDark = currentTheme === 'dark';
    toggle.style.background = isDark ? '#2C2C34' : '#4A90D9';

    toggle.innerHTML = '';

    // Thumb (moving circle)
    const thumb = document.createElement('span');
    Object.assign(thumb.style, {
      width: '22px',
      height: '22px',
      borderRadius: '50%',
      background: '#FFFFFF',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'absolute',
      top: '2px',
      left: isDark ? '2px' : '26px',
      transition: 'left 0.3s cubic-bezier(.34,1.56,.64,1)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      fontSize: '13px',
      lineHeight: '1',
      pointerEvents: 'none',
    });
    thumb.textContent = isDark ? '\u{1F319}' : '\u2600\uFE0F';
    toggle.appendChild(thumb);
  }

  /* ──────────────── UTILITY ──────────────── */
  function camelToDash(str) {
    return str.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  function css(tokenName) {
    return `var(--${camelToDash(tokenName)})`;
  }

  /* ──────────────── PUBLIC API ──────────────── */
  return {
    get t() { return t; },
    themes,
    typography,
    spacing,
    radius,
    z: zIndex,
    setTheme,
    toggleTheme,
    getTheme,
    injectStyles,
    anim,
    animPop,
    status,
    font,
    css,
    createThemeToggle,
  };
})();

// Global export
if (typeof window !== 'undefined') {
  window.DS = DS;
}
