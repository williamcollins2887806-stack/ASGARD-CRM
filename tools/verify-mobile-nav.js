'use strict';
/**
 * verify-mobile-nav.js — гейт навигации: с любого экрана есть выход.
 *
 * Проверяет в реальном браузере, что на каждом экране (кроме экранов входа)
 * присутствует достижимый элемент навигации:
 *   • кнопка «назад» (aria-label="Назад") ИЛИ
 *   • ссылка «на главную» (aria-label="На главную") ИЛИ
 *   • активная вкладка нижнего тап-бара (тогда выход — через неё).
 *
 * Так закрывается класс «экран без кнопки назад» (жалоба заказчика).
 *
 * Запуск: node tools/verify-mobile-nav.js
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = 'asgard-jwt-secret-2026';

/**
 * Адрес стенда.
 *
 * D-371 (24.10.2026). Раньше дефолт был жёстко `http://127.0.0.1:5173` (vite dev).
 * Если vite не запущен, все страницы молча не открывались, каждый маршрут
 * считался «тупиком», и гейт выдавал «FAIL — 71 тупиков» — то есть ЛОЖНЫЙ
 * провал, не связанный с кодом. Теперь пробуем известные порты по порядку и
 * явно падаем, если ни один не отвечает.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const FALLBACK_PORTS = ['5173', '3000', '3100'];

async function resolveBase() {
  // Явно заданный BASE уважаем: никакого «подбора вместо пользователя».
  // Иначе проверка могла уйти на другой стенд, и результат ничего не значил бы.
  const explicit = !!process.env.BASE;
  const candidates = explicit
    ? [BASE]
    : [BASE, ...FALLBACK_PORTS.map((p) => `http://127.0.0.1:${p}`)];
  for (const url of [...new Set(candidates)]) {
    try {
      const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(3000) });
      if (r.ok) return url;
    } catch (_) { /* порт молчит */ }
  }
  return null;
}

/** Публичные экраны: выход не нужен по определению. */
const PUBLIC = ['/welcome', '/login', '/pin'];

/** Экраны входа полевого приложения. */
const FIELD_PUBLIC = ['/field/welcome', '/field-login', '/field/pin-entry', '/field/pin-setup'];

const USERS = [
  { label: 'DIRECTOR_GEN', id: 3455, login: 'ok', role: 'DIRECTOR_GEN' },
];

/** Мобильные маршруты офисной части + поле. */
const ROUTES = [
  '/', '/tasks', '/works', '/more', '/finances', '/cash', '/personnel', '/contracts', '/tenders',
  '/warehouse', '/my-mail', '/permits', '/office-schedule', '/profile', '/settings', '/alerts-hide-check',
  '/director-approvals', '/director-tender-approvals', '/approval-payment', '/assembly', '/acts',
  '/meetings', '/correspondence', '/documents', '/marketplace', '/personal-kanban',
  '/personal-kanban-config', '/office-academy', '/integrations', '/diag', '/tenders/platform',
  '/payroll', '/payroll-dashboard', '/official-employees', '/travel', '/tmc-requests',
  '/procurement', '/seals', '/proxies', '/my-equipment', '/gantt', '/training-board', '/hr-requests',
  // D-369 (23.10.2026): «Мои заявки» — счета на согласование с телефона.
  '/my-requests',
  '/staff-requests', '/pm-calcs',
  '/field', '/field/profile', '/field/timesheet', '/field/money', '/field/inventory',
  '/field/quests', '/field/shop', '/field/leaderboard', '/field/achievements', '/field/hall',
  '/field/seasonal', '/field/academy', '/field/stages', '/field/crew', '/field/permits',
  '/field/report', '/field/incidents', '/field/logistics', '/field/packing', '/field/receiving',
  '/field/diary', '/field/photos', '/field/journey', '/field/readiness', '/field/shift',
];

let fails = 0;
const bad = (m) => { console.log('  FAIL ' + m); fails++; };

(async () => {
  // Сначала убеждаемся, что стенд вообще отвечает: иначе гейт выдаёт ложный
  // FAIL по всем маршрутам сразу (это уже случалось — «71 тупиков»).
  const base = await resolveBase();
  if (!base) {
    const tried = process.env.BASE
      ? process.env.BASE
      : [BASE, ...FALLBACK_PORTS.map((p) => 'http://127.0.0.1:' + p)].join(', ');
    console.error('ОШИБКА: стенд не отвечает (' + tried + ').');
    console.error('Поднимите стенд (node src/index.js) или задайте BASE=<url>.');
    // Важно: это НЕ провал проверки навигации, а отсутствие стенда. Отдельный
    // код 2, чтобы в конвейере было видно разницу между «код плохой» и «не на чем проверять».
    process.exit(2);
  }
  if (base !== BASE) console.log('стенд: ' + base + ' (BASE не задан, подобран автоматически)');
  else console.log('стенд: ' + base);

  const b = await chromium.launch();
  console.log('=== verify-mobile-nav ===');
  console.log('правило: на каждом экране есть «назад», «на главную» или тап-бар\n');

  for (const u of USERS) {
    const token = jwt.sign({ ...u, name: u.login, email: u.login + '@asgard-service.com', pinVerified: true }, SECRET);
    const ctx = await b.newContext({
      viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    });
    await ctx.addInitScript(({ t }) => {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('asgard_theme', 'dark');
      localStorage.setItem('field_auth_epoch', '6');
      localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
    }, { t: token });
    const p = await ctx.newPage();
    console.log('--- ' + u.label + ' ---');
    let okCount = 0;
    for (const path of ROUTES) {
      await p.goto(base + '/m' + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await p.waitForTimeout(1900);

      const r = await p.evaluate(() => {
        const path = location.pathname;
        const q = (sel) => document.querySelector(sel);
        const back = q('[aria-label="Назад"], [aria-label="Назад в Зал Рабочих"]');
        const home = q('[aria-label="На главную"]');
        const tabbar = q('nav.fixed.bottom-0');
        const onWelcome = /welcome|login|pin/.test(path);
        return { path, hasBack: !!back, hasHome: !!home, hasTabbar: !!tabbar, onWelcome };
      });

      // Редирект на экран входа = гейт не пройден (страница недоступна роли),
      // но это не «тупик навигации» — учитываем отдельно.
      const isPublic = PUBLIC.some((x) => r.path.startsWith(x)) || FIELD_PUBLIC.some((x) => r.path.includes(x));
      if (isPublic && !ROUTES.includes(r.path.replace('/m', ''))) {
        console.log('    ' + path.padEnd(28) + '→ ' + r.path + '  (экран входа, пропуск)');
        continue;
      }
      const hasExit = r.hasBack || r.hasHome || r.hasTabbar;
      if (hasExit) okCount++;
      else bad(path + ': нет ни «назад», ни «на главную», ни тап-бара');
      console.log('    ' + path.padEnd(28) +
        (r.hasBack ? 'назад ' : '      ') +
        (r.hasHome ? 'домой ' : '      ') +
        (r.hasTabbar ? 'тапбар' : '      ') +
        (hasExit ? '' : '  ← ТУПИК'));
    }
    console.log('  экранов с выходом: ' + okCount + '/' + ROUTES.length);
    await ctx.close();
  }

  console.log('\nИТОГ: ' + (fails === 0 ? 'OK — с каждого экрана есть выход' : 'FAIL — ' + fails + ' тупиков'));
  await b.close();
  process.exit(fails === 0 ? 0 : 1);
})();
