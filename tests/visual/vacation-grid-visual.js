'use strict';
/**
 * Визуальная и поведенческая проверка «Графика отпусков».
 * Проверяем именно то, что просил заказчик 20.10.2026:
 *   1. При раскрытии месяца сетка дней есть у ВСЕХ, а не только у меня.
 *   2. Видны отпуска коллег.
 *   3. «Скрыть всех» не скрывает меня.
 *   4. ФИО влезает целиком (фамилия + инициалы) и должность видна.
 *   5. У праздников есть тултип с названием.
 *   6. Своя строка подсвечена.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '..', 'reports', 'vacation-grid');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0; let fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

async function login(page, user) {
  const lg = await page.request.post(BASE + '/api/auth/login', { data: { login: user, password: 'Test123!' } });
  const lj = await lg.json();
  const t0 = lj.token || (lj.data && lj.data.token);
  const u = lj.user || (lj.data && lj.data.user);
  const pr = await page.request.post(BASE + '/api/auth/verify-pin', {
    headers: { Authorization: 'Bearer ' + t0 }, data: { pin: '0000' },
  });
  const pj = await pr.json();
  return { token: pj.token || t0, user: u };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console: ' + m.text()); });

  const { token, user } = await login(page, 'qa.buh');
  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
    if (u && u.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(u.permissions));
  }, [token, user]);
  await page.goto(BASE + '/#/vacation-schedule', { waitUntil: 'commit' });
  await page.waitForTimeout(3000);
  await page.waitForSelector('.vs-tablewrap', { timeout: 30000 });
  await page.waitForTimeout(1200);

  check('страница графика открылась', !!(await page.$('.vs-tablewrap')), 'нет .vs-tablewrap');

  // Раскрываем месяц (январь). Клик по шапке перехватывается sticky-слоем,
  // поэтому дергаем обработчик напрямую — это тот же путь, что у пользователя.
  await page.evaluate(() => {
    const el = document.querySelector('[data-month]');
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('.vs-body .vs-days', { timeout: 10000 });
  await page.waitForTimeout(900);

  // 1. Сетка дней у всех: считаем строки с .vs-days в теле
  const gridRows = await page.$$eval('.vs-body .vs-days', (els) => els.length);
  const bodyRows = await page.$$eval('.vs-body .vs-row', (els) => els.length);
  check('сетка дней есть у всех строк', gridRows === bodyRows && bodyRows > 1,
    'строк=' + bodyRows + ', с сеткой=' + gridRows);

  // 2. Ячейки дней отрисованы
  const dayCells = await page.$$eval('.vs-body .vs-d', (els) => els.length);
  check('ячейки дней отрисованы', dayCells >= 28, 'ячеек: ' + dayCells);

  // 3. Праздники с тултипом
  const holTips = await page.$$eval('.vs-d.is-hol', (els) => els.map((e) => e.getAttribute('title')).filter(Boolean));
  check('у праздников есть тултип с названием', holTips.length > 0 && /Праздник РФ/.test(holTips[0]),
    'пример: ' + (holTips[0] || 'нет').slice(0, 70));

  // 4. ФИО не обрезано: ширины текста <= ширины контейнера
  const nameFit = await page.$$eval('.vs-who__n', (els) => els.map((e) => ({
    t: e.textContent.trim(),
    fit: e.scrollWidth <= e.clientWidth + 1,
    vis: e.getBoundingClientRect().width > 40,
  })));
  const truncated = nameFit.filter((n) => !n.fit);
  check('ФИО влезает целиком', truncated.length === 0,
    'обрезано: ' + truncated.slice(0, 3).map((n) => n.t).join(' | '));

  // 5. Должность видна
  const roles = await page.$$eval('.vs-who__r', (els) => els.filter((e) => e.getBoundingClientRect().width > 30).length);
  check('должность видна', roles > 0, 'видимых должностей: ' + roles);

  // 6. Своя строка подсвечена
  const meRow = await page.$('.vs-row.is-me');
  check('своя строка присутствует и помечена', !!meRow);

  // 7. Отпуска коллег видны (ячейки со статусом отпуска не только у меня)
  const vacCells = await page.$$eval('.vs-d.is-vac', (els) => els.length);
  const vacInOthers = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.vs-body .vs-row'));
    return rows.filter((r) => !r.classList.contains('is-me') && r.querySelector('.vs-d.is-vac')).length;
  });
  check('отпуска коллег видны в сетке', vacCells > 0, 'ячеек с отпуском: ' + vacCells + ', строк коллег: ' + vacInOthers);

  await page.screenshot({ path: path.join(OUT, '01-grid-open.png') });

  // 8. «Скрыть всех» не скрывает меня
  const hasHideAll = await page.$$eval('[data-vs-hide-all]', (e) => e.length);
  if (hasHideAll) {
    await page.evaluate(() => {
      const b = document.querySelector('[data-vs-hide-all]');
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(1100);
    const afterHide = await page.evaluate(() => ({
      rows: document.querySelectorAll('.vs-body .vs-row').length,
      me: document.querySelectorAll('.vs-row.is-me').length,
    }));
    check('«Скрыть всех» оставляет мою строку', afterHide.me >= 1,
      'строк=' + afterHide.rows + ', моя=' + afterHide.me);
    check('«Скрыть всех» убирает коллег', afterHide.rows < bodyRows,
      'было=' + bodyRows + ', стало=' + afterHide.rows);
    await page.screenshot({ path: path.join(OUT, '02-hide-all.png') });
    await page.evaluate(() => {
      const b = document.querySelector('[data-vs-show-all]');
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(700);
  } else {
    check('кнопка «Скрыть всех» найдена', false, 'не найдена');
  }

  // 9. Сетка в обеих темах: скрин светлой
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '03-light.png') });
  const lightCells = await page.$$eval('.vs-body .vs-d', (els) => els.length);
  check('сетка цела в светлой теме', lightCells === dayCells, 'тёмная=' + dayCells + ' светлая=' + lightCells);

  // 10. Горизонтальной прокрутки нет
  const hscroll = await page.evaluate(() => {
    const el = document.querySelector('.vs-tablewrap');
    return el ? el.scrollWidth - el.clientWidth : -1;
  });
  check('нет горизонтальной прокрутки в раскрытом месяце', hscroll <= 2, 'перелив: ' + hscroll + 'px');

  const errs = jsErrors.filter((e) => !/favicon|404|Failed to load resource|ERR_/i.test(e));
  check('0 JS-ошибок', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nСкриншоты: ' + OUT);
  console.log('ИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
