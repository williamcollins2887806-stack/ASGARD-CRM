// @ts-check
/**
 * Playwright-конфиг для ЛОКАЛЬНОГО КЛОНА (:3200) — не трогает прод-конфиг,
 * который смотрит на https://asgard-crm.ru.
 *
 * Запуск: npx playwright test tests/browser/e2e/payouts-approval-tabs.spec.js \
 *          --config=playwright.clone.config.js
 */
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.CLONE_URL || 'http://127.0.0.1:3200',
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20000,
    // Клон может стоять на удалённом сервере, и полная загрузка страницы
    // (сотни ассетов) по сети занимает десятки секунд. Ждём 'commit':
    // DOM приходит сразу, дальше тест сам ждёт нужные селекторы.
    navigationTimeout: 60000,
  },
  projects: [
    { name: 'clone-chromium', use: { browserName: 'chromium' } },
  ],
  timeout: 120000,
});
