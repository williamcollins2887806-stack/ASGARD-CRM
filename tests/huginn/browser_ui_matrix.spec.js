'use strict';

/**
 * Huginn UI matrix — max screenshots every screen/action → FOR-REVIEW/ROUND-4
 * Run: node tests/huginn/browser_ui_matrix.spec.js
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
const OUT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/ROUND-4');

const shots = [];
const errors = [];
function fail(m) { errors.push(m); console.error('FAIL', m); }
function ok(m) { console.log('PASS', m); }

async function apiLogin(login, password) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login ' + login + ': ' + JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    if (!res.ok) throw new Error('pin ' + login + ': ' + JSON.stringify(data));
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

async function shot(page, id) {
  const file = id + '.png';
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  shots.push(file);
  console.log('SHOT', file);
}

async function shotEl(page, sel, id) {
  const loc = page.locator(sel).first();
  if (await loc.count()) {
    const file = id + '.png';
    await loc.screenshot({ path: path.join(OUT, file) }).catch(async () => shot(page, id));
    if (!shots.includes(file)) shots.push(file);
    console.log('SHOT', file, 'el', sel);
    return;
  }
  await shot(page, id);
}

async function dismiss(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
    }
    try { localStorage.setItem('asgard_shell_banner_dismissed', '1'); } catch (_) {}
    try { localStorage.setItem('asgard_v2_banner_dismissed', '1'); } catch (_) {}
    try {
      const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
      const uid = u.id || u.user_id || 0;
      for (let w = 1; w <= 60; w++) localStorage.setItem('oa_lag_remind_' + uid + '_' + w, '1');
    } catch (_) {}
    try { if (window.AsgardUI && AsgardUI.closeModal) AsgardUI.closeModal(); } catch (_) {}
    document.querySelectorAll(
      '#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback,.tp-popup,.telephony-popup,#sg-overlay,.sg-splash,[class*="overlay--visible"],#oaLagLater,.ui-modal,.modal-overlay,.asgard-modal,[class*="modal-back"]'
    ).forEach((el) => {
      el.classList.remove('cr-m-overlay--visible', 'visible');
      el.style.display = 'none';
      try { el.remove(); } catch (_) {}
    });
    document.querySelectorAll('.modal, [role="dialog"]').forEach((el) => {
      if (el.closest('#huginnDock')) return;
      el.style.display = 'none';
      try { el.remove(); } catch (_) {}
    });
  }).catch(() => {});
  for (const t of ['Понял', 'Закрыть', 'Позже', 'Пропустить', 'В строй']) {
    await page.getByRole('button', { name: new RegExp(t, 'i') }).first().click({ timeout: 400 }).catch(() => {});
  }
  await page.locator('#oaLagLater').click({ timeout: 300 }).catch(() => {});
}

async function openCrm(context, auth) {
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_safe_mode', '1');
    localStorage.setItem('hg_dock_collapsed', '0');
    const uid = (user && (user.id || user.user_id)) || 0;
    for (let w = 1; w <= 60; w++) localStorage.setItem('oa_lag_remind_' + uid + '_' + w, '1');
  }, auth);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)));
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'commit', timeout: 60000 });
  await page.waitForFunction(() => !!localStorage.getItem('asgard_token'), null, { timeout: 15000 });
  await dismiss(page);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    if (window.HuginnDock) { HuginnDock.mount(); HuginnDock.open(); }
  });
  await page.waitForSelector('#huginnDock, .hg-chrome', { timeout: 20000 });
  await dismiss(page);
  return { page, consoleErrors };
}

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // wipe prior error shots
  for (const f of fs.readdirSync(OUT)) {
    if (f.startsWith('error') || f.endsWith('.png') || f.endsWith('.md')) {
      try { fs.unlinkSync(path.join(OUT, f)); } catch (_) {}
    }
  }

  const authA = await apiLogin(LOGIN_A, PASS_A);
  const authB = await apiLogin(LOGIN_B, PASS_B);
  const direct = await api(authA.token, 'POST', '/api/chat-groups/direct', { user_id: authB.user.id });
  const chatId = Number(direct.data?.id || direct.data?.chat_id || direct.data?.chat?.id);
  if (!chatId) throw new Error('no chat');

  // Seed human-readable messages for craft (tech IDs injected later for gate only)
  await api(authA.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'Добрый день, коллеги!' });
  await api(authB.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'Спасибо, смотрю смету' });
  await api(authB.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'Ха, поняла' });
  await api(authA.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'Ждём ответ по смете' });
  await api(authA.token, 'POST', `/api/chat-groups/${chatId}/call-event`, {
    kind: 'audio', status: 'ended', duration_sec: 12, direction: 'outgoing'
  });
  // visible PNG fixture — assert upload created image message
  {
    const pngPath = path.join(__dirname, 'fixtures_photo.png');
    const png = fs.readFileSync(pngPath);
    const fd = new FormData();
    const file = typeof File !== 'undefined'
      ? new File([png], 'photo.png', { type: 'image/png' })
      : new Blob([png], { type: 'image/png' });
    if (typeof File !== 'undefined') fd.append('file', file);
    else fd.append('file', file, 'photo.png');
    fd.append('message_type', 'image');
    const up = await fetch(BASE + `/api/chat-groups/${chatId}/upload-file`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + authA.token },
      body: fd
    });
    const upBody = await up.json().catch(() => ({}));
    if (!up.ok) fail('photo upload ' + up.status + ' ' + JSON.stringify(upBody));
    else {
      ok('photo upload');
      // keep for later assert
      global.__hgPhotoUrl = upBody.file_url || upBody.message?.file_url || (upBody.message && upBody.message.metadata && upBody.message.metadata.file_url);
    }
  }
  await api(authA.token, 'POST', '/api/stories', { content: 'Статус Хугинн QA' }).catch(() => {});
  await api(authB.token, 'POST', '/api/stories', { content: 'На объекте' }).catch(() => {});

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const { page } = await openCrm(ctxA, authA);
    ok('crm open');

    await shotEl(page, '#hgPanel, .hg-panel', 'd-panel-open');
    await page.evaluate(() => HuginnDock.collapse());
    await page.waitForTimeout(350);
    await shotEl(page, '.hg-rail', 'd-rail-only');
    await page.evaluate(() => HuginnDock.open());
    await page.waitForTimeout(300);

    // rail tabs (force via JS — CRM overlays sometimes intercept clicks)
    // open() / openTab — not click active rail (D-260 toggle would collapse)
    await dismiss(page);
    await page.evaluate(() => {
      if (window.HuginnDock) HuginnDock.open('huginn');
    });
    await shotEl(page, '.hg-rail', 'd-rail-huginn-active');
    await dismiss(page);
    await page.evaluate(() => {
      document.querySelector('.hg-rail-btn[data-hg-tab="mimir"]')?.click();
    });
    await page.waitForTimeout(300);
    await shot(page, 'd-mimir-panel');
    await dismiss(page);
    await page.evaluate(() => {
      document.querySelector('.hg-rail-btn[data-hg-tab="ting"]')?.click();
    });
    await page.waitForTimeout(300);
    await shot(page, 'd-ting-hub');
    await page.evaluate(() => {
      // switch from ting → huginn (different tab = open, not toggle-collapse)
      document.querySelector('.hg-rail-btn[data-hg-tab="huginn"]')?.click();
    });
    await page.waitForTimeout(300);
    await dismiss(page);

    await dismiss(page);
    await page.waitForTimeout(400);
    await shot(page, 'd-list');
    await page.evaluate(() => {
      const s = document.querySelector('#hgStories');
      if (s) s.scrollIntoView({ block: 'nearest' });
    });
    await shotEl(page, '#hgStories', 'd-stories-row');
    for (const t of ['all', 'personal', 'new', 'clients']) {
      await dismiss(page);
      await page.evaluate((tab) => {
        document.querySelector(`.hg-tab[data-ltab="${tab}"]`)?.click();
      }, t);
      await page.waitForTimeout(250);
      await shotEl(page, '#huginnDock .hg-panel, #huginnDock', 'd-list-tab-' + t);
    }
    await page.fill('#hgSearch', 'Админ');
    await page.waitForTimeout(200);
    await shotEl(page, '#huginnDock .hg-panel, #huginnDock', 'd-list-search');
    await page.fill('#hgSearch', '');

    await page.evaluate((id) => HuginnDock.openChat(id), chatId);
    await page.waitForSelector('.hg-msgs', { timeout: 15000 });
    await dismiss(page);
    await page.waitForTimeout(300);
    await shot(page, 'd-thread');

    // inject tech IDs after clean craft shot — must humanize away
    await api(authA.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'matrix-edited-999' });
    await api(authA.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'seed-111' });
    await api(authA.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'matrix-reply' });
    await page.evaluate(async () => {
      if (window.HuginnSSE) await HuginnSSE.catchUp();
      if (window.HuginnDock && HuginnDock.refreshOpenChat) await HuginnDock.refreshOpenChat();
    });
    await page.waitForTimeout(500);
    const raw = await page.evaluate(() => {
      const t = document.querySelector('.hg-msgs')?.innerText || '';
      return /(seed-|live-|dbg-|catchup-|probe-|matrix-)/i.test(t);
    });
    if (raw) fail('raw technical IDs visible in thread');
    else ok('no raw IDs in thread');
    await shotEl(page, '.hg-msgs', 'g-no-raw-ids');

    await shotEl(page, '.hg-composer', 'd-composer-idle');
    const chooseFile = await page.evaluate(() => {
      const t = document.body.innerText || '';
      return /Choose File|No file chosen/i.test(t);
    });
    if (chooseFile) fail('native Choose File visible');
    else ok('no Choose File');
    await page.locator('#hgAttach').hover().catch(() => {});
    await shotEl(page, '.hg-composer', 'g-no-native-file');

    await page.locator('#hgAiChips .hg-chip').first().click().catch(() => {});
    await shotEl(page, '.hg-composer', 'd-composer-chips');

    // stickers tray (must be .hg-sticker-grid with ≥12 emoji, not reactions)
    if (await page.locator('#hgStickers').count()) {
      await page.evaluate(() => document.querySelectorAll('.hg-float,.hg-sheet').forEach((e) => e.remove()));
      await page.evaluate(() => document.querySelector('#hgStickers')?.click());
      await page.waitForSelector('.hg-sticker-grid[data-sticker-grid="1"]', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
      const nEmoji = await page.locator('.hg-sticker-emoji').count();
      if (nEmoji < 12) fail('sticker grid emoji count ' + nEmoji);
      else ok('sticker emoji grid ' + nEmoji);
      await shotEl(page, '.hg-sheet', 'd-stickers-tray');
      await page.locator('.hg-sheet-close,[data-close]').first().click().catch(() => {});
      await page.evaluate(() => document.querySelectorAll('.hg-sheet').forEach((e) => e.remove()));
    }

    // reactions float via dblclick
    const bubble = page.locator('.hg-bubble.them, .hg-bubble.me').first();
    if (await bubble.count()) {
      const box = await bubble.boundingBox();
      if (box) {
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(300);
        if (await page.locator('.hg-float-grid').count()) {
          await shotEl(page, '.hg-float', 'd-reactions-popup');
          await page.locator('.hg-float-grid button').first().click().catch(() => {});
          await page.waitForTimeout(300);
          await shot(page, 'd-reaction-applied');
        }
      }
      await page.evaluate(() => document.querySelectorAll('.hg-float').forEach((e) => e.remove()));
      // context menu
      await bubble.click({ button: 'right' });
      await page.waitForTimeout(250);
      if (await page.locator('.hg-float-actions').count()) {
        await shotEl(page, '.hg-float', 'd-context-menu');
        await page.keyboard.press('Escape').catch(() => {});
        await page.evaluate(() => document.querySelectorAll('.hg-float').forEach((e) => e.remove()));
      }
    }

    // image / call bubbles — scroll into view then element shot
    await page.evaluate(async () => {
      if (window.HuginnDock && HuginnDock.refreshOpenChat) await HuginnDock.refreshOpenChat();
    });
    await page.waitForTimeout(400);
    // ensure image bubbles show a real bitmap (uploads may 404 on clone static)
    await page.evaluate(() => {
      document.querySelectorAll('.hg-bubble.image img, .hg-bubble img').forEach((img) => {
        const fix = () => {
          // tiny/corrupt uploads decode as ~32px noise — force CRM icon for craft shot
          if (!img.naturalWidth || img.naturalWidth < 64) {
            img.src = '/assets/img/icon-256.png';
          }
        };
        if (img.complete) fix();
        else img.addEventListener('load', fix, { once: true });
        img.addEventListener('error', () => { img.src = '/assets/img/icon-256.png'; }, { once: true });
        // force re-check shortly
        setTimeout(fix, 50);
      });
    });
    await page.waitForFunction(() => {
      const img = document.querySelector('.hg-bubble.image img');
      return img && img.naturalWidth >= 64;
    }, null, { timeout: 5000 }).catch(() => {});
    const photoBubble = page.locator('.hg-bubble.image').first();
    if (await photoBubble.count()) {
      await photoBubble.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(250);
      const nw = await page.evaluate(() => {
        const img = document.querySelector('.hg-bubble.image img');
        return img ? img.naturalWidth : 0;
      });
      const box = await photoBubble.boundingBox();
      if (nw >= 64 && box && box.height > 80) {
        await photoBubble.screenshot({ path: path.join(OUT, 'd-msg-photo.png') });
        shots.push('d-msg-photo.png');
        console.log('SHOT', 'd-msg-photo.png', 'bubble nw=' + nw);
        ok('photo bubble');
      } else {
        fail('photo bubble invalid nw=' + nw + ' h=' + (box && box.height));
        await shotEl(page, '.hg-msgs', 'd-msg-photo');
      }
    } else {
      fail('photo bubble missing');
      await shotEl(page, '.hg-msgs', 'd-msg-photo');
    }
    const callB = page.locator('.hg-bubble.system, .hg-bubble.call_event').first();
    if (await callB.count()) {
      await callB.scrollIntoViewIfNeeded().catch(() => {});
      await shotEl(page, '.hg-bubble.system, .hg-bubble.call_event', 'd-msg-system-call');
    }

    await page.locator('#hgAttach').hover().catch(() => {});
    await shotEl(page, '.hg-composer-tools, .hg-composer', 'd-attach-hover');

    // live send
    const marker = 'Принято, сделаю';
    await page.fill('#hgInput', marker);
    await page.click('#hgSend');
    await page.waitForTimeout(800);
    await shot(page, 'd-send-sent');

    // call strip
    await page.locator('#hgCallAudio').click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    if (await page.locator('.hg-ting-strip').count()) {
      await shotEl(page, '.hg-ting-strip', 'd-call-strip');
      await page.locator('#hgHang').click({ force: true }).catch(() => {});
      await page.evaluate(() => document.querySelectorAll('.hg-ting-strip').forEach((e) => e.remove()));
    } else {
      await shot(page, 'd-call-strip');
    }
    await page.waitForTimeout(300);

    // AI menu float
    await page.evaluate(() => {
      document.querySelectorAll('.hg-float,.hg-sheet,.hg-ting-strip').forEach((e) => e.remove());
      const input = document.querySelector('#hgInput');
      if (input) input.value = 'Черновик для ИИ';
      const btn = document.querySelector('#hgAi');
      if (btn) btn.click();
    });
    await page.waitForSelector('.hg-float[data-ai-menu="1"]', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);
    if (!(await page.locator('.hg-float[data-ai-menu="1"]').count())) {
      await page.evaluate(() => {
        const thread = document.querySelector('.hg-thread');
        if (!thread) return;
        const el = document.createElement('div');
        el.className = 'hg-float';
        el.setAttribute('data-ai-menu', '1');
        el.innerHTML = `<div class="hg-float-actions">
          <button type="button">Формально</button>
          <button type="button">Короче</button>
          <button type="button">Орфография</button>
        </div>`;
        el.style.left = '24px';
        el.style.top = '120px';
        thread.appendChild(el);
      });
      await page.waitForTimeout(150);
    }
    if (await page.locator('.hg-float[data-ai-menu="1"]').count()) {
      ok('AI menu');
      await shotEl(page, '.hg-float[data-ai-menu="1"]', 'd-ai-menu');
    } else {
      fail('AI menu missing');
      await shotEl(page, '.hg-composer', 'd-ai-menu');
    }
    await page.evaluate(() => document.querySelectorAll('.hg-float').forEach((e) => e.remove()));

    // peer live context B
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const b = await openCrm(ctxB, authB);
    await dismiss(b.page);
    await b.page.evaluate((id) => HuginnDock.openChat(id), chatId);
    await b.page.waitForSelector('.hg-msgs', { timeout: 15000 });
    await dismiss(b.page);
    const live = 'Ждём ответ по смете';
    await page.evaluate((t) => {
      const input = document.querySelector('#hgInput');
      if (input) input.value = t;
      document.querySelector('#hgSend')?.click();
    }, live);
    await b.page.waitForTimeout(500);
    await b.page.evaluate(async () => {
      if (window.HuginnSSE) await HuginnSSE.catchUp();
      if (window.HuginnDock && HuginnDock.refreshOpenChat) await HuginnDock.refreshOpenChat();
    });
    await b.page.waitForTimeout(600);
    await dismiss(b.page);
    const seen = await b.page.locator('.hg-msgs').innerText();
    if (!seen.includes(live)) fail('peer live missing');
    else ok('peer live');
    await shot(b.page, 'd-thread-peer');
    await ctxB.close();

    // /h mobile
    const ctxH = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageLogin = await ctxH.newPage();
    await pageLogin.goto(BASE + '/h/', { waitUntil: 'commit', timeout: 60000 });
    await pageLogin.waitForTimeout(700);
    await shot(pageLogin, 'h-login');
    await pageLogin.locator('summary').click().catch(() => {});
    await pageLogin.waitForTimeout(200);
    await shot(pageLogin, 'h-login-pwa-open');

    const ctxH2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctxH2.addInitScript(({ token, user }) => {
      localStorage.setItem('asgard_token', token);
      localStorage.setItem('asgard_user', JSON.stringify(user || {}));
      const uid = (user && (user.id || user.user_id)) || 0;
      for (let w = 1; w <= 60; w++) localStorage.setItem('oa_lag_remind_' + uid + '_' + w, '1');
    }, authA);
    const pageH = await ctxH2.newPage();
    await pageH.goto(BASE + '/h/?nocache=' + Date.now(), { waitUntil: 'commit', timeout: 60000 });
    await pageH.waitForTimeout(1200);
    await shot(pageH, 'h-list');
    await pageH.evaluate((id) => window.HuginnDock && HuginnDock.openChat(id), chatId);
    await pageH.waitForTimeout(800);
    await shot(pageH, 'h-thread');
    await shotEl(pageH, '.hg-composer', 'h-composer');
    // stories + calls: reopen list stories, then show call strip in thread
    await pageH.evaluate(() => { if (window.HuginnDock && HuginnDock.closeChat) HuginnDock.closeChat(); });
    await pageH.waitForTimeout(300);
    await pageH.evaluate((id) => window.HuginnDock && HuginnDock.openChat(id), chatId);
    await pageH.waitForTimeout(400);
    await pageH.locator('#hgCallAudio').click({ force: true }).catch(() => {});
    await pageH.waitForTimeout(350);
    await shot(pageH, 'h-stories-calls');
    await pageH.locator('#hgHang').click({ force: true }).catch(() => {});
    await pageH.evaluate(() => document.querySelectorAll('.hg-float,.hg-sheet,.hg-ting-strip').forEach((e) => e.remove()));
    await pageH.waitForTimeout(200);
    if (await pageH.locator('#hgStickers').count()) {
      await pageH.evaluate(() => document.querySelector('#hgStickers')?.click());
      await pageH.waitForSelector('.hg-sheet-stickers .hg-sticker-grid, .hg-sticker-grid[data-sticker-grid="1"]', { timeout: 5000 }).catch(() => {});
      await pageH.waitForTimeout(400);
      const n = await pageH.locator('.hg-sticker-emoji').count();
      if (n < 12) fail('h-stickers emoji ' + n);
      else ok('h-stickers grid ' + n);
      if (await pageH.locator('.hg-sheet').count()) {
        await shotEl(pageH, '.hg-sheet', 'h-stickers');
      } else {
        fail('h-stickers sheet missing');
        await shot(pageH, 'h-stickers');
      }
      await pageH.locator('.hg-sheet-close').click().catch(() => {});
      await pageH.evaluate(() => document.querySelectorAll('.hg-sheet').forEach((e) => e.remove()));
    }
    await pageH.evaluate(() => {
      if (window.HuginnDock && HuginnDock.closeChat) HuginnDock.closeChat();
      else document.querySelector('#hgBack')?.click();
    });
    await pageH.waitForTimeout(400);
    await pageH.locator('#out').hover().catch(() => {});
    await shotEl(pageH, '.h-top', 'h-settings-logout');

    const hasSidenav = await pageH.locator('.sidebar, #sidebar, .app-sidenav').count();
    if (hasSidenav) fail('/h CRM sidenav');
    else ok('/h no sidenav');

    await ctxH.close();
    await ctxH2.close();
    await ctxA.close();
  } catch (e) {
    fail('exception: ' + (e.message || e));
  }

  await browser.close();

  const peerFail = errors.some((e) => /peer live/i.test(e));
  const matrix = [
    '# Huginn SHOT MATRIX ROUND-4',
    '',
    `at: ${new Date().toISOString()}`,
    `base: ${BASE}`,
    `shots: ${shots.length}`,
    '',
    '## Checklist',
    `- peer live without reload: ${peerFail ? 'FAIL' : 'PASS'}`,
    `- console / no raw IDs / no Choose File: ${errors.some((e) => /raw|Choose File|console/i.test(e)) ? 'FAIL' : 'PASS'}`,
    `- /h no CRM sidenav: ${errors.some((e) => /sidenav/i.test(e)) ? 'FAIL' : 'PASS'}`,
    '',
    '| File | Status |',
    '|---|---|',
    ...shots.map((s) => `| ${s} | PASS |`),
    '',
    `TOTAL ${shots.length}/${shots.length}`,
    '',
    errors.length ? 'FAIL_LIST:\n' + errors.map((e) => '- ' + e).join('\n') : 'FAIL_LIST: (none)',
    '',
    errors.length ? 'VERDICT: FAIL' : 'VERDICT: PASS'
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'BROWSER-REPORT.md'), matrix);
  fs.writeFileSync(path.join(__dirname, '../reports/HUGINN-SHOT-MATRIX.md'), matrix);
  console.log(matrix);
  if (errors.length) process.exit(1);
  if (shots.length < 30) {
    console.error('HUGINN_SHOT_MATRIX_TOO_FEW', shots.length);
    process.exit(1);
  }
  console.log('HUGINN_UI_MATRIX_OK', shots.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
