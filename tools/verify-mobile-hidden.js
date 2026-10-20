'use strict';
/**
 * verify-mobile-hidden.js — гейт скрытия разделов в мобильном приложении.
 *
 * Проверяет, что разделы, скрытые в десктопе (ADMIN_ONLY_HIDDEN / MAINTENANCE_PAGES /
 * navHide), скрыты и на мобильном: нет пункта в меню «Ещё», нет живого перехода из
 * любого места приложения, и маршрут перехватывается ProtectedRoute.
 *
 * Источник истины: public/mobile-app/src/config/hiddenRoutes.js
 * Десктопный эталон: public/assets/js/app.js (ADMIN_ONLY_HIDDEN, MAINTENANCE_PAGES, navHide)
 *
 * Запуск: node tools/verify-mobile-hidden.js
 * Код возврата 1 — есть нарушения.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'mobile-app', 'src');
const DESKTOP = path.join(ROOT, 'public', 'assets', 'js', 'app.js');

let fails = 0;
const fail = (msg) => { console.log('  FAIL ' + msg); fails++; };
const pass = (msg) => console.log('  ok   ' + msg);

/** Читает объект-константу вида `const NAME = { 'key': 'Значение', ... };` из app.js. */
function readDesktopMap(name) {
  const s = fs.readFileSync(DESKTOP, 'utf8');
  const i = s.indexOf('const ' + name + ' = {');
  if (i < 0) return {};
  const j = s.indexOf('};', i);
  const block = s.slice(i, j);
  const out = {};
  for (const m of block.matchAll(/'([a-z0-9-]+)':\s*'([^']*)'/g)) out[m[1]] = m[2];
  return out;
}

/** Все .js/.jsx файлы исходников мобильного (без node_modules/dist). */
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'dist-mine') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, acc); continue; }
    if (/\.(js|jsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

// ─── Загружаем список скрытых маршрутов из самого приложения ──────────────────
const cfgPath = path.join(SRC, 'config', 'hiddenRoutes.js');
if (!fs.existsSync(cfgPath)) { console.error('FAIL: нет ' + cfgPath); process.exit(1); }
const cfg = fs.readFileSync(cfgPath, 'utf8');
const hidden = [];
for (const m of cfg.matchAll(/^\s*'(\/[^']*)',/gm)) hidden.push(m[1]);
const hiddenUniq = [...new Set(hidden)];

console.log('=== verify-mobile-hidden ===');
console.log('скрытых путей в config: ' + hiddenUniq.length);

// ─── 1. Покрытие десктопного списка ───────────────────────────────────────────
const adminOnly = Object.keys(readDesktopMap('ADMIN_ONLY_HIDDEN'));
const maint = Object.keys(readDesktopMap('MAINTENANCE_PAGES'));

/** Есть ли в мобильном приложении файл/компонент для этого раздела. */
function mobileHasRoute(slug) {
  const appx = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
  return new RegExp('path="' + slug.replace(/[/\\]/g, '\\$&')).test(appx);
}

/**
 * Осознанные исключения: разделы, которые на десктопе скрыты, но на мобильном
 * нужны — это НЕ разделы меню, а экраны-детали, куда ведут живые кнопки.
 * Если их скрыть, пользователь нажимает кнопку и молча попадает на главную.
 */
const INTENTIONALLY_VISIBLE = {
  'estimate-report': 'экран-деталь отчёта просчёта: в него ведут «Открыть просчёт» из Мимира и закреплённая карточка просчёта',
};

console.log('\n[1] Разделы, скрытые на десктопе и существующие в мобильном, должны быть в config');
const missing = [];
for (const slug of [...adminOnly, ...maint]) {
  if (!mobileHasRoute('/' + slug)) continue; // такого экрана в мобильном нет вообще
  if (INTENTIONALLY_VISIBLE[slug]) continue; // осознанно оставлен доступным
  if (!hiddenUniq.includes('/' + slug)) missing.push(slug);
}
if (missing.length) {
  fail('не скрыты, хотя скрыты на десктопе: ' + missing.join(', '));
} else {
  pass('все существующие в мобильном скрытые разделы учтены');
}

// ─── 2. Маршруты перехватываются ProtectedRoute ───────────────────────────────
console.log('\n[2] Перехват прямого захода в ProtectedRoute');
const prPath = path.join(SRC, 'components', 'layout', 'ProtectedRoute.jsx');
const pr = fs.readFileSync(prPath, 'utf8');
if (/isHiddenRoute\(location\.pathname\)/.test(pr) && /Navigate to="\/"/.test(pr)) {
  pass('ProtectedRoute уводит скрытые пути на главную');
} else {
  fail('ProtectedRoute не перехватывает isHiddenRoute');
}

// ─── 3. Меню не содержит скрытых пунктов ──────────────────────────────────────
console.log('\n[3] Меню «Ещё» фильтрует скрытое');
const morePath = path.join(SRC, 'pages', 'More.jsx');
const more = fs.readFileSync(morePath, 'utf8');
if (/isHiddenRoute\(item\.path\)/.test(more)) {
  pass('More.jsx фильтрует пункты через isHiddenRoute');
} else {
  fail('More.jsx не фильтрует пункты меню');
}

// ─── 4. Ни один файл не ведёт в скрытый раздел напрямую ───────────────────────
console.log('\n[4] Живые переходы в скрытые разделы');
const files = walk(SRC);
const offenders = [];
for (const f of files) {
  const rel = f.replace(/\\/g, '/');
  if (rel.includes('/config/hiddenRoutes.js')) continue; // сам список
  const s = fs.readFileSync(f, 'utf8');
  for (const h of hiddenUniq) {
    const esc = h.replace(/[/\\]/g, '\\$&');
    // Регистрация маршрута и декларация пункта меню — легитимны:
    // маршрут перехватывает ProtectedRoute, пункт отсекает isHiddenRoute при рендере.
    const navPatterns = [
      new RegExp('navigate\\(\\s*[`\'"]' + esc + '[\'"`]'),
      new RegExp('to=[\'"]' + esc + '[\'"]'),
      new RegExp('href=[\'"]' + esc + '[\'"]'),
    ];
    // Ищем только живые переходы. Но в More.jsx декларации меню идут как path: '/x'
    // внутри объекта — их не считаем: они фильтруются при рендере (проверка 3).
    const isMenuDecl = /\/pages\/More\.jsx$/.test(rel) && new RegExp('path:\\s*[\'"]' + esc + '[\'"]').test(s);
    if (isMenuDecl) continue;
    if (navPatterns.some((re) => re.test(s))) offenders.push(rel + ' → ' + h);
  }
}
if (offenders.length) {
  fail('переходы в скрытое:\n     ' + offenders.join('\n     '));
} else {
  pass('живой навигации в скрытые разделы нет');
}

// ─── 5. Скрытые экраны недостижимы из живых страниц ───────────────────────────
console.log('\n[5] Входы в скрытые экраны удалены из живых страниц');
const ptPath = path.join(SRC, 'pages', 'tenders', 'PlatformTenders.jsx');
if (fs.existsSync(ptPath)) {
  const pt = fs.readFileSync(ptPath, 'utf8');
  const navTo = (pt.match(/navigate\('\/tenders\/tenderguru-settings'\)/g) || []).length;
  if (navTo === 0) pass('PlatformTenders: переходов в настройки TenderGuru нет');
  else fail('PlatformTenders: осталось ' + navTo + ' переход(ов) в скрытые настройки');
}

// Ни один скрытый путь не должен встречаться как navigate('/', 'to=' или 'href='
// (декларации меню More.jsx отсеиваются — их фильтрует isHiddenRoute при рендере).
const liveNav = [];
for (const f of files) {
  const rel = f.replace(/\\/g, '/');
  if (rel.includes('/config/hiddenRoutes.js') || /\/pages\/More\.jsx$/.test(rel)) continue;
  const s = fs.readFileSync(f, 'utf8');
  for (const h of hiddenUniq) {
    const esc = h.replace(/[/\\]/g, '\\$&');
    if (new RegExp('(navigate\\(\\s*[`\'"]|to=[\'"]|href=[\'"])' + esc + '[\'"`]').test(s)) liveNav.push(rel + ' → ' + h);
  }
}
if (liveNav.length) fail('остались живые ссылки:\n     ' + liveNav.join('\n     '));
else pass('живых ссылок на скрытые разделы нет нигде, кроме деклараций меню');

console.log('\nИТОГ: ' + (fails === 0 ? 'OK — скрытие согласовано с десктопом' : 'FAIL — ' + fails + ' нарушений'));
process.exit(fails === 0 ? 0 : 1);
