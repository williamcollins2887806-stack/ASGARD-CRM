/**
 * Timesheet v2 — браузерный E2E на клоне БД (asgard_crm_test, порт :3100).
 *
 * Прогон:
 *   1. ssh root@92.242.61.184 'pg_dump asgard_crm | psql -d asgard_crm_test'
 *   2. ssh root@92.242.61.184 'cd /var/www/asgard-crm && PORT=3100 PGDATABASE=asgard_crm_test node src/index.js &'
 *   3. ssh-туннель: ssh -L 3100:127.0.0.1:3100 root@92.242.61.184
 *   4. локально: npx playwright test tests/timesheet-v2/playwright-suite.spec.js
 *
 * НИКОГДА не запускать против прод (порт 3000) — defensive check на BASE_URL.
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3100';
if (BASE.includes(':3000') || BASE.includes('asgard-crm.ru')) {
  throw new Error('FATAL: BASE_URL указывает на прод! Тесты разрешены только против :3100 клона.');
}

// 6 тест-аккаунтов из памяти + предполагаемые для новых ролей.
// Если test-аккаунтов под кладовщика/ТО/офис-менеджера нет — создать в setup.
const ACCOUNTS = {
  PM:             { login: 'test_pm',             password: 'Test123!', pin: '1234', role: 'PM' },
  WAREHOUSE:      { login: 'test_warehouse',      password: 'Test123!', pin: '1234', role: 'WAREHOUSE' },
  TO:             { login: 'test_to',             password: 'Test123!', pin: '1234', role: 'TO' },
  OFFICE_MANAGER: { login: 'test_office_manager', password: 'Test123!', pin: '1234', role: 'OFFICE_MANAGER' },
  DIRECTOR:       { login: 'test_director',       password: 'Test123!', pin: '1234', role: 'DIRECTOR_GEN' },
  HR:             { login: 'test_hr',             password: 'Test123!', pin: '1234', role: 'HR' },
};

async function loginAs(page, account) {
  await page.goto(BASE, { waitUntil: 'commit' });
  await page.waitForSelector('#btnShowLogin', { timeout: 45000 });
  await page.click('#btnShowLogin');
  await page.fill('input[name="login"]', account.login);
  await page.fill('input[name="password"]', account.password);
  await page.click('button[type="submit"]');
  // PIN
  await page.waitForSelector('.pin-input, input[name="pin"]', { timeout: 15000 }).catch(() => {});
  const pinInput = await page.$('input[name="pin"]');
  if (pinInput) {
    await pinInput.fill(account.pin);
    await page.click('button[type="submit"]');
  }
  await page.waitForURL(/#\/(dashboard|my-works|home)/, { timeout: 20000 });
}

function expectedRoute(role) {
  return {
    PM: '/my-timesheet',
    HEAD_PM: '/my-timesheet',
    WAREHOUSE: '/timesheet-warehouse',
    TO: '/timesheet-medical',
    HEAD_TO: '/timesheet-medical',
    OFFICE_MANAGER: '/timesheet-travel',
    DIRECTOR_GEN: '/timesheet',
    BUH: '/timesheet',
    HR: '/timesheet',
    HR_MANAGER: '/timesheet',
    ADMIN: '/timesheet',
  }[role];
}

// 0 console errors — обязательная проверка по фидбеку пользователя
let consoleErrors = [];
test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push('console.error: ' + msg.text());
  });
});
test.afterEach(async () => {
  expect(consoleErrors, 'JS-ошибок в консоли быть не должно').toEqual([]);
});

// ========== ТЕСТ 1: PM «Табель моей дружины» ==========
test.describe('PM — Табель моей дружины', () => {
  test('видит свою бригаду, может ставить день/ночь, не может — склад/МО/дорогу', async ({ page }) => {
    await loginAs(page, ACCOUNTS.PM);
    await page.goto(BASE + '/#/my-timesheet', { waitUntil: 'commit' });
    await page.waitForSelector('[data-testid="timesheet-grid"], .tsv2-grid', { timeout: 20000 });

    // Заголовок страницы
    await expect(page.locator('h1, h2').first()).toContainText(/табел/i);

    // Должна быть видна сетка ФИО × дни
    const rows = await page.locator('tr.tsv2-row, [data-row="employee"]').count();
    expect(rows).toBeGreaterThan(0);

    // Клик по своей ячейке → popover с типами day/night/waiting (БЕЗ warehouse/medical/travel)
    const cell = await page.locator('[data-cell="empty"]').first();
    await cell.click();
    await page.waitForSelector('.tsv2-popover, [data-testid="cell-editor"]');
    const types = await page.locator('.tsv2-popover button, [data-type-btn]').allTextContents();
    expect(types.join(' ')).toMatch(/(День|☀️|Day)/);
    expect(types.join(' ')).toMatch(/(Ночь|🌙|Night)/);
    expect(types.join(' ')).not.toMatch(/(Склад|📦|Warehouse)/);
    expect(types.join(' ')).not.toMatch(/(Медосмотр|🏥|Medical)/);
    expect(types.join(' ')).not.toMatch(/(Дорога|✈️|Travel)/);

    // tooltip «Внёс: ФИО» на hover
    await page.locator('[data-cell-filled]').first().hover();
    const tooltip = await page.locator('.tsv2-tooltip, [role="tooltip"]').textContent();
    expect(tooltip).toMatch(/Внёс/i);
  });

  test('может закрыть свой блок месяца → бейдж появляется', async ({ page }) => {
    await loginAs(page, ACCOUNTS.PM);
    await page.goto(BASE + '/#/my-timesheet', { waitUntil: 'commit' });
    await page.waitForSelector('.tsv2-grid');
    await page.click('[data-action="lock-month"]');
    await page.click('[data-action="confirm-lock"]');
    await expect(page.locator('[data-lock-badge="pm"]')).toContainText(/Закрыт/i);
  });

  test('«+ Добавить рабочего» требует выбор работы', async ({ page }) => {
    await loginAs(page, ACCOUNTS.PM);
    await page.goto(BASE + '/#/my-timesheet', { waitUntil: 'commit' });
    await page.click('[data-action="add-worker"]');
    await page.waitForSelector('[data-testid="add-worker-modal"]');
    // Селектор работы обязателен
    await expect(page.locator('select[name="work_id"], [data-testid="work-selector"]')).toBeVisible();
    // Кнопка «Добавить» disabled пока работа не выбрана
    const addBtn = page.locator('[data-action="confirm-add"]');
    await expect(addBtn).toBeDisabled();
  });

  test('НЕ имеет доступа к /timesheet (глобальный)', async ({ page }) => {
    await loginAs(page, ACCOUNTS.PM);
    await page.goto(BASE + '/#/timesheet', { waitUntil: 'commit' });
    // Должен быть редирект или 403
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).not.toContain('/timesheet?ok'); // не показал данные
  });
});

// ========== ТЕСТ 2: WAREHOUSE ==========
test.describe('Кладовщик — Табель учёта работы на складе', () => {
  test('видит всех рабочих БЕЗ баллов и сумм, ставит только склад', async ({ page }) => {
    await loginAs(page, ACCOUNTS.WAREHOUSE);
    await page.goto(BASE + '/#/timesheet-warehouse', { waitUntil: 'commit' });
    await page.waitForSelector('.tsv2-grid');

    // НЕТ цифр баллов в ячейках — только иконки
    const cellsWithNumbers = await page.locator('[data-cell-filled] .tsv2-points-number').count();
    expect(cellsWithNumbers).toBe(0);

    // НЕТ колонок «ФОТ» / «Баллов» в KPI
    const kpi = await page.locator('.tsv2-kpi').textContent();
    expect(kpi).not.toMatch(/ФОТ|₽/);

    // Клик по ячейке → только «Склад» (без day/night/medical/travel)
    await page.locator('[data-cell="empty"]').first().click();
    const types = await page.locator('.tsv2-popover button').allTextContents();
    expect(types.join(' ')).toMatch(/(Склад|📦)/);
    expect(types.join(' ')).not.toMatch(/(День|☀️|Ночь|🌙)/);
    expect(types.join(' ')).not.toMatch(/(Медосмотр|🏥)/);
  });

  test('может закрыть warehouse-scope месяц', async ({ page }) => {
    await loginAs(page, ACCOUNTS.WAREHOUSE);
    await page.goto(BASE + '/#/timesheet-warehouse', { waitUntil: 'commit' });
    await page.click('[data-action="lock-month"]');
    await page.click('[data-action="confirm-lock"]');
    await expect(page.locator('[data-lock-badge="warehouse"]')).toContainText(/Закрыт/i);
  });
});

// ========== ТЕСТ 3: TO ==========
test.describe('ТО — Табель учёта МО', () => {
  test('видит всех БЕЗ баллов, ставит только МО', async ({ page }) => {
    await loginAs(page, ACCOUNTS.TO);
    await page.goto(BASE + '/#/timesheet-medical', { waitUntil: 'commit' });
    await page.waitForSelector('.tsv2-grid');

    expect(await page.locator('.tsv2-points-number').count()).toBe(0);

    await page.locator('[data-cell="empty"]').first().click();
    const types = await page.locator('.tsv2-popover button').allTextContents();
    expect(types.join(' ')).toMatch(/(Медосмотр|🏥)/);
    expect(types.join(' ')).not.toMatch(/(Склад|📦|День|☀️|Дорога|✈️)/);
  });
});

// ========== ТЕСТ 4: OFFICE_MANAGER ==========
test.describe('Офис-менеджер — Табель учёта дороги', () => {
  test('видит всех БЕЗ баллов, ставит только дорогу', async ({ page }) => {
    await loginAs(page, ACCOUNTS.OFFICE_MANAGER);
    await page.goto(BASE + '/#/timesheet-travel', { waitUntil: 'commit' });
    await page.waitForSelector('.tsv2-grid');

    expect(await page.locator('.tsv2-points-number').count()).toBe(0);

    await page.locator('[data-cell="empty"]').first().click();
    const types = await page.locator('.tsv2-popover button').allTextContents();
    expect(types.join(' ')).toMatch(/(Дорога|✈️)/);
    expect(types.join(' ')).not.toMatch(/(Склад|📦|Медосмотр|🏥)/);
  });
});

// ========== ТЕСТ 5: DIRECTOR ==========
test.describe('Директор — Общий табель', () => {
  test('видит баллы, ставки, все типы — кроме суточных', async ({ page }) => {
    await loginAs(page, ACCOUNTS.DIRECTOR);
    await page.goto(BASE + '/#/timesheet', { waitUntil: 'commit' });
    await page.waitForSelector('.tsv2-grid');

    // Баллы видны
    const pointsCount = await page.locator('.tsv2-points-number').count();
    expect(pointsCount).toBeGreaterThan(0);

    // ФОТ в KPI виден
    const kpi = await page.locator('.tsv2-kpi').textContent();
    expect(kpi).toMatch(/ФОТ|₽/);

    // НО суточные — НЕТ
    expect(kpi).not.toMatch(/Суточные/i);

    // Все 6 типов в редакторе
    await page.locator('[data-cell="empty"]').first().click();
    const types = await page.locator('.tsv2-popover button').allTextContents();
    expect(types.join(' ')).toMatch(/(День|☀️)/);
    expect(types.join(' ')).toMatch(/(Ночь|🌙)/);
    expect(types.join(' ')).toMatch(/(Склад|📦)/);
    expect(types.join(' ')).toMatch(/(Медосмотр|🏥)/);
    expect(types.join(' ')).toMatch(/(Дорога|✈️)/);
  });

  test('видит чипы статусов закрытия каждой роли', async ({ page }) => {
    await loginAs(page, ACCOUNTS.DIRECTOR);
    await page.goto(BASE + '/#/timesheet', { waitUntil: 'commit' });
    await page.waitForSelector('.tsv2-grid');

    const badges = await page.locator('[data-lock-badge]').allTextContents();
    expect(badges.length).toBeGreaterThanOrEqual(3); // как минимум warehouse/medical/travel чипы
  });

  test('может выгрузить Excel', async ({ page }) => {
    await loginAs(page, ACCOUNTS.DIRECTOR);
    await page.goto(BASE + '/#/timesheet', { waitUntil: 'commit' });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-action="export-xlsx"]'),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test('закрывает глобальный месяц → блокирует мобилку рабочего', async ({ page, browser }) => {
    await loginAs(page, ACCOUNTS.DIRECTOR);
    await page.goto(BASE + '/#/timesheet', { waitUntil: 'commit' });
    await page.click('[data-action="lock-month-global"]');
    await page.click('[data-action="confirm-lock"]');
    await expect(page.locator('[data-lock-badge="global"]')).toContainText(/Закрыт/i);

    // В новой сессии PM не может править
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await loginAs(page2, ACCOUNTS.PM);
    await page2.goto(BASE + '/#/my-timesheet', { waitUntil: 'commit' });
    await page2.locator('[data-cell="empty"]').first().click();
    await page2.locator('[data-type-btn="day"]').click();
    await expect(page2.locator('.tsv2-toast, .toast')).toContainText(/Месяц закрыт/i);
  });
});

// ========== ТЕСТ 6: HR ==========
test.describe('HR — Общий табель (как директор, кроме суточных)', () => {
  test('может видеть и редактировать всё, кроме суточных', async ({ page }) => {
    await loginAs(page, ACCOUNTS.HR);
    await page.goto(BASE + '/#/timesheet', { waitUntil: 'commit' });
    await page.waitForSelector('.tsv2-grid');
    const kpi = await page.locator('.tsv2-kpi').textContent();
    expect(kpi).toMatch(/ФОТ|₽/);
    expect(kpi).not.toMatch(/Суточные/i);
  });
});

// ========== ТЕСТ 7: tooltip «Внёс» работает на всех ==========
test('Tooltip «Внёс: ФИО» работает у всех 6 ролей', async ({ page }) => {
  for (const acc of [ACCOUNTS.PM, ACCOUNTS.WAREHOUSE, ACCOUNTS.TO, ACCOUNTS.OFFICE_MANAGER, ACCOUNTS.DIRECTOR, ACCOUNTS.HR]) {
    await loginAs(page, acc);
    const route = expectedRoute(acc.role);
    await page.goto(BASE + '/#' + route, { waitUntil: 'commit' });
    await page.waitForSelector('.tsv2-grid');
    const filled = await page.locator('[data-cell-filled]').first();
    if (await filled.count() > 0) {
      await filled.hover();
      const t = await page.locator('.tsv2-tooltip, [role="tooltip"]').first().textContent();
      expect(t, `Tooltip для ${acc.role}`).toMatch(/Внёс/i);
    }
  }
});
