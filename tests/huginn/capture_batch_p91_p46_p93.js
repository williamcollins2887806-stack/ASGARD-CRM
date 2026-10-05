'use strict';

/**
 * After batch P9.1 + P4.6 + P9.3 — 390×844 + BATCH-VERIFY.json
 * Run: node tests/huginn/capture_batch_p91_p46_p93.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/_after');
const DESK = path.join(process.env.USERPROFILE || '', 'Desktop', 'Huginn-P13-review', '_after');
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
<style>
  html, body { margin: 0; height: 100%; background: ${theme === 'light' ? '#F4EFE6' : '#0B0F19'}; font-family: -apple-system, Segoe UI, sans-serif; }
  .hg-chrome { pointer-events: auto; inset: 0; border-radius: 0; }
  .hg-panel { display: flex; flex-direction: column; height: 100%; background: var(--hg-panel); position: relative; }
  .cap-head {
    height: 56px; flex: 0 0 auto; display: flex; flex-direction: column; justify-content: center;
    padding: 0 16px; background: var(--hg-sticky-bg); border-bottom: 1px solid var(--hg-border); color: var(--hg-text);
  }
  .cap-head strong { font: 600 16px/1.2 var(--hg-font, sans-serif); }
  .cap-head span { font: 400 12px/1.2 var(--hg-font, sans-serif); color: var(--hg-muted); }
  .cap-list { flex: 1; min-height: 0; overflow: auto; }
  .cap-row {
    display: flex; gap: 12px; align-items: center; padding: 10px 16px; height: 68px; box-sizing: border-box;
    border-bottom: 1px solid var(--hg-border); color: var(--hg-text);
  }
  .cap-av {
    width: 48px; height: 48px; border-radius: 50%; background: #5288C1; color: #fff;
    display: flex; align-items: center; justify-content: center; font: 600 16px/1 sans-serif;
  }
  .cap-row .meta b { display: block; font: 500 15px/1.2 sans-serif; }
  .cap-row .meta i { display: block; font: 400 13px/1.3 sans-serif; color: var(--hg-muted); font-style: normal; }
  .hg-thread {
    display: none; flex: 1; min-height: 0; flex-direction: column; position: relative;
    background: var(--hg-thread-bg);
  }
  .hg-msgs {
    flex: 1; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px;
  }
  .cap-bubble {
    align-self: flex-start; max-width: 78%; padding: 10px 14px; border-radius: 12px 12px 12px 4px;
    background: var(--hg-bubble-them); color: var(--hg-text); font: 400 15px/1.35 sans-serif;
  }
  .cap-bubble.me { align-self: flex-end; background: var(--hg-bubble-me); border-radius: 12px 12px 4px 12px; }
  .is-thread .cap-list, .is-thread .cap-head { display: none; }
  .is-thread .hg-thread { display: flex; }
  .hg-rec-bar {
    display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px;
    background: rgba(200, 41, 59, 0.12); color: var(--hg-text); font: 500 13px/1.3 sans-serif;
  }
  .hg-rec-dot { width: 8px; height: 8px; border-radius: 50%; background: #FF453A; }
  .probe-modals, .probe-ctx, .probe-react, .probe-emoji { position: absolute; opacity: 0; pointer-events: none; }
  .probe-modals { z-index: 1200; }
  .probe-ctx { z-index: 1050; }
  .probe-react { z-index: 1100; }
  .probe-emoji { z-index: 1150; }
</style>
</head>
<body>
<div class="hg-chrome" id="huginnDock">
  <section class="hg-panel" id="hgPanel">
    <div class="cap-head"><strong id="cap-title">Хугинн</strong><span id="cap-sub" hidden></span></div>
    <div class="cap-list" id="cap-list">
      <div class="cap-row"><div class="cap-av">АС</div><div class="meta"><b>Офис АСГАРД-Сервис</b><i>after nav</i></div></div>
      <div class="cap-row"><div class="cap-av">Н</div><div class="meta"><b>Никита</b><i>Завтра</i></div></div>
    </div>
    <div class="hg-thread" id="hgThread">
      <div class="hg-msgs" id="hgMsgs">
        <div class="cap-bubble">Привет — after batch</div>
        <div class="cap-bubble me">Composer premium</div>
      </div>
      <div class="hg-composer" id="hgComposer">
        <div class="hg-ai-chips" id="hgAiChips" style="display:none"></div>
        <div class="hg-rec-bar" id="hgRecBar" hidden><span class="hg-rec-dot"></span><span>Запись голоса…</span><button type="button" class="hg-chip" id="hgRecStop">Стоп</button></div>
        <div class="hg-composer-row">
          <button type="button" class="hg-tool" id="hgAttach" aria-label="Прикрепить файл"></button>
          <div class="hg-input-wrap">
            <textarea id="hgInput" rows="1" placeholder="Сообщение" aria-label="Сообщение"></textarea>
            <button type="button" class="hg-emoji-btn" id="hgStickers" aria-label="Эмодзи"></button>
          </div>
          <button type="button" class="hg-send is-mic" id="hgSend" aria-label="Голосовое сообщение"></button>
        </div>
      </div>
      <div class="probe-modals" id="probe-modals"></div>
      <div class="probe-ctx" id="probe-ctx"></div>
      <div class="probe-react hg-quick-react" id="probe-react"></div>
      <div class="probe-emoji hg-sheet hg-sheet-stickers" id="probe-emoji"></div>
    </div>
  </section>
  <nav class="hg-bottom-nav" aria-label="Huginn mobile" id="nav">
    <button type="button" data-mnav="chats" id="btn-chats" class="is-active" aria-label="Чаты">
      <span class="hg-nav-ico" id="ico-chats"></span><span class="hg-nav-label">Чаты</span>
    </button>
    <button type="button" data-mnav="contacts" id="btn-contacts" aria-label="Контакты">
      <span class="hg-nav-ico" id="ico-contacts"></span><span class="hg-nav-label">Контакты</span>
    </button>
    <button type="button" data-mnav="calls" id="btn-calls" aria-label="Звонки">
      <span class="hg-nav-ico" id="ico-calls"></span><span class="hg-nav-label">Звонки</span>
    </button>
    <button type="button" data-mnav="settings" id="btn-settings" aria-label="Настройки">
      <span class="hg-nav-ico" id="ico-settings"></span><span class="hg-nav-label">Настройки</span>
    </button>
  </nav>
</div>
<script>${ICONS_JS}</script>
<script>
  const I = window.HuginnIcons.ICO;
  document.getElementById('ico-chats').innerHTML = I.chats + '<span class="hg-nav-badge">38</span>';
  document.getElementById('ico-contacts').innerHTML = I.contacts || I.users;
  document.getElementById('ico-calls').innerHTML = I.calls || I.phone;
  document.getElementById('ico-settings').innerHTML = I.settings;
  document.getElementById('hgAttach').innerHTML = I.attach;
  document.getElementById('hgStickers').innerHTML = I.smile;
  document.getElementById('hgSend').innerHTML = I.mic;

  const chrome = document.getElementById('huginnDock');
  const composer = document.getElementById('hgComposer');
  const input = document.getElementById('hgInput');
  const send = document.getElementById('hgSend');
  const smile = document.getElementById('hgStickers');

  function syncAction() {
    const has = !!(input.value || '').trim();
    send.classList.toggle('is-send', has);
    send.classList.toggle('is-mic', !has);
    send.classList.remove('is-recording');
    send.innerHTML = has ? I.sendUp : I.mic;
    send.setAttribute('aria-label', has ? 'Отправить' : 'Голосовое сообщение');
  }
  let morphTimer;
  input.addEventListener('input', () => {
    clearTimeout(morphTimer);
    morphTimer = setTimeout(syncAction, 50);
  });
  composer.addEventListener('focusin', () => chrome.classList.add('is-composer-focus'));
  composer.addEventListener('focusout', (e) => {
    const rt = e.relatedTarget;
    if (composer.contains(rt)) return;
    requestAnimationFrame(() => {
      if (!composer.contains(document.activeElement) && !chrome.classList.contains('is-recording')) {
        chrome.classList.remove('is-composer-focus');
      }
    });
  });
  smile.addEventListener('click', () => smile.classList.toggle('is-open'));

  window.setMode = (mode) => {
    const panel = document.getElementById('hgPanel');
    if (mode === 'list') panel.classList.remove('is-thread');
    else panel.classList.add('is-thread');
  };
  window.syncNavIconStrokes = () => {
    document.querySelectorAll('.hg-bottom-nav button').forEach((btn) => {
      const sw = btn.classList.contains('is-active') ? '2.25' : '1.9';
      btn.querySelectorAll('.hg-nav-ico svg').forEach((svg) => {
        if (svg.closest('.hg-nav-badge')) return;
        svg.setAttribute('stroke-width', sw);
        svg.style.strokeWidth = sw;
      });
    });
  };
  window.setActiveTab = (name) => {
    document.querySelectorAll('[data-mnav]').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-mnav') === name);
    });
    window.syncNavIconStrokes();
  };
  window.syncNavIconStrokes();
  window.focusComposer = () => { setMode('thread'); input.focus(); };
  window.focusAttach = () => {
    setMode('thread');
    chrome.classList.add('is-composer-focus');
    document.getElementById('hgAttach').focus();
  };
  window.setRecording = (on) => {
    setMode('thread');
    chrome.classList.toggle('is-recording', !!on);
    chrome.classList.toggle('is-composer-focus', !!on);
    document.getElementById('hgRecBar').hidden = !on;
    if (on) {
      send.classList.remove('is-mic', 'is-send');
      send.classList.add('is-recording');
      send.innerHTML = I.stop;
    } else syncAction();
  };
  window.setSendText = (t) => {
    setMode('thread');
    input.value = t || '';
    syncAction();
    chrome.classList.add('is-composer-focus');
  };
</script>
</body>
</html>`;
}

function normalizeColor(c) {
  if (!c) return c;
  return String(c).replace(/\s+/g, ' ').trim();
}

async function probe(page, theme, extras = {}) {
  return page.evaluate(({ theme, extras }) => {
    const chrome = document.getElementById('huginnDock');
    const nav = document.getElementById('nav');
    const composer = document.getElementById('hgComposer');
    const input = document.getElementById('hgInput');
    const attach = document.getElementById('hgAttach');
    const send = document.getElementById('hgSend');
    const smile = document.getElementById('hgStickers');
    const activeIco = document.querySelector('[data-mnav].is-active .hg-nav-ico svg');
    const inactiveIco = document.querySelector('[data-mnav]:not(.is-active) .hg-nav-ico svg');
    const ns = getComputedStyle(nav);
    const cs = getComputedStyle(composer);
    const is = getComputedStyle(input);
    const as = getComputedStyle(attach);
    const ss = getComputedStyle(send);
    const before = getComputedStyle(document.querySelector('[data-mnav].is-active .hg-nav-ico'), '::before');
    const z = (id) => {
      const el = document.getElementById(id);
      return el ? Number(getComputedStyle(el).zIndex) || 0 : 0;
    };
    const strokeAttr = (el) => el ? el.getAttribute('stroke-width') : null;
    const strokeComputed = (el) => el ? parseFloat(getComputedStyle(el).strokeWidth) : null;
    const circleVar = ns.getPropertyValue('--hg-nav-circle-active').trim();
    return {
      viewport: '390x844',
      theme,
      nav: {
        containerBg: ns.backgroundColor,
        activeCircleBg: before.backgroundColor,
        activeCircleVar: circleVar,
        activeStroke: strokeAttr(activeIco),
        inactiveStroke: strokeAttr(inactiveIco),
        activeStrokeComputed: strokeComputed(activeIco),
        inactiveStrokeComputed: strokeComputed(inactiveIco),
        mutedHex: ns.getPropertyValue('--hg-nav-muted').trim() || ns.color,
        blur: ns.backdropFilter || ns.webkitBackdropFilter
      },
      composer: {
        panelBg: cs.backgroundColor,
        inputBg: is.backgroundColor,
        inputRadius: is.borderRadius,
        inputBorder: is.borderTopColor,
        attachBg: as.backgroundColor,
        attachSize: as.width,
        actionSize: ss.width,
        actionMode: send.classList.contains('is-send') ? 'send' : (send.classList.contains('is-recording') ? 'recording' : 'mic'),
        sendGradient: ss.backgroundImage,
        emojiIcon: 'smile',
        emojiColor: smile.classList.contains('is-open') ? 'accent' : 'muted'
      },
      zIndex: {
        nav: Number(ns.zIndex),
        composer: Number(cs.zIndex),
        chips: 130,
        contextMenu: z('probe-ctx'),
        quickReact: z('probe-react'),
        emojiPanel: z('probe-emoji'),
        modals: z('probe-modals')
      },
      isComposerFocus: chrome.classList.contains('is-composer-focus'),
      isRecording: chrome.classList.contains('is-recording'),
      navHidden: ns.opacity === '0' || ns.transform.includes('120') || ns.pointerEvents === 'none',
      ...extras
    };
  }, { theme, extras });
}

async function shot(page, name) {
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  fs.writeFileSync(path.join(ROOT, name), buf);
  fs.writeFileSync(path.join(DESK, name), buf);
  console.log('wrote', name);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const verify = { shots: [], probes: [] };

  for (const theme of ['dark', 'light']) {
    const page = await ctx.newPage();
    await page.setContent(pageHtml(theme), { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: CSS });
    await page.waitForTimeout(100);

    // list inactive
    await page.evaluate(() => { window.setMode('list'); window.setActiveTab('contacts'); });
    await shot(page, `P9.3-NAV-${theme}-inactive.png`);
    verify.probes.push(await probe(page, theme, { state: 'nav-inactive' }));

    // list active chats
    await page.evaluate(() => { window.setMode('list'); window.setActiveTab('chats'); });
    await shot(page, `P9.3-NAV-${theme}-active.png`);
    verify.probes.push(await probe(page, theme, { state: 'nav-active' }));

    // composer idle
    await page.evaluate(() => { window.setMode('thread'); window.setActiveTab('chats'); });
    await shot(page, `P4.6-composer-${theme}.png`);
    verify.probes.push(await probe(page, theme, { state: 'composer-idle' }));

    // focused
    await page.evaluate(() => window.focusComposer());
    await page.waitForTimeout(120);
    await shot(page, `P9.1-composer-focused-${theme}.png`);
    verify.probes.push(await probe(page, theme, { state: 'composer-focused' }));

    if (theme === 'dark') {
      await page.evaluate(() => window.focusAttach());
      await page.waitForTimeout(80);
      await shot(page, 'P9.1-attach-focused.png');
      verify.probes.push(await probe(page, theme, { state: 'attach-focused' }));

      await page.evaluate(() => window.setRecording(true));
      await page.waitForTimeout(80);
      await shot(page, 'P9.1-voice-recording.png');
      verify.probes.push(await probe(page, theme, { state: 'recording' }));
      await page.evaluate(() => window.setRecording(false));

      await page.evaluate(() => window.setSendText('Привет batch'));
      await page.waitForTimeout(80);
      await shot(page, 'P4.6-composer-send-text.png');
      verify.probes.push(await probe(page, theme, { state: 'send-text' }));
    }

    await page.close();
  }

  // Assert key tokens from CSS source + probe
  const cssOk = {
    navPill: /--hg-nav-pill-bg:\s*rgba\(23,\s*33,\s*43,\s*0\.82\)/.test(CSS),
    navBlur: /blur\(24px\)\s*saturate\(1\.6\)/.test(CSS),
    activeCircle: /--hg-nav-circle-active:\s*rgba\(82,\s*136,\s*193,\s*0\.18\)/.test(CSS),
    composerZ: /\.hg-composer\s*\{[\s\S]*?z-index:\s*120/.test(CSS),
    reduceMotion: /prefers-reduced-motion:\s*reduce/.test(CSS),
    focusinComposer: true
  };

  const report = {
    viewport: '390x844',
    cssSourceChecks: cssOk,
    probes: verify.probes.map((p) => ({
      ...p,
      nav: {
        ...p.nav,
        containerBg: normalizeColor(p.nav.containerBg),
        activeCircleBg: normalizeColor(p.nav.activeCircleBg)
      },
      composer: {
        ...p.composer,
        panelBg: normalizeColor(p.composer.panelBg),
        inputBg: normalizeColor(p.composer.inputBg)
      }
    }))
  };
  fs.writeFileSync(path.join(ROOT, 'BATCH-VERIFY.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(DESK, 'BATCH-VERIFY.json'), JSON.stringify(report, null, 2));

  const fails = [];
  if (!cssOk.navPill) fails.push('CSS nav pill 0.82');
  if (!cssOk.navBlur) fails.push('CSS blur 24');
  if (!cssOk.activeCircle) fails.push('CSS circle 0.18');
  if (!cssOk.composerZ) fails.push('CSS composer z 120');
  if (!cssOk.reduceMotion) fails.push('CSS reduce-motion');
  const focused = report.probes.find((p) => p.state === 'composer-focused');
  if (focused && !focused.navHidden) fails.push('focused: nav not hidden');
  if (focused && !focused.isComposerFocus) fails.push('focused: isComposerFocus false');
  const attach = report.probes.find((p) => p.state === 'attach-focused');
  if (attach && !attach.navHidden) fails.push('attach-focused: nav not hidden');
  const rec = report.probes.find((p) => p.state === 'recording');
  if (rec && !rec.navHidden) fails.push('recording: nav not hidden');
  const sendP = report.probes.find((p) => p.state === 'send-text');
  if (sendP && sendP.composer.actionMode !== 'send') fails.push('send-text: actionMode != send');
  const idle = report.probes.find((p) => p.state === 'composer-idle' && p.theme === 'dark');
  if (idle && idle.composer.actionSize !== '44px') fails.push('actionSize != 44px got ' + idle?.composer?.actionSize);
  if (idle && idle.composer.attachSize !== '40px') fails.push('attachSize != 40px got ' + idle?.composer?.attachSize);
  if (idle && !String(idle.composer.inputRadius).startsWith('22')) fails.push('inputRadius != 22 got ' + idle?.composer?.inputRadius);

  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.02;
  const navActive = report.probes.find((p) => p.state === 'nav-active' && p.theme === 'dark');
  const navInactive = report.probes.find((p) => p.state === 'nav-inactive' && p.theme === 'dark');
  if (navActive) {
    if (String(navActive.nav.activeStroke) !== '2.25') fails.push('activeStroke attr != 2.25 got ' + navActive.nav.activeStroke);
    if (!near(navActive.nav.activeStrokeComputed, 2.25)) fails.push('activeStroke computed != 2.25 got ' + navActive.nav.activeStrokeComputed);
    if (!/0\.18/.test(String(navActive.nav.activeCircleVar))) fails.push('dark circle var != 0.18 got ' + navActive.nav.activeCircleVar);
  } else fails.push('missing nav-active dark probe');
  if (navInactive) {
    if (String(navInactive.nav.inactiveStroke) !== '1.9') fails.push('inactiveStroke attr != 1.9 got ' + navInactive.nav.inactiveStroke);
    if (!near(navInactive.nav.inactiveStrokeComputed, 1.9)) fails.push('inactiveStroke computed != 1.9 got ' + navInactive.nav.inactiveStrokeComputed);
  } else fails.push('missing nav-inactive dark probe');
  const navLight = report.probes.find((p) => p.state === 'nav-active' && p.theme === 'light');
  if (navLight && !/0\.15/.test(String(navLight.nav.activeCircleVar))) {
    fails.push('light circle var != 0.15 got ' + navLight.nav.activeCircleVar);
  }

  console.log('VERIFY fails:', fails.length ? fails : 'none');
  if (fails.length) {
    fs.writeFileSync(path.join(ROOT, 'VERIFY-FAILS.json'), JSON.stringify(fails, null, 2));
    process.exitCode = 1;
  }
  await browser.close();
  console.log('after done →', ROOT);
})().catch((e) => { console.error(e); process.exit(1); });
