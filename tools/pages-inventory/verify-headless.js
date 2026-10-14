/**
 * Headless-проверка перехвата «Страница на ремонте» БЕЗ браузера.
 * Реально исполняет router.js и патч из app.js (тот же код, вырезан из файла),
 * затем прогоняет навигации и проверяет, какой обработчик вызван.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const routerSrc = fs.readFileSync(path.join(ROOT, 'public/assets/js/router.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public/assets/js/app.js'), 'utf8');

// ── вырезаем из app.js ровно те фрагменты, что там есть ──────────────────────
const s0 = appSrc.indexOf('const MAINTENANCE_PAGES = {');
const s1 = appSrc.indexOf('async function placeholder(title)');
const maintCode = appSrc.slice(s0, s1);

// патч роутера из boot()
const p0 = appSrc.indexOf('var _origAdd = AsgardRouter.add;');
const p1 = appSrc.indexOf('})();', p0) + 5;
if (p0 < 0 || p1 < 5) throw new Error('патч boot не найден');
const patchCode = '(function(){' + appSrc.slice(p0, p1);

console.log('Фрагмент MAINTENANCE:', maintCode.length, 'символов');
console.log('Фрагмент патча:', patchCode.length, 'символов');

// ── окружение ────────────────────────────────────────────────────────────────
const calls = [];
const layoutCalls = [];
const sandbox = {
  console,
  document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, hidden: false },
  location: { hash: '#/home' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  window: null,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
};
sandbox.window = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.window.dispatchEvent = () => {};
sandbox.window.AsgardUI = { toast: () => {}, hideModal: () => {}, esc: s => String(s == null ? '' : s) };
sandbox.window.AsgardAuth = { requireUser: async () => ({ user: { role: 'ADMIN' } }) };
sandbox.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
sandbox.layout = async (body, opts) => { layoutCalls.push({ body, opts }); };
sandbox.CustomEvent = function () { return {}; };
vm.createContext(sandbox);

// router.js
vm.runInContext(routerSrc, sandbox);
// наши фрагменты
vm.runInContext(maintCode, sandbox);
vm.runInContext(patchCode, sandbox);

const Router = sandbox.window.AsgardRouter;

// ── register routes ровно как в app.js: 11 «ремонтных» + несколько обычных ────
const MAINT = ['gamification-admin', 'preview-calc-report', 'tenderguru-settings', 'pm-consents',
  'estimate-report', 'kpi-money', 'field-tariffs', 'mango', 'reminders', 'payment-invoices', 'command-map-flat'];
const OK = ['home', 'tenders', 'pm-calculations', 'doc-hub', 'payouts', 'telephony', 'personnel', 'cash', 'warehouse-v2', 'settings'];
for (const p of MAINT) Router.add('/' + p, () => { calls.push('REAL:' + p); }, { auth: true, roles: [] });
for (const p of OK) Router.add('/' + p, () => { calls.push('REAL:' + p); }, { auth: true, roles: [] });

// ── прогон ───────────────────────────────────────────────────────────────────
(async () => {
  let fail = 0;
  const check = (c, m) => { console.log((c ? '  OK   ' : '  FAIL ') + m); if (!c) fail++; };

  // render() скрыт в замыкании router.js — перехватываем hashchange-обработчик
  // через start() и дёргаем его вручную для каждой навигации.
  sandbox.window.addEventListener = (ev, fn) => { if (ev === 'hashchange') sandbox.window.__render = fn; };
  Router.start();
  check(typeof sandbox.window.__render === 'function', 'router.start() зарегистрировал hashchange-обработчик');

  const go = async (hash) => {
    calls.length = 0; layoutCalls.length = 0;
    sandbox.location.hash = hash;
    await sandbox.window.__render();
  };

  console.log('\n— скрытые страницы (ожидаем НЕ вызов их обработчика, а баннер) —');
  for (const p of MAINT) {
    await go('#/' + p);
    const realCalled = calls.includes('REAL:' + p);
    const banner = layoutCalls.some(x => String(x.body).includes('Страница на ремонте'));
    check(!realCalled && banner, `/${p}: показан баннер, обработчик НЕ вызван`);
  }

  console.log('\n— обычные страницы (ожидаем вызов их обработчика) —');
  for (const p of OK) {
    await go('#/' + p);
    const realCalled = calls.includes('REAL:' + p);
    const banner = layoutCalls.some(x => String(x.body).includes('Страница на ремонте'));
    check(realCalled && !banner, `/${p}: работает как обычно`);
  }

  console.log('\n— параметры в адресе —');
  await go('#/estimate-report?id=42');
  check(!calls.includes('REAL:estimate-report') && layoutCalls.some(x => String(x.body).includes('Страница на ремонте')),
    '/estimate-report?id=42 → баннер');
  await go('#/mango?x=1');
  check(!calls.includes('REAL:mango') && layoutCalls.some(x => String(x.body).includes('Страница на ремонте')),
    '/mango?x=1 → баннер');

  console.log('\n— имя раздела в карточке —');
  await go('#/mango');
  check(layoutCalls.some(x => String(x.body).includes('Настройки телефонии Mango')), 'подставлено человеческое имя раздела');
  check(layoutCalls.every(x => x.opts && x.opts.title === 'Страница на ремонте'), 'title баннера = «Страница на ремонте»');

  console.log(fail === 0 ? '\nHEADLESS: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : '\nHEADLESS: ПРОВАЛОВ ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
