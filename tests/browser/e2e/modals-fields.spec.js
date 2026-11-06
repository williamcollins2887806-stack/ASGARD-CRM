const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

/**
 * modals-fields.spec.js — визуальная проверка новых полей в обеих модалках.
 * Анализ: ДВ, звонок, технология. Просчёт: вкладка «Объёмы».
 */
const CLONE = process.env.CLONE_URL || 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

async function tk() {
  const lr = await fetch(`${CLONE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_pm', password: 'Test123!' })
  });
  const ld = await lr.json();
  const pr = await fetch(`${CLONE}/api/auth/verify-pin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ld.token },
    body: JSON.stringify({ pin: '0000' })
  });
  return (await pr.json()).token;
}

async function demoId() {
  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: process.env.DB_PASSWORD || '123456789', database: 'asgard_crm_test'
  });
  await db.connect();
  const r = await db.query(
    "SELECT id FROM tenders WHERE tender_title ILIKE '%ДЕМО Мимир%' AND deleted_at IS NULL ORDER BY id LIMIT 1"
  );
  await db.end();
  return r.rows[0]?.id || null;
}

test('анализ: ДВ, звонок, технология в карточке', async ({ page }) => {
  test.setTimeout(120000);
  const token = await tk();
  const id = await demoId();
  test.skip(!id, 'нет демо-тендера');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('token', t);
  }, token);
  await page.goto(`${CLONE}/#/pm-calculations`, { waitUntil: 'commit' });
  await page.waitForTimeout(2600);

  // Модуль модалки грузится со страницей — проверяем, что он есть.
  const hasModule = await page.evaluate(() => typeof window.AsgardRpReviewModal === 'object');
  expect(hasModule, 'AsgardRpReviewModal загружен').toBe(true);

  // Кнопка анализа → этапы → доходим до объёмов через API уже наполненной сессии.
  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } });
    const d = await r.json();
    window.AsgardRpReviewModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'analysis' });
    await new Promise((res) => setTimeout(res, 1800));
  }, id);

  await page.locator('#rpOpenMimir').click();
  await page.waitForSelector('.mst-modal', { timeout: 20000 });
  await page.waitForTimeout(1500);

  // Запускаем разбор: кнопка «Запустить анализ».
  const next = page.locator('[data-main-action]');
  if (await next.isEnabled().catch(() => false)) {
    await next.click();
    await page.waitForTimeout(25000);
  }

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '50-stages-after-analyze.png') });

  const stageText = await page.locator('.mst-main').innerText().catch(() => '');
  console.log('ЭТАП ТЕКСТ:\n' + stageText.slice(0, 500));

  // Закрываем этапы — карточка должна обновиться.
  await page.evaluate(() => window.AsgardMimirStages.close());
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '51-card-with-dv.png'), fullPage: false });

  const card = await page.evaluate(() => ({
    dvBlock: !!document.querySelector('.rp-review-dv-block'),
    callBlock: !!document.querySelector('.rp-review-call-block'),
    dvRows: document.querySelectorAll('.rp-review-dv-table tbody tr').length,
    callQuestions: document.querySelectorAll('.rp-review-call-list li').length,
    phone: (document.querySelector('.rp-review-call-text .muted') || {}).textContent || null
  }));
  console.log('КАРТОЧКА АНАЛИЗА:', JSON.stringify(card));

  expect(errors, 'ошибки: ' + errors.join(' | ')).toHaveLength(0);
});

test('просчёт: вкладка «Объёмы»', async ({ page }) => {
  test.setTimeout(120000);
  const token = await tk();
  const id = await demoId();
  test.skip(!id, 'нет демо-тендера');

  await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('token', t);
  }, token);
  await page.goto(`${CLONE}/#/pm-calculations`, { waitUntil: 'commit' });
  await page.waitForTimeout(2000);

  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } });
    const d = await r.json();
    window.AsgardRpCalcModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'calc' });
    await new Promise((res) => setTimeout(res, 1800));
  }, id);

  const tabs = await page.locator('.rp-calc-tab').allInnerTexts();
  console.log('ВКЛАДКИ ПРОСЧЁТА:', JSON.stringify(tabs));

  const dvTab = page.locator('.rp-calc-tab[data-rp-tab="dv"]');
  expect(await dvTab.count(), 'должна быть вкладка «Объёмы»').toBeGreaterThan(0);
  await dvTab.click();
  await page.waitForTimeout(900);

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '52-calc-dv.png'), fullPage: false });

  const info = await page.evaluate(() => ({
    table: !!document.querySelector('.rp-calc-dv-table'),
    rows: document.querySelectorAll('.rp-calc-dv-table tbody tr').length,
    headers: Array.from(document.querySelectorAll('.rp-calc-dv-table th')).map((t) => t.textContent.trim())
  }));
  console.log('ПРОСЧЁТ ДВ:', JSON.stringify(info));
});
