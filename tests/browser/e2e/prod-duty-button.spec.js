const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * prod-duty-button.spec.js — что открывается из очереди дежурного РП.
 *
 * В списке кнопка называется «Отчёт», а надпись «Анализ Мимир / Просчёт Мимир»
 * появляется уже в карточке. Проверяем именно её — на вкладке «Анализ».
 */
const PROD = process.env.PROD_URL || 'https://asgard-crm.ru';
const TOKEN = process.env.PROD_TOKEN || '';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-prod');

test('прод: из очереди анализа открывается анализ', async ({ page }) => {
  test.skip(!TOKEN, 'нужен PROD_TOKEN');

  await page.goto(`${PROD}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('token', t);
  }, TOKEN);
  await page.goto(`${PROD}/#/pm-calculations`, { waitUntil: 'commit' });
  await page.waitForTimeout(4000);

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '30-duty-queue.png'), fullPage: false });

  // Вкладка «Анализ» (по умолчанию) — берём первую кнопку «Отчёт».
  const reportBtns = page.locator('.duty-report');
  const n = await reportBtns.count();
  console.log('кнопок «Отчёт/Открыть» в очереди:', n);
  test.skip(n === 0, 'очередь пуста');

  // Кликаем первую, у которой не preview (её ведёт дежурный).
  let clicked = false;
  for (let i = 0; i < Math.min(n, 8); i++) {
    const b = reportBtns.nth(i);
    const preview = await b.getAttribute('data-preview');
    if (preview === '1') continue;
    await b.click();
    clicked = true;
    break;
  }
  if (!clicked) { await reportBtns.first().click(); }
  await page.waitForTimeout(2600);

  await page.screenshot({ path: path.join(OUT, '31-card.png'), fullPage: false });

  const info = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const mimir = btns.find((b) => /Мимир/i.test(b.textContent || ''));
    const badge = document.querySelector('.rp-review-badge.mode-analysis, .rp-review-badge.mode-calc');
    return {
      buttonText: mimir ? mimir.textContent.trim().replace(/\s+/g, ' ') : '(нет кнопки)',
      modeBadge: badge ? badge.textContent.trim() : '(нет бейджа)',
      tabs: Array.from(document.querySelectorAll('.rp-review-tab')).map((t) => t.textContent.trim())
    };
  });
  console.log('КАРТОЧКА:', JSON.stringify(info));

  expect(info.buttonText, 'кнопка Мимира').toContain('Анализ');
  expect(info.buttonText, 'не должно быть «Просчёт»').not.toContain('Просчёт');
});
