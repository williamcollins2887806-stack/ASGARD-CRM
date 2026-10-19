/**
 * Headless-проверка ADMIN_ONLY_HIDDEN + MAINTENANCE: реально исполняет router.js и
 * перехват из app.js (вырезан из файла), прогоняет навигации под ролями ADMIN и PM.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const routerSrc = fs.readFileSync(path.join(ROOT, 'public/assets/js/router.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public/assets/js/app.js'), 'utf8');

// фрагмент: MAINTENANCE_PAGES … до placeholder (включает routeKey/isMaintenance/ADMIN_ONLY_HIDDEN/currentRole/maintenanceCard)
const s0 = appSrc.indexOf('const MAINTENANCE_PAGES = {');
const s1 = appSrc.indexOf('async function placeholder(title)');
if (s0 < 0 || s1 < 0) { console.error('не нашёл блок'); process.exit(1); }
const maintCode = appSrc.slice(s0, s1);

// патч роутера
const p0 = appSrc.indexOf('var _origAdd = AsgardRouter.add;');
const p1 = appSrc.indexOf('})();', p0) + 5;
if (p0 < 0 || p1 < 5) { console.error('патч boot не найден'); process.exit(1); }
const patchCode = '(function(){' + appSrc.slice(p0, p1);

// ── окружение ────────────────────────────────────────────────────────────────
const calls = [], layoutCalls = [];
let ROLE = 'ADMIN';
const sandbox = {
  console,
  document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, hidden: false },
  location: { hash: '#/home' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
};
sandbox.window = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.window.dispatchEvent = () => {};
sandbox.window.AsgardUI = { toast: () => {}, hideModal: () => {}, esc: s => String(s == null ? '' : s) };
sandbox.window.AsgardAuth = { requireUser: async () => ({ user: { role: ROLE } }), getAuth: () => ({ user: { role: ROLE } }) };
sandbox.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
sandbox.layout = async (body, opts) => { layoutCalls.push({ body, opts }); };
sandbox.CustomEvent = function () {};
vm.createContext(sandbox);
vm.runInContext(routerSrc, sandbox);
vm.runInContext(maintCode, sandbox);
vm.runInContext(patchCode, sandbox);
const Router = sandbox.window.AsgardRouter;

const ADMIN_ONLY = ['my-dashboard', 'bonus-approval', 'gantt-calcs', 'kanban', 'one-time-pay', 'pass-requests',
  'training', 'all-works', 'tasks-admin', 'collections', 'hr-requests', 'permit-applications',
  'workers-schedule', 'site-crew', 'training-board', 'pm-balance', 'alerts'];
const MAINT = ['gamification-admin', 'preview-calc-report', 'tenderguru-settings', 'pm-consents', 'estimate-report',
  'kpi-money', 'field-tariffs', 'mango', 'reminders', 'payment-invoices', 'command-map-flat'];
const NORMAL = ['home', 'tenders', 'pm-calculations', 'doc-hub', 'payouts', 'telephony', 'personnel', 'cash'];

for (const p of ADMIN_ONLY.concat(MAINT, NORMAL)) Router.add('/' + p, () => { calls.push('REAL:' + p); }, { auth: true, roles: [] });

(async () => {
  let fail = 0;
  const ck = (c, m) => { console.log((c ? '  OK   ' : '  FAIL ') + m); if (!c) fail++; };
  sandbox.window.addEventListener = (ev, fn) => { if (ev === 'hashchange') sandbox.window.__render = fn; };
  Router.start();
  const go = async (hash) => { calls.length = 0; layoutCalls.length = 0; sandbox.location.hash = hash; await sandbox.window.__render(); };
  const banner = () => layoutCalls.some(x => String(x.body).includes('Страница на ремонте'));
  const name = () => { const m = layoutCalls.map(x => String(x.body)).join(' ').match(/Раздел «([^»]+)»/); return m ? m[1] : null; };

  console.log('=== РОЛЬ ADMIN ===');
  ROLE = 'ADMIN';
  for (const p of ADMIN_ONLY) { await go('#/' + p); ck(calls.includes('REAL:' + p) && !banner(), `/ADMIN /${p}: работает как обычно`); }
  for (const p of MAINT) { await go('#/' + p); ck(!calls.includes('REAL:' + p) && banner(), `/ADMIN /${p}: НА РЕМОНТЕ (скрыто для всех)`); }
  for (const p of NORMAL) { await go('#/' + p); ck(calls.includes('REAL:' + p) && !banner(), `/ADMIN /${p}: работает`); }

  console.log('=== РОЛЬ PM (не админ) ===');
  ROLE = 'PM';
  for (const p of ADMIN_ONLY) { await go('#/' + p); ck(!calls.includes('REAL:' + p) && banner(), `/PM /${p}: СКРЫТО (баннер)`); }
  for (const p of NORMAL) { await go('#/' + p); ck(calls.includes('REAL:' + p) && !banner(), `/PM /${p}: работает`); }
  await go('#/pm-balance');
  ck(name() === 'Баланс подотчётников', 'в баннере человеческое имя раздела: ' + name());

  console.log('=== прочие не-админские роли ===');
  for (const role of ['HEAD_PM', 'TO', 'BUH', 'HR', 'OFFICE_MANAGER', 'PROC', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN']) {
    ROLE = role; await go('#/kanban'); ck(banner() && !calls.includes('REAL:kanban'), `${role}: /kanban скрыт`);
  }
  await go('#/kanban?x=1'); ck(banner(), 'параметр в адресе не обходит блокировку');
  await go('#/training'); ck(banner(), '/training скрыт для не-админа');

  console.log(fail === 0 ? '\nHEADLESS: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : '\nHEADLESS: ПРОВАЛОВ ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
