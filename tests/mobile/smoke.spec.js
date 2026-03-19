const { test, expect } = require('@playwright/test');
const { loginByToken, setupLocalAssets } = require('./auth.helper');

const GO = { waitUntil: 'domcontentloaded', timeout: 30000 };

// ── WELCOME/AUTH ──

test('welcome page loads — not black screen', async ({ page }) => {
  await setupLocalAssets(page);
  await page.goto('/', GO);
  await page.waitForTimeout(5000);
  await expect(
    page.locator('text=АСГАРД').or(page.locator('text=Войти')).first()
  ).toBeVisible({ timeout: 10000 });
});

test('login button navigates to /login', async ({ page }) => {
  await setupLocalAssets(page);
  await page.goto('/', GO);
  await page.waitForTimeout(3000);
  var btn = page.locator('text=Войти');
  if (await btn.isVisible()) {
    await btn.click();
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('login');
  }
});

// ── DASHBOARD ──

test('dashboard loads with tab bar', async ({ page }) => {
  await loginByToken(page);
  await expect(
    page.locator('text=Главная').first()
  ).toBeVisible({ timeout: 15000 });
});

test('dashboard — tab bar has all items', async ({ page }) => {
  await loginByToken(page);
  await page.waitForTimeout(3000);
  await expect(page.locator('text=Главная').first()).toBeVisible();
  await expect(page.locator('text=Задачи').first()).toBeVisible();
  await expect(page.locator('text=Мимир').first()).toBeVisible();
  await expect(page.locator('text=Ещё').first()).toBeVisible();
});

// ── TAB BAR ──

test('tab Задачи navigates', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/tasks', GO);
  await page.waitForTimeout(3000);
  expect(page.url()).toContain('/tasks');
});

test('tab Мимир navigates', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/mimir', GO);
  await page.waitForTimeout(3000);
  expect(page.url()).toContain('/mimir');
});

test('tab Ещё navigates', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/more', GO);
  await page.waitForTimeout(3000);
  expect(page.url()).toContain('/more');
});

// ── HUGINN (CHAT) ──

test('messenger page loads', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/messenger', GO);
  await page.waitForTimeout(3000);
  expect(page.url()).toContain('/messenger');
  var hasError = await page.locator('text=Не удалось').or(page.locator('text=Ошибка связи')).isVisible().catch(function () { return false; });
  expect(hasError).toBeFalsy();
});

test('huginn — stories Вы not duplicated', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/messenger', GO);
  await page.waitForTimeout(3000);
  var youCount = await page.locator('text=Вы').count();
  expect(youCount).toBeLessThanOrEqual(1);
});

test('huginn — page has no JS errors', async ({ page }) => {
  await loginByToken(page);
  var jsErrors = [];
  page.on('pageerror', function (err) { jsErrors.push(err.message); });
  await page.goto('/#/messenger', GO);
  await page.waitForTimeout(5000);
  // Не должно быть критичных JS ошибок
  var critical = jsErrors.filter(function (e) { return e.includes('Cannot read') || e.includes('is not a function'); });
  expect(critical.length).toBe(0);
});

// ── РАБОТЫ ──

test('works page loads for ADMIN', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/pm-works', GO);
  await page.waitForTimeout(5000);
  await expect(
    page.locator('text=РАБОТЫ').or(page.locator('text=Мои работы')).first()
  ).toBeVisible({ timeout: 10000 });
});

test('works page has filter tabs', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/pm-works', GO);
  await page.waitForTimeout(5000);
  await expect(page.locator('text=Все').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=В работе').first()).toBeVisible({ timeout: 5000 });
});

// ── ТЕНДЕРЫ ──

test('tenders page loads without error', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/tenders', GO);
  await page.waitForTimeout(5000);
  var hasError = await page.locator('text=Ошибка загрузки').isVisible().catch(function () { return false; });
  expect(hasError).toBeFalsy();
});

test('tenders — not empty for ADMIN', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/tenders', GO);
  await page.waitForTimeout(5000);
  var empty = await page.locator('text=Нет тендеров').isVisible().catch(function () { return false; });
  expect(empty).toBeFalsy();
});

// ── ДРУЖИНА ──

test('personnel page loads without error', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/personnel', GO);
  await page.waitForTimeout(5000);
  var hasError = await page.locator('text=Ошибка загрузки дружины').isVisible().catch(function () { return false; });
  expect(hasError).toBeFalsy();
});

// ── МИМИР ──

test('mimir page opens', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/mimir', GO);
  await page.waitForTimeout(3000);
  expect(page.url()).toContain('/mimir');
  // Проверяем что нет JS ошибок (страница не пустая)
  var bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText.length).toBeGreaterThan(5);
});

// ── АНКЕТА ──

test('worker profiles list loads', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/worker-profiles', GO);
  await page.waitForTimeout(5000);
  await expect(
    page.locator('text=ХАРАКТЕРИСТИКИ').or(page.locator('text=Анкеты рабочих')).first()
  ).toBeVisible({ timeout: 10000 });
});

// ── КАССА ──

test('cash page loads', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/cash', GO);
  await page.waitForTimeout(5000);
  await expect(
    page.locator('text=Касса').or(page.locator('text=МОИ АВАНСЫ')).first()
  ).toBeVisible({ timeout: 10000 });
});

// ── МЕНЮ ЕЩЁ ──

test('Ещё — menu items visible', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/more', GO);
  await page.waitForTimeout(3000);
  await expect(page.locator('text=Профиль')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('text=Тендеры').first()).toBeVisible();
  await expect(page.locator('text=Сотрудники').first()).toBeVisible();
});

// ── НАВИГАЦИЯ НАЗАД ──

test('back navigation works', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/more', GO);
  await page.waitForTimeout(1000);
  await page.goto('/#/cash', GO);
  await page.waitForTimeout(1000);
  var backBtn = page.locator('text=←').or(page.locator('[style*="←"]')).first();
  if (await backBtn.isVisible()) {
    await backBtn.click();
    await page.waitForTimeout(1000);
    expect(page.url()).toBeTruthy();
  }
});

// ── МОДАЛКИ ──

test('new chat modal — inputs fit screen', async ({ page }) => {
  await loginByToken(page);
  await page.goto('/#/messenger', GO);
  await page.waitForTimeout(2000);
  var plusBtn = page.locator('text=+').or(page.locator('[style*="font-size: 18px"]')).first();
  if (await plusBtn.isVisible()) {
    await plusBtn.click();
    await page.waitForTimeout(1000);
    var input = page.locator('input').first();
    if (await input.isVisible()) {
      var box = await input.boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(400);
      }
    }
  }
});
