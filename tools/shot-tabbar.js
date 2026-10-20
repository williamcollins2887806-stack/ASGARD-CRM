'use strict';
/**
 * shot-tabbar.js — визуальная проверка низа экранов под iPhone-профилем.
 * Скроллит в самый низ и снимает полосу вместе с контентом.
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';

const ROUTES = [['/more', 'more'], ['/', 'home'], ['/works', 'works'], ['/personnel', 'personnel'], ['/warehouse', 'warehouse']];

(async () => {
  const outDir = 'tests/reports/_tabbar_shots';
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch();
  const token = jwt.sign({ id: 3455, login: 'ok', name: 'Д', role: 'DIRECTOR_GEN', email: 'x@a.com', pinVerified: true }, SECRET);
  const ctx = await b.newContext({
    viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block',
  });
  await ctx.addInitScript(({ t }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('field_auth_epoch', '6');
    localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
    const s = document.createElement('style');
    s.textContent = ':root{--safe-bottom:34px !important;--safe-top:20px !important;}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s));
  }, { t: token });
  const p = await ctx.newPage();

  for (const [path, name] of ROUTES) {
    await p.goto(BASE + '/m' + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.waitForTimeout(3000);
    // скроллим все скролл-контейнеры в самый низ
    await p.evaluate(() => {
      document.querySelectorAll('.scroll-container, main, [class*="overflow"]').forEach((e) => { e.scrollTop = e.scrollHeight; });
      window.scrollTo(0, document.body.scrollHeight);
    });
    await p.waitForTimeout(800);
    fs.mkdirSync(outDir, { recursive: true });
    await p.screenshot({ path: outDir + '/' + name + '.png' });
    const info = await p.evaluate(() => {
      const nav = document.querySelector('nav.fixed.bottom-0');
      const sc = document.querySelector('.scroll-container');
      return {
        navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
        scPaddingBottom: sc ? getComputedStyle(sc).paddingBottom : null,
        scLastChild: sc && sc.lastElementChild ? getComputedStyle(sc.lastElementChild).paddingBottom : null,
      };
    });
    console.log(name.padEnd(12) + JSON.stringify(info));
  }
  console.log('скриншоты: ' + outDir);
  await b.close();
})();
