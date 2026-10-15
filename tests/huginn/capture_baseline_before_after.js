'use strict';

/**
 * P0 — capture the "BEFORE" baseline for the Huginn Telegram-grade redesign.
 * ---------------------------------------------------------------------------
 * Screens from the user TZ (Часть 1): chat list, chat thread, settings,
 * invite, story composer; plus contacts / calls / stories rail as context.
 *
 * Two surfaces, one engine:
 *   - phone  : PWA /h/               (390x844 @2x, bottom nav, rail hidden)  ← first
 *   - desktop: CRM dock in /         (rail visible, panel 400px)
 * Themes: dark + light.
 *
 * Output: tests/reports/huginn-ui/FOR-REVIEW/BEFORE/
 * Run:    node tests/huginn/capture_baseline_before_after.js
 *
 * Read-only against the app; writes files + a manifest only.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';

// CAPTURE_OUT lets the same script produce BEFORE and AFTER sets.
// e.g. CAPTURE_OUT=AFTER node tests/huginn/capture_baseline_before_after.js
const OUTDIR_NAME = process.env.CAPTURE_OUT || 'BEFORE';
const OUT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW', OUTDIR_NAME);
const ONLY = (process.env.CAPTURE_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean); // e.g. "desktop:light,phone:dark"
const PHOTO = path.join(__dirname, 'fixtures_photo.png');

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

fs.mkdirSync(OUT, { recursive: true });

const manifest = [];

function ok(m) { console.log('OK  ', m); }
function warn(m) { console.log('WARN', m); }

async function apiLogin() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login: ' + JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: String(PIN) })
    });
    const d2 = await r2.json();
    if (!r2.ok) throw new Error('pin: ' + JSON.stringify(d2));
    data = d2;
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

async function dismiss(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
    }
    try {
      localStorage.setItem('asgard_shell_banner_dismissed', '1');
      localStorage.setItem('hg_bday_banners', '0');
      localStorage.setItem('hg_dock_collapsed', '0');
    } catch (_) {}
    // CRM-оверлеи/модалки — убрать. ВАЖНО: НЕ удалять шиты дока
    // (.hg-sheet/.hg-*-sheet), иначе открытый шит стирается ПЕРЕД снимком
    // (именно это делало desktop list/invite/story байтово идентичными).
    // Модалка «Залы Асгарда»/свитки (cr-m-overlay, z=10000) реально перекрывает док.
    // Закрываем ЛЕГИТИМНО — её собственной кнопкой, а не удалением DOM.
    document.querySelectorAll('.cr-m-overlay button').forEach((b) => {
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(Позже|Закрыть|Понятно|Ок|OK)$/i.test(t)) { try { b.click(); } catch (_) {} }
    });

    document.querySelectorAll(
      '#asgard-presence-gate,#asgard-splash,.modalback,.modal-overlay,.tp-popup,#sg-overlay,.ui-modal,.hg-lightbox'
    ).forEach((el) => {
      if (el.closest('#huginnDock')) return;
      try { el.style.setProperty('display', 'none', 'important'); } catch (_) {}
    });
    // Any full-screen fixed/dim overlay (>=60% viewport) → remove (kills the
    // 0.529 dark scrim that made desktop-light captures unreadable).
    // ВАЖНО: НЕ трогаем сами шиты дока (.hg-sheet и его варианты) — они тоже
    // fixed и при анимации появления имеют opacity<1, иначе их удаляло.
    const vw = window.innerWidth, vh = window.innerHeight;
    document.querySelectorAll('body > div, body > section, body > aside').forEach((el) => {
      if (el.id === 'huginnDock' || el.classList.contains('hg-chrome')) return;
      if (el.closest('#huginnDock') || el.classList.contains('hg-sheet')
        || el.classList.contains('hg-story-sheet') || el.classList.contains('hg-invite-sheet')
        || el.classList.contains('hg-compose-sheet') || el.classList.contains('hg-chat-profile')
        || el.classList.contains('hg-ai-sheet') || el.classList.contains('hg-call-sheet')) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && r.width >= vw * 0.6 && r.height >= vh * 0.6 && Number(cs.opacity || 1) < 1) {
        try { el.style.setProperty('display', 'none', 'important'); } catch (_) {}
      }
    });
  }).catch(() => {});
}

/** Read local CSS/JS and inject so captures never use a stale ?v= cache.
 *  HUGINN_ASSETS_DIR lets us capture the historical BEFORE state from a
 *  `git show HEAD:<path>` checkout (read-only) instead of the working tree. */
function localAssets() {
  const dir = process.env.HUGINN_ASSETS_DIR || path.join(__dirname, '../../public/assets');
  return {
    css: fs.readFileSync(path.join(dir, 'css/huginn_dock.css'), 'utf8'),
    js: fs.readFileSync(path.join(dir, 'js/huginn_dock.js'), 'utf8'),
    icons: fs.readFileSync(path.join(dir, 'js/huginn_icons.js'), 'utf8')
  };
}

/** Neutralize the SERVED dock CSS so only the injected (baseline/current) stylesheet applies.
 *  ND-1: shell отдавал huginn_dock.css?v=<working tree> и он перекрашивал кадры «БЫЛО».
 *  JS НЕ трогаем: на /h/ от huginn_dock.js зависит app.js — без него док не монтируется,
 *  а оба JS (shell + инжект) сосуществуют, инжект монтирует свежий док после удаления старого. */
async function blockServedDockAssets(ctx) {
  await ctx.route('**/assets/css/huginn_dock.css*', (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '/* baseline: served css neutralized */' }));
}

async function newPhonePage(browser, auth, theme, assets) {
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  await blockServedDockAssets(ctx);
  await ctx.addInitScript(({ token, user, theme }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', theme);
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('hg_theme', theme);
    localStorage.setItem('asgard_safe_mode', '1');
    localStorage.setItem('hg_dock_collapsed', '0');
  }, { token: auth.token, user: auth.user, theme });
  const page = await ctx.newPage();
  await page.goto(BASE + '/h/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await dismiss(page);
  await page.waitForSelector('#huginnDock', { timeout: 30000 });
  // Force freshest dock CSS/JS regardless of shell ?v=
  await page.addStyleTag({ content: assets.css });
  await page.evaluate(() => {
    document.querySelectorAll('.hg-bottom-nav, #hgNavSearch').forEach((el) => el.remove());
    const d = document.querySelector('#huginnDock');
    if (d) d.remove();
  });
  await page.addScriptTag({ content: assets.icons });
  await page.addScriptTag({ content: assets.js });
  await page.evaluate(async () => {
    await window.HuginnDock.mount();
    window.HuginnDock.open();
    const host = document.querySelector('#hgHost');
    const chrome = document.querySelector('#huginnDock');
    if (host && chrome) host.appendChild(chrome);
    const nav = document.querySelector('.hg-bottom-nav');
    const fab = document.querySelector('#hgNavSearch');
    if (nav) document.body.appendChild(nav);
    if (fab) document.body.appendChild(fab);
  });
  await page.waitForTimeout(600);
  await dismiss(page);
  return { ctx, page };
}

async function newDeskPage(browser, auth, theme, assets) {
  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 2 });
  await blockServedDockAssets(ctx);
  await ctx.addInitScript(({ token, user, theme }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', theme);
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('hg_theme', theme);
    localStorage.setItem('asgard_safe_mode', '1');
    localStorage.setItem('hg_dock_collapsed', '0');
  }, { token: auth.token, user: auth.user, theme });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.body, { timeout: 20000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.addStyleTag({ content: assets.css });
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock, .hg-chrome, .hg-bottom-nav').forEach((el) => el.remove());
    if (document.body) document.body.classList.remove('hg-dock-open', 'hg-dock-collapsed');
  });
  await page.addScriptTag({ content: assets.icons });
  await page.addScriptTag({ content: assets.js });
  await page.evaluate(async () => {
    await window.HuginnDock.mount();
    window.HuginnDock.open();
  });
  await page.waitForSelector('#huginnDock', { timeout: 25000 });
  await page.waitForTimeout(600);
  await dismiss(page);
  return { ctx, page };
}

/** Crop the dock panel (+rail) for desktop, or clip status bar for phone. */
async function cropChrome(page, mode) {
  if (mode === 'desktop') {
    const box = await page.evaluate(() => {
      const rail = document.querySelector('.hg-rail');
      const panel = document.querySelector('#hgPanel');
      const r = rail && getComputedStyle(rail).display !== 'none' ? rail.getBoundingClientRect() : null;
      const p = panel ? panel.getBoundingClientRect() : null;
      if (!p) return null;
      const x = r ? Math.min(r.left, p.left) : p.left;
      return { x, y: Math.min(r ? r.top : p.top, p.top), w: (p.right - x), h: Math.max(r ? r.height : p.height, p.height) };
    });
    return box ? { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.w, height: box.h } : null;
  }
  return null;
}

async function shot(page, name, mode, opts = {}) {
  // F1 (находка верификатора): CRM-скрим (cr-m-overlay, fixed z=10000) может
  // появиться ПОСЛЕ открытия экрана/шита и затемнить кадр. Чистим непосредственно
  // перед снимком, иначе light-кадры получают медиану ~133 вместо >200.
  await dismiss(page);
  const clip = opts.full ? undefined : await cropChrome(page, mode);
  await page.screenshot({ path: path.join(OUT, name), fullPage: false, clip: clip || undefined });
  manifest.push({ file: name, mode, theme: opts.theme, screen: opts.screen, surface: opts.surface });
  ok(name);
}

/** Evaluate inside the page, forwarding one argument to the callback. */
async function dockEval(page, fn, arg) {
  return page.evaluate(fn, arg);
}

async function captureSurface(browser, auth, surface, theme, assets, chatId, groupId) {
  const isPhone = surface === 'phone';
  const mk = isPhone ? newPhonePage : newDeskPage;
  const mode = isPhone ? 'phone' : 'desktop';
  const tag = `${surface}-${theme}`;

  // ---- 1. CHAT LIST ----
  {
    const { ctx, page } = await mk(browser, auth, theme, assets);
    await dockEval(page, () => window.HuginnDock._capture.setTab('huginn'));
    await page.waitForTimeout(500);
    await shot(page, `list-${tag}.png`, mode, { theme, screen: 'list', surface });
    await ctx.close();
  }

  // ---- 2. THREAD (bubbles / time / badge) ----
  {
    const { ctx, page } = await mk(browser, auth, theme, assets);
    await dockEval(page, (id) => window.HuginnDock.openChat(id), chatId);
    await page.waitForSelector('.hg-msgs .hg-bubble', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(700);
    await dismiss(page);
    await shot(page, `thread-${tag}.png`, mode, { theme, screen: 'thread', surface });
    await ctx.close();
  }

  // ---- 3. SETTINGS ----
  {
    const { ctx, page } = await mk(browser, auth, theme, assets);
    await dockEval(page, () => window.HuginnDock._capture.setTab('settings'));
    await page.waitForTimeout(500);
    await shot(page, `settings-${tag}.png`, mode, { theme, screen: 'settings', surface });
    await ctx.close();
  }

  // ---- 4. INVITE ----
  {
    const { ctx, page } = await mk(browser, auth, theme, assets);
    await dockEval(page, () => window.HuginnDock._capture.setTab('huginn'));
    // Дать пройти асинхронным renderPanel (loadStories/loadChats), иначе шит
    // живёт внутри #hgPanel и может быть стёрт поздним перерисовыванием.
    await page.waitForTimeout(1200);
    const openSheet = () => page.evaluate(() => {
      const cap = window.HuginnDock._capture;
      if (cap && cap.openInvite) { cap.openInvite(); return true; }
      const btn = document.querySelector('#hgCompose');
      if (btn) btn.click();
      return false;
    });
    const openedDirect = await openSheet();
    if (!openedDirect) {
      // HEAD-код: открываем приглашение через compose-шит (он может перерисоваться
      // при загрузке списка пользователей) — ретраим связку compose → CTA → шит.
      let ok = false;
      for (let attempt = 0; attempt < 6 && !ok; attempt++) {
        await page.evaluate(() => {
          if (!document.querySelector('.hg-compose-sheet')) {
            const c = document.querySelector('#hgCompose');
            if (c) c.click();
          }
        });
        await page.waitForSelector('#hgComposeInvite', { timeout: 4000 }).catch(() => {});
        await page.evaluate(() => { const i = document.querySelector('#hgComposeInvite'); if (i) i.click(); });
        await page.waitForSelector('.hg-invite-sheet', { timeout: 4000 }).catch(() => {});
        ok = !!(await page.$('.hg-invite-sheet'));
        if (!ok) await page.waitForTimeout(500);
      }
    }
    await page.waitForSelector('.hg-invite-sheet', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, `invite-${tag}.png`, mode, { theme, screen: 'invite', surface });
    await ctx.close();
  }

  // ---- 5. STORY composer ----
  {
    const { ctx, page } = await mk(browser, auth, theme, assets);
    await dockEval(page, () => window.HuginnDock._capture.setTab('huginn'));
    await page.waitForTimeout(1200);
    const openStory = () => page.evaluate(() => {
      const cap = window.HuginnDock._capture;
      if (cap && cap.openStory) { cap.openStory(); return; }
      const add = document.querySelector('#hgStoryAdd');
      if (add) add.click();
    });
    // Поздний renderPanel (loadStories/SSE) может стереть шит. Открываем и ЖДЁМ
    // стабилизации: шит стабилен, если через 700мс он всё ещё в DOM. Детект
    // универсален: в HEAD это .hg-story-sheet (нет .hg-dropzone), в новом — оба.
    const hasSheet = () => page.evaluate(() =>
      !!document.querySelector('.hg-story-sheet') || !!document.querySelector('.hg-dropzone'));
    let okSheet = false;
    for (let attempt = 0; attempt < 4 && !okSheet; attempt++) {
      await openStory();
      await page.waitForTimeout(700);
      okSheet = await hasSheet();
    }
    if (!okSheet) warn('story sheet not open for ' + tag);
    else ok('story sheet stable for ' + tag);
    await shot(page, `story-${tag}.png`, mode, { theme, screen: 'story', surface });
    await ctx.close();
  }

  // ---- 6. CONTACTS (context) ----
  {
    const { ctx, page } = await mk(browser, auth, theme, assets);
    await dockEval(page, () => window.HuginnDock._capture.setTab('contacts'));
    await page.waitForTimeout(700);
    await shot(page, `contacts-${tag}.png`, mode, { theme, screen: 'contacts', surface });
    await ctx.close();
  }
}

async function main() {
  const assets = localAssets();
  const auth = await apiLogin();
  ok('logged in as ' + (auth.user.name || auth.user.login || LOGIN));
  if (!fs.existsSync(PHOTO)) warn('fixtures_photo.png missing — thread will have no media');

  // Seed a group chat with realistic conversation (idempotent-ish: reuse if exists).
  let groupId = null;
  {
    const list = await api(auth.token, 'GET', '/api/chat-groups?archived=false');
    const existing = (list.data.chats || []).find((c) => c.is_group && /BEFORE demo/i.test(c.name || ''));
    if (existing) groupId = Number(existing.id);
    else {
      const dir = await api(auth.token, 'GET', '/api/chat-groups/directory');
      const members = (dir.data.users || []).filter((u) => Number(u.user_id) !== Number(auth.user.id)).slice(0, 3).map((u) => Number(u.user_id));
      const cr = await api(auth.token, 'POST', '/api/chat-groups', { name: 'BEFORE demo', member_ids: members, group_kind: 'work' });
      groupId = Number(cr.data.chat && cr.data.chat.id || cr.data.id);
      if (members.length) {
        for (const text of [
          'Коллеги, добрый день! Напоминаю: акты и счета нужно сдать до пятницы.',
          'Принял, сегодня отправлю закрывающие документы.',
          'Спасибо! По объекту на Ленина ждём фотоотчёт.'
        ]) {
          await api(auth.token, 'POST', `/api/chat-groups/${groupId}/messages`, { text });
        }
      }
    }
    ok('group chat id=' + groupId);
  }
  const chatId = groupId;

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // Phone first (user decision), then desktop; dark then light.
  for (const surface of ['phone', 'desktop']) {
    for (const theme of ['dark', 'light']) {
      if (ONLY.length && !ONLY.includes(`${surface}:${theme}`)) continue;
      try {
        await captureSurface(browser, auth, surface, theme, assets, chatId, groupId);
      } catch (e) {
        warn(`${surface}/${theme} failed: ${e.message}`);
      }
    }
  }

  await browser.close();
  const manifestPath = path.join(OUT, 'MANIFEST.json');
  let prev = { shots: [] };
  if (ONLY.length && fs.existsSync(manifestPath)) {
    try { prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) {}
  }
  const keep = (prev.shots || []).filter((s) => !manifest.some((m) => m.file === s.file));
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, chat_id: chatId, theme_surfaces: ['phone', 'desktop'], shots: keep.concat(manifest) }, null, 2)
  );
  ok(`wrote ${manifest.length} shots + MANIFEST.json to ${OUTDIR_NAME}/`);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
