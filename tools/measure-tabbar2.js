'use strict';
/**
 * measure-tabbar2.js — глубокая диагностика: где иконки внутри полосы,
 * сколько пустого стекла под ними, и как соотносятся с контентом страницы.
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';

(async () => {
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
    s.textContent = ':root{--safe-bottom:34px !important;--safe-top:59px !important;}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s));
  }, { t: token });
  const p = await ctx.newPage();
  await p.goto(BASE + '/m/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);

  const r = await p.evaluate(() => {
    const nav = document.querySelector('nav.fixed.bottom-0') ||
      [...document.querySelectorAll('nav,div')].find((e) => {
        const s = getComputedStyle(e);
        return s.position === 'fixed' && s.bottom === '0px' && e.querySelector('button');
      });
    if (!nav) return { none: true };
    const nr = nav.getBoundingClientRect();
    const cs = getComputedStyle(nav);
    const btns = [...nav.querySelectorAll('button')].map((btn) => {
      const r2 = btn.getBoundingClientRect();
      return { label: btn.textContent.trim().slice(0, 12), top: Math.round(r2.top), bottom: Math.round(r2.bottom), h: Math.round(r2.height) };
    });
    // контентная область страницы: последний scroll-container
    const sc = document.querySelector('.scroll-container') || document.querySelector('main');
    const sr = sc ? sc.getBoundingClientRect() : null;
    return {
      nav: { top: Math.round(nr.top), bottom: Math.round(nr.bottom), h: Math.round(nr.height), csHeight: cs.height, padTop: cs.paddingTop, padBottom: cs.paddingBottom, boxSizing: cs.boxSizing },
      vh: window.innerHeight,
      visualVh: window.visualViewport ? Math.round(window.visualViewport.height) : null,
      btns,
      content: sr ? { top: Math.round(sr.top), bottom: Math.round(sr.bottom), padBottom: getComputedStyle(sc).paddingBottom, scrollH: sc.scrollHeight, clientH: sc.clientHeight } : null,
      bodyH: document.body.getBoundingClientRect().height,
      rootH: document.getElementById('root').getBoundingClientRect().height,
    };
  });
  console.log(JSON.stringify(r, null, 2));

  // Насколько «пустое стекло» под иконками
  if (r.btns && r.btns.length) {
    const lastBtnBottom = Math.max(...r.btns.map((x) => x.bottom));
    console.log('\nПустое стекло под иконками: ' + (r.nav.bottom - lastBtnBottom) + 'px');
    console.log('Высота полосы: ' + r.nav.h + 'px; контент иконок: ' + Math.max(...r.btns.map((x) => x.h)) + 'px');
  }
  await b.close();
})();
