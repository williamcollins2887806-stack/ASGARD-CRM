/**
 * ASGARD Field — Design System (ds-field.js)
 * Dark-first mobile DS with gold accents
 */
(() => {
'use strict';

const themes = {
  dark: {
    bg0: '#0D0D0F', bg1: '#18181B', bg2: '#1E1E23', bg3: '#27272B',
    surface: '#1E1E23', surfaceHover: '#27272B', surfaceActive: '#2E2E33',
    border: 'rgba(255,255,255,0.08)', borderLight: 'rgba(255,255,255,0.04)',
    text: '#F4F4F5', textSec: '#A1A1AA', textTer: '#71717A', textInv: '#0D0D0F',
    gold: '#D4A843', goldDark: '#C49A2A', goldLight: '#E8C560',
    accent: '#D4A843', accentHover: '#E8C560',
    green: '#34C759', greenDark: '#1A9F4A', greenBg: 'rgba(52,199,89,0.12)',
    red: '#E53935', redDark: '#C62828', redBg: 'rgba(229,57,53,0.12)',
    blue: '#3B82F6', blueBg: 'rgba(59,130,246,0.12)',
    orange: '#F59E0B', orangeBg: 'rgba(245,158,11,0.12)',
    // Gradients
    heroGrad: 'linear-gradient(135deg, #1A1A2E 0%, #16213E 50%, #0F3460 100%)',
    goldGrad: 'linear-gradient(135deg, #C49A2A 0%, #D4A843 50%, #E8C560 100%)',
    shiftActiveGrad: 'linear-gradient(135deg, #1A9F4A 0%, #34C759 100%)',
    dangerGrad: 'linear-gradient(135deg, #C62828 0%, #E53935 100%)',
    goldBg: 'linear-gradient(135deg, rgba(196,154,42,0.08) 0%, rgba(212,168,67,0.04) 100%)',
    cardGrad: 'linear-gradient(180deg, #1E1E23 0%, #18181B 100%)',
  },
  light: {
    bg0: '#FFFFFF', bg1: '#F8F8FA', bg2: '#F0F0F3', bg3: '#E8E8EB',
    surface: '#FFFFFF', surfaceHover: '#F8F8FA', surfaceActive: '#F0F0F3',
    border: 'rgba(0,0,0,0.08)', borderLight: 'rgba(0,0,0,0.04)',
    text: '#18181B', textSec: '#52525B', textTer: '#A1A1AA', textInv: '#F4F4F5',
    gold: '#B8860B', goldDark: '#A07608', goldLight: '#D4A843',
    accent: '#B8860B', accentHover: '#D4A843',
    green: '#16A34A', greenDark: '#15803D', greenBg: 'rgba(22,163,74,0.08)',
    red: '#DC2626', redDark: '#B91C1C', redBg: 'rgba(220,38,38,0.08)',
    blue: '#2563EB', blueBg: 'rgba(37,99,235,0.08)',
    orange: '#D97706', orangeBg: 'rgba(217,119,6,0.08)',
    heroGrad: 'linear-gradient(135deg, #EDE9FE 0%, #DBEAFE 50%, #E0E7FF 100%)',
    goldGrad: 'linear-gradient(135deg, #B8860B 0%, #D4A843 50%, #E8C560 100%)',
    shiftActiveGrad: 'linear-gradient(135deg, #15803D 0%, #16A34A 100%)',
    dangerGrad: 'linear-gradient(135deg, #B91C1C 0%, #DC2626 100%)',
    goldBg: 'linear-gradient(135deg, rgba(184,134,11,0.06) 0%, rgba(212,168,67,0.03) 100%)',
    cardGrad: 'linear-gradient(180deg, #FFFFFF 0%, #F8F8FA 100%)',
  }
};

const spacing = { xxs:4, xs:8, sm:12, md:14, base:16, lg:20, xl:24, xxl:32, page:20, hero:40 };
const radius = { xs:4, sm:8, md:12, lg:14, xl:18, xxl:20, hero:24, pill:9999 };
const zIndex = { base:1, card:10, header:100, overlay:200, modal:300, toast:400 };

const fontScale = {
  hero: { size: '2rem', weight: 700, lh: 1.1 },
  xl:   { size: '1.5rem', weight: 700, lh: 1.2 },
  lg:   { size: '1.25rem', weight: 600, lh: 1.3 },
  md:   { size: '1.125rem', weight: 600, lh: 1.35 },
  base: { size: '1rem', weight: 400, lh: 1.5 },
  sm:   { size: '0.875rem', weight: 400, lh: 1.45 },
  xs:   { size: '0.75rem', weight: 400, lh: 1.4 },
  label:{ size: '0.6875rem', weight: 600, lh: 1.3, ls: '0.08em', transform: 'uppercase' },
};

let currentTheme = 'dark';
let t = themes.dark;

const DS = {
  t, themes, spacing, radius, zIndex, fontScale,

  font(scale) {
    const s = fontScale[scale] || fontScale.base;
    return `font-size:${s.size};font-weight:${s.weight};line-height:${s.lh};${s.ls ? 'letter-spacing:'+s.ls+';':''}${s.transform ? 'text-transform:'+s.transform+';':''}`;
  },

  setTheme(name) {
    currentTheme = name;
    t = themes[name] || themes.dark;
    DS.t = t;
    DS.injectVars();
  },

  getTheme() { return currentTheme; },

  injectVars() {
    let root = document.getElementById('ds-field-vars');
    if (!root) {
      root = document.createElement('style');
      root.id = 'ds-field-vars';
      document.head.appendChild(root);
    }
    const v = Object.entries(t).map(([k, val]) => `--f-${k}:${val}`).join(';');
    const sp = Object.entries(spacing).map(([k, val]) => `--sp-${k}:${val}px`).join(';');
    const rd = Object.entries(radius).map(([k, val]) => `--r-${k}:${val}px`).join(';');
    root.textContent = `:root{${v};${sp};${rd}}`;
  },

  injectStyles() {
    DS.injectVars();
    if (document.getElementById('ds-field-anim')) return;
    const style = document.createElement('style');
    style.id = 'ds-field-anim';
    style.textContent = `
@keyframes fieldPulse{0%,100%{box-shadow:0 0 0 0 rgba(196,154,42,0.4)}50%{box-shadow:0 0 0 12px rgba(196,154,42,0)}}
@keyframes fieldGreenPulse{0%,100%{box-shadow:0 0 0 0 rgba(52,199,89,0.35)}50%{box-shadow:0 0 0 12px rgba(52,199,89,0)}}
@keyframes fieldGlow{0%,100%{filter:drop-shadow(0 0 8px rgba(196,154,42,0.3))}50%{filter:drop-shadow(0 0 16px rgba(196,154,42,0.6))}}
@keyframes fieldSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes fieldSlideDown{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}
@keyframes fieldFadeIn{from{opacity:0}to{opacity:1}}
@keyframes fieldPop{0%{transform:scale(0)}60%{transform:scale(1.15)}100%{transform:scale(1)}}
@keyframes fieldShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
@keyframes fieldTimer{from{width:100%}to{width:0%}}
@keyframes fieldSpin{to{transform:rotate(360deg)}}
@keyframes fieldGradShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes fieldCountUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
`;
    document.head.appendChild(style);
  },

  anim(delay) {
    return `animation:fieldSlideUp 0.4s ease ${delay||0}s both`;
  },

  animPop(delay) {
    return `animation:fieldPop 0.5s cubic-bezier(0.175,0.885,0.32,1.275) ${delay||0}s both`;
  },

  status(type) {
    const map = {
      active: { bg: 'var(--f-greenBg)', color: 'var(--f-green)', label: 'Активна' },
      completed: { bg: 'var(--f-blueBg)', color: 'var(--f-blue)', label: 'Завершена' },
      cancelled: { bg: 'var(--f-redBg)', color: 'var(--f-red)', label: 'Отменена' },
      pending: { bg: 'var(--f-orangeBg)', color: 'var(--f-orange)', label: 'Ожидание' },
      draft: { bg: 'var(--f-border)', color: 'var(--f-textSec)', label: 'Черновик' },
    };
    return map[type] || map.pending;
  },
};

window.DS = DS;
})();
