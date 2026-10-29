/**
 * Проверка D-348 на ПРОДЕ: скачиваем pm_duty.js и router.js прямо с
 * asgard-crm.ru, собираем стенд из НАСТОЯЩИХ прод-файлов и считаем, сколько
 * раз страница перерисовывается при клике по вкладке.
 *
 * Локальный гейт зелёный, но именно рассинхрон прод/локаль уже дважды давал
 * повторные жалобы (D-346, D-347) — поэтому проверяем то, что отдаёт сервер.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROD = 'https://asgard-crm.ru';

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

const stand = (pmDuty, router) => `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div id="app"></div>
<script>
window.__api = {};
window.__renderCalls = 0;
window.__layoutCalls = 0;
function bump(n) { window.__api[n] = (window.__api[n] || 0) + 1; }
window.AsgardUI = {
  esc: function (s) { return String(s == null ? '' : s); },
  toast: function () {}, showModal: function () {}, hideModal: function () {}, replaceModal: null
};
const USER = { id: 1, role: 'PM', name: 'Тест' };
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
  loadPmDutyQueueCounts: async function () { bump('counts'); return { analysis: 15, mine: 7, archive: 45 }; },
  loadPmDutyRoster: async function () { bump('roster'); return { items: [] }; },
  loadPmDutyCurrent: async function () { bump('current'); return { duty: null, is_duty: false }; },
  loadPmDutyRatingMe: async function () { bump('ratingMe'); return { rating: null }; },
  loadPmDutyRatingDuty: async function () { bump('ratingDuty'); return { rating: null }; },
  loadPmDutyLeaderboard: async function () { bump('leaderboard'); return { items: [] }; },
  loadUsers: async function () { bump('users'); return []; },
  loadPmDutyRating: async function () { bump('rating'); return { items: [] }; }
};
window.__layout = async function (body) { window.__layoutCalls++; document.getElementById('app').innerHTML = body; };
</script>
<script>${router}</script>
<script>${pmDuty}</script>
<script>
AsgardRouter.add('/pm-calculations', function (ctx) {
  window.__renderCalls++;
  return AsgardPmDutyPage.render({ layout: window.__layout, title: 'x', query: ctx.query });
}, { auth: false });
AsgardRouter.start();
</script></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const net = await browser.newContext();
  const get = async (u) => {
    const r = await net.request.get(u, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok()) throw new Error(`${u}: HTTP ${r.status()}`);
    return r.text();
  };
  const stamp = Date.now();
  const [pmDuty, router] = await Promise.all([
    get(`${PROD}/assets/js/pm_duty.js?d348check=${stamp}`),
    get(`${PROD}/assets/js/router.js?d348check=${stamp}`),
  ]);
  await net.close();
  console.log(`  скачано с прода: pm_duty.js ${pmDuty.length} б, router.js ${router.length} б\n`);

  console.log('=== 1. Что в прод-байтах ===');
  if (pmDuty.includes('if (location.hash === want) refreshUI();')) {
    ok('прод отдаёт разведённый обработчик (хэш ИЛИ refreshUI)');
  } else {
    bad('прод НЕ отдаёт исправление — обработчик по-прежнему делает и то, и другое');
  }
  if (pmDuty.includes("location.hash = '#/pm-calculations?tab=' + next; refreshUI();")) {
    bad('в проде остался двойной вызов');
  } else {
    ok('двойного вызова в проде нет');
  }
  if (pmDuty.includes('let renderSeq = 0;')) ok('в проде есть защита от гонки ответов');
  else bad('в проде нет счётчика поколений');

  console.log('\n=== 2. Клик по вкладкам на прод-коде ===');
  const f = path.join(process.cwd(), 'tests', 'reports', '_prod-d348-stand.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, stand(pmDuty, router));

  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.goto('file:///' + f.replace(/\\/g, '/') + '#/pm-calculations?tab=analysis');
  await p.waitForTimeout(600);

  const start = await p.evaluate(() => ({
    renders: window.__renderCalls, layouts: window.__layoutCalls
  }));
  if (start.renders === 1) ok('старт страницы: один цикл');
  else bad(`старт страницы: ${start.renders} цикла(ов)`);

  for (const tabId of ['calc', 'mine', 'archive']) {
    await p.evaluate(() => { window.__renderCalls = 0; window.__layoutCalls = 0; window.__api = {}; });
    await p.click('[data-tab="' + tabId + '"]');
    await p.waitForTimeout(700);
    const m = await p.evaluate(() => ({
      renders: window.__renderCalls,
      layouts: window.__layoutCalls,
      api: Object.values(window.__api).reduce((a, b) => a + b, 0),
      hash: location.hash,
      active: document.querySelector('[data-tab].is-active')
        ? document.querySelector('[data-tab].is-active').dataset.tab : null
    }));
    if (m.renders === 1 && m.layouts === 1) {
      ok(`«${tabId}»: один цикл (${m.api} запросов, hash=${m.hash})`);
    } else {
      bad(`«${tabId}»: render=${m.renders}, layout=${m.layouts} — двойная загрузка`);
    }
    if (m.active !== tabId) bad(`«${tabId}»: активная вкладка = ${m.active}`);
  }

  if (errs.length === 0) ok('нет JS-ошибок');
  else bad('JS-ошибки: ' + errs.join(' | '));

  await p.screenshot({ path: 'tests/reports/prod-d348-tabs.png' });
  await browser.close();

  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — ПРОД: переключение вкладок даёт один цикл загрузки'
    : `ИТОГ: FAIL — ${fail} нарушений на проде`));
  process.exit(fail === 0 ? 0 : 1);
})();
