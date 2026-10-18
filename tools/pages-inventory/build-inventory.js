'use strict';
/**
 * Итоговый инвентарь страниц vanilla-СРМ: описание + использование + связи.
 * Вход:  public/assets/js/*.js, _api_hits.tsv, _hints_hits.tsv
 * Выход: _pages_tmp/pages_final.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(__dirname, 'data');
const OUT_DIR = path.join(__dirname, 'data');
const JS_DIR = path.join(ROOT, 'public', 'assets', 'js');
const app = fs.readFileSync(path.join(JS_DIR, 'app.js'), 'utf8');

const GROUP_LABEL = {
  home: 'Главная', tenders: 'Тендеры', works: 'Работы', finance: 'Финансы',
  resources: 'Ресурсы', personnel: 'Персонал', comm: 'Коммуникации',
  analytics: 'Аналитика', system: 'Система'
};

// ── 1. NAV ───────────────────────────────────────────────────────────────────
const navBlock = app.slice(app.indexOf('const NAV=['), app.indexOf('\n  ];', app.indexOf('const NAV=[')));
const NAV = [];
{
  const re = /\{r:"([^"]+)",l:"([^"]*)",d:"([^"]*)",\s*roles:(?:\[([^\]]*)\]|([A-Za-z_0-9.]+)),[\s\S]*?p:"([^"]+)",g:"([^"]+)"([^}]*)\}/g;
  let m;
  while ((m = re.exec(navBlock))) {
    NAV.push({
      route: m[1], label: m[2], desc: m[3], group: m[7], page: m[6],
      navHide: /navHide:true/.test(m[8] || '')
    });
  }
}
const navByRoute = new Map(NAV.map(n => [n.route, n]));

// ── 2. Роуты ─────────────────────────────────────────────────────────────────
// Идём по всем регистрациям и берём текст от одной до следующей — так не теряем
// длинные обработчики и записи без блока {auth:...}.
const routes = [];
{
  const marks = [];
  const re = /AsgardRouter\.add\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(app))) marks.push({ route: m[1], start: m.index, after: re.lastIndex });
  for (let i = 0; i < marks.length; i++) {
    const handler = app.slice(marks[i].after, i + 1 < marks.length ? marks[i + 1].start : Math.min(app.length, marks[i].after + 6000));
    const authM = handler.match(/\{\s*auth:(true|false)/);
    const rm = handler.match(/roles:\[([^\]]*)\]/);
    const tgt = handler.match(/location\.(?:hash\s*=|replace\s*\(\s*|assign\s*\(\s*)\s*[`'"]#\/([a-zA-Z0-9_\-/]+)/)
             || handler.match(/\?\s*\(\s*[`'"]#\/([a-zA-Z0-9_\-/]+)/)
             || handler.match(/:\s*[`'"]#\/([a-zA-Z0-9_\-/]+)/);
    const title = handler.match(/title:"([^"]+)"/);
    const mod = handler.match(/(Asgard[A-Za-z0-9_]+)\.(?:render|renderList|renderCard|renderForm|renderGlobal|renderPm|renderWarehouse|renderMedical|renderTravel|renderCalcs|renderWorks|renderCombined|renderDirector|renderDetail|renderSelfEmployed|renderOneTimePay|renderSettings|renderPage|renderCatalog)/);
    routes.push({
      route: marks[i].route, handler,
      auth: authM ? authM[1] === 'true' : null,
      roles: rm ? rm[1] : '',
      redirectTo: tgt ? '/' + tgt[1] : null,
      title: title ? title[1] : null,
      module: mod ? mod[1] : null
    });
  }
}
const PUBLIC_ROUTES = new Set(['/welcome', '/login', '/register']);
const MOBILE_ONLY = new Set(['/more']);

// ── 3. модуль → файл ─────────────────────────────────────────────────────────
const allJs = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
const jsText = {};
for (const f of allJs) jsText[f] = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
const modFile = {};
for (const [f, txt] of Object.entries(jsText)) {
  const re = /window\.(Asgard[A-Za-z0-9_]+)\s*=/g;
  let m;
  while ((m = re.exec(txt))) if (!modFile[m[1]]) modFile[m[1]] = f;
}
for (const r of routes) r.file = r.module ? (modFile[r.module] || null) : null;

// ── 4. endpoint'ы файлов ─────────────────────────────────────────────────────
const norm = p => p.replace(/\/$/, '').replace(/\/[0-9]{2,}/g, '/:id');
const epOwners = new Map();
const fileEps = {};
for (const [f, txt] of Object.entries(jsText)) {
  const set = new Set();
  const re = /\/api\/[a-zA-Z0-9_\-/][a-zA-Z0-9_\-/]*[a-zA-Z0-9_]/g;
  let m;
  while ((m = re.exec(txt))) {
    const ep = norm(m[0].replace(/\/\$\{[^}]*\}/g, '/:id'));
    set.add(ep);
    if (!epOwners.has(ep)) epOwners.set(ep, new Set());
    epOwners.get(ep).add(f);
  }
  fileEps[f] = [...set];
}

// ── 5. hits ──────────────────────────────────────────────────────────────────
const YEAR = 2026;
function toDate(s) {
  const t = String(s || '').trim().replace(/\s/g, '');
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);          // 28.09.2026
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = /^(\d{1,2})\.(\d{1,2})$/.exec(t);                        // 28.9  (год = 2026)
  if (m) return new Date(Date.UTC(YEAR, +m[2] - 1, +m[1]));
  m = /^(\d{2})\/([A-Za-z]{3})\/(\d{4})$/.exec(t);             // 28/Sep/2026
  const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  if (m) return new Date(Date.UTC(+m[3], (MON[m[2]] || 1) - 1, +m[1]));
  return null;
}
function minDate(list) {
  const d = list.map(toDate).filter(Boolean).sort((a, b) => a - b);
  return d.length ? d[0] : null;
}
function maxDate(list) {
  const d = list.map(toDate).filter(Boolean).sort((a, b) => b - a);
  return d.length ? d[0] : null;
}
const fmtDate = d => d ? String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') : '';

// Эндпоинты-поллеры: опрашиваются глобально и не отражают факт посещения страницы
const POLLER = new Set([
  '/api/command-map/live', '/api/sse/stream', '/api/chat-groups/events',
  '/api/chat-groups/presence/all', '/api/chat-groups/presence', '/api/version',
  '/api/push/badge-count', '/api/hints', '/api/page-view', '/api/auth/me', '/api/data/users', '/api/users',
  '/api/settings/app', '/api/settings/core', '/api/settings/sync', '/api/settings/docs',
  '/api/mimir/suggestions', '/api/mimir/auto-estimate-active', '/api/daily-presence/today',
  '/api/data/notifications', '/api/health', '/api/data/reminders',
  '/api/data', '/api/data/:id', '/api/settings', '/api/settings/',
  '/api/chat-groups/events', '/api/chat-groups/presence/all', '/api/chat-groups/presence',
  '/api/chat-groups/folders', '/api/chat-groups/stories/feed', '/api/telephony/missed',
  '/api/work-readiness/summary', '/api/mimir/conversations', '/api/users/me'
]);

const apiHits = new Map();
for (const raw of fs.readFileSync(path.join(DATA, 'api_hits.tsv'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const [cnt, ep, first, last] = raw.split('\t');
  if (!ep || !ep.startsWith('/api/')) continue;
  const k = norm(ep);
  const prev = apiHits.get(k) || { hits: 0, dates: [] };
  prev.hits += Number(cnt) || 0;
  if (first) prev.dates.push(first);
  if (last) prev.dates.push(last);
  apiHits.set(k, prev);
}
function hitsForEndpoint(ep) {
  const per = [];
  const exact = apiHits.get(ep);
  if (exact) per.push(exact);
  for (const [k, v] of apiHits) if (k.startsWith(ep + '/')) per.push(v);
  if (!per.length) return null;
  let sum = 0; const dates = [];
  for (const v of per) { sum += v.hits; for (const d of v.dates) dates.push(d); }
  return { hits: sum, dates };
}

const views = new Map();
for (const raw of fs.readFileSync(path.join(DATA, 'hints_hits.tsv'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const [cnt, key, first, last] = raw.split('\t');
  if (!key) continue;
  const route = '/' + decodeURIComponent(key);
  const v = views.get(route) || { n: 0, first: null, last: null };
  v.n += Number(cnt) || 0;
  if (first && (!v.first || first < v.first)) v.first = first;
  if (last && (!v.last || last > v.last)) v.last = last;
  views.set(route, v);
}

// ── 6. группы по модулю (вкладки одной страницы) ─────────────────────────────
const byFile = new Map();
for (const r of routes) {
  if (!r.file) continue;
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(r);
}
const fileViews = new Map(); // file → сумма просмотров всех роутов модуля
for (const [f, list] of byFile) {
  let n = 0;
  for (const r of list) n += (views.get(r.route) || { n: 0 }).n;
  fileViews.set(f, n);
}

// ── 7. связи ─────────────────────────────────────────────────────────────────
const routeSet = new Set(routes.map(r => r.route));
const links = new Map();
const addLink = (from, to, kind) => {
  if (!from || !to || from === to || !routeSet.has(to)) return;
  if (!links.has(from)) links.set(from, new Map());
  links.get(from).set(to + '|' + kind, { to, kind });
};

for (const r of routes) if (r.redirectTo) addLink(r.route, r.redirectTo, 'редирект');

for (const [f, list] of byFile) {
  const appLike = f === 'app.js';
  if (list.length < 2 || appLike) continue;
  const kind = list.length === 2 ? 'общий модуль' : 'вкладки одной страницы';
  for (const a of list) for (const b of list) addLink(a.route, b.route, kind);
}

const HUB_ROUTES = new Set(['/home', '/login', '/register', '/welcome', '/more']);

for (const r of routes) {
  if (!r.file || r.file === 'app.js') continue;
  const txt = jsText[r.file] || '';
  const re = /[`'"]#\/([a-zA-Z0-9_\-/]+)/g;
  let m;
  while ((m = re.exec(txt))) {
    const to = '/' + m[1];
    if (HUB_ROUTES.has(to)) continue;
    addLink(r.route, to, 'переход из интерфейса');
  }
}

// ── 8. описания ──────────────────────────────────────────────────────────────
function rolesTextOf(raw) {
  if (!raw) return 'Все роли (по правам)';
  const MAP = {
    ADMIN: 'Администратор', PM: 'РП', HEAD_PM: 'Рук. РП', TO: 'ТО', HEAD_TO: 'Рук. ТО',
    BUH: 'Бухгалтер', HR: 'HR', HR_MANAGER: 'Рук. HR', OFFICE_MANAGER: 'Офис-менеджер',
    WAREHOUSE: 'Склад', CHIEF_ENGINEER: 'Гл. инженер', PROC: 'Закупщик',
    DIRECTOR_GEN: 'Директор (ген.)', DIRECTOR_COMM: 'Директор (комм.)', DIRECTOR_DEV: 'Директор (разв.)',
    FIELD_WORKER: 'Полевой рабочий'
  };
  if (raw.includes('ALL_ROLES')) return 'Все роли';
  const out = [];
  if (raw.includes('WH_READ_ROLES')) out.push('Администратор, Склад, Гл. инженер, РП, Бухгалтер, Закупщик, Директора');
  for (const m of raw.matchAll(/"([A-Z_]+)"/g)) {
    const t = MAP[m[1]];
    if (t && !out.includes(t)) out.push(t);
  }
  if (raw.includes('...DIRECTOR_ROLES') && !out.includes('Директора')) out.push('Директора');
  if (raw.includes('...HEAD_ROLES') && !out.includes('Руководители отделов')) out.push('Руководители отделов');
  return out.length ? out.join(', ') : 'По правам доступа';
}

const DESC_EXTRA = {
  '/welcome': 'Стартовая (публичная) страница: вход, регистрация, режимы работы',
  '/login': 'Вход по логину и паролю',
  '/register': 'Заявка на регистрацию нового пользователя',
  '/home': 'Зал Ярла — главный портал: сводка, виджеты, баланс кассы',
  '/permit-application-form': 'Форма заявки на оформление разрешения (создание/редактирование)',
  '/preview-calc-report': 'Служебное превью модалки просчёта (только ADMIN)',
  '/tenderguru-settings': 'Настройки TenderGuru (правила скоринга заявок)',
  '/customer': 'Карточка контрагента (открывается по ИНН)',
  '/pm-consents': 'Согласия РП — журнал подтверждений',
  '/estimate-report': 'Отчёт по просчёту тендера',
  '/work-report': 'Финансовый отчёт по работе',
  '/kpi-works': 'Аналитика Ярла — KPI по работам',
  '/kpi-money': 'Аналитика Ярла — KPI по деньгам',
  '/field-tariffs': 'Тарифная сетка полевых работ (только ADMIN)',
  '/mango': 'Настройки телефонии Mango Office',
  '/employee': 'Личное дело сотрудника (открывается по id)',
  '/pm-balance/:pm_id': 'Детализация баланса подотчётника (карточка РП)',
  '/gantt': 'Гантт — объединённый: просчёты + работы',
  '/gantt-objects': 'Гантт по объектам',
  '/reminders': 'Личные напоминания',
  '/messenger': 'Мессенджер (открывает правый док «Хугинн»)',
  '/chat-groups': 'Служебный адрес: открывает мессенджер и возвращает на главную',
  '/chat': 'Служебный адрес: открывает мессенджер и возвращает на главную',
  '/mimir': 'Служебный адрес: открывает Мимира в доке «Хугинн» и возвращает на главную',
  '/command-map-flat': 'Гео-карта офиса — плоский список сотрудников/объектов',
  '/assembly': 'Ведомости сборки → переадресация в Склад (вкладка «Сборки»)',
  '/acts': 'Вкладка «Акты» страницы «Счета и акты»',
  '/invoices': 'Вкладка «Счета» страницы «Счета и акты»',
  '/alerts': 'Уведомления — «Воронья почта»',
  '/tasks': 'Мои задачи — Todo-список и поручения',
  '/meetings': 'Совещания — планирование и протоколы',
  '/my-mail': 'Персональная почта сотрудника',
  '/training': 'Мои заявки на обучение',
  '/office-academy': 'Академия Асгарда — уроки и квизы',
  '/suppliers-catalog': 'Справочник поставщиков, каталог товаров, база цен',
  '/warehouse-v2': 'Склад: каталог, наличие, оборудование, ячейки, сборка, готовность',
  '/procurement': 'Закупки — реестр заявок (роль закупщика)',
  '/my-procurement': 'Мои заявки на закупку и их статусы',
  '/help': 'Помощь коллеги — задачи «любой → любому» с чатом',
  '/kanban': 'Канбан-доска задач',
  '/office-schedule': 'График офиса — статусы по дням',
  '/workers-schedule': 'График рабочих — бронь и доступность',
  '/gantt-calcs': 'Гантт — пересечения по срокам просчётов',
  '/gantt-works': 'Гантт — план и факты по работам',
  '/payment-invoices': 'Счета на оплату — очередь директора: согласовать или отказать',
  '/more': 'Мобильное меню: все разделы CRM (только телефон/узкий экран)',
  '/my-dashboard': 'Алиас: открывает «Зал Ярла» с настраиваемыми виджетами'
};

const GROUP_EXTRA = {
  '/payment-invoices': 'Финансы', '/more': 'Главная',
  '/welcome': 'Вход и регистрация', '/login': 'Вход и регистрация', '/register': 'Вход и регистрация',
  '/customer': 'Тендеры', '/permit-application-form': 'Персонал', '/employee': 'Персонал',
  '/pm-balance/:pm_id': 'Персонал',
  '/preview-calc-report': 'Работы', '/tenderguru-settings': 'Тендеры',
  '/pm-consents': 'Работы', '/estimate-report': 'Тендеры', '/work-report': 'Работы',
  '/kpi-works': 'Аналитика', '/kpi-money': 'Аналитика',
  '/field-tariffs': 'Персонал', '/mango': 'Система',
  '/gantt': 'Работы', '/gantt-objects': 'Работы', '/reminders': 'Главная',
  '/messenger': 'Коммуникации', '/command-map-flat': 'Главная'
};

// ── 9. сборка строк ──────────────────────────────────────────────────────────
const SHARED_LIMIT = 4; // файл обслуживает ≥4 роутов → endpoint'ы не приписываем
const FILE_CARD = new Set(['/customer', '/employee', '/permit-application-form', '/pm-balance/:pm_id']);

const rows = routes.map(r => {
  const nav = navByRoute.get(r.route);
  const v = views.get(r.route) || null;
  const isPoll = ep => POLLER.has(ep) || [...POLLER].some(p => p.endsWith('/') && ep.startsWith(p));

  // эндпоинты страницы: из её модуля, а для встроенных в app.js обработчиков — из самого кода роута
  let srcEps = r.file ? fileEps[r.file] || [] : [];
  if (!r.file) {
    const raw = [...new Set([...r.handler.matchAll(/\/api\/[a-zA-Z0-9_\-/]+/g)].map(m => m[0]))];
    srcEps = raw.map(e => norm(e.replace(/\/\$\{[^}]*\}/g, '/:id')));
  }

  let ownHits = 0, ownDates = [], ownList = [];
  if (!r.redirectTo && srcEps.length && (!r.file || (byFile.get(r.file) || []).length < SHARED_LIMIT)) {
    const all = srcEps
      .map(ep => ({ ep, h: hitsForEndpoint(ep), owners: (epOwners.get(ep) || new Set()).size }))
      .filter(x => x.h && !isPoll(x.ep));
    // Для страниц с отдельным модулем берём только «свои» эндпоинты (встречаются в одном модуле).
    // Для встроенных в app.js обработчиков источник — сам код роута, поэтому фильтр владельцев не нужен.
    const list = (r.file ? all.filter(x => x.owners === 1) : all).sort((a, b) => b.h.hits - a.h.hits);
    ownList = list.slice(0, 6).map(x => `${x.ep} (${x.h.hits})`);
    ownHits = list.reduce((s, x) => s + x.h.hits, 0);
    for (const x of list) for (const d of x.h.dates) ownDates.push(d);
  }

  const siblings = r.file ? (byFile.get(r.file) || []).filter(x => x.route !== r.route) : [];
  const sibUsed = siblings.filter(s => (views.get(s.route) || { n: 0 }).n > 0);

  const errSelf = null;
  let used, source, note = '', firstRaw = [], lastRaw = [], cnt = 0;
  if (r.redirectTo) {
    used = '—'; source = 'редирект';
    note = 'Переадресация на ' + r.redirectTo + ' — это адрес-переход, а не отдельный экран';
  } else if (PUBLIC_ROUTES.has(r.route)) {
    used = 'н/д'; source = 'вне авторизации — трекинг не пишется';
    note = 'Публичная страница: сигнал посещения в системе не фиксируется';
  } else if (MOBILE_ONLY.has(r.route)) {
    used = 'н/д'; source = 'только мобильный вид';
    note = 'Desktop-версия: на широком экране сразу переадресует на «Зал Ярла», отдельного экрана нет';
  } else if (v && v.n > 0) {
    used = 'Да'; source = 'рендер страницы'; cnt = v.n; firstRaw = [v.first]; lastRaw = [v.last];
  } else if (ownHits > 0) {
    used = 'Да'; source = 'вызовы API'; cnt = ownHits; firstRaw = ownDates; lastRaw = ownDates;
  } else if (sibUsed.length) {
    used = 'Да'; source = 'косвенно: вкладка/режим другой страницы';
    note = 'Прямого сигнала нет. Открывается как вкладка/режим: ' +
      sibUsed.map(s => s.route).join(', ') + ' — данные сняты с общей страницы';
  } else {
    used = 'Нет'; source = 'нет следов';
  }
  if (nav && nav.navHide) note = (note ? note + ' · ' : '') + 'скрыт из меню (вход по ссылке)';

  const rel = [...(links.get(r.route) || new Map()).values()];
  const relKind = rel.map(x => x.kind);
  const related = rel.length > 0;

  let type = 'Страница';
  if (r.redirectTo) type = 'Редирект/алиас';
  else if (!nav && routeSet.has(r.route) && FILE_CARD.has(r.route)) type = 'Подстраница (по id)';
  else if (!nav && !r.redirectTo) type = 'Служебная';

  if (note) note += ' · ';
  if (r.redirectTo) note += 'отдельного экрана у адреса нет';
  note = note.replace(/^ · /, '').replace(/ · $/, '');

  return {
    route: r.route,
    name: nav ? nav.label : (r.title || DESC_EXTRA[r.route] ? (nav ? nav.label : null) : null),
    title: r.title,
    desc: (nav && nav.desc) || DESC_EXTRA[r.route] || r.title || (r.redirectTo ? 'Переход на ' + r.redirectTo : ''),
    group: nav ? (GROUP_LABEL[nav.group] || nav.group) : (GROUP_EXTRA[r.route] || (r.redirectTo ? (navByRoute.get(r.redirectTo) ? (GROUP_LABEL[navByRoute.get(r.redirectTo).group] || navByRoute.get(r.redirectTo).group) : 'Без раздела') : 'Без раздела')),
    type,
    inMenu: !!nav,
    navHide: nav ? nav.navHide : false,
    pageKey: nav ? nav.page : '',
    module: r.module,
    file: r.file,
    redirectTo: r.redirectTo,
    views: v ? v.n : 0,
    used, source,
    first: fmtDate(minDate(firstRaw)),
    last: fmtDate(maxDate(lastRaw)),
    usedFrom: fmtDate(minDate(firstRaw)),
    usedTo: fmtDate(maxDate(lastRaw)),
    count: cnt,
    rolesText: rolesTextOf(r.roles),
    ownEndpoints: ownList,
    related, relatedCount: rel.length,
    relatedTo: [...new Set(rel.map(x => x.to))],
    relatedKinds: [...new Set(relKind)],
    relDetail: rel,
    note  };
});

// ── названия алиасов и служебных страниц ─────────────────────────────────────
const REDIRECT_NAME = {
  '/pre-tenders': 'Переход в «Маркетплейс заявок»',
  '/funnel': 'Переход в «Сагу Тендеров»',
  '/pm-duty': 'Переход в «Просчёты РП»',
  '/pm-calcs': 'Переход в «Просчёты РП»',
  '/to-calcs': 'Переход в «Сагу Тендеров»',
  '/head-to-approvals': 'Переход в «Сагу Тендеров»',
  '/approvals': 'Переход в «Сагу Тендеров»',
  '/all-estimates': 'Переход в «Просчёты РП» (архив)',
  '/analytics': 'Переход в «Аналитику Ярла • Работы»',
  '/my-dashboard': 'Переход на «Зал Ярла»',
  '/global-timesheet': 'Переход в «Табель»',
  '/warehouse': 'Переход в «Склад»',
  '/payroll': 'Переход в «Табель»',
  '/payroll-sheet': 'Переход в «Табель»',
  '/payroll-grid': 'Переход в «Табель моей дружины»',
  '/chat-groups': 'Переход на «Зал Ярла» (док «Хугинн»)',
  '/chat': 'Переход на «Зал Ярла» (док «Хугинн»)',
  '/inbox-applications': 'Переход в «Маркетплейс заявок»',
  '/personal-kanban': 'Переход в «Мой канбан»',
  '/mimir': 'Переход на «Зал Ярла» (док «Хугинн»)',
  '/assembly': 'Переход в «Склад» (вкладка «Сборки»)'
};

const NAME_EXTRA = {
  '/mango': 'Настройки телефонии (Mango)',
  '/permit-application-form': 'Форма заявки на допуск',
  '/pm-balance/:pm_id': 'Баланс подотчётника — карточка',
  '/preview-calc-report': 'Превью модалки просчёта',
  '/tenderguru-settings': 'TenderGuru — настройки'
};

// имена для страниц без NAV: берём из DESC_EXTRA первой фразой
for (const r of rows) {
  if (r.redirectTo) { r.name = REDIRECT_NAME[r.route] || ('Переход на ' + r.redirectTo); continue; }
  if (r.inMenu) continue;
  if (NAME_EXTRA[r.route]) { r.name = NAME_EXTRA[r.route]; continue; }
  if (r.title) { r.name = r.title; continue; }
  const d = DESC_EXTRA[r.route];
  r.name = d ? d.split(/[(·—,]/)[0].trim() : r.route;
  if (!r.desc && d) r.desc = d;
}

fs.writeFileSync(path.join(OUT_DIR, 'pages_final.json'), JSON.stringify(rows, null, 2), 'utf8');

const usedN = rows.filter(r => r.used === 'Да').length;
const noN = rows.filter(r => r.used === 'Нет').length;
const redN = rows.filter(r => r.type === 'Редирект/алиас').length;
console.log('строк:', rows.length, '| заходили Да:', usedN, '| Нет:', noN, '| редиректы:', redN,
  '| связаны:', rows.filter(r => r.related).length);
console.log('\nНЕ заходили (не редиректы):');
console.log(rows.filter(r => r.used === 'Нет').map(r => `${r.route} [${r.group}] ${r.name}`).join('\n'));
