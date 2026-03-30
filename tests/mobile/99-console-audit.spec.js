// @ts-check
/**
 * Console Error Audit — Mobile (iPhone 14 эмуляция)
 *
 * Для каждой роли: логин через API, обход всех страниц на мобильном вьюпорте.
 * Собирает console.error и page errors.
 *
 * Запуск: npx playwright test tests/mobile/99-console-audit.spec.js --project=mobile --reporter=line
 */

const { test } = require('@playwright/test');

const BASE_URL = 'https://asgard-crm.ru';

const ACCOUNTS = {
  ADMIN:          { login: 'admin',              password: 'admin123',  pin: '1234' },
  DIRECTOR_GEN:   { login: 'test_director_gen',  password: 'Test123!',  pin: '0000' },
  PM:             { login: 'test_pm',            password: 'Test123!',  pin: '0000' },
  TO:             { login: 'test_to',            password: 'Test123!',  pin: '0000' },
  HEAD_PM:        { login: 'test_head_pm',       password: 'Test123!',  pin: '0000' },
  BUH:            { login: 'test_buh',           password: 'Test123!',  pin: '0000' },
  HR:             { login: 'test_hr',            password: 'Test123!',  pin: '0000' },
  WAREHOUSE:      { login: 'test_warehouse',     password: 'Test123!',  pin: '0000' },
  PROC:           { login: 'test_proc',          password: 'Test123!',  pin: '0000' },
};

// ── Страницы (те же что и desktop, плюс мобильные специфичные) ───────────
const PAGES = [
  // Общие / главная
  { path: 'home',               name: 'Главная' },
  { path: 'calendar',           name: 'Календарь' },
  { path: 'birthdays',          name: 'Дни рождения' },
  { path: 'alerts',             name: 'Уведомления' },
  { path: 'reminders',          name: 'Напоминания' },
  { path: 'office-schedule',    name: 'График офиса' },
  { path: 'messenger',          name: 'Мессенджер (Huginn)' },
  { path: 'my-mail',            name: 'Моя почта' },
  { path: 'meetings',           name: 'Совещания' },
  // Проекты
  { path: 'tenders',            name: 'Тендеры' },
  { path: 'tkp',                name: 'ТКП' },
  { path: 'pm-calcs',           name: 'Просчёты' },
  { path: 'pm-works',           name: 'Работы' },
  { path: 'tasks',              name: 'Задачи' },
  { path: 'kanban',             name: 'Канбан' },
  // Финансы
  { path: 'cash',               name: 'Касса' },
  { path: 'payroll',            name: 'Зарплата' },
  { path: 'invoices',           name: 'Счета' },
  { path: 'acts',               name: 'Акты' },
  // HR
  { path: 'personnel',          name: 'Персонал' },
  { path: 'hr-requests',        name: 'Заявки HR' },
  // Снабжение
  { path: 'procurement',        name: 'Закупки' },
  { path: 'tmc-requests',       name: 'ТМЦ-заявки' },
  { path: 'warehouse',          name: 'Склад' },
  { path: 'assembly',           name: 'Сборки' },
  { path: 'training',           name: 'Обучение' },
  // Пропуска
  { path: 'pass-requests',      name: 'Заявки на пропуск' },
  { path: 'permits',            name: 'Разрешения' },
  // Документы
  { path: 'contracts',          name: 'Договоры' },
  { path: 'correspondence',     name: 'Корреспонденция' },
];

const IGNORE = [
  'favicon',
  'ResizeObserver loop',
  'Non-passive event listener',
  'The play() request was interrupted',
  'AudioContext was not allowed',
  'chrome-extension',
  '[Violation]',
  'HTTP 502',
  'status of 502',
  'HTTP 503',
  'status of 503',
  'net::ERR_',
  'Failed to fetch',
  'Error: offline',
];

function isIgnored(text) {
  return IGNORE.some(p => text.toLowerCase().includes(p.toLowerCase()));
}

async function loginByApi(page, role) {
  const acc = ACCOUNTS[role];
  if (!acc) return null;

  try {
    const loginResp = await page.request.post(BASE_URL + '/api/auth/login', {
      data: { login: acc.login, password: acc.password },
    });
    if (!loginResp.ok()) return null;
    const preToken = (await loginResp.json()).token;
    if (!preToken) return null;

    const pinResp = await page.request.post(BASE_URL + '/api/auth/verify-pin', {
      data: { pin: acc.pin },
      headers: { Authorization: `Bearer ${preToken}` },
    });
    if (!pinResp.ok()) return null;
    const pinData = await pinResp.json();
    const token = pinData.token;
    if (!token) return null;

    await page.goto(BASE_URL + '/#/welcome', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // SW controllerchange triggers hard reload to /?_sw=TIMESTAMP — wait for it to settle
    await page.waitForFunction(
      () => !window.location.search.includes('_sw='),
      { timeout: 5000 }
    ).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

    await page.evaluate(({ t, u }) => {
      localStorage.setItem('asgard_token', t);
      if (u) {
        localStorage.setItem('asgard_user', JSON.stringify(u));
        if (u.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(u.permissions));
        if (u.menu_settings) localStorage.setItem('asgard_menu_settings', JSON.stringify(u.menu_settings));
      }
    }, { t: token, u: pinData.user });

    try {
      await page.goto(BASE_URL + '/#/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (_navErr) {
      await page.waitForTimeout(1500);
      await page.evaluate(({ t, u }) => {
        localStorage.setItem('asgard_token', t);
        if (u) {
          localStorage.setItem('asgard_user', JSON.stringify(u));
          if (u.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(u.permissions));
          if (u.menu_settings) localStorage.setItem('asgard_menu_settings', JSON.stringify(u.menu_settings));
        }
      }, { t: token, u: pinData.user }).catch(() => {});
      await page.goto(BASE_URL + '/#/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await page.waitForTimeout(2500); // мобилка инициализируется чуть дольше

    return token;
  } catch (e) {
    return null;
  }
}

for (const role of Object.keys(ACCOUNTS)) {
  test(`[Mobile] Аудит консоли [${role}]`, async ({ page }) => {
    test.setTimeout(360000); // 6 минут на роль

    const findings = [];

    const token = await loginByApi(page, role);
    if (!token) {
      console.log(`  ⚠️  [Mobile][${role}] нет токена — пропускаем`);
      test.skip();
      return;
    }
    console.log(`  ✅ [Mobile][${role}] залогинен`);

    // Сборщик ошибок — после логина
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

    for (const { path, name } of PAGES) {
      currentPageErrors.length = 0;

      try {
        await page.goto(BASE_URL + '/#/' + path, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await Promise.race([
          page.waitForLoadState('networkidle', { timeout: 4000 }),
          page.waitForTimeout(4000),
        ]).catch(() => {});
        await page.waitForTimeout(500);
      } catch (_) {}

      if (currentPageErrors.length > 0) {
        findings.push({ path, name, errors: [...currentPageErrors] });
        console.log(`  ❌ [Mobile][${role}] /${path}: ${currentPageErrors.length} ошибок`);
      }
    }

    if (findings.length === 0) {
      console.log(`  🎉 [Mobile][${role}] 0 ошибок на всех ${PAGES.length} страницах`);
      return;
    }

    const report = findings.map(f =>
      `\n  📍 /${f.path} (${f.name}):\n` +
      f.errors.map(e => `     • ${e.slice(0, 200)}`).join('\n')
    ).join('\n');

    throw new Error(
      `[Mobile] Роль ${role}: console.error на ${findings.length}/${PAGES.length} страницах:${report}`
    );
  });
}
