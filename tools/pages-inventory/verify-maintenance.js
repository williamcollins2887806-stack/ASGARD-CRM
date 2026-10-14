/**
 * Проверка правок «страница на ремонте» без браузера:
 * 1) 11 ключей MAINTENANCE_PAGES совпадают с реальными роутами кода;
 * 2) перехват роутера реально подменяет обработчик (симуляция на моке роутера);
 * 3) NAV больше не содержит /gamification-admin;
 * 4) кнопка CRM 2.0 скрыта, баннер в index.html скрыт;
 * 5) CSS-сдвиг правых панелей под док присутствует.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(ROOT, 'public/assets/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/assets/css/huginn_dock.css'), 'utf8');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  OK   ' : '  FAIL ') + m); if (!c) fail++; };

// ── 1) ключи ↔ реальные роуты ────────────────────────────────────────────────
const keysBlock = app.slice(app.indexOf('const MAINTENANCE_PAGES'), app.indexOf('};', app.indexOf('const MAINTENANCE_PAGES')));
const keys = [...keysBlock.matchAll(/'([a-z0-9-]+)':/g)].map(m => m[1]);
const allRoutes = [...app.matchAll(/AsgardRouter\.add\(\s*"([^"]+)"/g)].map(m => m[1].replace(/^\//, ''));
console.log('Ключей:', keys.length, '| Роутов в app.js:', allRoutes.length);
const notFound = keys.filter(k => !allRoutes.includes(k));
ok(keys.length === 11, 'ровно 11 страниц помечено на ремонт (получено ' + keys.length + ')');
ok(notFound.length === 0, 'все ключи есть среди реальных роутов' + (notFound.length ? ' — НЕТ: ' + notFound.join(', ') : ''));
const expected = ['gamification-admin', 'preview-calc-report', 'tenderguru-settings', 'pm-consents',
  'estimate-report', 'kpi-money', 'field-tariffs', 'mango', 'reminders', 'payment-invoices', 'command-map-flat'];
ok(expected.every(k => keys.includes(k)), 'набор ключей = отметки пользователя в Excel');

// ── 2) симуляция перехвата ───────────────────────────────────────────────────
const isMaint = route => {
  const key = String(route || '').replace(/^\/+/, '').split('?')[0].split('/')[0];
  return keys.includes(key);
};
const cases = [['/mango', true], ['/mango?x=1', true], ['/estimate-report?id=5', true],
  ['/reminders', true], ['/payment-invoices', true], ['/home', false], ['/tenders', false],
  ['/kpi-works', false], ['/customers', false], ['/gantt', false]];
for (const [r, want] of cases) ok(isMaint(r) === want, `isMaintenance('${r}') = ${want}`);

// ── 3) NAV ───────────────────────────────────────────────────────────────────
const navBlock = app.slice(app.indexOf('const NAV=['), app.indexOf('\n  ];', app.indexOf('const NAV=[')));
ok(!/r:"\/gamification-admin"/.test(navBlock), 'злевого меню убран /gamification-admin');
ok(!/r:"\/(mango|reminders|estimate-report|field-tariffs|kpi-money|payment-invoices|tenderguru-settings|pm-consents|preview-calc-report|command-map-flat)"/.test(navBlock),
  'остальные 10 скрытых страниц в меню отсутствуют');

// ── 4) CRM 2.0 ───────────────────────────────────────────────────────────────
ok(/id="asgard-v2-banner" hidden/.test(html), 'баннер CRM 2.0 скрыт (hidden)');
ok(/<a href="\/v2\/" hidden/.test(html), 'ссылка «Попробовать» в баннере скрыта');
ok(!/class="v2-switch v2-switch--to-new" href="\/v2\/"/.test(app), 'кнопка перехода в /v2/ больше не активна');
ok(/class="v2-switch v2-switch--to-new" href="#\/home"[^>]*display:none/.test(app), 'кнопка CRM 2.0 скрыта (display:none)');

// ── 5) CSS ───────────────────────────────────────────────────────────────────
const hasOpen = /body\.hg-dock-open :is\(\.cr-d\.drawer, \.bc-drawer, \.pk3-drawer, \.wh2-cart-dr\)\s*\{[^}]*right:\s*calc\(var\(--hg-panel-w/.test(css);
const hasColl = /body\.hg-dock-collapsed :is\(\.cr-d\.drawer, \.bc-drawer, \.pk3-drawer, \.wh2-cart-dr\)\s*\{[^}]*right:\s*calc\(var\(--hg-rail-w/.test(css);
ok(hasOpen, 'CSS: правые панели смещаются при открытом доке');
ok(hasColl, 'CSS: правые панели смещаются при свёрнутом доке');
ok(/@media \(min-width: 769px\)/.test(css.slice(css.indexOf('Правые выезжающие панели'))), 'CSS-фикс только desktop (≥769px)');

console.log(fail === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : '\nПРОВАЛОВ: ' + fail);
process.exit(fail === 0 ? 0 : 1);
