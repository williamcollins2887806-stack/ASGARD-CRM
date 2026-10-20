'use strict';
/**
 * Живая проверка прода после выкатки 20.28.249.
 * Не трогаем данные: только читаем страницу и меряем DOM.
 */
const { chromium } = require('playwright');

const BASE = process.env.PROD_URL || 'http://92.242.61.184';
let pass = 0; let fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.url().includes('presence_week') || r.url().includes('presence-week') || r.url().includes('vacation_schedule')) {
      check('ассет ' + r.url().split('/').pop().split('?')[0] + ' → ' + r.status(), r.status() === 200);
    }
  });

  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 45000 });
  await page.waitForTimeout(2500);

  const v = await page.evaluate(() => window.ASGARD_SHELL_VERSION || null);
  check('версия оболочки на проде = 20.28.249', v === '20.28.249', 'version=' + v);

  const hasComp = await page.evaluate(() => typeof window.AsgardPresenceWeek);
  if (hasComp !== 'object') {
    // defer-скрипт мог не дойти к моменту замера — ждём явно.
    await page.waitForFunction(() => typeof window.AsgardPresenceWeek === 'object', null, { timeout: 15000 }).catch(() => {});
  }
  const hasComp2 = await page.evaluate(() => typeof window.AsgardPresenceWeek);
  check('компонент присутствия загружен', hasComp2 === 'object', 'typeof=' + hasComp2);

  const linkOk = await page.evaluate(() => {
    const css = Array.from(document.querySelectorAll('link[rel=stylesheet]')).some((l) => l.href.includes('presence-week'));
    const js = Array.from(document.querySelectorAll('script[src]')).some((s) => s.src.includes('presence_week'));
    return { css, js };
  });
  check('presence-week.css подключён', linkOk.css);
  check('presence_week.js подключён', linkOk.js);

  // Меню: пункта «График отпусков» быть не должно (открывается кнопкой)
  const menuHasVac = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return /График отпусков/.test(t);
  });
  console.log('INFO: «График отпусков» в тексте главной: ' + menuHasVac);

  const realErrors = jsErrors.filter((e) => !/favicon|404|Failed to load|ERR_/i.test(e));
  check('0 JS-ошибок на проде', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
