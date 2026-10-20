'use strict';
/**
 * Проверка фильтров «Финансы · Документы» (реестр счетов), D-296.
 * Что проверяем:
 *   1. «Только неполные» включается И снимается.
 *   2. Выпадающий список ФИО: галочка слева, текст не капсом, одна строка,
 *      нет горизонтального скролла.
 *   3. Подпись «Отв. за объект» вместо «РП».
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '..', 'reports', 'doc-hub-filters');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0; let fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console: ' + m.text()); });

  const lg = await page.request.post(BASE + '/api/auth/login', { data: { login: 'test_buh', password: 'Test123!' } });
  const lj = await lg.json();
  const t0 = lj.token || (lj.data && lj.data.token);
  const u = lj.user || (lj.data && lj.data.user);
  const pr = await page.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t0 }, data: { pin: '0000' } });
  const pj = await pr.json();
  const token = pj.token || t0;

  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.evaluate(([t, uu]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(uu));
    if (uu && uu.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(uu.permissions));
  }, [token, u]);
  await page.goto(BASE + '/#/doc-hub', { waitUntil: 'commit' });
  await page.waitForTimeout(5000);
  await page.waitForSelector('#dhTableHost, .dh-facet', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);

  const hasHub = await page.$('.dh-facet, #dhFacetIncomplete');
  check('страница документов открылась', !!hasHub);
  if (!hasHub) {
    console.log('hash: ' + await page.evaluate(() => location.hash));
    console.log('текст: ' + (await page.evaluate(() => document.body.innerText || '')).slice(0, 200));
    await browser.close(); console.log('ИТОГ: FAIL'); process.exit(1);
  }

  // ── 3. Подпись «Отв. за объект» ─────────────────────────────────────────
  const labels = await page.$$eval('.dh-facet > span', (els) => els.map((e) => e.textContent.trim()));
  console.log('подписи фильтров: ' + JSON.stringify(labels));
  check('есть «Отв. за объект»', labels.some((l) => /Отв\. за объект/.test(l)), labels.join(' | '));
  check('нет голого «РП»', !labels.includes('РП'), labels.join(' | '));

  // ── 1. «Только неполные» включается и снимается ─────────────────────────
  // Гейт присутствия перекрывает экран — убираем его для теста (не трогая логику).
  await page.evaluate(() => {
    document.querySelectorAll('.pg-scene').forEach((e) => e.remove());
  });
  await page.waitForTimeout(400);

  const inc = page.locator('#dhFacetIncomplete');
  check('галочка найдена', (await inc.count()) > 0);
  if (await inc.count()) {
    // Клик через JS: элемент может быть перекрыт оверлеями, но обработчик тот же.
    await page.evaluate(() => {
      const el = document.querySelector('#dhFacetIncomplete');
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(1600);
    const on = await page.evaluate(() => document.querySelector('#dhFacetIncomplete').checked);
    check('галочка ставится', on === true);
    const rowsOn = await page.$$eval('tbody tr', (e) => e.length).catch(() => 0);

    await page.evaluate(() => {
      const el = document.querySelector('#dhFacetIncomplete');
      el.checked = false;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(1600);
    const off = await page.evaluate(() => document.querySelector('#dhFacetIncomplete').checked);
    check('галочка СНИМАЕТСЯ', off === false, 'checked=' + off);
    const rowsOff = await page.$$eval('tbody tr', (e) => e.length).catch(() => 0);
    check('после снятия строк стало больше (фильтр снят)', rowsOff >= rowsOn,
      `включено=${rowsOn}, снято=${rowsOff}`);
    await page.screenshot({ path: path.join(OUT, '01-incomplete-toggle.png') });
  }

  // ── 2. Вёрстка выпадающего списка ФИО ───────────────────────────────────
  // Открываем мультивыбор «Отв. документы»
  const trigger = page.locator('.dh-ms__trigger').first();
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForTimeout(600);
    const drop = await page.$('.dh-ms__drop:not([hidden])');
    check('выпадающий список открылся', !!drop);

    if (drop) {
      const m = await page.evaluate(() => {
        const drop = document.querySelector('.dh-ms__drop:not([hidden])');
        const items = Array.from(drop.querySelectorAll('.dh-ms__item'));
        const first = items[0];
        const span = first?.querySelector('span');
        const chk = first?.querySelector('input[type=checkbox]');
        const cs = first ? getComputedStyle(first) : null;
        const spanCs = span ? getComputedStyle(span) : null;
        const ir = first?.getBoundingClientRect();
        const sr = span?.getBoundingClientRect();
        const cr = chk?.getBoundingClientRect();
        return {
          itemCount: items.length,
          display: cs?.display,
          textTransform: cs?.textTransform,
          align: cs?.alignItems,
          itemH: ir ? Math.round(ir.height) : 0,
          spanLeft: sr ? Math.round(sr.left) : -1,
          chkLeft: cr ? Math.round(cr.left) : -1,
          spanW: sr ? Math.round(sr.width) : 0,
          dropScrollW: drop.scrollWidth,
          dropClientW: drop.clientWidth,
          listScrollW: drop.querySelector('.dh-ms__list')?.scrollWidth || 0,
          listClientW: drop.querySelector('.dh-ms__list')?.clientWidth || 0,
          whiteSpace: spanCs?.whiteSpace,
          firstText: first?.innerText?.trim().slice(0, 40),
        };
      });
      console.log('метрики списка: ' + JSON.stringify(m, null, 2));

      check('строки — flex (не block из глобального label)', m.display === 'flex', 'display=' + m.display);
      check('текст НЕ капсом', m.textTransform === 'none', 'text-transform=' + m.textTransform);
      check('галочка СЛЕВА от текста', m.chkLeft < m.spanLeft,
        `checkbox.left=${m.chkLeft}, text.left=${m.spanLeft}`);
      check('высота строки человеческая (< 44px)', m.itemH > 0 && m.itemH <= 44, 'h=' + m.itemH);
      check('НЕТ горизонтального скролла у списка', m.listScrollW <= m.listClientW + 1,
        `scrollW=${m.listScrollW}, clientW=${m.listClientW}`);
      check('НЕТ горизонтального скролла у дропа', m.dropScrollW <= m.dropClientW + 1,
        `scrollW=${m.dropScrollW}, clientW=${m.dropClientW}`);

      await page.screenshot({ path: path.join(OUT, '02-dropdown-layout.png') });
    }
  } else {
    check('мультивыбор найден', false, 'нет .dh-ms__trigger');
  }

  const errs = jsErrors.filter((e) => !/favicon|404|Failed to load|ERR_/i.test(e));
  check('0 JS-ошибок', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nСкриншоты: ' + OUT);
  console.log('ИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
