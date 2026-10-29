/**
 * Гейт D-348: переключение вкладок «Анализ / Просчёты / Мои / Архив» не должно
 * рендерить страницу дважды (29.10.2026).
 *
 * Жалоба: «когда между этими вкладками прыгаю — страница как будто 2 раза грузится».
 *
 * Причина была в обработчике вкладки (`pm_duty.js`, bindEvents):
 *
 *     tab = b.dataset.tab;
 *     location.hash = '#/pm-calculations?tab=' + tab;   // → hashchange → router.render()
 *     refreshUI();                                       // → ещё один полный цикл
 *
 * Смена хэша запускает `hashchange`, на который подписан `AsgardRouter.start()`,
 * и роутер заново вызывает `render()` страницы. То есть на ОДИН клик приходилось
 * два полных цикла: 6 запросов + layout() каждый.
 *
 * Гейт проверяет не строки, а факт: поднимает настоящий роутер и настоящую
 * страницу, кликает по вкладкам и СЧИТАЕТ вызовы API и layout().
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PM_DUTY = 'public/assets/js/pm_duty.js';
const ROUTER = 'public/assets/js/router.js';

const pmDuty = fs.readFileSync(PM_DUTY, 'utf8');
const router = fs.readFileSync(ROUTER, 'utf8');

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

// ── 1. Статическая защита: обработчик не должен делать и то, и другое ─────
console.log('=== 1. Обработчик вкладки: один цикл, а не два ===');

const tabHandler = pmDuty.match(/document\.querySelectorAll\('\[data-tab\]'\)\.forEach[\s\S]{0,1400}?\n      \}\);/);
if (!tabHandler) {
  bad('не нашёл обработчик [data-tab]');
} else {
  const h = tabHandler[0];
  const setsHash = /location\.hash\s*=/.test(h);
  const callsRefresh = /refreshUI\(\)/.test(h);
  // Допустимо ИЛИ хэш, ИЛИ прямой refresh — но не оба безусловно.
  const guarded = /if \(location\.hash === want\) refreshUI\(\);/.test(h)
    && /else location\.hash = want;/.test(h);
  if (setsHash && callsRefresh && !guarded) {
    bad('обработчик одновременно ставит хэш И зовёт refreshUI → двойной рендер');
  } else if (guarded) {
    ok('хэш и refreshUI разведены по условию (один рендер на клик)');
  } else {
    ok('обработчик делает только одно действие');
  }
  if (/if \(next === tab\) return;/.test(h)) ok('повторный клик по активной вкладке не грузит');
  else bad('нет защиты от повторного клика по активной вкладке');
}

// ── 2. Защита от гонки ответов ────────────────────────────────────────────
console.log('\n=== 2. Устаревшие ответы не перерисовывают экран ===');
if (/let renderSeq = 0;/.test(pmDuty) && /const seq = \+\+renderSeq;/.test(pmDuty)) {
  ok('есть счётчик поколений отрисовки');
} else {
  bad('нет счётчика поколений — медленный ответ старой вкладки перерисует новую');
}
const seqGuards = (pmDuty.match(/if \(seq !== renderSeq\) return;/g) || []).length;
if (seqGuards >= 2) ok(`проверка поколения до и после layout (${seqGuards} места)`);
else bad(`проверка поколения только в ${seqGuards} месте(ах)`);

// ── 3. Рантайм: считаем циклы на реальном роутере ─────────────────────────
console.log('\n=== 3. Браузер: клик по вкладке = один цикл загрузки ===');

const page = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font:14px system-ui} .pm-duty-tab{padding:6px 10px}</style></head>
<body><div id="app"></div>
<script>
/* ── Счётчики ─────────────────────────────────────────────────────────── */
window.__api = {};          // сколько раз звали каждый метод
window.__renderCalls = 0;   // сколько раз роутер вызвал render страницы
window.__layoutCalls = 0;   // сколько раз строили оболочку

function bump(name) { window.__api[name] = (window.__api[name] || 0) + 1; }

/* ── Заглушки окружения ───────────────────────────────────────────────── */
window.AsgardUI = {
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
  toast: function () {}, showModal: function () {}, hideModal: function () {}, replaceModal: null
};
const USER = { id: 1, role: 'PM', name: 'Тест РП' };
window.AsgardAuth = {
  requireUser: async function () { return { user: USER }; },
  getAuth: function () { return { user: USER, token: 't' }; },
  normalizeUserRoles: function (u) { return [u.role]; },
  isDirectorRole: function () { return false; },
  hasPermission: function () { return false; },
  getPermissions: function () { return {}; },
  getMenuSettings: function () { return {}; }
};
window.AsgardDB = { byIndex: function () { return Promise.resolve([]); } };
window.AsgardSLA = { tick: async function () {} };

const EMPTY = { items: [], banner: null, duty: null, is_duty: false, queue_mode: 'duty' };
window.AsgardRegistryApi = {
  fmtDate: function (v) { return v ? String(v).slice(0, 10) : '—'; },
  loadPmDutyQueue: async function () { bump('queue'); return EMPTY; },
  loadPmDutyQueueCounts: async function () { bump('counts'); return { analysis: 15, calc: 0, mine: 7, archive: 45 }; },
  loadPmDutyRoster: async function () { bump('roster'); return { items: [] }; },
  loadPmDutyCurrent: async function () { bump('current'); return { duty: null, is_duty: false }; },
  loadPmDutyRatingMe: async function () { bump('ratingMe'); return { rating: null }; },
  loadPmDutyRatingDuty: async function () { bump('ratingDuty'); return { rating: null }; },
  loadPmDutyLeaderboard: async function () { bump('leaderboard'); return { items: [] }; },
  loadUsers: async function () { bump('users'); return []; },
  loadPmDutyRating: async function () { bump('rating'); return { items: [] }; }
};

/* layout() — то, что перерисовывает оболочку целиком (и мигает у пользователя). */
window.__layout = async function (body, opts) {
  window.__layoutCalls++;
  const app = document.getElementById('app');
  app.innerHTML = body;
  if (opts && opts.title) document.title = opts.title;
};
</script>
<script>${router}</script>
<script>${pmDuty}</script>
<script>
/* Считаем вызовы render() страницы: оборачиваем зарегистрированный обработчик. */
window.addEventListener('hashchange', function () { window.__hashChanges = (window.__hashChanges || 0) + 1; });
AsgardRouter.add('/pm-calculations', function (ctx) {
  window.__renderCalls++;
  return AsgardPmDutyPage.render({
    layout: window.__layout,
    title: 'Просчёты РП',
    query: ctx.query
  });
}, { auth: false });
AsgardRouter.add('/home', function () { document.getElementById('app').textContent = 'home'; }, { auth: false });
/**
 * ВАЖНО (методика). Хэш НЕ ставим программно: присвоение location.hash перед
 * start() кладёт hashchange в очередь, и роутер отрисует страницу дважды —
 * это артефакт стенда, а не дефект приложения. В проде браузер открывает URL
 * уже с хэшем, hashchange не возникает, и start() рендерит один раз.
 * Поэтому хэш задаётся адресом страницы (см. page.goto в проверке).
 */
AsgardRouter.start();
</script></body></html>`;

(async () => {
  const f = path.join(process.cwd(), 'tests', 'reports', '_d348-tabs-stand.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, page);

  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.goto('file:///' + f.replace(/\\/g, '/') + '#/pm-calculations?tab=analysis');
  await p.waitForTimeout(600);

  const initial = await p.evaluate(() => ({
    renders: window.__renderCalls,
    layouts: window.__layoutCalls,
    api: Object.assign({}, window.__api),
    tabs: document.querySelectorAll('[data-tab]').length
  }));
  console.log('  стартовый рендер: render=' + initial.renders + ', layout=' + initial.layouts
    + ', вкладок=' + initial.tabs);
  if (initial.renders === 1 && initial.layouts === 1) {
    ok('старт страницы: один цикл загрузки');
  } else {
    bad(`старт страницы: ${initial.renders} рендер(ов) / ${initial.layouts} layout(ов) вместо одного`);
  }
  if (initial.tabs === 0) { bad('вкладки не отрисовались — стенд не поднялся'); }

  // Сбрасываем счётчики и кликаем по вкладке «Просчёты».
  const measure = async (tabId) => {
    await p.evaluate(() => {
      window.__api = {};
      window.__renderCalls = 0;
      window.__layoutCalls = 0;
    });
    await p.click('[data-tab="' + tabId + '"]');
    await p.waitForTimeout(700);
    return p.evaluate(() => ({
      renders: window.__renderCalls,
      layouts: window.__layoutCalls,
      api: Object.assign({}, window.__api),
      hash: location.hash,
      active: (document.querySelector('[data-tab].is-active') || {}).dataset
        ? document.querySelector('[data-tab].is-active').dataset.tab : null
    }));
  };

  for (const tabId of ['calc', 'mine', 'archive']) {
    const m = await measure(tabId);
    const apiTotal = Object.values(m.api).reduce((a, b) => a + b, 0);
    console.log(`  клик «${tabId}»: render=${m.renders}, layout=${m.layouts}, `
      + `запросов=${apiTotal}, hash=${m.hash}, активная=${m.active}`);
    if (m.renders === 1 && m.layouts === 1) {
      ok(`«${tabId}»: ровно один цикл загрузки`);
    } else {
      bad(`«${tabId}»: ${m.renders} рендер(ов) и ${m.layouts} layout(ов) вместо одного — двойная загрузка`);
    }
    if (m.active === tabId) ok(`「${tabId}」: вкладка стала активной`);
    else bad(`«${tabId}»: активная вкладка = ${m.active}`);
    if (m.hash.indexOf('tab=' + tabId) >= 0) ok(`«${tabId}»: хэш обновился`);
    else bad(`«${tabId}»: хэш не содержит tab=${tabId} (${m.hash})`);
  }

  // Повторный клик по АКТИВНОЙ вкладке не должен ничего грузить.
  await p.evaluate(() => { window.__api = {}; window.__renderCalls = 0; });
  await p.click('[data-tab="archive"]');
  await p.waitForTimeout(500);
  const again = await p.evaluate(() => ({
    renders: window.__renderCalls,
    api: Object.values(window.__api).reduce((a, b) => a + b, 0)
  }));
  if (again.renders === 0 && again.api === 0) {
    ok('повторный клик по активной вкладке не делает запросов');
  } else {
    bad(`повторный клик по активной вкладке: render=${again.renders}, запросов=${again.api}`);
  }

  if (errs.length === 0) ok('нет JS-ошибок');
  else bad('JS-ошибки: ' + errs.join(' | '));

  await p.screenshot({ path: 'tests/reports/d348-tabs.png' });
  await browser.close();

  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — переключение вкладок даёт один цикл загрузки'
    : `ИТОГ: FAIL — ${fail} нарушений`));
  process.exit(fail === 0 ? 0 : 1);
})();
