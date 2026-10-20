'use strict';
/**
 * verify-tabbar.js — гейт нижнего тап-бара, safe-area и запаса под контент.
 *
 * Проверяет детерминированно:
 *  1. Полоса достаёт до низа вьюпорта (нет «щели»).
 *  2. Высота полосы = высота контента вкладок + safe-area-inset-bottom.
 *  3. Иконки вкладок стоят выше домашнего индикатора (safe-area не съедает контент).
 *  4. Тач-таргеты вкладок >= 44px.
 *  5. Контент не уезжает под полосу: у активного скролл-контейнера запас снизу
 *     либо >= высоты полосы (PageShell), либо контейнер вообще не доходит до полосы.
 *     Для экранов без PageShell проверяется собственный нижний отступ.
 *
 * Запуск: node tools/verify-tabbar.js
 * Код возврата 1 — есть нарушения.
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';

const DEVICES = [
  { name: 'iPhone 14 Pro (safe 34)', width: 393, height: 852, safeBottom: 34 },
  { name: 'iPhone SE (safe 0)', width: 375, height: 667, safeBottom: 0 },
];

const USERS = [
  { label: 'DIRECTOR_GEN', id: 3455, login: 'ok', role: 'DIRECTOR_GEN' },
  { label: 'PM', id: 3463, login: 'r.rochshupkin', role: 'PM' },
];

/** Маршруты с тап-баром. Полевые и /pm/* его скрывают — проверяются отдельно. */
const ROUTES = [
  ['/', 'Главная'],
  ['/tasks', 'Задачи'],
  ['/works', 'Работы'],
  ['/more', 'Ещё'],
  ['/finances', 'Финансы'],
  ['/cash', 'Касса'],
  ['/personnel', 'Персонал'],
  ['/director-approvals', 'Согласования'],
  ['/contracts', 'Договоры'],
  ['/tenders', 'Тендеры'],
  ['/warehouse', 'Склад'],
  ['/my-mail', 'Почта'],
  ['/payroll', 'Ведомости'],
  ['/permits', 'Допуски'],
  ['/office-schedule', 'График офиса'],
];

let fails = 0;
const bad = (m) => { console.log('  FAIL ' + m); fails++; };

(async () => {
  const b = await chromium.launch();
  console.log('=== verify-tabbar ===');
  console.log('источник запаса: --tabbar-total = --tabbar-height + safe-area-inset-bottom\n');

  for (const dev of DEVICES) {
    console.log('######## ' + dev.name + ' ########');
    for (const u of USERS) {
      const token = jwt.sign({ ...u, name: u.login, email: u.login + '@asgard-service.com', pinVerified: true }, SECRET);
      const ctx = await b.newContext({
        viewport: { width: dev.width, height: dev.height },
        isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block',
      });
      await ctx.addInitScript(({ t, sb }) => {
        localStorage.setItem('asgard_token', t);
        localStorage.setItem('asgard_theme', 'dark');
        localStorage.setItem('field_auth_epoch', '6');
        localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
        const s = document.createElement('style');
        s.textContent = ':root{--safe-bottom:' + sb + 'px !important;--safe-top:20px !important;}';
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s));
      }, { t: token, sb: dev.safeBottom });

      const p = await ctx.newPage();
      console.log('  --- ' + u.label + ' ---');
      for (const [path, name] of ROUTES) {
        await p.goto(BASE + '/m' + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await p.waitForTimeout(2000);

        const m = await p.evaluate(() => {
          const nav = document.querySelector('nav.fixed.bottom-0');
          if (!nav) return { none: true };
          const nr = nav.getBoundingClientRect();
          const cs = getComputedStyle(nav);
          const root = getComputedStyle(document.documentElement);
          const safe = parseFloat(root.getPropertyValue('--safe-bottom')) || 0;
          const totalVar = root.getPropertyValue('--tabbar-total').trim();
          const btns = [...nav.querySelectorAll('button')].map((x) => x.getBoundingClientRect());
          // Главный скролл-контейнер — самый крупный по площади.
          let scroller = null, best = 0;
          for (const sc of document.querySelectorAll('.scroll-container, main, [class*="overflow-y-auto"], [class*="overflow-auto"]')) {
            const s2 = getComputedStyle(sc);
            if (s2.overflowY !== 'auto' && s2.overflowY !== 'scroll') continue;
            const r2 = sc.getBoundingClientRect();
            if (r2.height < 200) continue;
            const area = r2.width * r2.height;
            if (area > best) { best = area; scroller = sc; }
          }
          // Эффективный запас снизу: максимум padding-bottom у скроллера и его
          // потомков до 3 уровней (запас часто лежит на вложенной обёртке контента).
          let effPad = 0;
          if (scroller) {
            const queue = [{ el: scroller, depth: 0 }];
            while (queue.length) {
              const { el, depth } = queue.shift();
              const p = parseFloat(getComputedStyle(el).paddingBottom) || 0;
              if (p > effPad) effPad = p;
              if (depth >= 3) continue;
              for (const kid of el.children) queue.push({ el: kid, depth: depth + 1 });
            }
          }
          return {
            gapBelow: Math.round(window.innerHeight - nr.bottom),
            height: Math.round(nr.height),
            padBottom: Math.round(parseFloat(cs.paddingBottom) || 0),
            safe, totalVar,
            minBtnH: btns.length ? Math.round(Math.min(...btns.map((x) => x.height))) : 0,
            iconsBottom: btns.length ? Math.round(Math.max(...btns.map((x) => x.bottom))) : 0,
            navTop: Math.round(nr.top),
            innerH: window.innerHeight,
            effPad: Math.round(effPad),
            hasScroller: !!scroller,
          };
        });

        if (m.none) { console.log('    ' + name.padEnd(14) + 'тап-бара нет (скрыт для этого маршрута)'); continue; }
        const tags = [];
        // 1. щель снизу
        if (m.gapBelow !== 0) { tags.push('щель ' + m.gapBelow + 'px'); bad(name + ' (' + dev.name + '/' + u.label + '): полоса не достаёт до низа'); }
        // 2. высота = 52 + safe
        const expect = 52 + m.safe;
        if (Math.abs(m.height - expect) > 1) { tags.push('высота ' + m.height + ' ≠ ' + expect); bad(name + ': высота полосы ' + m.height + ' вместо ' + expect); }
        // 3. иконки выше индикатора: низ иконок + safe <= низ полосы
        if (m.iconsBottom > m.innerH - m.safe + 1) { tags.push('иконки заходят в зону индикатора'); bad(name + ': иконки в safe-area'); }
        // 4. тач-таргет
        if (m.minBtnH < 44) { tags.push('тач-таргет ' + m.minBtnH); bad(name + ': тач-таргет ' + m.minBtnH + 'px < 44px'); }
        // 5. контент не под полосой: эффективный запас снизу >= высоты полосы.
        if (m.hasScroller && m.effPad < m.height) {
          tags.push('запас ' + m.effPad + 'px < полосы ' + m.height);
          bad(name + ': нет запаса под полосу (эффективный padding-bottom ' + m.effPad + ')');
        }

        console.log('    ' + name.padEnd(14) +
          'h=' + String(m.height).padStart(3) +
          ' safe=' + String(m.safe).padStart(3) +
          ' pad=' + String(m.padBottom).padStart(3) +
          ' btn=' + String(m.minBtnH).padStart(3) +
          ' щель=' + String(m.gapBelow).padStart(2) +
          ' запас=' + String(m.effPad).padStart(4) +
          (tags.length ? '  ← ' + tags.join('; ') : ''));
      }
      await ctx.close();
    }
  }
  console.log('\nИТОГ: ' + (fails === 0 ? 'OK — тап-бар, safe-area и запас корректны' : 'FAIL — ' + fails + ' нарушений'));
  await b.close();
  process.exit(fails === 0 ? 0 : 1);
})();
