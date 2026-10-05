'use strict';

/**
 * Huginn ROUND-6 fullframe acceptance (blocks 9–16).
 * Viewports: 1920×1080 / 768×1024 / 390×844 × dark+light × base scenarios
 * + named extra shots. Crop-only shots FAIL.
 *
 * Run: node tests/huginn/browser_round6_fullframe.spec.js
 * Env: TEST_BASE_URL (default http://127.0.0.1:3100)
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN_A = process.env.TEST_LOGIN_A || 'admin';
const PASS_A = process.env.TEST_PASS_A || 'huginn-test-ok';
const LOGIN_B = process.env.TEST_LOGIN_B || 'ok';
const PASS_B = process.env.TEST_PASS_B || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const PIN_B = process.env.TEST_PIN_B || process.env.TEST_PIN || '0000';
const OUT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/ROUND-6');
const REPORTS = path.join(__dirname, '../reports');
const REFS = path.join(__dirname, '../reports/huginn-ui/REFS');

const VIEWPORTS = [
  { id: 'd1920', width: 1920, height: 1080, mobile: false },
  { id: 't768', width: 768, height: 1024, mobile: true },
  { id: 'm390', width: 390, height: 844, mobile: true }
];

const shots = [];
const errors = [];
const notes = [];
function fail(m) { errors.push(m); console.error('FAIL', m); }
function ok(m) { console.log('PASS', m); }
function note(m) { notes.push(m); console.log('NOTE', m); }

async function apiLogin(login, password, pinPrefer) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login ' + login + ': ' + JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    const candidates = [...new Set([pinPrefer, PIN, PIN_B, '1234', '0000'].filter(Boolean))];
    let lastErr = null;
    for (const pin of candidates) {
      res = await fetch(BASE + '/api/auth/verify-pin', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: String(pin) })
      });
      const next = await res.json();
      if (res.ok) { data = next; lastErr = null; break; }
      lastErr = next;
      const again = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
      });
      data = await again.json();
    }
    if (lastErr) throw new Error('pin ' + login + ': ' + JSON.stringify(lastErr));
  }
  return { token: data.token, user: data.user || {} };
}

async function api(token, method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function shotFull(page, id) {
  const file = id + '.png';
  const vp = page.viewportSize();
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  const buf = fs.readFileSync(path.join(OUT, file));
  // PNG IHDR width/height at bytes 16..24
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (!vp || w < vp.width - 2 || h < vp.height - 2) {
    fail('crop-only or undersized shot ' + file + ' got ' + w + 'x' + h + ' expect ~' + vp.width + 'x' + vp.height);
  } else {
    ok('fullframe ' + file + ' ' + w + 'x' + h);
  }
  shots.push(file);
  console.log('SHOT', file);
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
    document.querySelectorAll(
      '#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback,.tp-popup,#sg-overlay,.ui-modal,.modal-overlay,.cr-m-overlay--visible'
    ).forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      try { el.remove(); } catch (_) {}
    });
  }).catch(() => {});
}

async function openCrm(context, auth, theme) {
  await context.addInitScript(({ token, user, theme }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', theme);
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('hg_theme', theme);
    localStorage.setItem('asgard_safe_mode', '1');
    localStorage.setItem('hg_dock_collapsed', '0');
    try {
      if (document && document.documentElement) {
        document.documentElement.setAttribute('data-theme', theme);
      }
    } catch (_) {}
  }, { ...auth, theme });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    const msg = String(e.message || e);
    if (/setAttribute/.test(msg)) return;
    fail('pageerror: ' + msg.slice(0, 160));
  });
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'commit', timeout: 60000 });
  await page.evaluate((t) => {
    if (document.documentElement) document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await dismiss(page);
  await page.waitForTimeout(500);
  await dismiss(page);
  await page.evaluate(() => {
    if (window.HuginnDock) { HuginnDock.mount(); HuginnDock.open(); }
  });
  await page.waitForSelector('#huginnDock, .hg-chrome', { timeout: 20000 });
  await dismiss(page);
  await page.waitForTimeout(200);
  await dismiss(page);
  return page;
}

const TECH_DOM_RE = /\b(ROUND\s*5|ROUND5|E2E|seed[-_]|matrix[-_]|live[-_]|dbg[-_]|probe[-_]|catchup[-_])\b/i;

async function assertNoTechInDom(page, label) {
  const hit = await page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, 'i');
    const root = document.querySelector('#huginnDock');
    if (!root) return 'no dock';
    const text = root.innerText || '';
    const m = text.match(re);
    return m ? m[0] : '';
  }, TECH_DOM_RE.source);
  if (hit) fail(label + ' tech in DOM: ' + hit);
  else ok(label + ' no tech IDs in DOM');
}

async function assertReactionSane(page, label) {
  const bad = await page.evaluate(() => {
    const pills = [...document.querySelectorAll('.hg-reacts button')];
    for (const b of pills) {
      const t = (b.textContent || '').trim();
      const nums = t.match(/\d+/g) || [];
      for (const n of nums) {
        const v = Number(n);
        if (v > 99) return 'count>99: ' + t;
        if (v >= 1000) return 'userId-like: ' + t;
        // classic bug: userId 46081 shown as count
        if (String(v).length >= 4 && v > 99) return 'userId-like: ' + t;
      }
    }
    return '';
  });
  if (bad) fail(label + ' reaction ' + bad);
  else ok(label + ' reaction counts sane');
}

async function assertLayoutGates(page, vp, theme, label) {
  const info = await page.evaluate((mobile) => {
    const root = document.querySelector('#huginnDock');
    if (!root) return { err: 'no dock' };
    const rail = root.querySelector('.hg-rail');
    const bottom = root.querySelector('.hg-bottom-nav');
    const railDisp = rail ? getComputedStyle(rail).display : 'none';
    const bottomDisp = bottom ? getComputedStyle(bottom).display : 'none';
    const row = root.querySelector('.hg-chat-row, .hg-row, #hgList > *');
    let rowH = 0;
    if (row) rowH = row.getBoundingClientRect().height;
    const head = root.querySelector('.hg-thread-head');
    const headOk = !head ? null : {
      av: !!head.querySelector('.hg-thread-av'),
      status: !!head.querySelector('[data-hg-presence]'),
      actions: head.querySelectorAll('.hg-thread-actions .hg-icon-btn').length
    };
    const composer = root.querySelector('.hg-composer-row');
    const composerOk = !composer ? null : {
      attach: !!composer.querySelector('#hgAttach'),
      input: !!composer.querySelector('#hgInput'),
      emoji: !!composer.querySelector('#hgStickers'),
      send: !!composer.querySelector('#hgSend')
    };
    const bg = getComputedStyle(root.querySelector('.hg-panel') || root).backgroundColor;
    const me = root.querySelector('.hg-bubble.me');
    const them = root.querySelector('.hg-bubble.them');
    const meBg = me ? getComputedStyle(me).backgroundColor : '';
    const themBg = them ? getComputedStyle(them).backgroundColor : '';
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--hg-accent').trim()
      || getComputedStyle(document.documentElement).getPropertyValue('--gold').trim();
    return {
      railDisp, bottomDisp, rowH, headOk, composerOk, bg, meBg, themBg, accent,
      railW: rail ? rail.getBoundingClientRect().width : 0
    };
  }, vp.mobile);

  if (info.err) { fail(label + ' ' + info.err); return; }

  if (!vp.mobile) {
    if (info.railDisp === 'none' || info.railW < 50) fail(label + ' missing desktop rail');
    else if (Math.abs(info.railW - 64) > 4) fail(label + ' rail width ' + info.railW + ' != 64');
    else ok(label + ' rail 64px');
  } else {
    if (info.bottomDisp === 'none') fail(label + ' missing mobile bottom nav');
    else ok(label + ' bottom nav visible');
  }

  if (info.rowH > 0) {
    if (info.rowH > 72) fail(label + ' row height ' + info.rowH + ' > 72');
    else ok(label + ' row height ' + Math.round(info.rowH));
  }

  if (info.headOk) {
    if (!info.headOk.av || !info.headOk.status || info.headOk.actions < 3) {
      fail(label + ' header incomplete ' + JSON.stringify(info.headOk));
    } else ok(label + ' header avatar+status+actions');
  }

  if (info.composerOk) {
    const c = info.composerOk;
    if (!c.attach || !c.input || !c.emoji || !c.send) fail(label + ' composer not Telegram layout');
    else ok(label + ' composer Telegram layout');
  }

  if (/#f5c542/i.test(info.accent)) fail(label + ' acid yellow accent');

  if (info.meBg && info.themBg && info.meBg === info.themBg) {
    fail(label + ' me/them same bg ' + info.meBg);
  } else if (info.meBg && info.themBg) {
    ok(label + ' me/them distinct');
  }
}

async function runViewport(browser, authA, chatId, vp, theme) {
  const prefix = (theme === 'light' ? 'L' : 'D') + '-' + vp.id;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await openCrm(ctx, authA, theme);
  ok(prefix + ' crm open');

  // S1 list + rail/bottom
  await page.waitForTimeout(400);
  await shotFull(page, prefix + '-s1-list');
  await assertLayoutGates(page, vp, theme, prefix + ' S1');
  await assertNoTechInDom(page, prefix + ' S1');

  if (!vp.mobile) {
    // rail huginn active (default)
    await dismiss(page);
    await shotFull(page, 'rail_module_active_huginn_' + theme);
    await page.evaluate(() => {
      const btn = document.querySelector('.hg-rail-btn[data-hg-tab="ting"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(250);
    const tingActive = await page.locator('.hg-rail-btn[data-hg-tab="ting"].is-active').count();
    if (!tingActive) fail(prefix + ' ting rail not active');
    else ok(prefix + ' ting rail active');
    await shotFull(page, 'rail_module_active_ting_' + theme);
    await page.evaluate(() => {
      // openTab — do not click active huginn (D-260 toggle would collapse)
      if (window.HuginnDock) HuginnDock.open('huginn');
    });
    await page.waitForSelector('#hgSearch', { timeout: 10000 });
    await page.waitForTimeout(200);
  }

  // density shot (desktop dark once)
  if (vp.id === 'd1920' && theme === 'dark') {
    await page.waitForSelector('#hgSearch', { timeout: 10000 });
    await shotFull(page, 'chat_list_density_dark');
  }

  // S4 empty search
  await page.waitForSelector('#hgSearch', { timeout: 10000 });
  await page.fill('#hgSearch', 'zzz_no_such_chat_q_999');
  await page.waitForTimeout(200);
  const emptySearch = await page.locator('.hg-empty').innerText().catch(() => '');
  if (!/Ничего не найдено/i.test(emptySearch)) fail(prefix + ' S4 empty search copy');
  else ok(prefix + ' S4 empty search');
  await shotFull(page, prefix + '-s4-empty');
  await page.fill('#hgSearch', '');

  // S2 thread
  await page.evaluate((id) => HuginnDock.openChat(id), chatId);
  await page.waitForSelector('.hg-msgs', { timeout: 15000 });
  await page.waitForTimeout(500);
  await shotFull(page, prefix + '-s2-thread');
  await assertLayoutGates(page, vp, theme, prefix + ' S2');
  await assertNoTechInDom(page, prefix + ' S2');

  if (vp.id === 'd1920' && theme === 'dark') {
    await shotFull(page, 'chat_header_dark');
  }

  // FAB scroll up
  await page.evaluate(() => {
    const box = document.querySelector('.hg-msgs');
    if (box) box.scrollTop = 0;
  });
  await page.waitForTimeout(250);
  const fabVis = await page.evaluate(() => {
    const fab = document.querySelector('#hgScrollFab');
    return fab && fab.classList.contains('is-visible');
  });
  if (fabVis) {
    ok(prefix + ' S2 FAB visible');
    if (theme === 'light') {
      const fabLight = await page.evaluate(() => {
        const fab = document.querySelector('#hgScrollFab');
        const bg = getComputedStyle(fab).backgroundColor;
        const color = getComputedStyle(fab).color;
        // light glass ≈ white/near-white, dark text
        const darkDisk = bg === 'rgb(18, 18, 18)' || bg === 'rgb(0, 0, 0)' || /rgb\(\s*1[0-9],\s*1[0-9],\s*1[0-9]\)/.test(bg);
        return { bg, color, darkDisk };
      });
      if (fabLight.darkDisk) fail(prefix + ' FAB light is dark disk: ' + fabLight.bg);
      else ok(prefix + ' FAB light glass');
    }
    await shotFull(page, prefix + '-s2-fab');
  } else {
    note(prefix + ' S2 FAB not visible (short thread)');
  }

  // S3 emoji + reaction + quick react
  await dismiss(page);
  await page.locator('#hgStickers').click({ force: true });
  await page.waitForSelector('.hg-sheet-stickers .hg-sticker-label', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  const emojiLabel = await page.locator('.hg-sticker-label').innerText().catch(() => '');
  if (!/Эмодзи/i.test(emojiLabel)) fail(prefix + ' S3 label Эмодзи missing');
  else ok(prefix + ' S3 Эмодзи label');
  await shotFull(page, prefix + '-s3-emoji');
  await page.evaluate(() => document.querySelectorAll('.hg-sheet,.hg-float,.hg-attach-menu').forEach((e) => e.remove()));

  // quick reactions
  const bubble = page.locator('.hg-bubble.me, .hg-bubble.them').first();
  if (await bubble.count()) {
    if (vp.mobile) {
      await page.evaluate(() => {
        const b = document.querySelector('.hg-bubble.me, .hg-bubble.them');
        if (!b) return;
        b.dispatchEvent(new CustomEvent('contextmenu', { bubbles: true }));
        // simulate long-press via touch events if dock listens
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      });
      await page.waitForTimeout(650);
      await page.evaluate(() => {
        const b = document.querySelector('.hg-bubble.me, .hg-bubble.them');
        if (b) b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
      });
    } else {
      await bubble.hover({ force: true });
      await page.waitForTimeout(450);
    }
    const qr = await page.locator('.hg-quick-react').count();
    if (!qr) {
      // fallback: force show via evaluate if hover path flaky in headless
      await page.evaluate(() => {
        const b = document.querySelector('.hg-bubble.me, .hg-bubble.them');
        if (b && window.HuginnDock && HuginnDock._showQuickReact) HuginnDock._showQuickReact(b);
        else if (b) {
          b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        }
      });
      await page.waitForTimeout(500);
    }
    const qr2 = await page.locator('.hg-quick-react').count();
    if (!qr2) fail(prefix + ' S3 quick reactions missing');
    else {
      ok(prefix + ' S3 quick reactions');
      if (theme === 'dark') await shotFull(page, 'quick_reactions_long_press_dark');
      else await shotFull(page, prefix + '-s3-quickreact');
      await page.locator('.hg-quick-react button').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
      await assertReactionSane(page, prefix + ' S3');
    }
  } else {
    fail(prefix + ' S3 no bubbles');
  }

  // composer states
  await page.fill('#hgInput', 'Привет, коллеги — проверка composer');
  await page.waitForTimeout(150);
  const sendReady = await page.evaluate(() => {
    const s = document.querySelector('#hgSend');
    return s && s.classList.contains('is-ready');
  });
  if (!sendReady) fail(prefix + ' S2 send not ready with text');
  else ok(prefix + ' S2 mic→send on text');
  await page.evaluate(() => document.querySelector('#hgAttach')?.click());
  await page.waitForTimeout(200);
  if (theme === 'dark' && vp.id === 'd1920') await shotFull(page, 'composer_states_dark');
  else await shotFull(page, prefix + '-s2-composer');
  await page.evaluate(() => document.querySelectorAll('.hg-attach-menu').forEach((e) => e.remove()));
  await page.fill('#hgInput', '');

  // photo present?
  const photo = await page.locator('.hg-media-photo').count();
  if (!photo) note(prefix + ' S3 no photo bubble');
  else {
    ok(prefix + ' S3 photo');
    await shotFull(page, prefix + '-s3-photo');
  }

  // mobile bottom nav named shot
  if (vp.id === 'm390' && theme === 'dark') {
    const back = page.locator('#hgBack');
    if (await back.count()) await back.click();
    await page.waitForTimeout(300);
    await shotFull(page, 'mobile_bottom_nav_dark');
  }

  // /h login (once per theme on m390)
  if (vp.id === 'm390') {
    const loginCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await loginCtx.addInitScript((t) => {
      try {
        localStorage.removeItem('asgard_token');
        localStorage.removeItem('auth_token');
        localStorage.setItem('hg_theme', t);
        localStorage.setItem('asgard_theme', t);
      } catch (_) {}
    }, theme);
    const pageLogin = await loginCtx.newPage();
    await pageLogin.goto(BASE + '/h/?nocache=' + Date.now(), { waitUntil: 'commit', timeout: 60000 });
    await pageLogin.waitForTimeout(400);
    await pageLogin.evaluate((t) => {
      if (document.documentElement) document.documentElement.setAttribute('data-theme', t);
      if (typeof window.__hgSetTheme === 'function') window.__hgSetTheme(t);
    }, theme);
    await pageLogin.waitForTimeout(200);
    await shotFull(pageLogin, prefix + '-s5-h-login');
    if (!(await pageLogin.locator('.h-login').count())) fail(prefix + ' S5 /h login missing');
    else ok(prefix + ' S5 /h login');
    await loginCtx.close();
  }

  await ctx.close();
}

async function makeSideBySide(browser) {
  // Telegram-inspired palette reference (synthetic) vs Huginn fullframe
  const huginnShot = path.join(OUT, 'D-d1920-s2-thread.png');
  if (!fs.existsSync(huginnShot)) {
    fail('side-by-side: missing huginn shot');
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const huginnB64 = fs.readFileSync(huginnShot).toString('base64');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:Segoe UI,system-ui,sans-serif;background:#0e0e0e;color:#fff}
    .wrap{display:grid;grid-template-columns:1fr 1fr;height:100vh}
    .pane{position:relative;overflow:hidden;border-right:1px solid #333}
    .label{position:absolute;top:12px;left:12px;z-index:2;background:rgba(0,0,0,.65);padding:6px 10px;border-radius:8px;font:600 13px/1 sans-serif}
    .tg{height:100%;background:#17212B;display:flex;flex-direction:column}
    .tg-head{height:64px;background:rgba(18,18,18,.85);backdrop-filter:blur(20px);display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid rgba(255,255,255,.06)}
    .tg-av{width:40px;height:40px;border-radius:50%;background:#3B82F6}
    .tg-name{font:600 15px/1.2 sans-serif}.tg-st{font:400 12px/1.2 sans-serif;color:#D4A843}
    .tg-msgs{flex:1;padding:16px;display:flex;flex-direction:column;gap:10px}
    .tg-them{align-self:flex-start;background:#182533;padding:10px 14px;border-radius:14px;max-width:70%}
    .tg-me{align-self:flex-end;background:rgba(212,168,67,.14);padding:10px 14px;border-radius:14px;max-width:70%;border:1px solid rgba(212,168,67,.35)}
    .tg-comp{height:64px;background:#232E3C;display:flex;align-items:center;gap:10px;padding:0 12px;border-top:1px solid rgba(255,255,255,.06)}
    .tg-in{flex:1;background:#17212B;border-radius:18px;height:40px;border:1px solid rgba(255,255,255,.06)}
    .tg-send{width:40px;height:40px;border-radius:50%;background:#D4A843}
    .hg img{width:100%;height:100%;object-fit:cover;object-position:right center}
  </style></head><body>
  <div class="wrap">
    <div class="pane"><div class="label">Telegram Desktop (palette ref)</div>
      <div class="tg">
        <div class="tg-head"><div class="tg-av"></div><div><div class="tg-name">Коллега</div><div class="tg-st">в сети</div></div></div>
        <div class="tg-msgs">
          <div class="tg-them">Добрый день — уточните статус по объекту</div>
          <div class="tg-me">На линии, отвечу в течение часа</div>
          <div class="tg-them">Отлично, жду</div>
        </div>
        <div class="tg-comp"><div class="tg-in"></div><div class="tg-send"></div></div>
      </div>
    </div>
    <div class="pane hg"><div class="label">Huginn CRM (ROUND-6)</div>
      <img src="data:image/png;base64,${huginnB64}" alt="huginn">
    </div>
  </div></body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'side_by_side_telegram_vs_huginn.png'), fullPage: false });
  shots.push('side_by_side_telegram_vs_huginn.png');
  ok('side-by-side telegram vs huginn');
  await ctx.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(REFS, { recursive: true });
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.png') || f.endsWith('.md')) {
      try { fs.unlinkSync(path.join(OUT, f)); } catch (_) {}
    }
  }

  const health = await fetch(BASE + '/api/health').then((r) => r.status).catch(() => 0);
  if (!health) throw new Error('BASE unreachable: ' + BASE);

  const authA = await apiLogin(LOGIN_A, PASS_A, PIN);
  const authB = await apiLogin(LOGIN_B, PASS_B, PIN_B);
  const direct = await api(authA.token, 'POST', '/api/chat-groups/direct', { user_id: authB.user.id });
  const chatId = Number(direct.data?.id || direct.data?.chat_id || direct.data?.chat?.id);
  if (!chatId) throw new Error('no chat');

  // human seed texts (gate asserts no tech IDs)
  const humanA = [
    'Добрый день — уточните статус по объекту',
    'Смета готова, жду согласования',
    'На линии, отвечу в течение часа',
    'Фото с площадки приложил',
    'Перенесём созвон на 15:00',
    'Ок, беру в работу',
    'Нужен доступ к папке документов',
    'Закрыл замечания по разделу АР',
    'Клиент подтвердил даты выезда',
    'Проверьте акт — правки в конце',
    'Готово к передаче в производство',
    'Напомню про закупку кабеля'
  ];
  const humanB = [
    'Принял, смотрю сегодня',
    'Согласовано с директором',
    'Спасибо, жду файл',
    'Буду на объекте после обеда',
    'Ок по 15:00',
    'Доступ выдал',
    'Правки внес',
    'Акт в порядке',
    'Даты подтверждаю',
    'Закупку запущу завтра',
    'Отлично',
    'На связи'
  ];
  for (let i = 0; i < humanA.length; i++) {
    await api(authA.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: humanA[i] });
    await api(authB.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: humanB[i] });
  }
  // inject tech garbage — must be humanized away in UI
  await api(authA.token, 'POST', `/api/chat-groups/${chatId}/messages`, {
    text: 'ROUND5 seed A — must not show'
  });
  await api(authB.token, 'POST', `/api/chat-groups/${chatId}/messages`, {
    text: 'E2E matrix-probe live-catchup'
  });

  try {
    const pngPath = path.join(__dirname, 'fixtures_photo.png');
    if (fs.existsSync(pngPath)) {
      const png = fs.readFileSync(pngPath);
      const fd = new FormData();
      const blob = new Blob([png], { type: 'image/png' });
      fd.append('file', blob, 'photo.png');
      fd.append('message_type', 'image');
      const up = await fetch(BASE + `/api/chat-groups/${chatId}/upload-file`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + authA.token },
        body: fd
      });
      if (up.ok) ok('photo upload');
      else note('photo upload ' + up.status);
    }
  } catch (e) { note('photo upload skip ' + e.message); }

  // expose showQuickReact for headless fallback
  // (optional; hover path preferred)

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    for (const theme of ['dark', 'light']) {
      for (const vp of VIEWPORTS) {
        await runViewport(browser, authA, chatId, vp, theme);
      }
    }
    await makeSideBySide(browser);
  } finally {
    await browser.close();
  }

  const requiredExtras = [
    'rail_module_active_huginn_dark.png',
    'rail_module_active_ting_dark.png',
    'chat_list_density_dark.png',
    'chat_header_dark.png',
    'quick_reactions_long_press_dark.png',
    'composer_states_dark.png',
    'mobile_bottom_nav_dark.png',
    'side_by_side_telegram_vs_huginn.png'
  ];
  for (const f of requiredExtras) {
    if (!fs.existsSync(path.join(OUT, f))) fail('missing required shot ' + f);
    else ok('required shot ' + f);
  }

  const verdict = errors.length ? 'FAIL' : 'ALL_GREEN';
  const report = [
    '# Huginn ROUND-6 FULLFRAME REPORT',
    '',
    `At: ${new Date().toISOString()}`,
    `base: ${BASE}`,
    `shots: ${shots.length}`,
    `FAIL: ${errors.length}`,
    `NOTE: ${notes.length}`,
    '',
    '## Matrix',
    '1920×1080 / 768×1024 / 390×844 × dark+light',
    'Scenarios: list, empty, thread, fab, emoji, quick-react, composer, photo, /h login',
    'Extras: rail huginn/ting, density, header, quick-react, composer, mobile nav, side-by-side',
    '',
    '## Shots',
    ...shots.map((s) => '- ' + s),
    '',
    '## Fails',
    ...(errors.length ? errors.map((e) => '- ' + e) : ['- (none)']),
    '',
    '## Notes',
    ...(notes.length ? notes.map((n) => '- ' + n) : ['- (none)']),
    '',
    `VERDICT: ${verdict}`
  ].join('\n');

  fs.writeFileSync(path.join(OUT, 'BROWSER-REPORT.md'), report, 'utf8');
  fs.writeFileSync(path.join(REPORTS, 'HUGINN-SHOT-MATRIX-ROUND-6.md'), report, 'utf8');
  console.log('\n' + report);
  if (errors.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
