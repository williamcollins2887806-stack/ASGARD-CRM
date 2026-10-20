'use strict';
/**
 * measure-tabbar.js — диагностика нижнего тап-бара под iPhone.
 *
 * Замеряет геометрию тап-бара и сравнивает её с низом вьюпорта, а также с
 * величиной safe-area-inset-bottom. Запускается на живом стенде (Vite :5173).
 *
 * Запуск: node tools/measure-tabbar.js
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';

/** Профили устройств: обычный экран и iPhone с «челкой» (safe-area снизу). */
const DEVICES = [
  { name: 'iPhone 14 Pro (safe 34px)', width: 393, height: 852, safeBottom: 34, safeTop: 59 },
  { name: 'iPhone SE (safe 0) ', width: 375, height: 667, safeBottom: 0, safeTop: 20 },
];

const USERS = [
  { label: 'DIRECTOR_GEN', id: 3455, login: 'ok', role: 'DIRECTOR_GEN' },
  { label: 'PM', id: 3463, login: 'r.rochshupkin', role: 'PM' },
];

const ROUTES = [
  ['Главная', '/'],
  ['Задачи', '/tasks'],
  ['Работы', '/works'],
  ['Ещё', '/more'],
  ['Согласования', '/director-approvals'],
];

(async () => {
  const b = await chromium.launch();
  let issues = 0;

  for (const dev of DEVICES) {
    console.log('\n######## ' + dev.name + ' ' + dev.width + 'x' + dev.height + ' ########');
    for (const u of USERS) {
      const token = jwt.sign({ ...u, name: u.login, email: u.login + '@asgard-service.com', pinVerified: true }, SECRET);
      const ctx = await b.newContext({
        viewport: { width: dev.width, height: dev.height },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        serviceWorkers: 'block',
      });
      // Эмулируем безопасную зону iOS: подменяем --safe-* на фактические значения.
      await ctx.addInitScript(({ t, sb, st }) => {
        localStorage.setItem('asgard_token', t);
        localStorage.setItem('asgard_theme', 'dark');
        localStorage.setItem('field_auth_epoch', '6');
        localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
        // Chromium не умеет env(safe-area-inset-*) — задаём значения напрямую.
        const s = document.createElement('style');
        s.textContent = ':root{--safe-bottom:' + sb + 'px !important;--safe-top:' + st + 'px !important;}';
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s));
      }, { t: token, sb: dev.safeBottom, st: dev.safeTop });

      const p = await ctx.newPage();
      console.log('  --- ' + u.label + ' ---');
      for (const [name, path] of ROUTES) {
        await p.goto(BASE + '/m' + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await p.waitForTimeout(2600);
        const m = await p.evaluate(() => {
          const nav = document.querySelector('nav.fixed.bottom-0') ||
                      [...document.querySelectorAll('nav,div')].find((e) => {
                        const s = getComputedStyle(e);
                        return s.position === 'fixed' && (s.bottom === '0px' || s.bottom === '0') && e.querySelector('button');
                      });
          if (!nav) return { none: true };
          const r = nav.getBoundingClientRect();
          const cs = getComputedStyle(nav);
          const root = getComputedStyle(document.documentElement);
          return {
            top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
            viewport: window.innerHeight,
            gapBelow: Math.round(window.innerHeight - r.bottom),
            padBottom: cs.paddingBottom,
            navHeight: cs.height,
            safeBottom: root.getPropertyValue('--safe-bottom').trim(),
            tabbarTotal: root.getPropertyValue('--tabbar-total').trim(),
            boxSizing: cs.boxSizing,
          };
        });
        if (m.none) { console.log('    ' + name.padEnd(15) + ' тап-бара нет'); continue; }
        // Диагноз: полоса должна доставать до низа, а контент — стоять над индикатором.
        const okBottom = m.gapBelow === 0;
        const tags = [];
        if (!okBottom) { tags.push('ЩЕЛЬ ' + m.gapBelow + 'px снизу'); issues++; }
        if (m.safeBottom === '0px' && m.padBottom !== '0px') tags.push('padding без safe-area');
        console.log('    ' + name.padEnd(15) +
          'h=' + String(m.height).padStart(3) +
          ' top=' + String(m.top).padStart(4) +
          ' bottom=' + String(m.bottom).padStart(4) +
          ' vh=' + m.viewport +
          ' щель=' + String(m.gapBelow).padStart(3) +
          ' padBottom=' + m.padBottom.padEnd(6) +
          ' safe=' + m.safeBottom.padEnd(6) +
          ' total=' + m.tabbarTotal.padEnd(20) +
          (tags.length ? '  ← ' + tags.join('; ') : ''));
      }
      await ctx.close();
    }
  }
  console.log('\nПРОБЛЕМ: ' + issues);
  await b.close();
})();
