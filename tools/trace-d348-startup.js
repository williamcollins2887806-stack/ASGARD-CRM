/**
 * Почему при СТАРТЕ страница рендерится дважды (render=2)?
 *
 * Гейт D-348 показал, что клики по вкладкам уже дают один цикл, но стартовый
 * рендер — два. Здесь трассируем порядок: когда вызывается render() и когда
 * приходит hashchange. Выясняем, наш ли это дефект (в странице) или артефакт
 * стенда (роутер стартует дважды).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const pmDuty = fs.readFileSync('public/assets/js/pm_duty.js', 'utf8');
const router = fs.readFileSync('public/assets/js/router.js', 'utf8');

const page = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div id="app"></div>
<script>
window.__trace = [];
const T = (m) => window.__trace.push(m);
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
  loadPmDutyQueue: async function () { return EMPTY; },
  loadPmDutyQueueCounts: async function () { return {}; },
  loadPmDutyRoster: async function () { return { items: [] }; },
  loadPmDutyCurrent: async function () { return { duty: null, is_duty: false }; },
  loadPmDutyRatingMe: async function () { return { rating: null }; },
  loadPmDutyRatingDuty: async function () { return { rating: null }; },
  loadPmDutyLeaderboard: async function () { return { items: [] }; },
  loadUsers: async function () { return []; },
  loadPmDutyRating: async function () { return { items: [] }; }
};
window.__layout = async function (body) { T('layout'); document.getElementById('app').innerHTML = body; };
</script>
<script>${router}</script>
<script>${pmDuty}</script>
<script>
window.addEventListener('hashchange', function () { T('hashchange -> ' + location.hash); });

/* Оборачиваем render() страницы, чтобы видеть каждый вызов и стек. */
AsgardRouter.add('/pm-calculations', function (ctx) {
  T('render START hash=' + location.hash);
  return AsgardPmDutyPage.render({ layout: window.__layout, title: 'x', query: ctx.query })
    .then(function () { T('render DONE hash=' + location.hash); });
}, { auth: false });

T('before set hash');
location.hash = '#/pm-calculations?tab=analysis';
T('after set hash, now=' + location.hash);
AsgardRouter.start();
T('start() вернулся');
setTimeout(function () { console.log(JSON.stringify(window.__trace, null, 1)); }, 900);
</script></body></html>`;

(async () => {
  const f = path.join(process.cwd(), 'tests', 'reports', '_d348-trace.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, page);

  const browser = await chromium.launch();
  const p = await browser.newPage();
  const logs = [];
  p.on('console', (m) => logs.push(m.text()));
  p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await p.goto('file:///' + f.replace(/\\/g, '/'));
  await p.waitForTimeout(1500);
  console.log(logs.join('\n'));
  await browser.close();
})();
