// @ts-check
/**
 * perf-budget.spec.js — перф-бюджет фронта CRM (P4.3).
 *
 * Проверяет ключевые метрики загрузки и интерактивности против бюджета:
 *   - LCP  < 2500 мс
 *   - запросов на страницу < 150
 *   - вес JS+CSS (decoded) < 14 МБ
 *
 * ЗАПУСК — только по явному запросу (по умолчанию тест пропускается), чтобы
 * не гонять нагрузочные замеры по проду случайно. Запускать на КЛОНЕ:
 *
 *   PERF_BUDGET=1 PERF_BASE_URL=http://127.0.0.1:3100 npx playwright test perf-budget
 *
 * Переменные:
 *   PERF_BUDGET=1        — включить тест (иначе skip)
 *   PERF_BASE_URL=<url>  — куда ходить (по умолчанию baseURL конфига)
 *   PERF_ROUTE=<hash>    — маршрут, по умолчанию '/'
 */

const { test, expect } = require('@playwright/test');

const ENABLED = process.env.PERF_BUDGET === '1';
const BASE = process.env.PERF_BASE_URL || '';
const ROUTE = process.env.PERF_ROUTE || '/';

const BUDGET = {
  lcpMs: 2500,
  requests: 150,
  decodedKB: 14 * 1024, // 14 МБ decoded JS+CSS
};

test.describe('Performance budget', () => {
  test.skip(!ENABLED, 'Перф-бюджет выключен (PERF_BUDGET != 1). Запускать на клоне.');

  test('LCP / requests / weight в бюджете', async ({ page }) => {
    const url = (BASE || '') + ROUTE;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(1500);

    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const resources = performance.getEntriesByType('resource');
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint') || [];
      const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1].startTime : nav.domContentLoadedEventEnd;
      const decodedKB = resources.reduce((a, r) => a + (r.decodedBodySize || 0), 0) / 1024;
      return {
        lcp: Math.round(lcp || 0),
        requests: resources.length,
        decodedKB: Math.round(decodedKB),
      };
    });

    // eslint-disable-next-line no-console
    console.log('[perf-budget]', JSON.stringify({ url, ...metrics, budget: BUDGET }));

    expect(metrics.lcp, `LCP ${metrics.lcp} мс должен быть < ${BUDGET.lcpMs} мс`).toBeLessThan(BUDGET.lcpMs);
    expect(metrics.requests, `запросов ${metrics.requests} должно быть < ${BUDGET.requests}`).toBeLessThan(BUDGET.requests);
    expect(metrics.decodedKB, `вес ${metrics.decodedKB} КБ должен быть < ${BUDGET.decodedKB} КБ`).toBeLessThan(BUDGET.decodedKB);
  });
});
