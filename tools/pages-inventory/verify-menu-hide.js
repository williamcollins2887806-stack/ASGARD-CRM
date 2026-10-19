/** Проверка левого меню: 17 скрытых маршрутов есть в NAV (видны ADMIN) и убираются у не-админов. */
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.resolve(__dirname, '..', '..', 'public/assets/js/app.js'), 'utf8');

const navBlock = app.slice(app.indexOf('const NAV=['), app.indexOf('\n  ];', app.indexOf('const NAV=[')));
const navRoutes = [...navBlock.matchAll(/\{r:"([^"]+)"/g)].map(m => m[1].replace(/^\//, ''));

const ADMIN_ONLY_HIDDEN = ['my-dashboard', 'bonus-approval', 'gantt-calcs', 'kanban', 'one-time-pay', 'pass-requests',
  'training', 'all-works', 'tasks-admin', 'collections', 'hr-requests', 'permit-applications',
  'workers-schedule', 'site-crew', 'training-board', 'pm-balance', 'alerts'];
const MAINT = ['gamification-admin', 'preview-calc-report', 'tenderguru-settings', 'pm-consents', 'estimate-report',
  'kpi-money', 'field-tariffs', 'mango', 'reminders', 'payment-invoices', 'command-map-flat'];

let fail = 0;
const ck = (c, m) => { console.log((c ? '  OK   ' : '  FAIL ') + m); if (!c) fail++; };

console.log('пунктов в NAV:', navRoutes.length);
console.log('\n— 17 «только у админа» —');
for (const r of ADMIN_ONLY_HIDDEN) {
  const inNav = navRoutes.includes(r);
  const inMaint = !!app.match(new RegExp("'" + r + "':"));
  ck(inNav && inMaint, `/${r}: в NAV (у админа видно) + в ADMIN_ONLY_HIDDEN (у прочих скрыто)`);
}
console.log('\n— 11 «на ремонте» (скрыто у ВСЕХ, включая админа) —');
for (const r of MAINT) {
  const inNav = navRoutes.includes(r);
  ck(!inNav, `/${r}: НЕ в NAV (скрыто у всех)`);
}
console.log('\n— пересечений нет —');
ck(ADMIN_ONLY_HIDDEN.filter(r => MAINT.includes(r)).length === 0, 'списки не пересекаются');

console.log('\n— фильтр меню в коде —');
ck(/if \(role !== 'ADMIN' && isAdminOnlyHidden\(n\.r\)\) return false;/.test(app), 'фильтр «role !== ADMIN → скрыть» присутствует в filteredNav');

console.log(fail === 0 ? '\nМЕНЮ: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : '\nМЕНЮ: ПРОВАЛОВ ' + fail);
process.exit(fail === 0 ? 0 : 1);
