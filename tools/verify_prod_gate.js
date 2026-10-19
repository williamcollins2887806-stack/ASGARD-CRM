'use strict';
// Пройти экран выбора темы и проверить гейт присутствия на проде.
const { chromium } = require('playwright');
const PROD = process.env.PROD_URL || 'https://92.242.61.184';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));

  await page.goto(PROD + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);

  // клик по светлой теме
  const picked = await page.evaluate(() => {
    const card = document.querySelector('.ats-theme-card[data-theme="light"]');
    if (!card) return { ok: false, reason: 'нет карточки light' };
    card.click();
    return { ok: true };
  });
  await page.waitForTimeout(800);
  const cont = await page.evaluate(() => {
    const btn = document.getElementById('atsContinue');
    if (!btn) return { ok: false };
    if (btn.disabled) return { ok: false, disabled: true };
    btn.click();
    return { ok: true };
  });
  await page.waitForTimeout(5000);

  const res = await page.evaluate(() => {
    const txt = document.body.innerText;
    const moji = (txt.match(/[\u2568\u2564\u2565]/g) || []).length;
    const fffd = (txt.match(/\ufffd/g) || []).length;
    const gateMatch = txt.match(/[^\n]*(рабочую неделю|держать строй)[^\n]*/i);
    const days = [...document.querySelectorAll('#pg-days > *, .pg-day')].slice(0, 6)
      .map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 40));
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      moji, fffd,
      gateText: gateMatch ? gateMatch[0].slice(0, 120) : '(нет)',
      daysCount: document.querySelectorAll('#pg-days > *').length,
      days,
      bodySample: txt.slice(0, 300).replace(/\s+/g, ' ')
    };
  });
  console.log('picked:', JSON.stringify(picked), 'continue:', JSON.stringify(cont));
  console.log(JSON.stringify(res, null, 1));
  await page.screenshot({ path: 'tests/reports/full-audit/prod-gate.png' });
  console.log('JS-ошибки:', errs.length, errs.slice(0, 3));
  await b.close();
})();
