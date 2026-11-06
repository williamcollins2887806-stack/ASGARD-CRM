const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');
const FILE = 'file:///C:/Users/Nikita-ASGARD/ASGARD-CRM/public/norms-form.html';

test('форма норм: вид и работа', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(FILE, { waitUntil: 'commit' });
  await page.waitForTimeout(900);

  const info = await page.evaluate(() => ({
    rows: document.querySelectorAll('tbody tr').length,
    cats: document.querySelectorAll('.cat').length,
    total: document.getElementById('pTotal').textContent,
    inputs: document.querySelectorAll('tbody input, tbody select, tbody textarea').length
  }));
  console.log('ФОРМА:', JSON.stringify(info));

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'F1-norms-form.png') });

  // Заполняем две строки и проверяем счётчик.
  const firstQty = page.locator('tbody tr').first().locator('[data-f="qty"]');
  await firstQty.fill('200');
  const firstDays = page.locator('tbody tr').first().locator('[data-f="days"]');
  await firstDays.fill('3');
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    filled: document.getElementById('pCount').textContent,
    done: document.getElementById('fDone').textContent
  }));
  console.log('ПОСЛЕ ВВОДА:', JSON.stringify(after));

  // Выгрузка.
  await page.locator('#btnExport').click();
  await page.waitForTimeout(500);
  const payload = await page.locator('#outText').inputValue();
  console.log('ВЫГРУЗКА (первые 400):', payload.slice(0, 400));

  expect(errors, 'ошибки JS: ' + errors.join(' | ')).toHaveLength(0);
  expect(info.rows, 'строк в форме').toBeGreaterThanOrEqual(30);
  expect(after.filled, 'счётчик заполненных').toBe('1');
  expect(payload, 'выгрузка содержит строку').toContain('vessels');
});
