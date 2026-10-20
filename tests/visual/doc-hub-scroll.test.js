'use strict';
/**
 * D-297: проверка, что сохранение карточки НЕ сбрасывает прокрутку.
 * Сценарий: открыть реестр, прокрутить вниз, открыть карточку, изменить дату,
 * сохранить — позиция скролла должна остаться прежней (допуск ±40px).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '..', 'reports', 'doc-hub-scroll');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0; let fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
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
  await page.waitForTimeout(4000);
  await page.evaluate(() => document.querySelectorAll('.pg-scene').forEach((e) => e.remove()));
  await page.waitForSelector('#dhTableHost', { timeout: 15000 });

  // Прокручиваем реальный контейнер (#layout, overflow:auto)
  const scrolled = await page.evaluate(() => {
    const el = document.getElementById('layout');
    if (!el) return -1;
    el.scrollTop = 500;
    return Math.round(el.scrollTop);
  });
  await page.waitForTimeout(500);
  const scrolledNow = await page.evaluate(() => Math.round(document.getElementById('layout').scrollTop));
  check('страница прокручена вниз', scrolledNow > 200, 'scrollTop=' + scrolledNow);

  const rowsBefore = await page.$$eval('#dhTableHost tbody tr[data-id]', (e) => e.length);
  check('строки таблицы есть', rowsBefore > 0, 'строк: ' + rowsBefore);

  // Открываем первую карточку и меняем дату оплаты
  await page.evaluate(() => {
    const tr = document.querySelector('#dhTableHost tbody tr[data-id]');
    if (tr) tr.click();
  });
  await page.waitForTimeout(2500);

  const drawerOpen = await page.$('#drPayDue');
  check('карточка документа открылась', !!drawerOpen);

  if (drawerOpen) {
    // Ставим дату (на день вперёд от текущего значения)
    await page.evaluate(() => {
      const el = document.querySelector('#drPayDue');
      el.value = '2027-03-15';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Сохраняем
    const saveBtn = await page.$('#dhDrawerSave');
    check('кнопка сохранения найдена', !!saveBtn);
    if (saveBtn) {
      await page.evaluate(() => {
        const b = document.querySelector('#dhDrawerSave');
        if (b) b.click();
      });
      await page.waitForTimeout(4000);

      const after = await page.evaluate(() => ({
        top: Math.round(document.getElementById('layout').scrollTop),
        rows: document.querySelectorAll('#dhTableHost tbody tr[data-id]').length,
      }));
      const drift = Math.abs(after.top - scrolledNow);
      check('после сохранения скролл НЕ прыгнул наверх', after.top > 200, 'scrollTop=' + after.top);
      check('позиция скролла сохранилась (±40px)', drift <= 40,
        `было=${scrolledNow}, стало=${after.top}, разница=${drift}`);
      check('таблица не пропала', after.rows > 0, 'строк: ' + after.rows);
      await page.screenshot({ path: path.join(OUT, '01-after-save.png') });
    }
  }

  const errs = jsErrors.filter((e) => !/favicon|404|Failed to load|ERR_/i.test(e));
  check('0 JS-ошибок', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\nИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
