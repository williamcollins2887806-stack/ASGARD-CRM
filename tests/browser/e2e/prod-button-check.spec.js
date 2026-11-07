const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * prod-button-check.spec.js — какая кнопка Мимира в карточке анализа на ПРОДЕ.
 *
 * Проверяем не «по коду», а глазами: открываем реестр, кликаем строку
 * в очереди «рассмотрение», ждём карточку и читаем надпись кнопки.
 */
const PROD = process.env.PROD_URL || 'https://asgard-crm.ru';
const TOKEN = process.env.PROD_TOKEN || '';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-prod');

test('прод: кнопка в карточке анализа', async ({ page }) => {
  test.skip(!TOKEN, 'нужен PROD_TOKEN');

  await page.goto(`${PROD}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('token', t);
  }, TOKEN);
  await page.goto(`${PROD}/#/tenders`, { waitUntil: 'commit' });
  await page.waitForTimeout(4500);

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '10-registry.png'), fullPage: false });

  // Кнопки открытия карточки в реестре.
  const candidates = page.locator('.reg-rp-edit, .reg-rp-view, [data-act="report"], .tender-row');
  const n = await candidates.count();
  console.log('элементов для клика:', n);

  let clicked = false;
  for (let i = 0; i < Math.min(n, 12); i++) {
    const el = candidates.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1400);
    // Признак карточки: есть вкладки отчёта.
    const hasTabs = await page.locator('.rp-review-tabs').count();
    if (hasTabs) { clicked = true; break; }
  }
  test.skip(!clicked, 'карточка не открылась кликом по реестру');

  const info = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const mimir = btns.find((b) => /Мимир/i.test(b.textContent || ''));
    const badge = document.querySelector('.rp-review-badge.mode-analysis, .rp-review-badge.mode-calc');
    return {
      buttonText: mimir ? mimir.textContent.trim() : '(нет кнопки)',
      modeBadge: badge ? badge.textContent.trim() : '(нет бейджа)',
      hasTabs: !!document.querySelector('.rp-review-tabs')
    };
  });
  console.log('КАРТОЧКА:', JSON.stringify(info));
  await page.screenshot({ path: path.join(OUT, '11-card.png'), fullPage: false });

  expect(info.buttonText).toBeTruthy();
  // В незакрытом анализе — «Анализ Мимир», а не «Просчёт Мимир».
  expect(info.buttonText, 'кнопка должна быть про анализ').toContain('Анализ');
  expect(info.modeBadge, 'бейдж режима').toContain('анализ');
});
