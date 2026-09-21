#!/usr/bin/env node
'use strict';
/**
 * verify_d241_paper_kopecks_live.js — ЖИВОЙ гейт D-241 (vanilla-«бумага счёта»).
 *
 * Зачем: правка D-241 (копейки в «бумаге счёта» procurement-page.js) была помечена FIXED
 * по наличию строки `money2`, но живой UI округлял сумму до рубля: локальная обёртка
 * `money = (v) => fn(v)` теряла `opts`, поэтому `money2` не доносил `fractionDigits: 2`.
 * Независимый VER-1 поймал это вживую. Этот гейт проверяет ВЫЧИСЛЕННУЮ сумму в DOM, а не
 * наличие строки в файле — иначе класс «фикс мимо UI» проходит незамеченным.
 *
 * Проверяет реальный UI-путь: счёт в реестре → клик по карточке → модалка `.proc-pay-modal`
 * → блок `.proc-pay-paper` (`.proc-pay-paper__sum` + строка позиции).
 *
 * Запуск: TEST_BASE_URL=http://127.0.0.1:3100 DB_NAME=asgard_crm_test node tools/verify_d241_paper_kopecks_live.js
 */
const { chromium } = require('playwright');
const { Pool } = require('pg');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (DB_NAME === 'asgard_crm') { console.error('D-241 FAIL: прод-БД запрещена'); process.exit(1); }

const pool = new Pool({ host: '127.0.0.1', user: 'asgard', password: '123456789', database: DB_NAME });

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  [OK] ' + name + (detail ? ' — ' + String(detail).slice(0, 190) : '')); }
  else { fail++; fails.push(name); console.log('  [FAIL] ' + name + (detail ? ' — ' + String(detail).slice(0, 240) : '')); }
}

async function login(loginName) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password: 'Test123!' }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(loginName + ' login: ' + JSON.stringify(j).slice(0, 160));
  let token = j.token, user = j.user;
  if (j.status === 'need_pin') {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' }),
    }).then((x) => x.json());
    token = r2.token || token; user = r2.user || user;
  }
  return { token, user };
}

async function newPageWithUser(browser, token, user) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(({ t, u }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('auth_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u || {}));
    localStorage.setItem('asgard_pin_verified', 'true');
    localStorage.setItem('pin_unlocked_at', String(Date.now()));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
  }, { t: token, u: user });
  return { ctx, page: await ctx.newPage() };
}

// «987 654,32 ₽» / «987 654,32₽» / неразрывный пробел — принимаем любой.
const norm = (s) => String(s || '').replace(/[\u00a0\u202f\s]/g, ' ').trim();
// Копейки на месте: хвост вида «,32» рядом с тысячами. Проверяем именно дробную часть.
const hasKopecks = (s, tail) => new RegExp(',' + tail).test(norm(s));

(async () => {
  console.log('D-241: копейки в vanilla-«бумаге счёта». BASE=' + BASE + ' DB=' + DB_NAME);

  const buh = await login('test_buh');
  const admin = await login('test_admin');
  console.log('  роль: ' + buh.user.role);

  // Посев: счёт с ДРОБНОЙ суммой и дробной ценой позиции.
  const AMOUNT = 987654.32;
  const LINE_PRICE = 12345.67;
  const { rows: [pay] } = await pool.query(
    `INSERT INTO payment_invoices (supplier_name, amount, currency, status, payment_status, pay_timing,
                                   basis_type, basis_text, line_items_json, created_by, created_at, updated_at)
     VALUES ('ООО «D241-Копейки»', $1, 'RUB', 'awaiting_dir', 'none', 'immediate',
             'work', 'Проверка копеек в бумаге счёта',
             $2::jsonb, $3, NOW(), NOW()) RETURNING id`,
    [AMOUNT, JSON.stringify([{ name: 'Позиция с копейками', qty: 1, unit_price: LINE_PRICE }]), admin.user.id]
  );
  const payId = pay.id;
  console.log('  поставлен счёт #' + payId + ' на ' + AMOUNT + ' (позиция ' + LINE_PRICE + ')');

  const browser = await chromium.launch({ headless: true });
  try {
    const b = await newPageWithUser(browser, buh.token, buh.user);
    const errs = [];
    b.page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 150)));
    b.page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 150)); });

    await b.page.goto(BASE + '/#/payment-invoices', { waitUntil: 'load', timeout: 60000 });
    await b.page.waitForTimeout(4500);

    // Открываем модалку РЕАЛЬНОЙ кнопкой карточки (не подстановкой).
    const opened = await b.page.evaluate((id) => {
      const btn = Array.from(document.querySelectorAll('[data-pay-open]')).find((x) => Number(x.dataset.payOpen) === id);
      if (!btn) return { via: null, cards: Array.from(document.querySelectorAll('[data-pay-open]')).map((x) => x.dataset.payOpen) };
      btn.click();
      return { via: 'button' };
    }, payId);
    await b.page.waitForTimeout(2500);
    check('1. карточка счёта найдена и модалка открыта реальной кнопкой',
      opened.via === 'button', 'via=' + opened.via + ' cards=' + (opened.cards || []).join(','));

    const dom = await b.page.evaluate(() => {
      const m = document.querySelector('.proc-pay-modal');
      if (!m) return { found: false };
      const sum = m.querySelector('.proc-pay-paper__sum');
      const rows = Array.from(m.querySelectorAll('.proc-pay-paper__row')).map((r) => r.textContent.trim());
      const cells3 = Array.from(m.querySelectorAll('.proc-pay-paper__row')).map((r) => {
        const c = r.querySelectorAll('span'); return c.length >= 3 ? c[2].textContent.trim() : '';
      });
      return {
        found: true,
        paper: !!m.querySelector('[data-pay-paper]'),
        sumText: sum ? sum.textContent.trim() : null,
        rowTexts: rows,
        rowPrices: cells3,
      };
    });
    check('2. «бумага счёта» отрисована (.proc-pay-paper__sum есть)',
      dom.found && dom.paper && dom.sumText != null, JSON.stringify({ found: dom.found, paper: dom.paper, sum: dom.sumText }));

    check('3. сумма бумаги = БД по КОПЕЙКАМ (987 654,32)',
      hasKopecks(dom.sumText, '32') && /987 654/.test(norm(dom.sumText)),
      'UI="' + dom.sumText + '" нужно 987 654,32');

    const rowOk = dom.rowPrices.some((p) => hasKopecks(p, '67') && /12 345/.test(norm(p)));
    check('4. цена строки позиции = БД по КОПЕЙКАМ (12 345,67)',
      rowOk, 'prices=[' + dom.rowPrices.join(' | ') + '] нужно 12 345,67');

    check('5. 0 JS-ошибок в сессии', errs.length === 0, errs.slice(0, 2).join(' | ') || 'нет');
    await b.ctx.close();

    await pool.query('DELETE FROM payment_invoices WHERE id=$1', [payId]);
  } finally {
    await browser.close();
    await pool.end();
  }

  console.log('\nD-241 ИТОГ: PASS=' + pass + ' FAIL=' + fail);
  if (fail) { console.log('Провалы: ' + fails.join(' | ')); process.exit(1); }
  console.log('D-241 GREEN: «бумага счёта» в vanilla отдаёт суммы с копейками (проверено по DOM).');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
