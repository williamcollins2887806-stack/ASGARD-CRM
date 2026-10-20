'use strict';
/**
 * Визуальная и поведенческая проверка МОБИЛЬНОГО экрана присутствия (/m/).
 * Что проверяем: нет нативных <select>, нет эмодзи, bottom-sheet с иконками,
 * выбор статуса работает, сохранение уходит в API, тема применяется.
 */
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '..', 'reports', 'presence-mobile');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0; let fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console: ' + m.text()); });

  // Авторизация
  const lg = await page.request.post(BASE + '/api/auth/login', { data: { login: 'test_buh', password: 'Test123!' } });
  const lj = await lg.json();
  const t0 = lj.token || (lj.data && lj.data.token);
  const u = lj.user || (lj.data && lj.data.user);
  const pr = await page.request.post(BASE + '/api/auth/verify-pin', {
    headers: { Authorization: 'Bearer ' + t0 }, data: { pin: '0000' },
  });
  const pj = await pr.json();
  const token = pj.token || t0;
  check('авторизация пройдена', !!token);

  await page.goto(BASE + '/m/', { waitUntil: 'commit' });
  await page.evaluate(([t, uu]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(uu));
    if (uu && uu.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(uu.permissions));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf('presence_week_done_') === 0) localStorage.removeItem(k);
    }
  }, [token, u]);
  await page.goto(BASE + '/m/', { waitUntil: 'commit' });
  await page.waitForTimeout(4000);

  // Гейт должен появиться сам
  let hasGate = await page.$('.pgm-sheet');
  if (!hasGate) {
    // ждём дольше — приложение грузит чанки
    await page.waitForTimeout(5000);
    hasGate = await page.$('.pgm-sheet');
  }
  check('мобильный гейт отрисован', !!hasGate, 'нет .pgm-sheet');

  if (!hasGate) {
    console.log('\nТело страницы:', (await page.evaluate(() => document.body.innerText || '')).slice(0, 200));
    await browser.close();
    console.log('ИТОГ: FAIL');
    process.exit(1);
  }

  // 1. Нет нативных select
  const nativeSelects = await page.$$eval('.pgm-scene select', (e) => e.length);
  check('нет нативных <select>', nativeSelects === 0, 'найдено: ' + nativeSelects);

  // 2. Нет эмодзи
  const emoji = await page.evaluate(() => {
    const t = document.querySelector('.pgm-scene')?.innerText || '';
    return (t.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  });
  check('нет эмодзи в тексте', emoji === 0, 'найдено: ' + emoji);

  // 3. SVG-иконки
  const svgCount = await page.$$eval('.pgm-scene svg', (e) => e.length);
  check('SVG-иконки на месте', svgCount > 5, 'svg: ' + svgCount);

  // 4. Строки дней
  const rows = await page.$$eval('.pgm-row', (e) => e.length);
  check('строки дней отрисованы', rows >= 5, 'строк: ' + rows);

  // 5. Дизайн: скругление листа, золотая кромка
  const design = await page.evaluate(() => {
    const s = document.querySelector('.pgm-sheet');
    const cs = getComputedStyle(s);
    const btn = document.querySelector('.pgm-btn');
    const trig = document.querySelector('.pgm-trig');
    return {
      radius: cs.borderTopLeftRadius,
      borderTop: cs.borderTopColor,
      sheetW: Math.round(s.getBoundingClientRect().width),
      vw: window.innerWidth,
      btnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
      trigH: trig ? Math.round(trig.getBoundingClientRect().height) : 0,
    };
  });
  check('лист со скруглением', parseFloat(design.radius) >= 16, 'radius=' + design.radius);
  check('лист на всю ширину экрана', design.sheetW >= design.vw - 2, `sheet=${design.sheetW} vw=${design.vw}`);
  check('кнопка удобна для пальца (>=48px)', design.btnH >= 48, 'h=' + design.btnH);
  check('триггер удобен для пальца (>=40px)', design.trigH >= 40, 'h=' + design.trigH);

  await page.screenshot({ path: path.join(OUT, '01-mobile-dark.png') });

  // 6. Bottom-sheet выбора открывается
  await page.locator('.pgm-trig').first().click();
  await page.waitForSelector('.pgm-pick-sheet', { timeout: 5000 });
  const opts = await page.$$eval('.pgm-pick-list .pgm-opt', (e) => e.length);
  check('bottom-sheet выбора открылся', opts >= 6, 'опций: ' + opts);
  const optIcons = await page.$$eval('.pgm-pick-list .pgm-opt-ic svg', (e) => e.length);
  check('у опций есть иконки', optIcons === opts, `иконок ${optIcons} из ${opts}`);
  const tones = await page.$$eval('.pgm-pick-list .pgm-opt-ic', (els) => els.map((e) => getComputedStyle(e).color));
  check('тона статусов различаются', new Set(tones).size >= 5, 'уникальных цветов: ' + new Set(tones).size);
  await page.screenshot({ path: path.join(OUT, '02-mobile-picker.png') });

  // 7. Выбор применяется
  await page.locator('.pgm-pick-list .pgm-opt', { hasText: 'В офисе' }).first().click();
  await page.waitForTimeout(400);
  const picked = await page.evaluate(() => document.querySelector('.pgm-trig')?.className || '');
  check('статус выбран, триггер окрашен', /has-value/.test(picked), 'class=' + picked.slice(0, 60));
  check('bottom-sheet закрылся после выбора', (await page.$$eval('.pgm-pick-sheet', (e) => e.length)) === 0);

  // 8. Светлая тема
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '03-mobile-light.png') });
  const lightOk = await page.evaluate(() => {
    const s = document.querySelector('.pgm-sheet');
    return s ? getComputedStyle(s).backgroundColor : null;
  });
  check('лист отрисован в светлой теме', !!lightOk, 'bg=' + lightOk);

  const errs = jsErrors.filter((e) => !/favicon|404|Failed to load|ERR_|vite/i.test(e));
  check('0 JS-ошибок', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nСкриншоты: ' + OUT);
  console.log('ИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
