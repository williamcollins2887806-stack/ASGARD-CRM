const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * stages-wiring.spec.js — кнопка «Анализ Мимир» открывает ПОЭТАПНЫЙ анализ,
 * а не старый мастер со сметой. Именно это было сломано: экраны сделаны,
 * но к кнопке не подключены.
 */
const CLONE = process.env.CLONE_URL || 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

async function token() {
  const lr = await fetch(`${CLONE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_pm', password: 'Test123!' })
  });
  const ld = await lr.json();
  const pr = await fetch(`${CLONE}/api/auth/verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ld.token },
    body: JSON.stringify({ pin: '0000' })
  });
  return (await pr.json()).token;
}

/** Тендер, который РП реально видит: берём из БД напрямую по демо-префиксу. */
async function demoTenderId() {
  const { Client } = require('pg');
  const db = new Client({
    host: 'localhost', port: 5432,
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    // ВАЖНО: именно клон. .env проекта указывает на asgard_crm_dev, а демо-тендеры
    // создаются в asgard_crm_test — из-за этого тест «не находил» их.
    database: process.env.CLONE_DB || 'asgard_crm_test'
  });
  await db.connect();
  const r = await db.query(
    `SELECT id FROM tenders WHERE tender_title ILIKE '%ДЕМО Мимир%' AND deleted_at IS NULL
      ORDER BY id LIMIT 1`
  );
  await db.end();
  return r.rows[0]?.id || null;
}

test('кнопка «Анализ Мимир» ведёт в поэтапный анализ', async ({ page }) => {
  test.setTimeout(120000);
  const t = await token();
  const id = await demoTenderId();
  console.log('ДЕМО-ТЕНДЕР:', id);
  test.skip(!id, 'нет демо-тендера (tools/seed-mimir-demo-tenders.js)');

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((tk) => {
    localStorage.setItem('asgard_token', tk);
    localStorage.setItem('token', tk);
  }, t);
  await page.goto(`${CLONE}/#/pm-calculations`, { waitUntil: 'commit' });
  await page.waitForTimeout(2200);

  const info = await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } });
    const d = await r.json();
    if (!r.ok) return { status: r.status, error: d.error };
    window.AsgardRpReviewModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'analysis' });
    await new Promise((res) => setTimeout(res, 2000));
    return { status: r.status, phase: d.phase };
  }, id);
  console.log('КАРТОЧКА:', JSON.stringify(info));
  test.skip(info.error, JSON.stringify(info));

  const btn = page.locator('#rpOpenMimir');
  await expect(btn).toBeVisible({ timeout: 10000 });
  console.log('НАДПИСЬ КНОПКИ:', (await btn.innerText()).trim());

  await btn.click();
  await page.waitForTimeout(3500);

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '40-after-click.png'), fullPage: false });

  const state = await page.evaluate(() => ({
    stagesModal: !!document.querySelector('.mst-modal'),
    oldQuick: !!document.querySelector('.pk3-modal[data-mimir-quick]'),
    rail: !!document.querySelector('.mst-rail'),
    stageNow: (document.querySelector('.mst-step.is-now') || {}).textContent || null,
    hasSmetaStep: !!document.querySelector('[data-goto="calc_smeta"]'),
    hasFileUpload: !!document.querySelector('[data-act="pick-files"]')
  }));
  console.log('ПОСЛЕ КЛИКА:', JSON.stringify(state));

  expect(state.stagesModal, 'должна открыться модалка этапов').toBe(true);
  expect(state.oldQuick, 'старый мастер со сметой не должен открываться').toBe(false);
  expect(state.rail, 'должен быть рельс этапов').toBe(true);
  expect(state.hasSmetaStep, 'в анализе нет этапа сметы').toBe(false);
  expect(errors, 'ошибки: ' + errors.join(' | ')).toHaveLength(0);
});
