'use strict';
/**
 * verify-tabbar.js — гейт нижнего тап-бара, safe-area и запаса под контент.
 *
 * Запускается на WebKit (движок Safari), а не на Chromium: только WebKit даёт
 * поведение env(safe-area-inset-*) и dynamic viewport, близкое к iOS.
 *
 * Проверяет:
 *  1. Полоса достаёт до низа вьюпорта (нет «щели»).
 *  2. Высота полосы = высота контента вкладок + safe-area-inset-bottom.
 *  3. Иконки вкладок стоят выше домашнего индикатора (safe-area не съедает контент).
 *  4. Тач-таргеты вкладок >= 44px.
 *  5. Контент не уезжает под полосу: запас снизу >= высоты полосы.
 *  6. Позиция полосы сохраняется при смене высоты вьюпорта (панели Safari).
 *
 * Запуск: node tools/verify-tabbar.js
 * Код возврата 1 — есть нарушения.
 */
const { webkit } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';

/**
 * Профили устройств заказчика и крайние случаи.
 * iPhone 11 (414×896) — телефон пользователя; iPhone 14 Pro (393×852) — директора.
 */
const DEVICES = [
  { name: 'iPhone 11 (414x896, safe 34)', width: 414, height: 896, safeBottom: 34, safeTop: 44 },
  { name: 'iPhone 14 Pro (393x852, safe 34)', width: 393, height: 852, safeBottom: 34, safeTop: 59 },
  { name: 'iPhone 12 mini (375x812, safe 34)', width: 375, height: 812, safeBottom: 34, safeTop: 44 },
  { name: 'iPhone SE (375x667, safe 0)', width: 375, height: 667, safeBottom: 0, safeTop: 20 },
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
  const b = await webkit.launch();
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

      // Отдельная проверка устойчивости: смена высоты вьюпорта = панели Safari.
      // Раньше это не проверялось вовсе, из-за чего дефект «полоса под тап-баром»
      // проходил зелёным.
      await p.goto(BASE + '/m/', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await p.waitForTimeout(2600);
      let driftFail = false;
      for (const h of [dev.height, Math.round(dev.height * 0.92), dev.height]) {
        await p.setViewportSize({ width: dev.width, height: h });
        await p.waitForTimeout(500);
        const g = await p.evaluate(() => {
          const nav = document.querySelector('nav.fixed.bottom-0');
          if (!nav) return null;
          const r = nav.getBoundingClientRect();
          const vv = window.visualViewport;
          return {
            inner: window.innerHeight,
            gap: Math.round(window.innerHeight - r.bottom),
            gapVisual: vv ? Math.round((vv.height + vv.offsetTop - r.bottom) * 100) / 100 : null,
          };
        });
        if (!g) break;
        if (g.gap !== 0 || (g.gapVisual !== null && Math.abs(g.gapVisual) > 1)) {
          bad(dev.name + ' / ' + u.label + ': при высоте ' + h + ' бар отстал (щель ' + g.gap + ', до visual ' + g.gapVisual + ')');
          driftFail = true;
        }
      }
      if (!driftFail) console.log('    ok   ' + dev.name + ': бар не отстаёт при смене высоты вьюпорта');

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
            // Ключевой показатель для iOS: привязка не к body, а к вьюпорту.
            // Если низ бара отстаёт от низа visualViewport — на iPhone появится
            // полоса фона (класс дефекта 20.10.2026).
            gapToVisual: (() => {
              const vv = window.visualViewport;
              if (!vv) return null;
              return Math.round((vv.height + vv.offsetTop - nr.bottom) * 100) / 100;
            })(),
            bodyPos: getComputedStyle(document.body).position,
            htmlPos: getComputedStyle(document.documentElement).position,
          };
        });

        if (m.none) { console.log('    ' + name.padEnd(14) + 'тап-бара нет (скрыт для этого маршрута)'); continue; }
        const tags = [];
        // 1. щель до низа layout-вьюпорта
        if (m.gapBelow !== 0) { tags.push('щель ' + m.gapBelow + 'px'); bad(name + ' (' + dev.name + '/' + u.label + '): полоса не достаёт до низа'); }
        // 1b. щель до низа VISUAL viewport — именно она даёт полосу на iPhone,
        //     когда Safari показывает свои панели.
        if (m.gapToVisual !== null && Math.abs(m.gapToVisual) > 1) {
          tags.push('до visual ' + m.gapToVisual + 'px');
          bad(name + ' (' + dev.name + '): низ бара не совпал с visualViewport на ' + m.gapToVisual + 'px');
        }
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
        // 6. position:fixed на html/body превращает body в containing block для
        //    тап-бара — на iOS это отрывает его от низа. Запрещаем явно.
        if (/fixed/.test(m.bodyPos) || /fixed/.test(m.htmlPos)) {
          tags.push('body/html position:fixed');
          bad(name + ': position:fixed на html/body — отрывает тап-бар от вьюпорта');
        }

        console.log('    ' + name.padEnd(14) +
          'h=' + String(m.height).padStart(3) +
          ' safe=' + String(m.safe).padStart(3) +
          ' pad=' + String(m.padBottom).padStart(3) +
          ' btn=' + String(m.minBtnH).padStart(3) +
          ' щель=' + String(m.gapBelow).padStart(2) +
          ' visual=' + String(m.gapToVisual === null ? '—' : m.gapToVisual).padStart(5) +
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
