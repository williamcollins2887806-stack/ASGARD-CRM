/**
 * ASGARD Design System — JS токены
 * Синхронизированы с index.css и design-tokens.css
 */

export const colors = {
  brand: {
    red: '#C8293B',
    blue: '#1E4D8C',
    gold: '#D4A843',
  },
  dark: {
    bgPrimary: '#0a0a0c',
    bgSurface: '#141418',
    bgSurfaceAlt: '#1c1c22',
    bgElevated: '#242430',
    bgFloating: '#2c2c3a',
    textPrimary: '#F5F5F7',
    textSecondary: '#8E8E93',
    textTertiary: '#48484A',
  },
  light: {
    bgPrimary: '#F2F2F7',
    bgSurface: '#FFFFFF',
    bgSurfaceAlt: '#F7F7FA',
    bgElevated: '#FFFFFF',
    bgFloating: '#FFFFFF',
    textPrimary: '#1C1C1E',
    textSecondary: '#6C6C70',
    textTertiary: '#AEAEB2',
  },
  accent: {
    gold: '#c8a84e',
    goldDim: '#a08030',
    blue: '#4A90D9',
    blueDim: '#2d5a8a',
    red: '#c62828',
    redSoft: '#ff453a',
    green: '#30d158',
    purple: '#7B68EE',
  },
};

export const typography = {
  display:  { size: 28, weight: 700, tracking: -0.02 },
  title1:   { size: 22, weight: 700, tracking: -0.01 },
  title2:   { size: 18, weight: 600, tracking: 0 },
  body:     { size: 15, weight: 400, tracking: 0 },
  bodyBold: { size: 15, weight: 600, tracking: 0 },
  caption1: { size: 13, weight: 500, tracking: 0 },
  caption2: { size: 11, weight: 500, tracking: 0.02 },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  pill: 44,
};

export const motion = {
  instant: 100,
  fast: 150,
  normal: 250,
  slow: 400,
  gentle: 600,
};

export const easing = {
  enter: 'cubic-bezier(0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  smoothOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

export const shadows = {
  0: 'none',
  1: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
  2: '0 4px 6px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.1)',
  3: '0 10px 20px rgba(0,0,0,0.2), 0 3px 6px rgba(0,0,0,0.1)',
  4: '0 15px 40px rgba(0,0,0,0.25), 0 5px 15px rgba(0,0,0,0.1)',
  5: '0 20px 60px rgba(0,0,0,0.35), 0 8px 20px rgba(0,0,0,0.15)',
};

export const zIndex = {
  base: 1,
  elevated: 10,
  sticky: 20,
  overlay: 30,
  modal: 40,
  toast: 50,
};

export const gradients = {
  hero: 'linear-gradient(135deg, #1a4a8a 0%, #3a1535 50%, #c62828 100%)',
  heroSoft: 'linear-gradient(135deg, #1E4D8C 0%, #2a1a3e 60%, #8B1A2B 100%)',
  gold: 'linear-gradient(135deg, #D4A843, #a08030)',
  accent: 'linear-gradient(135deg, #4A90D9, #7B68EE)',
  aurora: 'linear-gradient(-45deg, #0a0a1a, #0d1b3e, #1a0a2e, #0a1628, #1c0a22, #0a0a1a)',
};
