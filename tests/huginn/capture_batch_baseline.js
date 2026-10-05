'use strict';

/**
 * Baseline BEFORE P9.1/P4.6/P9.3 — current CSS/JS as-is, 390×844.
 * Run: node tests/huginn/capture_batch_baseline.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/_baseline');
const DESK = path.join(process.env.USERPROFILE || '', 'Desktop', 'Huginn-P13-review', '_baseline');
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
  html, body { margin: 0; height: 100%; background: ${theme === 'light' ? '#F4EFE6' : '#0B0F19'}; }
  .hg-chrome { pointer-events: auto; inset: 0; border-radius: 0; }
  .hg-panel { display: flex; flex-direction: column; height: 100%; background: var(--hg-panel); }
  .cap-head {
    height: 56px; flex: 0 0 auto; display: flex; flex-direction: column; justify-content: center;
    padding: 0 16px; background: var(--hg-sticky-bg); border-bottom: 1px solid var(--hg-border); color: var(--hg-text);
  }
  .cap-head strong { font: 600 16px/1.2 var(--hg-font); }
  .cap-head span { font: 400 12px/1.2 var(--hg-font); color: var(--hg-muted); }
  .cap-list, .cap-thread { flex: 1; min-height: 0; overflow: auto; }
  .cap-row {
    display: flex; gap: 12px; align-items: center; padding: 10px 16px; height: 68px; box-sizing: border-box;
    border-bottom: 1px solid var(--hg-border); color: var(--hg-text);
  }
  .cap-av {
    width: 48px; height: 48px; border-radius: 50%; flex: 0 0 auto; background: #5288C1; color: #fff;
    display: flex; align-items: center; justify-content: center; font: 600 16px/1 var(--hg-font);
  }
  .cap-row .meta { flex: 1; min-width: 0; }
  .cap-row .meta b { display: block; font: 500 15px/1.2 var(--hg-font); }
  .cap-row .meta i { display: block; font: 400 13px/1.3 var(--hg-font); color: var(--hg-muted); font-style: normal; }
  .cap-thread {
    background: var(--hg-thread-bg); padding: 16px 16px 96px; display: none; flex-direction: column; gap: 8px;
  }
  .cap-bubble {
    align-self: flex-start; max-width: 78%; padding: 10px 14px; border-radius: 12px 12px 12px 4px;
    background: var(--hg-bubble-them); color: var(--hg-text); font: 400 15px/1.35 var(--hg-font);
  }
  .cap-bubble.me { align-self: flex-end; background: var(--hg-bubble-me); border-radius: 12px 12px 4px 12px; }
  .cap-composer {
    display: none; z-index: 110; position: relative; padding: 10px 12px; border-top: 1px solid var(--hg-border);
    background: var(--hg-composer-bg); font: 400 14px/1 var(--hg-font); color: var(--hg-muted);
  }
  .is-thread .cap-list { display: none; }
  .is-thread .cap-thread { display: flex; }
  .is-thread .cap-composer { display: block; }
</style>
</head>
<body>
<div class="hg-chrome" id="huginnDock">
  <section class="hg-panel" id="hgPanel">
    <div class="cap-head" id="cap-head"><strong id="cap-title">Хугинн</strong><span id="cap-sub" hidden></span></div>
    <div class="cap-list" id="cap-list">
      <div class="cap-row"><div class="cap-av">АС</div><div class="meta"><b>Офис АСГАРД-Сервис</b><i>baseline nav</i></div></div>
      <div class="cap-row"><div class="cap-av">Н</div><div class="meta"><b>Никита</b><i>Завтра на объект</i></div></div>
    </div>
    <div class="cap-thread" id="cap-thread">
      <div class="cap-bubble">Привет — baseline</div>
      <div class="cap-bubble me">Ок, composer</div>
    </div>
    <div class="cap-composer" id="cap-composer">Сообщение…</div>
  </section>
  <nav class="hg-bottom-nav" aria-label="Huginn mobile" id="nav">
    <button type="button" data-mnav="chats" id="btn-chats" class="is-active">
      <span class="hg-nav-ico" id="ico-chats"></span><span class="hg-nav-label">Чаты</span>
    </button>
    <button type="button" data-mnav="contacts" id="btn-contacts">
      <span class="hg-nav-ico" id="ico-contacts"></span><span class="hg-nav-label">Контакты</span>
    </button>
    <button type="button" data-mnav="calls" id="btn-calls">
      <span class="hg-nav-ico" id="ico-calls"></span><span class="hg-nav-label">Звонки</span>
    </button>
    <button type="button" data-mnav="settings" id="btn-settings">
      <span class="hg-nav-ico" id="ico-settings"></span><span class="hg-nav-label">Настройки</span>
    </button>
  </nav>
</div>
<script>${ICONS_JS}</script>
<script>
  const I = window.HuginnIcons.ICO;
  document.getElementById('ico-chats').innerHTML = I.chats + '<span class="hg-nav-badge" hidden>0</span>';
  document.getElementById('ico-contacts').innerHTML = I.contacts || I.users;
  document.getElementById('ico-calls').innerHTML = I.calls || I.phone;
  document.getElementById('ico-settings').innerHTML = I.settings;
  window.setMode = (mode) => {
    const panel = document.getElementById('hgPanel');
    const title = document.getElementById('cap-title');
    const sub = document.getElementById('cap-sub');
    if (mode === 'list') {
      panel.classList.remove('is-thread');
      title.textContent = 'Хугинн';
      sub.hidden = true;
    } else {
      panel.classList.add('is-thread');
      title.textContent = 'Офис АСГАРД-Сервис';
      sub.hidden = false;
      sub.textContent = 'не в сети';
    }
  };
</script>
</body>
</html>`;
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

  for (const theme of ['dark', 'light']) {
    const page = await ctx.newPage();
    await page.setContent(pageHtml(theme), { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: CSS });
    await page.waitForTimeout(80);

    await page.evaluate(() => window.setMode('list'));
    await shot(page, `baseline-nav-${theme}.png`);

    await page.evaluate(() => window.setMode('thread'));
    await shot(page, `baseline-composer-${theme}.png`);

    if (theme === 'dark') {
      await page.evaluate(() => {
        document.getElementById('cap-composer').setAttribute('tabindex', '0');
        document.getElementById('cap-composer').focus();
        document.getElementById('huginnDock').classList.add('is-composer-focus');
      });
      await shot(page, 'baseline-composer-focused.png');
    }
    await page.close();
  }

  await browser.close();
  console.log('baseline done →', ROOT);
})().catch((e) => { console.error(e); process.exit(1); });
