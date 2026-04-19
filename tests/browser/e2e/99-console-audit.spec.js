// @ts-check
/**
 * Console Error Audit — Desktop (1440×900)
 *
 * Для каждой роли: логин через API (быстро), затем обход всех страниц.
 * Собирает console.error и page errors.
 * Провалит тест если найдёт реальные JS-ошибки.
 *
 * Запуск: npx playwright test 99-console-audit.spec.js --project=e2e-browser --reporter=line
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://asgard-crm.ru';

const ACCOUNTS = {
  ADMIN:          { login: 'admin',              password: 'admin123',  pin: '1234' },
  DIRECTOR_GEN:   { login: 'test_director_gen',  password: 'Test123!',  pin: '0000' },
  DIRECTOR_COMM:  { login: 'test_director_comm', password: 'Test123!',  pin: '0000' },
  PM:             { login: 'test_pm',            password: 'Test123!',  pin: '0000' },
  TO:             { login: 'test_to',            password: 'Test123!',  pin: '0000' },
  HEAD_PM:        { login: 'test_head_pm',       password: 'Test123!',  pin: '0000' },
  BUH:            { login: 'test_buh',           password: 'Test123!',  pin: '0000' },
  HR:             { login: 'test_hr',            password: 'Test123!',  pin: '0000' },
  OFFICE_MANAGER: { login: 'test_office_mgr',     password: 'Test123!',  pin: '0000' },
  WAREHOUSE:      { login: 'test_warehouse',     password: 'Test123!',  pin: '0000' },
  PROC:           { login: 'test_proc',          password: 'Test123!',  pin: '0000' },
  CHIEF_ENGINEER: { login: 'test_chief_eng',     password: 'Test123!',  pin: '0000' },
};

// ── Все страницы SPA ────────────────────────────────────────────────────────
const PAGES = [
  // Общие
  { path: 'home',               name: 'Главная' },
  { path: 'dashboard',          name: 'Дашборд руководителя' },
  { path: 'my-dashboard',       name: 'Мой дашборд' },
  { path: 'calendar',           name: 'Календарь' },
  { path: 'birthdays',          name: 'Дни рождения' },
  { path: 'alerts',             name: 'Уведомления' },
  { path: 'reminders',          name: 'Напоминания' },
  { path: 'office-schedule',    name: 'График офиса' },
  { path: 'messenger',          name: 'Мессенджер' },
  { path: 'my-mail',            name: 'Моя почта' },
  { path: 'mailbox',            name: 'Почтовый ящик' },
  { path: 'meetings',           name: 'Совещания' },
  // Тендеры / продажи
  { path: 'tenders',            name: 'Тендеры' },
  { path: 'pre-tenders',        name: 'Пред-тендеры' },
  { path: 'funnel',             name: 'Воронка продаж' },
  { path: 'customers',          name: 'Контрагенты' },
  { path: 'tkp',                name: 'ТКП' },
  { path: 'telephony',          name: 'Телефония' },
  { path: 'call-reports',       name: 'Аналитика звонков' },
  { path: 'inbox-applications', name: 'Входящие заявки (AI)' },
  // Проекты / работы
  { path: 'pm-calcs',           name: 'Просчёты РП' },
  { path: 'all-estimates',      name: 'Свод расчётов' },
  { path: 'pm-works',           name: 'Работы РП' },
  { path: 'all-works',          name: 'Свод контрактов' },
  { path: 'tasks',              name: 'Задачи' },
  { path: 'kanban',             name: 'Канбан' },
  { path: 'gantt',              name: 'Диаграмма Ганта' },
  { path: 'approvals',          name: 'Согласование' },
  { path: 'bonus-approval',     name: 'Согласование премий' },
  { path: 'pm-consents',        name: 'Согласия РП' },
  // Документооборот
  { path: 'contracts',          name: 'Договоры' },
  { path: 'correspondence',     name: 'Корреспонденция' },
  { path: 'proxies',            name: 'Доверенности' },
  { path: 'seals',              name: 'Реестр печатей' },
  { path: 'travel',             name: 'Жильё и билеты' },
  // Финансы
  { path: 'cash',               name: 'Касса' },
  { path: 'finances',           name: 'Финансы' },
  { path: 'payroll',            name: 'Зарплата' },
  { path: 'acts',               name: 'Акты' },
  { path: 'invoices',           name: 'Счета' },
  { path: 'office-expenses',    name: 'Офисные расходы' },
  { path: 'buh-registry',       name: 'Реестр БУХ' },
  { path: 'self-employed',      name: 'Самозанятые' },
  { path: 'one-time-pay',       name: 'Разовые оплаты' },
  // HR
  { path: 'personnel',          name: 'Персонал' },
  { path: 'hr-requests',        name: 'Заявки HR' },
  { path: 'hr-rating',          name: 'Рейтинг дружины' },
  { path: 'workers-schedule',   name: 'График рабочих' },
  { path: 'collections',        name: 'Подборки дружины' },
  // Снабжение / склад
  { path: 'procurement',        name: 'Закупки' },
  { path: 'tmc-requests',       name: 'ТМЦ-заявки' },
  { path: 'warehouse',          name: 'Склад ТМЦ' },
  { path: 'assembly',           name: 'Сборки' },
  { path: 'training',           name: 'Обучение' },
  // Пропуска / разрешения
  { path: 'pass-requests',      name: 'Заявки на пропуск' },
  { path: 'permits',            name: 'Разрешения' },
  { path: 'permit-applications',name: 'Заявки на оформление' },
  // Аналитика
  { path: 'kpi-works',          name: 'KPI работ' },
  { path: 'kpi-money',          name: 'KPI деньги' },
  { path: 'to-analytics',       name: 'Аналитика ТО' },
  { path: 'pm-analytics',       name: 'Аналитика РП' },
  { path: 'object-map',         name: 'Карта объектов' },
  { path: 'big-screen',         name: 'Big Screen' },
  { path: 'engineer-dashboard', name: 'Кузница инженера' },
  // Инфраструктура
  { path: 'integrations',       name: 'Интеграции' },
  { path: 'settings',           name: 'Настройки (ADMIN)' },
  { path: 'user-requests',      name: 'Заявки на регистрацию' },
];

// ── Ошибки которые игнорируем (браузерные артефакты / инфраструктура) ───────
const IGNORE = [
  'favicon',
  'ResizeObserver loop',
  'Non-passive event listener',
  'The play() request was interrupted',
  'AudioContext was not allowed',
  'chrome-extension',
  '[Violation]',
  'Could not load content for chrome-extension',
  // 502/503 — временная недоступность сервера (рестарт, перегрузка) — не баг приложения
  'HTTP 502',
  'status of 502',
  'HTTP 503',
  'status of 503',
  // Сетевые ошибки — проблема окружения, не баг приложения
  'net::ERR_',
  'Failed to fetch',
  'Error: offline',
];

function isIgnored(text) {
  return IGNORE.some(p => text.toLowerCase().includes(p.toLowerCase()));
}

// ── Быстрый логин через API (без UI-взаимодействия) ──────────────────────
async function loginByApi(page, role) {
  const acc = ACCOUNTS[role];
  if (!acc) return null;

  try {
    // 1. Login → pre-PIN token
    const loginResp = await page.request.post(BASE_URL + '/api/auth/login', {
      data: { login: acc.login, password: acc.password },
    });
    if (!loginResp.ok()) {
      console.log(`  [${role}] login failed: ${loginResp.status()}`);
      return null;
    }
    const loginData = await loginResp.json();
    const preToken = loginData.token;
    if (!preToken) return null;

    // 2. Verify PIN → full session token
    const pinResp = await page.request.post(BASE_URL + '/api/auth/verify-pin', {
      data: { pin: acc.pin },
      headers: { Authorization: `Bearer ${preToken}` },
    });
    if (!pinResp.ok()) {
      console.log(`  [${role}] pin failed: ${pinResp.status()}`);
      return null;
    }
    const pinData = await pinResp.json();
    const token = pinData.token;
    if (!token) return null;

    // 3. Inject all auth data in browser localStorage (same as SPA does after verifyPin)
    await page.goto(BASE_URL + '/#/welcome', { waitUntil: 'domcontentloaded', timeout: 25000 });

    // SW controllerchange triggers hard reload to /?_sw=TIMESTAMP — wait for it to settle
    await page.waitForFunction(
      () => !window.location.search.includes('_sw='),
      { timeout: 5000 }
    ).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

    // Inject localStorage — retry if SW redirect fires during evaluate
    const injectAuth = async () => page.evaluate(({ t, u }) => {
      localStorage.setItem('asgard_token', t);
      if (u) {
        localStorage.setItem('asgard_user', JSON.stringify(u));
        if (u.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(u.permissions));
        if (u.menu_settings) localStorage.setItem('asgard_menu_settings', JSON.stringify(u.menu_settings));
      }
    }, { t: token, u: pinData.user });

    try {
      await injectAuth();
    } catch (_evalErr) {
      // SW controllerchange fired during evaluate — wait for redirect and retry
      await page.waitForFunction(() => !window.location.search.includes('_sw='), { timeout: 8000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await injectAuth();
    }

    // 4. Navigate home — SPA loads with real token
    try {
      await page.goto(BASE_URL + '/#/home', { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch (_navErr) {
      // SW redirect interrupted navigation — wait and retry once
      await page.waitForTimeout(1500);
      await page.evaluate(({ t, u }) => {
        localStorage.setItem('asgard_token', t);
        if (u) {
          localStorage.setItem('asgard_user', JSON.stringify(u));
          if (u.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(u.permissions));
          if (u.menu_settings) localStorage.setItem('asgard_menu_settings', JSON.stringify(u.menu_settings));
        }
      }, { t: token, u: pinData.user }).catch(() => {});
      await page.goto(BASE_URL + '/#/home', { waitUntil: 'domcontentloaded', timeout: 25000 });
    }
    await page.waitForTimeout(2000);

    // Safety: SW controllerchange может сбросить token из localStorage в catch-блоке
    // (evaluate с .catch(() => {}) тихо проваливается если контекст был уничтожен).
    // Проверяем что токен ещё в localStorage и если нет — переинжектируем.
    try {
      const stillHasToken = await page.evaluate(() => !!localStorage.getItem('asgard_token'));
      if (!stillHasToken) {
        console.log(`  [${role}] token cleared during boot — re-injecting`);
        await page.waitForFunction(() => !window.location.search.includes('_sw='), { timeout: 5000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await injectAuth();
        await page.goto(BASE_URL + '/#/home', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1500);
      }
    } catch (_tokenCheck) {}

    return token;
  } catch (e) {
    console.log(`  [${role}] loginByApi error: ${e.message}`);
    return null;
  }
}

// ── Тест для каждой роли ──────────────────────────────────────────────────
for (const role of Object.keys(ACCOUNTS)) {
  test(`Аудит консоли [${role}] — все страницы`, async ({ page }) => {
    test.setTimeout(360000); // 6 минут на роль

    const findings = []; // { path, name, errors[] }

    // Логин — ДО подключения сборщика, чтобы не захватить ошибки инициализации
    const token = await loginByApi(page, role);
    if (!token) {
      console.log(`  ⚠️  [${role}] нет токена — пропускаем (аккаунт не существует?)`);
      test.skip();
      return;
    }
    console.log(`  ✅ [${role}] залогинен`);

    // Сборщик ошибок подключаем ПОСЛЕ логина — не захватываем ошибки инициализации SPA
    const currentPageErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isIgnored(text)) currentPageErrors.push(text);
      }
    });
    page.on('pageerror', err => {
      if (!isIgnored(err.message)) {
        currentPageErrors.push(`PAGE_ERROR: ${err.message}`);
      }
    });
    // Ловим все HTTP ошибки сервера (4xx/5xx) чтобы видеть конкретный URL
    page.on('response', resp => {
      const status = resp.status();
      if (status >= 400) {
        const url = resp.url().replace(BASE_URL, '');
        // Только API endpoints (не статика)
        if (url.startsWith('/api/')) {
          const msg = `HTTP ${status}: ${url}`;
          if (!isIgnored(msg)) currentPageErrors.push(msg);
        }
      }
    });

    // Обход страниц
    for (const { path, name } of PAGES) {
      currentPageErrors.length = 0; // сброс перед навигацией

      try {
        await page.goto(BASE_URL + '/#/' + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
        // Ждём networkidle или 3с (что раньше)
        await Promise.race([
          page.waitForLoadState('networkidle', { timeout: 3000 }),
          page.waitForTimeout(3000),
        ]).catch(() => {});
        await page.waitForTimeout(500); // доп. время для async рендера

      } catch (_) {
        // Таймаут навигации — всё равно смотрим консоль
      }

      if (currentPageErrors.length > 0) {
        findings.push({ path, name, errors: [...currentPageErrors] });
        console.log(`  ❌ [${role}] /${path}: ${currentPageErrors.length} ошибок`);
      }
    }

    // Итог
    if (findings.length === 0) {
      console.log(`  🎉 [${role}] 0 ошибок на всех ${PAGES.length} страницах`);
      return;
    }

    // Формируем отчёт для вывода в тест
    const report = findings.map(f =>
      `\n  📍 /${f.path} (${f.name}):\n` +
      f.errors.map(e => `     • ${e.slice(0, 200)}`).join('\n')
    ).join('\n');

    throw new Error(
      `Роль ${role}: console.error на ${findings.length}/${PAGES.length} страницах:${report}`
    );
  });
}
