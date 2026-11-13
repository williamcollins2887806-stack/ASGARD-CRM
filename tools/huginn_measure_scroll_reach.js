'use strict';
/**
 * Точный замер обрезки: доскролливается ли список до конца, и какие элементы
 * попадают под композер. Плюс — реальная высота строки текста при 17px.
 * Run: node tools/huginn_measure_scroll_reach.js   (нужен клон :3100)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const VIEWPORT = process.env.DIAG_W
  ? { width: Number(process.env.DIAG_W), height: Number(process.env.DIAG_H || 1024) }
  : { width: 543, height: 1024 };
const IS_MOBILE = process.env.DIAG_DESKTOP !== '1';
const OUT = path.join(__dirname, '../tests/reports/huginn-ui/' + (process.env.DIAG_DESKTOP === '1' ? 'OVERLAP-DIAG-DESKTOP' : 'OVERLAP-DIAG'));
fs.mkdirSync(OUT, { recursive: true });

const LOCAL_CSS = fs.readFileSync(
  process.env.HUGINN_CSS || path.join(__dirname, '../public/assets/css/huginn_dock.css'), 'utf8'
);
const LOCAL_JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/huginn_dock.js'), 'utf8');
const LOCAL_ICONS = fs.readFileSync(path.join(__dirname, '../public/assets/js/huginn_icons.js'), 'utf8');
const LOCAL_PHONE_CSS = fs.readFileSync(path.join(__dirname, '../public/assets/css/phone.css'), 'utf8');
const LOCAL_PHONE_JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/phone_ui.js'), 'utf8');

async function login() {
  let r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let d = await r.json();
  if (!r.ok) throw new Error('login ' + JSON.stringify(d).slice(0, 150));
  if (d.status === 'need_pin' || d.pinVerified === false) {
    r = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { Authorization: 'Bearer ' + d.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    d = await r.json();
    if (!r.ok) throw new Error('pin ' + JSON.stringify(d).slice(0, 150));
  }
  return d.token;
}

(async () => {
  const token = await login();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: IS_MOBILE ? 2 : 1, isMobile: IS_MOBILE, hasTouch: IS_MOBILE,
    userAgent: IS_MOBILE
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'commit' });
  await page.evaluate((t) => { try { localStorage.setItem('asgard_token', t); localStorage.setItem('token', t); } catch (_) {} }, token);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelectorAll('#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback').forEach((e) => { try { e.remove(); } catch (_) {} }));
  await page.addStyleTag({ content: LOCAL_CSS });
  await page.addStyleTag({ content: LOCAL_PHONE_CSS });
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock, .hg-chrome, .hg-bottom-nav, .hg-nav-search').forEach((e) => e.remove());
    document.body.classList.remove('hg-dock-open', 'hg-dock-collapsed');
    try { delete window.HuginnDock; } catch (_) { window.HuginnDock = undefined; }
  });
  await page.addScriptTag({ content: LOCAL_ICONS });
  await page.addScriptTag({ content: LOCAL_PHONE_JS });
  await page.addScriptTag({ content: LOCAL_JS });
  await page.evaluate(async () => { await window.HuginnDock.mount(); window.HuginnDock.open('huginn'); });
  await page.waitForSelector('#huginnDock', { timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { const r = document.querySelector('.hg-chat-row'); if (r) r.click(); });
  await page.waitForTimeout(3000);

  const rep = await page.evaluate(() => {
    const box = document.querySelector('.hg-msgs');
    const composer = document.querySelector('.hg-thread .hg-composer');
    if (!box || !composer) return { error: 'нет узлов' };
    const compTop = composer.getBoundingClientRect().top;
    const cs = getComputedStyle(box);
    const out = {
      scrollTop_before: box.scrollTop,
      maxScroll: box.scrollHeight - box.clientHeight,
      paddingBottom: cs.paddingBottom,
      paddingTop: cs.paddingTop,
      composerTop: Math.round(compTop),
      // прокручиваем в самый низ
    };
    box.scrollTop = box.scrollHeight;
    out.scrollTop_after = box.scrollTop;
    out.reachedBottom = Math.abs(box.scrollTop - (box.scrollHeight - box.clientHeight)) <= 1;
    // какие узлы пересекают зону композера
    const nodes = Array.from(box.children);
    out.childrenCount = nodes.length;
    out.covered = nodes
      .map((n) => {
        const r = n.getBoundingClientRect();
        return {
          cls: (n.className || '').toString().slice(0, 42),
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          under: Math.round(Math.max(0, r.bottom - compTop))
        };
      })
      .filter((x) => x.under > 0)
      .slice(-8);
    out.lastChildBottom = (() => {
      const last = nodes[nodes.length - 1];
      if (!last) return null;
      const r = last.getBoundingClientRect();
      return { cls: (last.className || '').toString().slice(0, 42), top: Math.round(r.top), bottom: Math.round(r.bottom), underComposerPx: Math.round(Math.max(0, r.bottom - compTop)) };
    })();
    // пузыри: последний по DOM с текстом
    const bubbles = Array.from(document.querySelectorAll('.hg-msgs .hg-bubble'));
    if (bubbles.length) {
      const lb = bubbles[bubbles.length - 1];
      const r = lb.getBoundingClientRect();
      out.lastBubble = { top: Math.round(r.top), bottom: Math.round(r.bottom), underComposerPx: Math.round(Math.max(0, r.bottom - compTop)) };
    }
    return out;
  });

  console.log('=== SCROLL / COVER ===');
  console.log(JSON.stringify(rep, null, 2));
  await page.screenshot({ path: path.join(OUT, 'after-scroll-bottom.png') });

  // снимок с подсветкой зоны композера
  await page.evaluate(() => {
    const c = document.querySelector('.hg-thread .hg-composer');
    if (!c) return;
    const r = c.getBoundingClientRect();
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:0;top:${r.top}px;width:100%;height:${r.height}px;background:rgba(255,0,0,0.22);border-top:2px solid red;z-index:99999;pointer-events:none`;
    d.id = 'diag-composer-zone';
    document.body.appendChild(d);
  });
  await page.screenshot({ path: path.join(OUT, 'composer-zone-highlight.png') });
  console.log('снимки:', OUT);
  fs.writeFileSync(path.join(OUT, 'scroll-reach.json'), JSON.stringify(rep, null, 2), 'utf8');
  await browser.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
