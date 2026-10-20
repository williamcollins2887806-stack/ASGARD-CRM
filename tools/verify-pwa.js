'use strict';
/**
 * verify-pwa.js — гейт PWA-оболочки и iOS-адаптации.
 *
 * Проверяет:
 *  1. index.html: viewport-fit=cover, apple-mobile-web-app-*, theme-color (обе темы),
 *     link rel=manifest, apple-touch-icon, набор apple-touch-startup-image.
 *  2. manifest.json: display/display_override, start_url/scope/id, иконки any+maskable
 *     (192 и 512), shortcuts, цвета, orientation.
 *  3. Файлы иконок и splash реально существуют на диске (битые пути = белый экран).
 *  4. safe-area переменные объявлены ровно один раз и участвуют в --tabbar-total.
 *  5. themeStore переключает meta theme-color под тему.
 *
 * Запуск: node tools/verify-pwa.js
 * Код возврата 1 — есть нарушения.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const M = path.join(ROOT, 'public', 'mobile-app');
const HTML = path.join(M, 'index.html');
const MANIFEST = path.join(M, 'public', 'manifest.json');
const CSS = path.join(M, 'src', 'index.css');
const THEME = path.join(M, 'src', 'stores', 'themeStore.js');

let fails = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { console.log('  FAIL ' + m); fails++; };

console.log('=== verify-pwa ===');
const html = fs.readFileSync(HTML, 'utf8');
const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const css = fs.readFileSync(CSS, 'utf8');
const theme = fs.readFileSync(THEME, 'utf8');

// ─── 1. Оболочка ──────────────────────────────────────────────────────────────
console.log('\n[1] index.html');
const htmlChecks = [
  ['viewport-fit=cover', /viewport-fit=cover/],
  ['apple-mobile-web-app-capable', /apple-mobile-web-app-capable/],
  ['apple-mobile-web-app-status-bar-style', /apple-mobile-web-app-status-bar-style/],
  ['apple-mobile-web-app-title', /apple-mobile-web-app-title/],
  ['theme-color', /name="theme-color"/],
  ['theme-color для светлой темы', /theme-color[^>]*prefers-color-scheme:\s*light/],
  ['link rel=manifest', /rel="manifest"/],
  ['apple-touch-icon', /rel="apple-touch-icon"/],
  ['apple-touch-startup-image', /apple-touch-startup-image/],
];
for (const [name, re] of htmlChecks) { if (re.test(html)) ok(name); else bad('нет ' + name); }

// ─── 2. Манифест ──────────────────────────────────────────────────────────────
console.log('\n[2] manifest.json');
if (man.display === 'standalone') ok('display=standalone'); else bad('display=' + man.display);
if (Array.isArray(man.display_override) && man.display_override.length) ok('display_override: ' + man.display_override.join(','));
else bad('нет display_override');
if (man.start_url === '/m/') ok('start_url=/m/'); else bad('start_url=' + man.start_url);
if (man.scope === '/m/') ok('scope=/m/'); else bad('scope=' + man.scope);
if (man.id) ok('id=' + man.id); else bad('нет id');
if (man.orientation === 'portrait') ok('orientation=portrait'); else bad('orientation=' + man.orientation);
if (man.background_color && man.theme_color) ok('цвета заданы'); else bad('нет background/theme color');
const icons = man.icons || [];
const hasAny = (sz) => icons.some((i) => i.sizes === sz && (!i.purpose || i.purpose === 'any'));
const hasMask = (sz) => icons.some((i) => i.sizes === sz && i.purpose === 'maskable');
if (hasAny('192x192') && hasAny('512x512')) ok('иконки any 192/512'); else bad('нет иконок any 192/512');
if (hasMask('192x192') && hasMask('512x512')) ok('иконки maskable 192/512'); else bad('нет maskable-иконок');
if (Array.isArray(man.shortcuts) && man.shortcuts.length >= 3) ok('shortcuts: ' + man.shortcuts.length);
else bad('shortcuts < 3');
if (Array.isArray(man.categories) && man.categories.length) ok('categories'); else bad('нет categories');

// ─── 3. Файлы существуют ──────────────────────────────────────────────────────
console.log('\n[3] Файлы иконок и splash');
const missingFiles = [];
// иконки манифеста лежат в public/assets/img (путь указан от корня сайта)
for (const ic of icons) {
  const p = path.join(ROOT, 'public', ic.src.replace(/^\//, ''));
  if (!fs.existsSync(p)) missingFiles.push(ic.src);
}
// splash из index.html
for (const m of html.matchAll(/apple-touch-startup-image" href="([^"]+)"/g)) {
  const p = path.join(ROOT, 'public', m[1].replace(/^\//, ''));
  if (!fs.existsSync(p)) missingFiles.push(m[1]);
}
if (missingFiles.length) bad('нет файлов: ' + missingFiles.join(', '));
else ok('все иконки и splash на месте');

// ─── 4. Safe-area ─────────────────────────────────────────────────────────────
console.log('\n[4] safe-area и тап-бар');
for (const v of ['--safe-top', '--safe-bottom', '--safe-left', '--safe-right']) {
  const n = (css.match(new RegExp(v.replace(/-/g, '\\-') + ':', 'g')) || []).length;
  if (n === 1) ok(v + ' объявлен один раз'); else bad(v + ' объявлен ' + n + ' раз(а)');
}
if (/--tabbar-total:\s*calc\(var\(--tabbar-height\)\s*\+\s*var\(--safe-bottom\)\)/.test(css)) {
  ok('--tabbar-total включает safe-area');
} else bad('--tabbar-total не включает --safe-bottom');

// ─── 5. Тема ──────────────────────────────────────────────────────────────────
console.log('\n[5] theme-color от темы');
if (/meta\[name="theme-color"\]/.test(theme) && /applyTheme/.test(theme)) ok('themeStore обновляет meta theme-color');
else bad('themeStore не обновляет theme-color');
if (/isStandalone/.test(theme) && /display-mode: standalone/.test(theme)) ok('isStandalone определяет display-mode');
else bad('нет isStandalone/display-mode');

// ─── 6. Standalone-класс на КОРНЕ документа ──────────────────────────────────
// Раньше класс вешался на внутренний <div>, и CSS `.is-standalone body` не
// матчился вовсе (правило было мёртвым). Проверяем, что класс ставится на <html>.
console.log('\n[6] Класс is-standalone на documentElement');
const app = fs.readFileSync(path.join(M, 'src', 'App.jsx'), 'utf8');
if (/applyStandaloneClass/.test(app)) ok('App.jsx вызывает applyStandaloneClass');
else bad('App.jsx не применяет класс standalone к корню документа');
if (/classList\.toggle\('is-standalone'/.test(theme)) ok('themeStore меняет класс на documentElement');
else bad('themeStore не ставит класс на documentElement');
// Селекторы в CSS должны использовать область от корня (не `.is-standalone body`).
if (/\.is-standalone\s+body\s*\{/.test(css) && !/:root\.is-standalone|html\.is-standalone/.test(css)) {
  // `.is-standalone body` допустим, только если класс реально на <html>.
  if (!/documentElement\.classList/.test(theme)) bad('CSS .is-standalone body без класса на <html> — правило мёртвое');
  else ok('CSS .is-standalone body согласован с классом на <html>');
} else ok('CSS standalone-правила заданы корректно');

console.log('\nИТОГ: ' + (fails === 0 ? 'OK — PWA и iOS-адаптация собраны верно' : 'FAIL — ' + fails + ' нарушений'));
process.exit(fails === 0 ? 0 : 1);
