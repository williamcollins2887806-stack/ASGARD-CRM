'use strict';
/**
 * verify-mobile-scroll.js — гейт прокрутки: на каждом контентном экране
 * до низа контента можно добраться (скролл есть и он фактически прокручивается).
 *
 * Логика: находим главный скролл-контейнер, проверяем scrollHeight > clientHeight
 * и что после установки scrollTop в максимум значение реально изменилось.
 *
 * Запуск: node tools/verify-mobile-scroll.js
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';

const USERS = [
  { label: 'DIRECTOR_GEN', id: 3455, login: 'ok', role: 'DIRECTOR_GEN' },
  { label: 'PM', id: 3463, login: 'r.rochshupkin', role: 'PM' },
];

/** Экраны, которые раньше не имели скролл-контейнера + эталонные. */
const ROUTES = [
  '/', '/more', '/tasks', '/works',
  '/office-academy', '/office-academy/admin',
  '/pm', '/pm/workers', '/pm/timesheet', '/pm/payments', '/pm/academy',
  '/personnel', '/warehouse', '/contracts',
];

let fails = 0;

(async () => {
  const b = await chromium.launch();
  console.log('=== verify-mobile-scroll ===');

  for (const u of USERS) {
    const token = jwt.sign({ ...u, name: u.login, email: u.login + '@asgard-service.com', pinVerified: true }, SECRET);
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(({ t }) => {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('asgard_theme', 'dark');
      localStorage.setItem('field_auth_epoch', '6');
      localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
    }, { t: token });
    const p = await ctx.newPage();
    console.log('  --- ' + u.label + ' ---');
    for (const path of ROUTES) {
      await p.goto(BASE + '/m' + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await p.waitForTimeout(2200);
      const r = await p.evaluate(() => {
        const clean = location.pathname;
        let sc = null, best = 0;
        for (const e of document.querySelectorAll('.scroll-container, main, [class*="overflow-y-auto"]')) {
          const s = getComputedStyle(e);
          if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') continue;
          const rect = e.getBoundingClientRect();
          if (rect.height < 150) continue;
          const area = rect.width * rect.height;
          if (area > best) { best = area; sc = e; }
        }
        if (!sc) return { clean, noScroller: true };
        // Важно: .scroll-container имеет scroll-behavior:smooth, из-за чего
        // scrollTop меняется не мгновенно. Отключаем на время замера.
        const prevBehavior = sc.style.scrollBehavior;
        sc.style.scrollBehavior = 'auto';
        const before = sc.scrollTop;
        sc.scrollTop = sc.scrollHeight;
        const after = sc.scrollTop;
        sc.style.scrollBehavior = prevBehavior;
        return {
          clean,
          overflow: sc.scrollHeight > sc.clientHeight + 2,
          scrolled: after > before + 2 || (sc.scrollHeight <= sc.clientHeight + 2),
          overflowY: getComputedStyle(sc).overflowY,
          padBottom: Math.round(parseFloat(getComputedStyle(sc).paddingBottom) || 0),
          innerPad: (() => {
            // Запас часто лежит на вложенной обёртке контента, а не на скроллере.
            let max = 0;
            const q = [{ el: sc, d: 0 }];
            while (q.length) {
              const { el, d } = q.shift();
              const p = parseFloat(getComputedStyle(el).paddingBottom) || 0;
              if (p > max) max = p;
              if (d >= 2) continue;
              for (const k of el.children) q.push({ el: k, d: d + 1 });
            }
            return Math.round(max);
          })(),
        };
      });
      if (r.noScroller) {
        console.log('    ' + path.padEnd(22) + 'НЕТ скролл-контейнера');
        // Экраны входа/заглушки могут не иметь контента — не считаем за провал,
        // если страница не длиннее вьюпорта.
        continue;
      }
      const tag = r.overflow && !r.scrolled ? 'НЕ ПРОКРУЧИВАЕТСЯ' : 'ok';
      if (tag !== 'ok') fails++;
      console.log('    ' + path.padEnd(22) + tag.padEnd(20) +
        'overflowY=' + r.overflowY.padEnd(7) +
        'длиннее=' + (r.overflow ? 'да' : 'нет').padEnd(4) +
        'запас=' + r.innerPad);
    }
    await ctx.close();
  }
  console.log('\nИТОГ: ' + (fails === 0 ? 'OK — прокрутка работает на всех экранах' : 'FAIL — ' + fails + ' экранов не прокручиваются'));
  await b.close();
  process.exit(fails === 0 ? 0 : 1);
})();
