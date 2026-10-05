'use strict';

/**
 * P9 floating-pill nav — 390×844 only. Distinct list vs thread headers.
 * Run: node tests/huginn/capture_p9_nav.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/PHASE-9');
const DESK = path.join(process.env.USERPROFILE || '', 'Desktop', 'Huginn-P13-review');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/huginn_dock.css'), 'utf8');
const ICONS_JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_icons.js'), 'utf8');
fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(DESK, { recursive: true });

function pageHtml(theme) {
  return `<!doctype html>
<html data-theme="${theme}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<style id="cap-shell">
  html, body { margin: 0; height: 100%; background: ${theme === 'light' ? '#F4EFE6' : '#0B0F19'}; }
  .hg-chrome { pointer-events: auto; inset: 0; border-radius: 0; }
  .hg-panel { display: flex; flex-direction: column; height: 100%; background: var(--hg-panel); }
  .cap-head {
    height: 56px; flex: 0 0 auto;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 16px; background: var(--hg-sticky-bg);
    border-bottom: 1px solid var(--hg-border);
    color: var(--hg-text);
  }
  .cap-head strong { font: 600 16px/1.2 var(--hg-font); }
  .cap-head span { font: 400 12px/1.2 var(--hg-font); color: var(--hg-muted); }
  .cap-list, .cap-thread { flex: 1; min-height: 0; overflow: auto; }
  .cap-row {
    display: flex; gap: 12px; align-items: center;
    padding: 10px 16px; height: 68px; box-sizing: border-box;
    border-bottom: 1px solid var(--hg-border);
    color: var(--hg-text);
  }
  .cap-av {
    width: 48px; height: 48px; border-radius: 50%; flex: 0 0 auto;
    background: #5288C1; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font: 600 16px/1 var(--hg-font);
  }
  .cap-row .meta { flex: 1; min-width: 0; }
  .cap-row .meta b { display: block; font: 500 15px/1.2 var(--hg-font); }
  .cap-row .meta i { display: block; font: 400 13px/1.3 var(--hg-font); color: var(--hg-muted); font-style: normal; }
  .cap-thread {
    background: var(--hg-thread-bg);
    padding: 16px 16px 96px;
    display: none; flex-direction: column; gap: 8px;
  }
  .cap-bubble {
    align-self: flex-start; max-width: 78%;
    padding: 10px 14px; border-radius: 12px 12px 12px 4px;
    background: var(--hg-bubble-them); color: var(--hg-text);
    font: 400 15px/1.35 var(--hg-font);
  }
  .cap-bubble.me {
    align-self: flex-end; background: var(--hg-bubble-me);
    border-radius: 12px 12px 4px 12px;
  }
  .cap-composer {
    display: none; z-index: 110; position: relative;
    padding: 10px 12px; border-top: 1px solid var(--hg-border);
    background: var(--hg-composer-bg);
    font: 400 14px/1 var(--hg-font); color: var(--hg-muted);
  }
  .is-thread .cap-list { display: none; }
  .is-thread .cap-thread { display: flex; }
  .is-thread .cap-composer { display: block; }
</style>
</head>
<body>
<div class="hg-chrome" id="huginnDock">
  <section class="hg-panel" id="hgPanel">
    <div class="cap-head" id="cap-head">
      <strong id="cap-title">Хугинн</strong>
      <span id="cap-sub" hidden></span>
    </div>
    <div class="cap-list" id="cap-list">
      <div class="cap-row"><div class="cap-av">АС</div><div class="meta"><b>Офис АСГАРД-Сервис</b><i>Ок, смотрим bottom nav</i></div></div>
      <div class="cap-row"><div class="cap-av">Н</div><div class="meta"><b>Никита</b><i>Завтра на объект</i></div></div>
      <div class="cap-row"><div class="cap-av">Б</div><div class="meta"><b>Бригада 3</b><i>Фото с площадки</i></div></div>
    </div>
    <div class="cap-thread" id="cap-thread">
      <div class="cap-bubble">Привет — проверка nav</div>
      <div class="cap-bubble me">Ок, смотрим bottom nav</div>
      <div class="cap-bubble">Последний пузырь над composer</div>
    </div>
    <div class="cap-composer" id="cap-composer">Сообщение…</div>
  </section>
  <nav class="hg-bottom-nav" aria-label="Huginn mobile" id="nav">
    <button type="button" data-mnav="chats" id="btn-chats">
      <span class="hg-nav-ico" id="ico-chats"></span>
      <span class="hg-nav-label">Чаты</span>
    </button>
    <button type="button" data-mnav="contacts" id="btn-contacts">
      <span class="hg-nav-ico" id="ico-contacts"></span>
      <span class="hg-nav-label">Контакты</span>
    </button>
    <button type="button" data-mnav="calls" id="btn-calls">
      <span class="hg-nav-ico" id="ico-calls"></span>
      <span class="hg-nav-label">Звонки</span>
    </button>
    <button type="button" data-mnav="settings" id="btn-settings">
      <span class="hg-nav-ico" id="ico-settings"></span>
      <span class="hg-nav-label">Настройки</span>
    </button>
  </nav>
</div>
<script>${ICONS_JS}</script>
<script>
  const I = window.HuginnIcons.ICO;
  function setIco(id, svg, badge) {
    const el = document.getElementById(id);
    el.innerHTML = svg + (badge !== undefined
      ? '<span class="hg-nav-badge" data-nav-badge' + (badge ? '' : ' hidden') + '>' + (badge || '0') + '</span>'
      : '');
  }
  setIco('ico-chats', I.chats, '3');
  setIco('ico-contacts', I.contacts || I.users);
  setIco('ico-calls', I.calls || I.phone);
  setIco('ico-settings', I.settings);

  window.__p9 = {
    setActive(nav) {
      document.querySelectorAll('[data-mnav]').forEach((b) => {
        b.classList.toggle('is-active', nav && b.getAttribute('data-mnav') === nav);
      });
    },
    setBadge(n) {
      const el = document.querySelector('[data-nav-badge]');
      if (!el) return;
      el.toggleAttribute('hidden', !n);
      if (n) el.textContent = String(n);
    },
    showList() {
      document.getElementById('hgPanel').classList.remove('is-thread');
      document.getElementById('cap-title').textContent = 'Хугинн';
      document.getElementById('cap-sub').hidden = true;
    },
    showThread() {
      document.getElementById('hgPanel').classList.add('is-thread');
      document.getElementById('cap-title').textContent = 'Офис АСГАРД-Сервис';
      const sub = document.getElementById('cap-sub');
      sub.hidden = false;
      sub.textContent = 'не в сети';
    },
    probe() {
      const nav = document.querySelector('.hg-bottom-nav');
      const activeBtn = document.querySelector('[data-mnav].is-active');
      const ico = activeBtn && activeBtn.querySelector('.hg-nav-ico');
      const svg = ico && ico.querySelector('svg');
      const badge = document.querySelector('[data-nav-badge]');
      const hoverBtn = document.querySelector('[data-mnav="contacts"]');
      const hoverIco = hoverBtn && hoverBtn.querySelector('.hg-nav-ico');
      const before = (el) => el ? getComputedStyle(el, '::before').backgroundColor : null;
      const ns = getComputedStyle(nav);
      return {
        navPillBg: ns.backgroundColor,
        navPillBgToken: ns.getPropertyValue('--hg-nav-pill-bg').trim(),
        navRadius: ns.borderRadius,
        navHeight: ns.height,
        circleActive: ico ? before(ico) : null,
        circleActiveToken: ns.getPropertyValue('--hg-nav-circle-active').trim(),
        hoverCircleToken: ns.getPropertyValue('--hg-nav-circle-hover').trim(),
        iconStrokeActive: svg ? getComputedStyle(svg).strokeWidth : null,
        iconColorActive: activeBtn ? getComputedStyle(activeBtn).color : null,
        badgeBg: badge && !badge.hidden ? getComputedStyle(badge).backgroundColor : 'hidden',
        badgeHidden: !badge || badge.hidden || getComputedStyle(badge).display === 'none',
        activeTab: activeBtn ? activeBtn.getAttribute('data-mnav') : null,
        header: document.getElementById('cap-title').textContent,
        isThread: document.getElementById('hgPanel').classList.contains('is-thread'),
        zNav: ns.zIndex,
        hoverIcoBg: hoverIco ? before(hoverIco) : null
      };
    }
  };
</script>
</body>
</html>`;
}

function parseRgba(s) {
  const m = String(s || '').match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

function alphaClose(got, expect, tol) {
  const a = parseRgba(got);
  if (!a) return false;
  return Math.abs(a.a - expect) <= (tol || 0.02);
}

async function shot(page, name) {
  const file = path.join(ROOT, name);
  await page.screenshot({ path: file, fullPage: false });
  fs.copyFileSync(file, path.join(DESK, name));
  const crop = path.join(ROOT, name.replace('.png', '-NAVSTRIP.png'));
  await page.locator('.hg-bottom-nav').screenshot({ path: crop });
  fs.copyFileSync(crop, path.join(DESK, path.basename(crop)));
  console.log('PASS', name);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const report = { viewport: '390x844', themes: {} };
  let failed = false;

  function fail(m) { console.error('FAIL', m); failed = true; }

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const page = await ctx.newPage();
    await page.setContent(pageHtml(theme), { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: CSS });
    await page.waitForTimeout(80);

    const expectA = theme === 'dark' ? 0.15 : 0.12;
    const expectPillA = 0.92;

    async function go(cfg) {
      await page.evaluate((c) => {
        if (c.view === 'list') window.__p9.showList();
        else window.__p9.showThread();
        window.__p9.setActive(c.active);
        window.__p9.setBadge(c.badge);
      }, cfg);
      if (cfg.focus) {
        await page.locator('body').click({ position: { x: 8, y: 40 } });
        await page.locator(cfg.focus).focus();
        await page.keyboard.press('Tab');
        await page.keyboard.down('Shift');
        await page.keyboard.press('Tab');
        await page.keyboard.up('Shift');
        await page.locator(cfg.focus).focus();
      }
      await page.waitForTimeout(220);
      const p = await page.evaluate(() => window.__p9.probe());
      if (cfg.expectHeader && p.header !== cfg.expectHeader) fail(theme + ' ' + cfg.name + ' header=' + p.header);
      if (cfg.expectThread != null && p.isThread !== cfg.expectThread) fail(theme + ' ' + cfg.name + ' thread mismatch');
      if (cfg.expectActive != null && p.activeTab !== cfg.expectActive) fail(theme + ' ' + cfg.name + ' active=' + p.activeTab);
      if (cfg.expectBadgeHidden != null && p.badgeHidden !== cfg.expectBadgeHidden) fail(theme + ' ' + cfg.name + ' badge');
      return p;
    }

    // LIST
    let pr = await go({
      name: 'list', view: 'list', active: 'chats', badge: 3,
      expectHeader: 'Хугинн', expectThread: false, expectActive: 'chats', expectBadgeHidden: false
    });
    report.themes[theme] = report.themes[theme] || {};
    report.themes[theme].list = pr;
    if (!alphaClose(pr.circleActive, expectA) && pr.circleActiveToken.indexOf(String(expectA)) < 0) {
      fail(theme + ' circleActive ' + pr.circleActive + ' token ' + pr.circleActiveToken);
    }
    if (pr.navRadius !== '24px') fail(theme + ' radius ' + pr.navRadius);
    if (pr.navHeight !== '64px') fail(theme + ' height ' + pr.navHeight);
    if (pr.iconStrokeActive !== '2.25px' && pr.iconStrokeActive !== '2.25') fail(theme + ' stroke ' + pr.iconStrokeActive);
    await shot(page, `P9-NAV-${theme}-list.png`);

    // THREAD
    pr = await go({
      name: 'thread', view: 'thread', active: 'chats', badge: 3,
      expectHeader: 'Офис АСГАРД-Сервис', expectThread: true, expectActive: 'chats'
    });
    report.themes[theme].thread = pr;
    await shot(page, `P9-NAV-${theme}-thread.png`);

    // ACTIVE chats (thread, no focus)
    pr = await go({
      name: 'active', view: 'thread', active: 'chats', badge: 3,
      expectHeader: 'Офис АСГАРД-Сервис', expectActive: 'chats'
    });
    report.themes[theme].active = pr;
    if (!/6AB3F3|3390EC|rgb\(106,\s*179,\s*243\)|rgb\(51,\s*144,\s*236\)/i.test(pr.iconColorActive || '')) {
      fail(theme + ' icon color ' + pr.iconColorActive);
    }
    await shot(page, `P9-NAV-${theme}-active.png`);

    // ACTIVE zvonki
    pr = await go({
      name: 'zvonki', view: 'list', active: 'calls', badge: 3,
      expectHeader: 'Хугинн', expectActive: 'calls'
    });
    report.themes[theme].zvonki = pr;
    await shot(page, `P9-NAV-${theme}-active-zvonki.png`);

    // FOCUS settings — chats remain active, focus ring on settings
    pr = await go({
      name: 'focus', view: 'list', active: 'chats', badge: 3, focus: '#btn-settings',
      expectHeader: 'Хугинн', expectActive: 'chats'
    });
    report.themes[theme].focus = pr;
    await shot(page, `P9-NAV-${theme}-focus.png`);

    // BADGE 0
    pr = await go({
      name: 'badge0', view: 'list', active: 'chats', badge: 0,
      expectHeader: 'Хугинн', expectBadgeHidden: true, expectActive: 'chats'
    });
    report.themes[theme].badge0 = pr;
    await shot(page, `P9-NAV-${theme}-badge0.png`);

    // Token asserts
    const t = report.themes[theme].active;
    if (t.navPillBgToken.indexOf('0.92') < 0) fail(theme + ' pill token ' + t.navPillBgToken);
    if (t.hoverCircleToken.indexOf('0.04') < 0) fail(theme + ' hover token ' + t.hoverCircleToken);
    if (Number(t.zNav) !== 100) fail(theme + ' z ' + t.zNav);
  }

  fs.writeFileSync(path.join(ROOT, 'P9-NAV-VERIFY.json'), JSON.stringify(report, null, 2));
  fs.copyFileSync(path.join(ROOT, 'P9-NAV-VERIFY.json'), path.join(DESK, 'P9-NAV-VERIFY.json'));
  await browser.close();
  if (failed) process.exit(1);
  console.log('PASS capture_p9_nav floating-pill');
})().catch((e) => { console.error(e); process.exit(1); });
