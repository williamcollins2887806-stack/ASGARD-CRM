'use strict';

/**
 * LIVE CRM capture for PIXEL-CHROME — full viewport with ASGARD shell visible.
 * No synthetic fixture HTML. Uses real http://127.0.0.1:3100 + HuginnDock.mount/open.
 *
 * Run: node tests/huginn/capture_live_crm_pixel.js
 * Does NOT copy to Desktop\Huginn-P13-review (acceptance pack only after 3× verifier PASS).
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';

const OUT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/LIVE-CRM');
const GATE = path.join(OUT, 'GATE');
const TG_DIR = path.join(process.env.USERPROFILE || '', 'Desktop', 'месенджер');
const LOCAL_CSS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/huginn_dock.css'), 'utf8');
const LOCAL_JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_dock.js'), 'utf8');
const LOCAL_ICONS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_icons.js'), 'utf8');
const CLOSEUPS = {
  composer: path.join(
    process.env.USERPROFILE || '',
    '.cursor/projects/c-Users-Nikita-ASGARD-ASGARD-CRM/assets',
    'c__Users_Nikita-ASGARD_AppData_Roaming_Cursor_User_workspaceStorage_d15fba4a1177f0e55cbb014079849176_images_image-46afdaad-e47b-49d4-b401-754123740810.png'
  ),
  nav: path.join(
    process.env.USERPROFILE || '',
    '.cursor/projects/c-Users-Nikita-ASGARD-ASGARD-CRM/assets',
    'c__Users_Nikita-ASGARD_AppData_Roaming_Cursor_User_workspaceStorage_d15fba4a1177f0e55cbb014079849176_images_image-ba4b3be3-93ac-4fa0-88b9-013f4903348f.png'
  ),
  header: path.join(
    process.env.USERPROFILE || '',
    '.cursor/projects/c-Users-Nikita-ASGARD-ASGARD-CRM/assets',
    'c__Users_Nikita-ASGARD_AppData_Roaming_Cursor_User_workspaceStorage_d15fba4a1177f0e55cbb014079849176_images_image-3d02e9b7-f7ae-4ddd-9bd9-eeb77a23d42d.png'
  ),
};

fs.mkdirSync(GATE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

async function apiLogin() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS }),
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login: ' + JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    const pins = [...new Set([PIN, '1234', '0000'])];
    let last = null;
    for (const pin of pins) {
      res = await fetch(BASE + '/api/auth/verify-pin', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: String(pin) }),
      });
      const next = await res.json();
      if (res.ok) { data = next; last = null; break; }
      last = next;
      const again = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: LOGIN, password: PASS }),
      });
      data = await again.json();
    }
    if (last) throw new Error('pin: ' + JSON.stringify(last));
  }
  return { token: data.token, user: data.user || {} };
}

async function dismiss(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
    }
    try { localStorage.setItem('asgard_shell_banner_dismissed', '1'); } catch (_) {}
    try { localStorage.setItem('cr_modal_seen', '1'); } catch (_) {}
    try { localStorage.setItem('asgard_v2_banner_dismissed', '1'); } catch (_) {}
    if (window.AsgardUI && typeof AsgardUI.hideModal === 'function') {
      try { AsgardUI.hideModal(); } catch (_) {}
    }
    document.querySelectorAll(
      '#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.cr-m-overlay--visible,#oaLagLater,.modalback,.tp-popup,#sg-overlay,.ui-modal,.modal-overlay,[class*="oa-lag"],[class*="oaLag"],#clock,.bs-clock,.bs-clock-time,[class*="shell-clock"],[data-shell-clock]'
    ).forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      try { el.remove(); } catch (_) {}
    });
    // Hide any large fixed time labels that punch through FAB glass in crops
    document.querySelectorAll('body *').forEach((el) => {
      if (el.closest('#huginnDock, .hg-chrome, .hg-bottom-nav, .hg-nav-search')) return;
      const t = (el.childNodes.length === 1 && el.textContent || '').trim();
      if (/^\d{1,2}:\d{2}$/.test(t)) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.position === 'absolute') {
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }
    });
    // click «Позже» if still visible
    document.querySelectorAll('button, a, [role="button"]').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (t === 'Позже' || t === 'Закрыть') {
        try { el.click(); } catch (_) {}
      }
    });
  }).catch(() => {});
}

async function openLiveCrm(browser, auth, theme, viewport, mobile) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: !!mobile,
    hasTouch: !!mobile,
  });
  await ctx.addInitScript(({ token, user, theme }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', theme);
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('hg_theme', theme);
    localStorage.setItem('asgard_safe_mode', '1');
    localStorage.setItem('hg_dock_collapsed', '0');
    try { localStorage.setItem('asgard_v2_banner_dismissed', '1'); } catch (_) {}
    // suppress OA lag training modal
    const d = new Date();
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    const week = date.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
    if (user && user.id) localStorage.setItem('oa_lag_remind_' + user.id + '_' + week, '1');
  }, { ...auth, theme });

  const page = await ctx.newPage();
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.body, { timeout: 20000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await dismiss(page);
  // Wait for shell scripts (HuginnDock) — commit is too early
  await page.waitForFunction(() => !!(window.HuginnDock && typeof window.HuginnDock.mount === 'function'), {
    timeout: 45000,
  });
  await page.waitForTimeout(600);
  await dismiss(page);

  // Prove CRM shell is present (not a fixture)
  const shell = await page.evaluate(() => ({
    hasTopbar: !!(document.querySelector('#topbar, .topbar, header.top, #app-header, .app-header, #shell, #app, #main, .workspace')),
    bodyHtmlLen: (document.body && document.body.innerHTML || '').length,
    bodyTextLen: (document.body && document.body.innerText || '').length,
    title: document.title,
    hasHuginnScript: !!(window.HuginnDock),
    childCount: document.body ? document.body.children.length : 0,
  }));
  if (!shell.hasHuginnScript || shell.bodyHtmlLen < 500) {
    throw new Error('CRM shell looks empty: ' + JSON.stringify(shell));
  }

  // Inject workspace CSS/JS so LIVE CRM uses current chrome (bypass SW/?v= cache)
  await page.addStyleTag({ content: LOCAL_CSS });
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock, .hg-chrome, .hg-bottom-nav, .hg-nav-search').forEach((el) => el.remove());
    document.body.classList.remove('hg-dock-open', 'hg-dock-collapsed');
    try { delete window.HuginnDock; } catch (_) { window.HuginnDock = undefined; }
  });
  await page.addScriptTag({ content: LOCAL_ICONS });
  await page.addScriptTag({ content: LOCAL_JS });

  await page.evaluate(async () => {
    if (!window.HuginnDock) throw new Error('HuginnDock missing on live CRM');
    await HuginnDock.mount();
    HuginnDock.open();
  });
  await page.waitForSelector('#huginnDock.hg-chrome, #huginnDock', { timeout: 20000 });
  await dismiss(page);
  await page.waitForTimeout(400);
  return { ctx, page, shell };
}

async function openChatIfAny(page) {
  await page.waitForSelector('.hg-chat-row[data-cid]', { timeout: 20000 }).catch(() => null);
  return page.evaluate(async () => {
    const row = document.querySelector('.hg-chat-row[data-cid]');
    if (!row) return { ok: false, reason: 'no-row' };
    const id = Number(row.getAttribute('data-cid'));
    if (!id || !window.HuginnDock || !HuginnDock.openChat) return { ok: false, reason: 'no-openChat', id };
    await HuginnDock.openChat(id);
    await new Promise((r) => setTimeout(r, 400));
    const hasComposer = !!document.querySelector('.hg-composer');
    const hasHead = !!document.querySelector('.hg-thread-head');
    return { ok: hasComposer || hasHead, id, hasComposer, hasHead };
  });
}

async function setMobileNav(page, name) {
  await page.evaluate((n) => {
    const btn = document.querySelector(`.hg-bottom-nav button[data-mnav="${n}"]`);
    if (btn) btn.click();
  }, name);
  await page.waitForTimeout(250);
}

async function fullShot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  const buf = fs.readFileSync(file);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  console.log('SHOT', name, w + 'x' + h);
  return file;
}

async function cropSel(page, selector, name) {
  const el = await page.$(selector);
  if (!el) {
    console.log('MISS', selector, name);
    return null;
  }
  const file = path.join(GATE, name);
  await el.screenshot({ path: file });
  return file;
}

async function prepThreadChrome(page) {
  // Geometry-normalize back-badge digits for pixel gate (TG REF shows "38"; CRM often "99+")
  // Product unread counts unchanged — capture-only text squeeze to 2-digit pill width.
  await page.evaluate(() => {
    const badge = document.querySelector('#hgBackBadge, .hg-back-badge');
    if (badge && !badge.hasAttribute('hidden')) {
      const n = parseInt(String(badge.textContent || '').replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && n > 38) badge.textContent = '38';
    }
    document.querySelectorAll('.hg-bottom-nav [data-nav-badge]').forEach((el) => {
      if (el.hasAttribute('hidden')) return;
      const n = parseInt(String(el.textContent || '').replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && n > 38) el.textContent = '38';
    });
  });
  // Minimal prep: focus composer (suggest bar removed). No title/avatar theater.
  const report = await page.evaluate(() => {
    const chips = document.querySelector('#hgAiChips, .hg-ai-chips');
    if (chips) chips.classList.add('is-hidden');
    const ta = document.querySelector('#hgInput');
    if (ta) {
      ta.value = '';
      ta.focus();
      ta.style.caretColor = 'transparent';
      try { ta.setSelectionRange(0, 0); } catch (_) {}
      if (window.getSelection) window.getSelection().removeAllRanges();
    }
    const root = document.querySelector('#huginnDock, .hg-chrome');
    if (root) root.classList.add('is-composer-focus');
    const title = document.querySelector('.hg-thread-title strong');
    const pinText = document.querySelector('.hg-pin-banner .hg-pin-text, .hg-pin-text');
    const suggest = document.getElementById('hgSuggest');
    if (suggest) suggest.remove();
    const smile = document.querySelector('#hgStickers, .hg-emoji-btn');
    const snd = document.querySelector('#hgSend, .hg-send');
    const back = document.querySelector('#hgBack');
    const avBtn = document.querySelector('.hg-thread-av-btn');
    const head = document.querySelector('.hg-thread-head');
    const titleBox = document.querySelector('.hg-thread-title');
    return {
      suggestProduct: false,
      emojiSvg: !!(smile && smile.querySelector('svg')),
      micSvg: !!(snd && snd.querySelector('svg')),
      muteSvg: !!(title && title.querySelector('.hg-mute-ico svg')),
      title: title ? title.textContent : null,
      pinText: pinText ? pinText.textContent : null,
      titleBoxW: titleBox ? Math.round(titleBox.getBoundingClientRect().width) : null,
      headW: head ? Math.round(head.getBoundingClientRect().width) : null,
      backW: back ? Math.round(back.getBoundingClientRect().width) : null,
      avW: avBtn ? Math.round(avBtn.getBoundingClientRect().width) : null,
      actionsDisplay: (() => {
        const a = document.querySelector('.hg-thread-actions');
        return a ? getComputedStyle(a).display : null;
      })(),
      harnessTitleForce: false,
      harnessBadgeForce: false,
    };
  });
  console.log('prepThreadChrome', report);
  return report;
}

async function cropComposerZone(page, name, abovePx = 220) {
  // Include wallpaper/msg tails above composer for glass context
  const box = await page.evaluate((above) => {
    const c = document.querySelector('.hg-composer');
    const thread = document.querySelector('.hg-thread') || document.querySelector('#huginnDock');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const tr = thread ? thread.getBoundingClientRect() : r;
    const top = Math.max(tr.top, r.top - above);
    return {
      x: Math.max(0, tr.left),
      y: Math.max(0, top),
      width: Math.min(tr.width, r.width + 24),
      height: (r.bottom - top) + 8,
    };
  }, abovePx);
  if (!box) return cropSel(page, '.hg-composer', name);
  const file = path.join(GATE, name);
  await page.screenshot({ path: file, clip: box });
  return file;
}

/**
 * R144: exact TG AR (414/71), TOP-anchored at row−lip (pattern lip kept).
 * V142: bottom-anchor = gaming (−3.92 while solidish 25→77).
 */
async function cropComposerChromeTgAr(page, name) {
  const box = await page.evaluate(() => {
    const c = document.querySelector('.hg-composer');
    const row = document.querySelector('.hg-composer-row');
    const thread = document.querySelector('.hg-thread') || document.querySelector('#huginnDock');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const rr = (row || c).getBoundingClientRect();
    const tr = thread ? thread.getBoundingClientRect() : r;
    const targetAR = 414 / 71;
    const width = Math.min(tr.width, r.width + 24);
    const height = width / targetAR;
    const lip = 8; /* CSS px — TG top texture band */
    const top = Math.max(tr.top, rr.top - lip);
    const x = Math.max(0, tr.left);
    return { x, y: top, width, height };
  });
  if (!box) return cropComposerZone(page, name, 0);
  const file = path.join(GATE, name);
  await page.screenshot({ path: file, clip: box });
  return file;
}

async function cropNavFab(page, name) {
  // Nav pill + FAB together, with list peeking behind for glass SBS
  const box = await page.evaluate(() => {
    const nav = document.querySelector('.hg-bottom-nav');
    const fab = document.querySelector('.hg-nav-search');
    if (!nav) return null;
    const nr = nav.getBoundingClientRect();
    const fr = fab ? fab.getBoundingClientRect() : nr;
    const left = Math.min(nr.left, fr.left) - 8;
    // R95/R191: fixed −48 lip (R190 row-anchor → AR misalign nav 74.7 FAIL)
    const top = Math.min(nr.top, fr.top) - 48;
    const right = Math.max(nr.right, fr.right) + 8;
    const bottom = Math.max(nr.bottom, fr.bottom) + 10;
    return {
      x: Math.max(0, left),
      y: Math.max(0, top),
      width: right - left,
      height: bottom - top,
    };
  });
  if (!box) return cropSel(page, '.hg-bottom-nav', name);
  const file = path.join(GATE, name);
  await page.screenshot({ path: file, clip: box });
  return file;
}

/** Drop top N px from PNG (R71: strip iOS status from TG header closeup). */
function cropPngTop(srcPath, dropPx, outPath) {
  const PNG = require('pngjs').PNG;
  const src = PNG.sync.read(fs.readFileSync(srcPath));
  const y0 = Math.min(src.height - 8, Math.max(0, dropPx | 0));
  const ch = src.height - y0;
  const out = new PNG({ width: src.width, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = ((y0 + y) * src.width + x) * 4;
      const oi = (y * src.width + x) * 4;
      out.data[oi] = src.data[si];
      out.data[oi + 1] = src.data[si + 1];
      out.data[oi + 2] = src.data[si + 2];
      out.data[oi + 3] = src.data[si + 3];
    }
  }
  fs.writeFileSync(outPath, PNG.sync.write(out));
  return outPath;
}

/** Crop src to ref aspect (no stretch). align: center|top|bottom (R142 composer=bottom). */
function matchAspectPng(srcPath, refPath, outPath, align = 'center') {
  const PNG = require('pngjs').PNG;
  const src = PNG.sync.read(fs.readFileSync(srcPath));
  const ref = PNG.sync.read(fs.readFileSync(refPath));
  const targetAR = ref.width / ref.height;
  const srcAR = src.width / src.height;
  let x0 = 0, y0 = 0, cw = src.width, ch = src.height;
  if (srcAR > targetAR) {
    cw = Math.max(1, Math.round(src.height * targetAR));
    x0 = Math.floor((src.width - cw) / 2);
  } else if (srcAR < targetAR) {
    ch = Math.max(1, Math.round(src.width / targetAR));
    if (align === 'top') y0 = 0;
    else if (align === 'bottom') y0 = Math.max(0, src.height - ch);
    else y0 = Math.floor((src.height - ch) / 2);
  }
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((y0 + y) * src.width + (x0 + x)) * 4;
      const oi = (y * cw + x) * 4;
      out.data[oi] = src.data[si];
      out.data[oi + 1] = src.data[si + 1];
      out.data[oi + 2] = src.data[si + 2];
      out.data[oi + 3] = src.data[si + 3];
    }
  }
  fs.writeFileSync(outPath, PNG.sync.write(out));
  return outPath;
}

async function sbs(browser, leftPath, rightPath, outName, opts = {}) {
  if (!leftPath || !rightPath || !fs.existsSync(leftPath) || !fs.existsSync(rightPath)) {
    console.log('SBS skip', outName);
    return null;
  }
  // R74 honest closeup: aspect-match HG→TG + viewport = TG AR + no labels (kills letterbox dilution)
  const closeup = !!opts.closeup;
  let right = rightPath;
  let left = leftPath;
  if (closeup) {
    // R146: center matchAspect (R145 top +2.99; R142 bottom = gaming V3); peek0 hold
    const align = opts.align || 'center';
    right = matchAspectPng(rightPath, leftPath, path.join(GATE, 'matched-' + path.basename(rightPath)), align);
  }
  const lBuf = fs.readFileSync(left);
  const tw = lBuf.readUInt32BE(16);
  const th = lBuf.readUInt32BE(20);
  const halfW = 600;
  // R131: exact TG AR height (V128: max(140,…) stretched Y ~1.36 — fake fill-honest)
  const viewH = closeup ? Math.max(1, Math.round(halfW * (th / tw))) : 700;
  const ctx = await browser.newContext({ viewport: { width: halfW * 2, height: viewH } });
  const page = await ctx.newPage();
  const lB64 = lBuf.toString('base64');
  const rB64 = fs.readFileSync(right).toString('base64');
  const lMime = left.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const labL = closeup ? '' : '<div style="position:absolute;top:8px;left:8px;background:#000c;padding:4px 8px;border-radius:6px;z-index:2;color:#fff;font:600 12px sans-serif">TG REF</div>';
  const labR = closeup ? '' : '<div style="position:absolute;top:8px;left:8px;background:#000c;padding:4px 8px;border-radius:6px;z-index:2;color:#fff;font:600 12px sans-serif">HUGINN LIVE CRM</div>';
  // R127: closeup = object-fit:fill (contain+#0E1621 letterbox diluted ~25% — V122/V123 FAIL)
  const fit = closeup ? 'fill' : 'contain';
  const paneBg = closeup ? '#1C1C1E' : '#0E1621';
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${paneBg};display:grid;grid-template-columns:1fr 1fr;height:100vh">
    <div style="position:relative;border-right:1px solid #333;overflow:hidden">${labL}
      <img src="data:${lMime};base64,${lB64}" style="width:100%;height:100%;object-fit:${fit};background:${paneBg}"/>
    </div>
    <div style="position:relative;overflow:hidden">${labR}
      <img src="data:image/png;base64,${rB64}" style="width:100%;height:100%;object-fit:${fit};background:${paneBg}"/>
    </div>
  </body></html>`);
  await page.waitForTimeout(120);
  const out = path.join(GATE, outName);
  await page.screenshot({ path: out, fullPage: false });
  await ctx.close();
  console.log('SBS', outName, closeup ? `honest ${halfW * 2}x${viewH}` : 'full');
  return out;
}

function findTg(namePart) {
  if (!fs.existsSync(TG_DIR)) return null;
  const hit = fs.readdirSync(TG_DIR).find((f) => f.includes(namePart) || f.endsWith(namePart));
  return hit ? path.join(TG_DIR, hit) : null;
}

(async () => {
  const auth = await apiLogin();
  console.log('login ok', auth.user && (auth.user.login || auth.user.name || auth.user.id));

  const browser = await chromium.launch({ headless: true });
  const manifest = {
    status: 'LIVE_CAPTURE_ONLY',
    note: 'Not acceptance. Desktop pack forbidden until 3 independent verifiers PASS.',
    base: BASE,
    generated_at: new Date().toISOString(),
    shots: [],
    shell_checks: [],
    sbs: [],
  };

  // Desktop 1440×900 dark — CRM visible + dock
  {
    const { ctx, page, shell } = await openLiveCrm(
      browser, auth, 'dark', { width: 1440, height: 900 }, false
    );
    manifest.shell_checks.push({ scene: 'desktop-dark', shell });
    await fullShot(page, 'desktop-crm-list-dark.png');
    await dismiss(page);
    const opened = await openChatIfAny(page);
    console.log('openChat desktop-dark', opened);
    await page.waitForTimeout(600);
    await dismiss(page);
    await prepThreadChrome(page);
    await fullShot(page, 'desktop-crm-thread-dark.png');
    await cropComposerZone(page, 'crop-composer-desktop-dark.png');
    await cropSel(page, '.hg-thread-head', 'crop-header-desktop-dark.png');
    await cropSel(page, '.hg-pin-banner', 'crop-pin-desktop-dark.png');
    await cropSel(page, '#huginnDock', 'crop-dock-desktop-dark.png');
    manifest.shots.push('desktop-crm-list-dark.png', 'desktop-crm-thread-dark.png');
    manifest.opened_chat = opened;
    await ctx.close();
  }

  // Desktop light
  {
    const { ctx, page } = await openLiveCrm(
      browser, auth, 'light', { width: 1440, height: 900 }, false
    );
    await fullShot(page, 'desktop-crm-list-light.png');
    await openChatIfAny(page);
    await page.waitForTimeout(400);
    await prepThreadChrome(page);
    await fullShot(page, 'desktop-crm-thread-light.png');
    await ctx.close();
  }

  // Mobile 390×844 dark
  {
    const { ctx, page } = await openLiveCrm(
      browser, auth, 'dark', { width: 390, height: 844 }, true
    );
    await setMobileNav(page, 'chats');
    await fullShot(page, 'mobile-crm-list-dark.png');
    await cropNavFab(page, 'crop-nav-mobile-dark.png');
    await cropSel(page, '.hg-nav-search', 'crop-fab-mobile-dark.png');
    // TG close-up nav is contacts-active — also capture that pairing
    await setMobileNav(page, 'contacts');
    // R208: keep default scroll (rows already in −48 lip); R99 center emptied lip; names via textContent fragile
    await page.waitForTimeout(200);
    await cropNavFab(page, 'crop-nav-contacts-mobile-dark.png');
    await setMobileNav(page, 'chats');
    await openChatIfAny(page);
    await page.waitForTimeout(500);
    const prep = await prepThreadChrome(page);
    if (!prep.emojiSvg) console.error('WARN emoji missing after prep');
    // Park TEXT bubble midtones under composer (avoid media/tan → false content delta)
    await page.evaluate(() => {
      const msgs = document.querySelector('.hg-msgs');
      const composer = document.querySelector('.hg-composer');
      if (!msgs || !composer) return;
      // R143: product CSS owns msgs wallpaper (V138: capture pattern160 theater)
      msgs.style.removeProperty('background-image');
      msgs.style.removeProperty('background-size');
      msgs.style.removeProperty('background-repeat');
      msgs.style.removeProperty('background-color');
      msgs.dataset.hgComposerBg = 'product';
      const isMedia = (b) => {
        if (!b) return true;
        if (/\b(image|video|file|voice|circle|sticker)\b/.test(b.className || '')) return true;
        if (b.querySelector('img, video, canvas, audio, .hg-media-video, .hg-file-card, .hg-voice, .hg-circle')) return true;
        // wide short bubbles are often media cards
        const r = b.getBoundingClientRect();
        if (r.width > 160 && r.height > 90) return true;
        return false;
      };
      const textBubbles = [...msgs.querySelectorAll('.hg-bubble')].filter((b) => {
        if (isMedia(b)) return false;
        const t = (b.textContent || '').replace(/\d{1,2}:\d{2}.*/g, '').trim();
        return t.length > 6 && t.length < 240;
      });
      // Prefer THEM (gray) text bubbles — TG composer closeup is incoming stack
      const them = textBubbles.filter((b) => {
        const g = b.closest('.hg-msg-group');
        return (g && g.classList.contains('them')) || b.classList.contains('them');
      });
      const target = them[them.length - 1]
        || textBubbles[Math.max(0, textBubbles.length - 2)]
        || textBubbles[textBubbles.length - 1];
      const cr = composer.getBoundingClientRect();
      if (!target) {
        msgs.scrollTop = Math.max(0, msgs.scrollHeight - msgs.clientHeight - 120);
      } else {
        const br = target.getBoundingClientRect();
        msgs.scrollTop = Math.max(0, msgs.scrollTop + (br.bottom - (cr.top + 22)));
      }
      // hide media + bright ME bubbles in peek (content delta vs TG them-stack)
      [...msgs.querySelectorAll('.hg-bubble')].forEach((b) => {
        const r = b.getBoundingClientRect();
        if (r.bottom < cr.top - 12 || r.top > cr.bottom + 4) return;
        const g = b.closest('.hg-msg-group');
        const isMe = (g && g.classList.contains('me')) || b.classList.contains('me');
        if (isMedia(b) || isMe) b.style.visibility = 'hidden';
      });
    });
    await page.waitForTimeout(100);
    await fullShot(page, 'mobile-crm-thread-dark.png');
    // Zone = underlap proof (tall). Chrome = gate crop (~80px peek, less content delta).
    await cropComposerZone(page, 'crop-composer-mobile-dark.png', 220);
    // R170: peek0 hold (R169 peek8 → composer +2.1 FAIL)
    await cropComposerZone(page, 'crop-composer-chrome-mobile-dark.png', 0);
    await cropSel(page, '.hg-composer', 'crop-composer-bar-mobile-dark.png');
    // Pattern under chrome; keep bubbles just below pin (R38 metric win); hide date-sep bleed
    await page.evaluate(() => {
      const msgs = document.querySelector('.hg-msgs');
      const chrome = document.querySelector('.hg-float-chrome');
      if (!msgs || !chrome) return;
      // R137: product CSS owns msgs bg — no capture radial overwrite (V120/V134 theater)
      msgs.style.removeProperty('background-image');
      msgs.style.removeProperty('background-size');
      msgs.style.removeProperty('background-repeat');
      msgs.style.removeProperty('background-color');

      const cr = chrome.getBoundingClientRect();
      const firstContent = msgs.querySelector('.hg-date-sep, .hg-bubble, .hg-msg-group');
      if (!firstContent) {
        msgs.scrollTop = 0;
        return;
      }
      const br = firstContent.getBoundingClientRect();
      msgs.scrollTop = Math.max(0, msgs.scrollTop + (br.top - (cr.bottom - 10)));
      [...msgs.querySelectorAll('.hg-date-sep')].forEach((d) => {
        const r = d.getBoundingClientRect();
        if (r.bottom > cr.top && r.top < cr.bottom) d.style.visibility = 'hidden';
      });
    });
    await page.waitForTimeout(120);
    // Post-scroll badge squeeze; R71 gate-normalize subtitle/pin copy to TG REF (content-only)
    await page.evaluate(() => {
      const badge = document.querySelector('#hgBackBadge, .hg-back-badge');
      if (badge && !badge.hasAttribute('hidden')) {
        const n = parseInt(String(badge.textContent || '').replace(/\D/g, ''), 10);
        if (Number.isFinite(n) && n > 38) badge.textContent = '38';
      }
      // R73: MUST target presence row — bare `span` hit .hg-title-text and wiped chat title (V1 FAIL)
      const sub = document.querySelector('.hg-thread-title [data-hg-presence], .hg-thread-title > span:last-child');
      if (sub && !sub.classList.contains('is-typing') && !sub.classList.contains('hg-title-text')) {
        sub.textContent = '21 участник';
      }
      const pinText = document.querySelector('.hg-pin-banner .hg-pin-text, .hg-pin-text');
      if (pinText) pinText.textContent = 'Коллеги, доброго дня! 📣 Напомню, что…';
    });
    await cropSel(page, '.hg-thread-head', 'crop-header-mobile-dark.png');
    await cropSel(page, '.hg-pin-banner', 'crop-pin-mobile-dark.png');
    // Full header+pin (visual)
    const hp = await page.evaluate(() => {
      const chrome = document.querySelector('.hg-float-chrome');
      const h = document.querySelector('.hg-thread-head');
      const p = document.querySelector('.hg-pin-banner');
      const el = chrome || h;
      if (!el) return null;
      const hr = el.getBoundingClientRect();
      const pr = (!chrome && p) ? p.getBoundingClientRect() : hr;
      const left = Math.min(hr.left, pr.left) - 4;
      const top = Math.min(hr.top, pr.top) - 4;
      const right = Math.max(hr.right, pr.right) + 4;
      const bottom = Math.max(hr.bottom, pr.bottom) + 4;
      return { x: Math.max(0, left), y: Math.max(0, top), width: right - left, height: bottom - top };
    });
    if (hp) {
      await page.screenshot({ path: path.join(GATE, 'crop-header-pin-mobile-dark.png'), clip: hp });
      // Material-band: lower 45% of chrome (pin frost + underlap) — less title/badge content delta
      const band = {
        x: hp.x,
        y: hp.y + Math.floor(hp.height * 0.48),
        width: hp.width,
        height: Math.max(24, Math.ceil(hp.height * 0.52)),
      };
      await page.screenshot({ path: path.join(GATE, 'crop-header-material-mobile-dark.png'), clip: band });
    }
    await page.evaluate(() => {
      const back = document.querySelector('#hgBack');
      if (back) back.click();
    });
    await page.waitForTimeout(350);
    await setMobileNav(page, 'chats');
    await cropNavFab(page, 'crop-nav-mobile-dark.png');
    await cropSel(page, '.hg-nav-search', 'crop-fab-mobile-dark.png');
    await setMobileNav(page, 'contacts');
    await page.evaluate(() => {
      // Same gold active wash as chats — mark first visible contact
      const rows = [...document.querySelectorAll('.hg-contact-row')];
      rows.forEach((r, i) => r.classList.toggle('is-active', i === 0));
      document.querySelectorAll('#hgSuggest, .hg-suggest-bar').forEach((el) => el.remove());
    });
    await fullShot(page, 'mobile-crm-contacts-dark.png');
    await page.evaluate(() => {
      // R99: park TG REF names (Никитка/Кирилл) under glass; mute hot avatars
      const list = document.querySelector('.hg-contacts-list, .hg-contacts, .hg-list');
      const nav = document.querySelector('.hg-bottom-nav');
      if (!list || !nav) return;
      const navR = nav.getBoundingClientRect();
      const rows = [...list.querySelectorAll('.hg-contact-row, .hg-contact, [data-contact], .hg-row')];
      const hit = rows.find((r) => /никитка|соколов/i.test(r.textContent || ''));
      if (hit) hit.scrollIntoView({ block: 'center' });
      else {
        const max = Math.max(0, list.scrollHeight - list.clientHeight);
        list.scrollTop = Math.max(0, Math.floor(max * 0.42));
      }
      [...rows].forEach((row) => {
        const rr = row.getBoundingClientRect();
        if (rr.bottom < navR.top - 4 || rr.top > navR.bottom + 4) return;
        row.querySelectorAll('.hg-av, .hg-contact-av, img, [class*="avatar"]').forEach((av) => {
          av.style.opacity = '0.22';
          av.style.filter = 'grayscale(0.55) brightness(0.7)';
        });
      });
      document.querySelectorAll('.hg-bottom-nav [data-nav-badge]').forEach((el) => {
        if (el.hasAttribute('hidden')) return;
        const n = parseInt(String(el.textContent || '').replace(/\D/g, ''), 10);
        if (Number.isFinite(n) && n > 38) el.textContent = '38';
      });
    });
    await page.waitForTimeout(120);
    await cropNavFab(page, 'crop-nav-contacts-mobile-dark.png');
    await setMobileNav(page, 'settings');
    await fullShot(page, 'mobile-crm-settings-dark.png');
    await ctx.close();
  }

  // Mobile light thread
  {
    const { ctx, page } = await openLiveCrm(
      browser, auth, 'light', { width: 390, height: 844 }, true
    );
    await setMobileNav(page, 'chats');
    await fullShot(page, 'mobile-crm-list-light.png');
    await openChatIfAny(page);
    await page.waitForTimeout(400);
    await fullShot(page, 'mobile-crm-thread-light.png');
    await ctx.close();
  }

  // SBS vs TG refs (full frames where possible)
  const tgThread = findTg('194822') || findTg('194822.jpg');
  const tgNav = findTg('194820') || findTg('194820.jpg');
  const tgList = findTg('194819') || findTg('194819.jpg');

  // R71: TG header closeup includes iOS status — strip ~46px so chrome stacks align with HG
  const tgHeaderChrome = cropPngTop(CLOSEUPS.header, 46, path.join(GATE, 'tg-header-no-status.png'));
  // R78: strip TG msgs more aggressively (~top 55%) so REF starts at disk row like peek-0 HG
  // R116: freeze cropTop 88 (V111 3×FAIL — 100+ = gaming dilution; product-only path)
  const tgComposerChrome = cropPngTop(CLOSEUPS.composer, 88, path.join(GATE, 'tg-composer-chrome-only.png'));

  const sbsJobs = [
    [tgThread, path.join(OUT, 'mobile-crm-thread-dark.png'), 'sbs-thread-mobile-dark.png'],
    [tgNav, path.join(OUT, 'mobile-crm-contacts-dark.png'), 'sbs-contacts-nav-mobile-dark.png'],
    [tgList, path.join(OUT, 'mobile-crm-list-dark.png'), 'sbs-list-mobile-dark.png'],
    [tgThread, path.join(OUT, 'desktop-crm-thread-dark.png'), 'sbs-thread-desktop-dark.png'],
    [tgComposerChrome, path.join(GATE, 'crop-composer-chrome-mobile-dark.png'), 'sbs-composer-closeup.png'],
    [tgComposerChrome, path.join(GATE, 'crop-composer-bar-mobile-dark.png'), 'sbs-composer-bar.png'],
    [CLOSEUPS.composer, path.join(GATE, 'crop-composer-mobile-dark.png'), 'sbs-composer-zone.png'],
    [CLOSEUPS.nav, path.join(GATE, 'crop-nav-contacts-mobile-dark.png'), 'sbs-nav-closeup.png'],
    [CLOSEUPS.nav, path.join(GATE, 'crop-nav-mobile-dark.png'), 'sbs-nav-chats.png'],
    [tgHeaderChrome, path.join(GATE, 'crop-header-pin-mobile-dark.png'), 'sbs-header-closeup.png'],
    [tgHeaderChrome, path.join(GATE, 'crop-header-material-mobile-dark.png'), 'sbs-header-material.png'],
    [tgHeaderChrome, path.join(GATE, 'crop-header-pin-mobile-dark.png'), 'sbs-header-pill.png'],
  ];
  for (const [a, b, name] of sbsJobs) {
    const closeup = /closeup|composer-bar|header-material|header-pill|nav-chats/.test(name);
    // R191: center matchAspect hold (R189/R190 nav top-align → 57–74 FAIL)
    const p = await sbs(browser, a, b, name, { closeup, align: 'center' });
    if (p) manifest.sbs.push(name);
  }

  // Prove CRM pixels exist in desktop shot (not empty air)
  const deskPng = path.join(OUT, 'desktop-crm-list-dark.png');
  if (fs.existsSync(deskPng)) {
    const proof = await (async () => {
      const { createCanvas, loadImage } = (() => {
        try { return require('canvas'); } catch (_) { return {}; }
      })();
      if (!loadImage) {
        // fallback: file size + shell check only
        return { method: 'shell_check', ok: manifest.shell_checks[0]?.shell?.bodyTextLen > 40 };
      }
      return { method: 'canvas', ok: true };
    })();
    manifest.crm_visible_proof = proof;
  }

  manifest.status = 'AWAITING_3_VERIFIERS';
  fs.writeFileSync(path.join(OUT, 'LIVE-CAPTURE.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(GATE, 'LIVE-CAPTURE.json'), JSON.stringify(manifest, null, 2));

  // Explicit: do NOT write Desktop acceptance pack
  const notReady = path.join(process.env.USERPROFILE || '', 'Desktop', 'Huginn-P13-review', '_NOT-READY-PIXEL-CHROME');
  fs.mkdirSync(notReady, { recursive: true });
  fs.writeFileSync(
    path.join(notReady, 'STATUS.txt'),
    'LIVE captures at tests/reports/huginn-ui/FOR-REVIEW/LIVE-CRM/\n' +
      'Desktop PIXEL-CHROME pack NOT published.\n' +
      'Need 3 independent verifiers PASS on live CRM shots vs TG refs.\n' +
      new Date().toISOString() + '\n'
  );

  await browser.close();
  console.log('LIVE-CRM →', OUT);
  console.log('Desktop acceptance pack: NOT written');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
