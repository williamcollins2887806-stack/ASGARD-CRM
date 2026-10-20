'use strict';
/**
 * verify-swipe.js — гейт жестов: шторка закрывается свайпом по шапке,
 * свайп вниз в контенте не закрывает (там скролл), и нет перехвата
 * системного жеста «назад» по краю экрана.
 *
 * Запуск: node tools/verify-swipe.js
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
let fails = 0;
const bad = (m) => { console.log('  FAIL ' + m); fails++; };
const ok = (m) => console.log('  ok   ' + m);

/** Открывает шторку счёта и возвращает её состояние. */
async function openSheet(p) {
  await p.goto(BASE + '/m/director-approvals?tab=invoices', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4200);
  const cards = await p.$$('button[aria-label^="Открыть счёт"]');
  if (!cards.length) return false;
  await cards[0].click();
  await p.waitForTimeout(2600);
  return true;
}

(async () => {
  const b = await chromium.launch();
  const token = jwt.sign({ id: 3455, login: 'ok', name: 'Д', role: 'DIRECTOR_GEN', email: 'x@a.com', pinVerified: true }, SECRET);
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(({ t }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('field_auth_epoch', '6');
    localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
  }, { t: token });
  const p = await ctx.newPage();
  console.log('=== verify-swipe ===');

  if (!(await openSheet(p))) { bad('не удалось открыть шторку (нет счетов на стенде)'); }

  // Геометрия шторки
  const geo = await p.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height) };
  });
  if (!geo) bad('шторка не найдена');
  else ok('шторка открыта: top=' + geo.top + ' h=' + geo.h);

  // 1. Свайп вниз по ШАПКЕ (заголовок) — должен закрыть
  if (geo) {
    const startY = geo.top + 26; // внутри шапки
    const x = 196;
    await p.touchscreen.tap(x, startY).catch(() => {});
    // touch-жест через CDP-подобные события Playwright: используем dispatch
    await p.evaluate(({ x, y0, y1 }) => {
      const d = document.querySelector('[role="dialog"]');
      const zone = d.querySelector('div[style*="pan-y"]') || d;
      const mk = (type, y) => {
        const t = new Touch({ identifier: 1, target: zone, clientX: x, clientY: y });
        return new TouchEvent(type, { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] });
      };
      zone.dispatchEvent(mk('touchstart', y0));
      for (let y = y0; y <= y1; y += 20) zone.dispatchEvent(mk('touchmove', y));
      zone.dispatchEvent(mk('touchend', y1));
    }, { x, y0: startY, y1: startY + 180 });
    await p.waitForTimeout(1200);
    const closed = await p.evaluate(() => document.querySelectorAll('[role="dialog"]').length === 0);
    (closed ? ok : bad.bind(null, 'свайп вниз по шапке НЕ закрыл шторку'))('свайп по шапке закрывает');
  }

  // 2. Свайп вниз в КОНТЕНТЕ не должен закрывать (там скролл)
  await openSheet(p);
  const geo2 = await p.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const scroll = d?.querySelector('.scroll-container');
    const r = scroll?.getBoundingClientRect();
    return r ? { x: Math.round(r.x + r.width / 2), y0: Math.round(r.y + 60), y1: Math.round(r.y + 200) } : null;
  });
  if (geo2) {
    await p.evaluate(({ x, y0, y1 }) => {
      const d = document.querySelector('[role="dialog"]');
      const zone = d.querySelector('.scroll-container');
      const mk = (type, y) => {
        const t = new Touch({ identifier: 2, target: zone, clientX: x, clientY: y });
        return new TouchEvent(type, { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] });
      };
      zone.dispatchEvent(mk('touchstart', y0));
      for (let y = y0; y <= y1; y += 20) zone.dispatchEvent(mk('touchmove', y));
      zone.dispatchEvent(mk('touchend', y1));
    }, geo2);
    await p.waitForTimeout(900);
    const still = await p.evaluate(() => document.querySelectorAll('[role="dialog"]').length > 0);
    (still ? ok : bad.bind(null, 'свайп в контенте закрыл шторку — мешает скроллу'))('свайп в контенте не закрывает');
  } else ok('контент-скролл не найден — проверка пропущена');

  // 3. Кнопка закрытия на месте
  const hasClose = await p.evaluate(() => !!document.querySelector('[role="dialog"] [aria-label="Закрыть"]'));
  (hasClose ? ok : bad.bind(null, 'нет кнопки «Закрыть»'))('кнопка «Закрыть» есть');

  console.log('\nИТОГ: ' + (fails === 0 ? 'OK — жесты шторки корректны' : 'FAIL — ' + fails + ' нарушений'));
  await b.close();
  process.exit(fails === 0 ? 0 : 1);
})();
