const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

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

test('полный цикл: анализ → сохранение → блоки в карточке', async ({ page }) => {
  test.setTimeout(240000);
  const token = await tk();

  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: process.env.DB_PASSWORD || '123456789', database: 'asgard_crm_test'
  });
  await db.connect();
  const demo = await db.query(
    "SELECT id FROM tenders WHERE tender_title ILIKE '%ДЕМО Мимир%' AND deleted_at IS NULL ORDER BY id LIMIT 1"
  );
  const id = demo.rows[0]?.id;
  await db.end();
  test.skip(!id, 'нет демо-тендера');

  await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('token', t);
  }, token);
  await page.goto(`${CLONE}/#/tenders-registry`, { waitUntil: 'commit' });
  await page.waitForTimeout(3000);

  // Открываем карточку и жмём «Анализ Мимир» → «Запустить анализ».
  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } });
    const d = await r.json();
    window.AsgardRpReviewModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'analysis' });
    await new Promise((res) => setTimeout(res, 1800));
  }, id);

  await page.locator('#rpOpenMimir').click();
  await page.waitForSelector('.mst-modal', { timeout: 20000 });
  await page.waitForTimeout(1200);

  // Сбрасываем сессию, чтобы кнопка была «Запустить анализ», а не «Согласовать».
  const uid = await page.evaluate(async () => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch('/api/tkp-quick/sessions', { headers: { Authorization: auth } });
    const d = await r.json();
    return (d.sessions || [])[0]?.session_uid || null;
  });
  if (uid) {
    await fetch(`${CLONE}/api/tkp-quick/sessions/${uid}/stage/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ to: 'intake' })
    });
    await page.evaluate((u) => {
      window.AsgardMimirStages.close();
      window.AsgardMimirStages.open({ sessionUid: u, title: 'Анализ', subtitle: 'демо' });
    }, uid);
    await page.waitForSelector('.mst-modal', { timeout: 15000 });
    await page.waitForTimeout(1200);
  }

  const actionLabel = await page.locator('[data-main-action]').innerText();
  console.log('КНОПКА ЭТАПА:', actionLabel.trim());
  await page.locator('[data-main-action]').click();

  // Ждём до 2 минут: модель разбирает ТЗ.
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(5000);
    const txt = await page.locator('.mst-main').innerText().catch(() => '');
    if (/ПОЗИЦИЙ/i.test(txt) && !/Позиций пока нет/.test(txt)) break;
    if (await page.locator('.mst-error').count()) break;
  }
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '60-stages-dv.png') });
  const stageText = await page.locator('.mst-main').innerText().catch(() => '');
  console.log('ЭТАП:', stageText.slice(0, 400).replace(/\n+/g, ' | '));

  await page.evaluate(() => window.AsgardMimirStages.close());
  await page.waitForTimeout(1500);

  const blocks = await page.evaluate(() => ({
    dv: document.querySelectorAll('.rp-review-dv-block').length,
    dvRows: document.querySelectorAll('.rp-review-dv-table tbody tr').length,
    call: document.querySelectorAll('.rp-review-call-block').length,
    questions: document.querySelectorAll('.rp-review-call-list li').length,
    tech: document.querySelectorAll('.rp-review-tech-block').length
  }));
  console.log('БЛОКИ:', JSON.stringify(blocks));

  await page.screenshot({ path: path.join(OUT, '61-card-full.png'), fullPage: true });
  expect(blocks.dv, 'блок ДВ в карточке').toBeGreaterThan(0);
  expect(blocks.dvRows, 'строки ДВ заполнены').toBeGreaterThan(0);

  // Блок звонка обязателен: вопросы считаются на сервере из ТЗ и позиций,
  // поэтому он должен быть даже если модель не вернула своих вопросов.
  if (blocks.call === 0) {
    console.log('ВНИМАНИЕ: блок звонка пуст — проверяю, пришли ли вопросы с сервера');
    const callInfo = await page.evaluate(async () => {
      const auth = 'Bearer ' + localStorage.getItem('asgard_token');
      const r = await fetch('/api/tkp-quick/sessions', { headers: { Authorization: auth } });
      const d = await r.json();
      const uid = (d.sessions || [])[0]?.session_uid;
      const sr = await fetch(`/api/tkp-quick/sessions/${uid}/stage`, { headers: { Authorization: auth } });
      const sd = await sr.json();
      return {
        questions: (sd.call_questions || []).length,
        contact: sd.contact,
        positions: (sd.state?.positions || []).length
      };
    });
    console.log('СЕРВЕР:', JSON.stringify(callInfo));
  }
  expect(blocks.call, 'блок «позвоните клиенту»').toBeGreaterThan(0);
});
