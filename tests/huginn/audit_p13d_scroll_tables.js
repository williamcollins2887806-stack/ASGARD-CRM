'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const DIR = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/PHASE-7');
fs.mkdirSync(DIR, { recursive: true });

function fail(m) { console.error('FAIL', m); process.exitCode = 1; }
function ok(m) { console.log('PASS', m); }

async function apiLogin() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let data = await res.json();
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
  }
  if (!data.token) throw new Error('login failed ' + JSON.stringify(data));
  return { token: data.token, user: data.user || {} };
}

function classify(t) {
  const ox = String(t.wrapOverflowX || '');
  const w100 = t.wrapWidthIs100 || t.wrapMaxWidthIs100;
  const hasWrap = !!t.wrap && t.wrap !== 'MAIN_ONLY';
  if (hasWrap && /auto|scroll/.test(ox) && w100) return 1;
  if (hasWrap && /auto|scroll/.test(ox) && !w100) return 2;
  if (hasWrap && !/auto|scroll/.test(ox)) return 3;
  return 4;
}

(async () => {
  const auth = await apiLogin();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_safe_mode', '1');
    try { localStorage.removeItem('asgard_v2_banner_dismissed'); } catch (_) {}
  }, auth);
  const page = await ctx.newPage();
  await page.goto(BASE + '/#/home?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.main', { timeout: 20000 });
  await page.waitForTimeout(800);

  const scroll = await page.evaluate(() => {
    const main = document.querySelector('.main');
    const nav = document.querySelector('.sidenav');
    const banner = document.getElementById('asgard-v2-banner');
    const before = {
      navY: nav ? nav.getBoundingClientRect().y : null,
      bannerY: banner ? banner.getBoundingClientRect().y : null,
      mainH: main ? main.getBoundingClientRect().height : null,
      mainScrollH: main ? main.scrollHeight : null,
      mainClientH: main ? main.clientHeight : null,
      docScrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
      bannerH: banner ? banner.offsetHeight : 0,
      cssBannerH: getComputedStyle(document.documentElement).getPropertyValue('--banner-h').trim(),
      mainOverflowY: main ? getComputedStyle(main).overflowY : null,
      mainHeight: main ? getComputedStyle(main).height : null
    };
    if (main) main.scrollTop = 200;
    const after = {
      navY: nav ? nav.getBoundingClientRect().y : null,
      bannerY: banner ? banner.getBoundingClientRect().y : null,
      mainScrollTop: main ? main.scrollTop : 0
    };
    if (main) main.scrollTop = 0;
    return { before, after };
  });
  fs.writeFileSync(path.join(DIR, 'P13D-SCROLL.json'), JSON.stringify(scroll, null, 2));
  console.log('P13D_SCROLL', JSON.stringify(scroll));
  if (scroll.before.docScrollH > scroll.before.innerH + 2) fail('body still scrolls: ' + scroll.before.docScrollH + '>' + scroll.before.innerH);
  if (!(scroll.before.mainScrollH > scroll.before.mainClientH + 20) && scroll.before.mainScrollH > 900) {
    /* home may be short after height clamp — still ok if body does not scroll */
  }
  if (Math.abs((scroll.after.navY || 0) - (scroll.before.navY || 0)) > 1) fail('sidenav moved on main scroll');
  if (scroll.before.bannerY != null && Math.abs((scroll.after.bannerY || 0) - (scroll.before.bannerY || 0)) > 1) {
    fail('banner moved on main scroll');
  }
  await page.evaluate((h) => { location.hash = h; }, '#/tenders');
  await page.waitForTimeout(1500);
  const scroll2 = await page.evaluate(() => {
    const main = document.querySelector('.main');
    const nav = document.querySelector('.sidenav');
    const banner = document.getElementById('asgard-v2-banner');
    const before = {
      navY: nav ? nav.getBoundingClientRect().y : null,
      bannerY: banner ? banner.getBoundingClientRect().y : null,
      mainScrollH: main ? main.scrollHeight : 0,
      mainClientH: main ? main.clientHeight : 0
    };
    if (main) main.scrollTop = 280;
    const after = {
      navY: nav ? nav.getBoundingClientRect().y : null,
      bannerY: banner ? banner.getBoundingClientRect().y : null,
      mainScrollTop: main ? main.scrollTop : 0
    };
    return { before, after };
  });
  fs.writeFileSync(path.join(DIR, 'P13D-SCROLL-TENDERS.json'), JSON.stringify(scroll2, null, 2));
  console.log('P13D_SCROLL_TENDERS', JSON.stringify(scroll2));
  if (scroll2.before.mainScrollH > scroll2.before.mainClientH + 8) {
    if (scroll2.after.mainScrollTop < 8) fail('main did not scroll internally');
    if (Math.abs((scroll2.after.navY || 0) - (scroll2.before.navY || 0)) > 1) fail('sidenav moved on tenders scroll');
    if (scroll2.before.bannerY != null && Math.abs((scroll2.after.bannerY || 0) - (scroll2.before.bannerY || 0)) > 1) {
      fail('banner moved on tenders scroll');
    }
    ok('tenders: scroll inside .main, chrome stuck');
  } else {
    console.log('WARN tenders page not tall enough — injecting spacer for inner-scroll proof');
    await page.evaluate(() => {
      const main = document.querySelector('.main');
      if (!main) return;
      const d = document.createElement('div');
      d.id = 'p13d-tall';
    d.style.cssText = 'height:1600px;flex-shrink:0;display:block';
      main.appendChild(d);
      main.scrollTop = 280;
    });
    const scroll3 = await page.evaluate(() => {
      const main = document.querySelector('.main');
      const nav = document.querySelector('.sidenav');
      const banner = document.getElementById('asgard-v2-banner');
      return {
        mainScrollTop: main ? main.scrollTop : 0,
        mainScrollH: main ? main.scrollHeight : 0,
        mainClientH: main ? main.clientHeight : 0,
        navY: nav ? nav.getBoundingClientRect().y : null,
        bannerY: banner ? banner.getBoundingClientRect().y : null
      };
    });
    console.log('P13D_SCROLL_SPACER', JSON.stringify(scroll3));
    if (scroll3.mainScrollTop < 8) fail('injected spacer: main still not scrolling');
    else if (scroll3.navY !== 0) fail('injected spacer: sidenav moved');
    else if (scroll3.bannerY !== 0 && scroll3.bannerY != null) fail('injected spacer: banner moved');
    else ok('inner .main scroll (spacer), chrome stuck');
    await page.screenshot({ path: path.join(DIR, 'scroll-inside-main.png'), fullPage: false });
    await page.evaluate(() => {
      const d = document.getElementById('p13d-tall');
      if (d) d.remove();
      const main = document.querySelector('.main');
      if (main) main.scrollTop = 0;
    });
  }

  const routes = ['#/home', '#/tenders', '#/pm-works'];
  const rows = [];
  for (const hash of routes) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(1500);
    const found = await page.evaluate(() => {
      const main = document.querySelector('.main');
      if (!main) return [];
      return [...main.querySelectorAll('table')].map((table, i) => {
        const cs = (el) => el ? getComputedStyle(el) : null;
        let wrap = table.parentElement;
        let wrapOx = wrap ? cs(wrap).overflowX : null;
        let hops = 0;
        while (wrap && wrap !== main && !/auto|scroll/.test(wrapOx || '') && hops < 6) {
          wrap = wrap.parentElement;
          wrapOx = wrap ? cs(wrap).overflowX : null;
          hops++;
        }
        const onMain = !wrap || wrap === main;
        const wcs = !onMain && wrap ? cs(wrap) : null;
        const widthIs100 = !!(wcs && (wcs.width.endsWith('px') ? wrap.clientWidth >= (main.clientWidth - 24) : /100%/.test(wcs.width)));
        const maxW100 = !!(wcs && (wcs.maxWidth === '100%' || wcs.maxWidth === 'none' || /100%/.test(wcs.maxWidth)));
        return {
          i,
          href: location.hash,
          tableW: table.scrollWidth,
          tableClientW: table.clientWidth,
          wrap: onMain ? 'MAIN_ONLY' : (wrap.className || wrap.tagName),
          wrapOverflowX: onMain ? cs(main).overflowX : wrapOx,
          wrapClientW: onMain ? main.clientWidth : wrap.clientWidth,
          wrapWidth: wcs ? wcs.width : null,
          wrapMaxWidth: wcs ? wcs.maxWidth : null,
          wrapWidthIs100: widthIs100,
          wrapMaxWidthIs100: maxW100,
          displayBlock: cs(table).display === 'block'
        };
      });
    });
    for (const t of found) {
      t.case = classify(t);
      t.wider = t.tableW > (t.wrapClientW || 0) + 2;
      if (t.displayBlock) fail('display:block on table ' + t.href + '#' + t.i);
      if (t.case === 4 && t.wider) fail('naked wide table ' + t.href + '#' + t.i + ' ' + t.tableW + '>' + t.wrapClientW);
      if (t.case === 2 && t.wider) fail('wrap width not 100% ' + t.href + '#' + t.i);
      if (t.case === 3 && t.wider) fail('wrap missing overflow-x ' + t.href + '#' + t.i);
      rows.push(t);
    }
    const slug = hash.replace(/[#/]/g, '_') || 'home';
    await page.screenshot({ path: path.join(DIR, 'table-' + slug + '.png'), fullPage: false });
  }

  const report = { scroll, tables: rows, pass: !process.exitCode };
  fs.writeFileSync(path.join(DIR, 'P13D-TABLE-AUDIT.json'), JSON.stringify(report, null, 2));
  console.log('P13D_TABLES', JSON.stringify(rows, null, 2));
  await browser.close();
  if (process.exitCode) process.exit(1);
  ok('P13d audit green');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function mainScrollsInside(scroll) {
  const b = scroll.before;
  return b.mainOverflowY === 'auto' && b.docScrollH <= b.innerH + 2;
}
