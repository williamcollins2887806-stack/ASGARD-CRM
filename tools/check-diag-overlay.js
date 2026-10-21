'use strict';
/**
 * check-diag-overlay.js — проверяет, что диагностическая панель:
 *   • НЕ показывается обычным пользователям (без ?diag=1);
 *   • ПОКАЗЫВАЕТСЯ с ?diag=1 и выводит реальные метрики;
 *   • скрывается кнопкой «Скрыть».
 *
 * Запуск: node tools/check-diag-overlay.js
 */
const { webkit } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';

(async () => {
  const b = await webkit.launch();
  const token = jwt.sign({ id: 3455, login: 'ok', name: 'Д', role: 'DIRECTOR_GEN', email: 'x@a.com', pinVerified: true }, SECRET);
  let fails = 0;
  const ok = (m) => console.log('  ok   ' + m);
  const bad = (m) => { console.log('  FAIL ' + m); fails++; };

  console.log('=== check-diag-overlay ===');

  for (const [label, url, expect] of [
    ['без ?diag=1', '/m/', false],
    ['с ?diag=1', '/m/?diag=1', true],
  ]) {
    const ctx = await b.newContext({ viewport: { width: 414, height: 896 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(({ t }) => {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('asgard_theme', 'light');
      localStorage.setItem('field_auth_epoch', '6');
      localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
      localStorage.removeItem('asgard_diag');
    }, { t: token });
    const p = await ctx.newPage();
    await p.goto(BASE + url, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3200);

    const r = await p.evaluate(() => {
      const txt = document.body.innerText;
      const el = [...document.querySelectorAll('div')].find((d) => /ДИАГНОСТИКА iOS/.test(d.textContent || '') && d.style.position === 'fixed');
      return {
        visible: /ДИАГНОСТИКА iOS/.test(txt),
        hasClose: !!el && [...el.querySelectorAll('button')].some((x) => /Скрыть/.test(x.textContent)),
        text: (el ? el.innerText : txt).replace(/\n+/g, ' | ').slice(0, 420),
      };
    });

    if (r.visible === expect) ok(label + ' → панель ' + (expect ? 'показана' : 'скрыта'));
    else bad(label + ' → панель ' + (r.visible ? 'показана' : 'скрыта') + ', ожидалось ' + (expect ? 'показана' : 'скрыта'));

    if (expect) {
      console.log('      ' + r.text);
      if (r.hasClose) ok('есть кнопка «Скрыть»');
      else bad('нет кнопки «Скрыть»');
      // Кнопка реально убирает панель
      if (r.hasClose) {
        await p.locator('button', { hasText: 'Скрыть' }).first().click();
        await p.waitForTimeout(700);
        const gone = await p.evaluate(() => !/ДИАГНОСТИКА iOS/.test(document.body.innerText));
        if (gone) ok('кнопка «Скрыть» убирает панель');
        else bad('кнопка «Скрыть» не убрала панель');
      }
    }
    await ctx.close();
  }

  console.log('\nИТОГ: ' + (fails === 0 ? 'OK — панель работает и скрыта от пользователей' : 'FAIL — ' + fails + ' нарушений'));
  await b.close();
  process.exit(fails === 0 ? 0 : 1);
})();
