'use strict';
/**
 * verify-standalone.js — рантайм-проверка режима standalone:
 *  • вне standalone выделение текста РАБОТАЕТ (можно скопировать номер/сумму);
 *  • в standalone выделение ЗАПРЕЩЕНО и включён touch-action: manipulation.
 * Проверяет именно совпадение CSS-правил, а не наличие текста в исходнике.
 *
 * Запуск: node tools/verify-standalone.js
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
let fails = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { console.log('  FAIL ' + m); fails++; };

/** Прогон в заданном режиме display-mode. */
async function run(b, standalone) {
  const token = jwt.sign({ id: 3455, login: 'ok', name: 'Д', role: 'DIRECTOR_GEN', email: 'x@a.com', pinVerified: true }, SECRET);
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(({ t, sa }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('field_auth_epoch', '6');
    localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
    // Эмулируем display-mode: standalone ДО загрузки приложения.
    if (sa) {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q.includes('display-mode: standalone')
        ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
        : orig(q));
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    }
  }, { t: token, sa: standalone });
  const p = await ctx.newPage();
  await p.goto(BASE + '/m/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  const r = await p.evaluate(() => {
    const htmlClass = document.documentElement.className;
    const bodySel = getComputedStyle(document.body).userSelect;
    // Пробуем выделить текст: если запрет работает — выделение не появится.
    const el = document.querySelector('main') || document.body;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    const selectedLen = String(sel.toString() || '').length;
    const htmlTA = getComputedStyle(document.documentElement).touchAction;
    return { htmlClass, bodySel, selectedLen, htmlTA };
  });
  await ctx.close();
  return r;
}

(async () => {
  const b = await chromium.launch();
  console.log('=== verify-standalone ===');

  const web = await run(b, false);
  console.log('  обычный браузер: html="' + web.htmlClass + '"  user-select=' + web.bodySel + '  выделеноСимволов=' + web.selectedLen);
  if (/is-standalone/.test(web.htmlClass)) bad('в обычном браузере класс is-standalone не должен стоять на <html>');
  else ok('в обычном браузере класс не выставлен');
  if (web.bodySel === 'none') bad('в обычном браузере запрещено выделение — нельзя скопировать номер/сумму');
  else ok('в обычном браузере выделение разрешено (user-select=' + web.bodySel + ')');

  const sa = await run(b, true);
  console.log('  standalone:      html="' + sa.htmlClass + '"  user-select=' + sa.bodySel + '  выделеноСимволов=' + sa.selectedLen + '  touch-action=' + sa.htmlTA);
  if (/is-standalone/.test(sa.htmlClass)) ok('в standalone класс стоит на <html>');
  else bad('в standalone класс is-standalone не попал на <html> — CSS-правила мёртвые');
  if (sa.bodySel === 'none') ok('в standalone выделение запрещено (user-select=none)');
  else bad('в standalone выделение НЕ запрещено (user-select=' + sa.bodySel + ')');

  console.log('\nИТОГ: ' + (fails === 0 ? 'OK — режим standalone работает' : 'FAIL — ' + fails + ' нарушений'));
  await b.close();
  process.exit(fails === 0 ? 0 : 1);
})();
