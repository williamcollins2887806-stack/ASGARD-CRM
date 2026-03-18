// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'tests/reports/playwright', open: 'never' }],
    ['list']
  ],
  use: {
    baseURL: 'https://asgard-crm.ru',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'mobile',
      testDir: './tests/mobile',
      use: {
        browserName: 'chromium',
        viewport: devices['iPhone 14'].viewport,
        userAgent: devices['iPhone 14'].userAgent,
        deviceScaleFactor: devices['iPhone 14'].deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
        navigationTimeout: 30000,
        actionTimeout: 15000,
      },
    },
  ],
  timeout: 60000,
});
