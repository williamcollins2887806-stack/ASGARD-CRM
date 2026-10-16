'use strict';
/**
 * ASGARD — контраст-верификатор дизайн-токенов (Фаза 1 / verify-gate).
 *
 * Читает src/index.css (:root = тёмная, .light = светлая) и проверяет WCAG
 * для пар «текст на фоне». Именно здесь ловятся дефекты класса «синий шрифт
 * на белом не читается» — цифрами, а не на глаз.
 *
 * Пороги: обычный текст ≥4.5:1 (AA), крупный/UI ≥3.0:1.
 *
 * Запуск:
 *   node tools/verify-contrast.js            # отчёт
 *   node tools/verify-contrast.js --check    # exit 1 при провале
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = path.join(ROOT, 'public', 'mobile-app', 'src', 'index.css');
const CHECK = process.argv.includes('--check');

/* ── WCAG ─────────────────────────────────────────────────────────────────── */
function srgbToLin(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function lum(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}
function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
function ratio(a, b) { return Math.round(contrast(a, b) * 100) / 100; }

/* ── Парсинг токенов из index.css ─────────────────────────────────────────── */
function extractBlock(css, selector) {
  // ищем `selector {` … до парной `}` на верхнем уровне
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return {};
  let depth = 0, i = css.indexOf('{', start), end = -1;
  for (let p = i; p < css.length; p++) {
    if (css[p] === '{') depth++;
    else if (css[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  const body = css.slice(i + 1, end);
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return out;
}

/** rgba(r,g,b,a) на предполагаемом фоне → эффективный hex (композитинг). */
function rgbaToHexOn(rgba, baseHex) {
  const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (!m) return null;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = m[4] === undefined ? 1 : Number(m[4]);
  let h = baseHex.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const bg = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const mix = [r, g, b].map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Токены со значением rgba(...) на известном фоне (--field-text-2/3 и т.п.). */
const RGBA_ON = { '--field-text-2': '--field-card', '--field-text-3': '--field-card', '--field-hairline': '--field-card' };
function extractRgbaBlock(cssText, selector) {
  const hexes = extractBlock(cssText, selector);
  const start = cssText.indexOf(`${selector} {`);
  if (start < 0) return {};
  let depth = 0, end = -1;
  const i = cssText.indexOf('{', start);
  for (let p = i; p < cssText.length; p++) {
    if (cssText[p] === '{') depth++;
    else if (cssText[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  const body = cssText.slice(i + 1, end);
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*(rgba?\([^)]*\))\s*;/g)) {
    const base = RGBA_ON[m[1]] ? (hexes[RGBA_ON[m[1]]] || '#000000') : '#000000';
    const hex = rgbaToHexOn(m[2], base);
    if (hex) out[m[1]] = hex;
  }
  return out;
}

const css = fs.readFileSync(CSS, 'utf8');
// Тёмная тема: :root (второй блок :root меньше — берём первый с токенами).
const dark = { ...extractBlock(css, ':root'), ...extractRgbaBlock(css, ':root') };
// Светлая: склеиваем :root + .light (светлая наследует и переопределяет).
const lightOverrides = { ...extractBlock(css, '.light'), ...extractRgbaBlock(css, '.light') };
const light = { ...dark, ...lightOverrides };

const pick = (obj, name) => obj[name] || dark[name] || null;

/* ── Проверяемые пары ─────────────────────────────────────────────────────── */
/** role: 'text' (≥4.5) | 'ui' (≥3.0) */
const PAIRS = [
  { fg: '--text-primary', bg: '--bg-primary', role: 'text', why: 'основной текст на фоне' },
  { fg: '--text-secondary', bg: '--bg-primary', role: 'text', why: 'вторичный текст на фоне' },
  { fg: '--text-secondary', bg: '--bg-surface', role: 'text', why: 'вторичный текст на карточке' },
  { fg: '--blue', bg: '--bg-primary', role: 'text', why: 'синий акцент = действие' },
  { fg: '--blue', bg: '--bg-surface', role: 'text', why: 'синий акцент на карточке' },
  { fg: '--gold', bg: '--bg-primary', role: 'text', why: 'золото = заработано' },
  { fg: '--gold', bg: '--bg-surface', role: 'text', why: 'золото на карточке' },
  { fg: '--red', bg: '--bg-primary', role: 'ui', why: 'красный = опасность (кнопка/бейдж)' },
  { fg: '--green', bg: '--bg-primary', role: 'ui', why: 'зелёный = статус' },
  { fg: '--field-text', bg: '--field-card', role: 'text', why: 'полевой текст на полевой карточке' },
  { fg: '--field-text-2', bg: '--field-card', role: 'text', why: 'полевой вторичный текст' },
  { fg: '--field-text-3', bg: '--field-card', role: 'ui', why: 'полевой третичный (мета)' },
];

function run(themeName, palette) {
  const rows = [];
  for (const p of PAIRS) {
    const fg = pick(palette, p.fg), bg = pick(palette, p.bg);
    if (!fg || !bg) { rows.push({ ...p, fg, bg, r: null, need: p.role === 'text' ? 4.5 : 3.0, ok: false, missing: true }); continue; }
    const r = ratio(fg, bg);
    const need = p.role === 'text' ? 4.5 : 3.0;
    rows.push({ ...p, fg, bg, r, need, ok: r >= need });
  }
  return { theme: themeName, rows, fails: rows.filter((x) => !x.ok) };
}

const results = [run('dark', dark), run('light', light)];

console.log('# Контраст токенов (WCAG AA)\n');
for (const res of results) {
  console.log(`## ${res.theme}`);
  console.log('| пара | роль | fg | bg | контраст | нужно | итог |');
  console.log('|---|---|---|---|--:|--:|:-:|');
  for (const r of res.rows) {
    console.log(`| ${r.fg} на ${r.bg} | ${r.role} | ${r.fg} | ${r.bg} | ${r.missing ? '—' : r.r} | ${r.need} | ${r.ok ? 'PASS' : 'FAIL'} |`);
  }
  console.log('');
}

const allFails = results.flatMap((r) => r.fails.map((f) => ({ theme: r.theme, ...f })));
if (allFails.length) {
  console.error(`FAIL: ${allFails.length} пар ниже порога`);
  for (const f of allFails) console.error(`  - [${f.theme}] ${f.fg} на ${f.bg} = ${f.r ?? '?'} < ${f.need} (${f.why})`);
  if (CHECK) process.exit(1);
} else {
  console.log('OK — все пары проходят WCAG AA');
}
