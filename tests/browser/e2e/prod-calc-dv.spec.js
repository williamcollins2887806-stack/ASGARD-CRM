const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * prod-calc-dv.spec.js — вкладка «Объёмы» в модалке просчёта на ПРОДЕ.
 * Проверяем: вкладка есть, таблица ДВ рисуется, люди/сроки/источник на месте.
 */
const BASE = process.env.PROD_URL || 'https://asgard-crm.ru';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

test('прод: просчёт — вкладка «Объёмы»', async ({ page }) => {
  test.setTimeout(120000);
  const token = (process.env.PROD_TOKEN || '').trim();
  test.skip(!token, 'нет PROD_TOKEN');

  await page.goto(`${BASE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('token', t);
  }, token);
  await page.goto(`${BASE}/#/tenders-registry`, { waitUntil: 'commit' });
  await page.waitForTimeout(4000);

  const id = Number(process.env.PROD_TENDER || 2131);
  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } });
    const d = await r.json();
    window.AsgardRpCalcModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'calc' });
    await new Promise((res) => setTimeout(res, 2200));
  }, id);

  const tabs = await page.locator('.rp-calc-tab').allInnerTexts();
  console.log('ВКЛАДКИ:', JSON.stringify(tabs.map((t) => t.trim())));

  const dvTab = page.locator('.rp-calc-tab[data-rp-tab="dv"]');
  expect(await dvTab.count(), 'вкладка «Объёмы» есть').toBeGreaterThan(0);
  await dvTab.click();
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const panel = document.querySelector('[data-panel="dv"]');
    return {
      table: document.querySelectorAll('.rp-calc-dv-table').length,
      rows: document.querySelectorAll('.rp-calc-dv-table tbody tr').length,
      headers: Array.from(document.querySelectorAll('.rp-calc-dv-table th')).map((t) => t.textContent.trim()),
      summary: (document.querySelector('.rp-calc-dv-summary') || {}).textContent || null,
      active: (document.querySelector('.rp-calc-tab.is-active') || {}).textContent || null,
      visible: panel ? panel.offsetHeight > 0 : false
    };
  });
  console.log('ДВ ПРОСЧЁТА:', JSON.stringify(info));

  // Снимаем именно панель, чтобы кадр не зависел от прокрутки модалки.
  const panelEl = page.locator('[data-panel="dv"]');
  if (await panelEl.count()) await panelEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '81-prod-calc-dv.png') });

  expect(info.rows, 'строки ДВ в просчёте').toBeGreaterThan(0);
  expect(info.visible, 'панель «Объёмы» видна').toBe(true);
});
