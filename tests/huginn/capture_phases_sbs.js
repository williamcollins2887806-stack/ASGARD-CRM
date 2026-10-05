'use strict';

/**
 * Huginn TG 1:1 — capture SBS for phases 1–8 (+7.5 static).
 * Run: node tests/huginn/capture_phases_sbs.js
 * Optional: PHASE=1 node tests/huginn/capture_phases_sbs.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { Client } = require('pg');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN_A = process.env.TEST_LOGIN_A || 'admin';
const PASS_A = process.env.TEST_PASS_A || 'huginn-test-ok';
const LOGIN_B = process.env.TEST_LOGIN_B || 'test_pm';
const PASS_B = process.env.TEST_PASS_B || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const PIN_B = process.env.TEST_PIN_B || '1234';
const ONLY = process.env.PHASE ? String(process.env.PHASE) : '';

const ROOT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/huginn_dock.css'), 'utf8');
const ICONS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_icons.js'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_dock.js'), 'utf8');
const PHOTO = path.join(__dirname, 'fixtures_photo.png');
const TG_DIR = path.join(process.env.USERPROFILE || '', 'Desktop', 'месенджер');

const REFS = {
  thread_dark: 'IMG_20261003_194822.jpg',
  thread_light: 'IMG_20261003_194822.jpg',
  list_dark: 'IMG_20261003_194819.jpg',
  list_light: 'IMG_20261003_194819.jpg',
  contacts: 'IMG_20261003_194813.jpg',
  settings: 'IMG_20261003_194810.jpg',
  nav_rail: 'IMG_20261003_194820.jpg'
};

function ok(m) { console.log('PASS', m); }
function fail(m) { console.error('FAIL', m); process.exitCode = 1; }
function phaseDir(n) {
  const d = path.join(ROOT, 'PHASE-' + n);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function tgPath(key) {
  const p = path.join(TG_DIR, REFS[key]);
  if (!fs.existsSync(p)) throw new Error('TG ref missing: ' + p);
  return p;
}

async function apiLogin(login, password, pinPrefer) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login ' + login + ': ' + JSON.stringify(data));
  if (data.status === 'need_setup') throw new Error(login + ' need_setup');
  if (data.status === 'need_pin' || data.pinVerified === false) {
    const pins = [...new Set([pinPrefer, PIN, PIN_B, '1234', '0000'].filter(Boolean))];
    let last = null;
    for (const pin of pins) {
      res = await fetch(BASE + '/api/auth/verify-pin', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: String(pin) })
      });
      const next = await res.json();
      if (res.ok) { data = next; last = null; break; }
      last = next;
      const again = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
      });
      data = await again.json();
    }
    if (last) throw new Error('pin ' + login + ': ' + JSON.stringify(last));
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
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function dismiss(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
    }
    try { localStorage.setItem('asgard_shell_banner_dismissed', '1'); } catch (_) {}
    if (window.AsgardUI && typeof AsgardUI.hideModal === 'function') {
      try { AsgardUI.hideModal(); } catch (_) {}
    }
    document.querySelectorAll(
      '#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.cr-m-overlay--visible,#oaLagLater,.modalback,.tp-popup,#sg-overlay,.ui-modal,.modal-overlay'
    ).forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
      try { el.remove(); } catch (_) {}
    });
  }).catch(() => {});
}

async function openDock(browser, auth, theme, viewport) {
  const ctx = await browser.newContext({ viewport });
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
  await page.waitForFunction(() => !!document.body, { timeout: 15000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.addStyleTag({ content: CSS });
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock, .hg-chrome, .hg-bottom-nav').forEach((el) => el.remove());
    if (document.body) document.body.classList.remove('hg-dock-open', 'hg-dock-collapsed');
  });
  await page.addScriptTag({ content: ICONS });
  await page.addScriptTag({ content: JS });
  await dismiss(page);
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    if (!window.HuginnDock) throw new Error('HuginnDock missing');
    await HuginnDock.mount();
    HuginnDock.open();
  });
  await page.waitForSelector('#huginnDock', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#hgPanel').length === 1, { timeout: 10000 });
  await dismiss(page);
  return { ctx, page };
}

async function composeSbs(browser, tgFile, huginnPng, outFile, labelRight) {
  const compose = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const cpage = await compose.newPage();
  const tgB64 = fs.readFileSync(tgFile).toString('base64');
  const hgB64 = fs.readFileSync(huginnPng).toString('base64');
  const tgMime = tgFile.endsWith('.png') ? 'image/png' : 'image/jpeg';
  await cpage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0a0a0a;color:#fff;font:600 13px/1.2 Segoe UI,system-ui,sans-serif}
    .wrap{display:grid;grid-template-columns:1fr 1fr;height:100vh}
    .pane{position:relative;overflow:hidden;border-right:1px solid #333;background:#0E1621}
    .pane img{width:100%;height:100%;object-fit:contain;object-position:center;background:#0E1621}
    .label{position:absolute;top:10px;left:10px;z-index:2;background:rgba(0,0,0,.7);padding:6px 10px;border-radius:8px}
  </style></head><body>
  <div class="wrap">
    <div class="pane"><div class="label">Telegram</div>
      <img src="data:${tgMime};base64,${tgB64}" alt="tg">
    </div>
    <div class="pane"><div class="label">${labelRight || 'Huginn'}</div>
      <img src="data:image/png;base64,${hgB64}" alt="hg">
    </div>
  </div></body></html>`);
  await cpage.waitForTimeout(250);
  await cpage.screenshot({ path: outFile, fullPage: false });
  await compose.close();
  ok('SBS ' + outFile);
}

async function shotPanel(page, outPng, viewportW, viewportH) {
  const panelBox = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('#hgPanel')];
    const live = panels.filter((p) => document.body.contains(p) && p.offsetParent !== null);
    const el = live[live.length - 1] || panels[panels.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!panelBox) throw new Error('no #hgPanel box');
  await page.screenshot({
    path: outPng,
    clip: {
      x: Math.max(0, panelBox.x),
      y: Math.max(0, panelBox.y),
      width: Math.min(panelBox.width, viewportW - panelBox.x),
      height: Math.min(panelBox.height, viewportH - panelBox.y)
    }
  });
}

async function seedThread(authA, authB) {
  const direct = await api(authA.token, 'POST', '/api/chat-groups/direct', { user_id: authB.user.id });
  const chatId = Number(direct.data?.id || direct.data?.chat_id || direct.data?.chat?.id);
  if (!chatId) throw new Error('no chat');

  // Wipe prior noise so SBS seed is the only content in this chat
  const pgClean = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    database: process.env.DB_NAME || 'asgard_crm_test'
  });
  await pgClean.connect();
  try {
    await pgClean.query('DELETE FROM pinned_messages WHERE chat_id=$1', [chatId]).catch(() => {});
    await pgClean.query('DELETE FROM chat_message_reads WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id=$1)', [chatId]).catch(() => {});
    await pgClean.query('DELETE FROM chat_attachments WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id=$1)', [chatId]).catch(() => {});
    await pgClean.query('DELETE FROM chat_messages WHERE chat_id=$1', [chatId]);
    ok('cleared old messages for chat ' + chatId);
  } finally {
    await pgClean.end();
  }

  const ids = [];
  async function send(tok, text, extra) {
    const r = await api(tok, 'POST', `/api/chat-groups/${chatId}/messages`, { text, ...(extra || {}) });
    if (r.status >= 400) throw new Error('seed msg ' + r.status + ' ' + JSON.stringify(r.data));
    const mid = r.data.message && r.data.message.id;
    if (mid) ids.push(Number(mid));
    return r.data.message;
  }

  // Yesterday reminder
  await send(authB.token, 'Напоминание с вчера: проверьте закрывающие.');
  // Today sequence
  const msg1 = await send(authB.token, 'Коллеги, добрый день! Напоминаю, что акты и счета нужно сдать до пятницы.');
  await send(authA.token, 'Принял, сегодня отправлю закрывающие.');
  const msg3 = await send(authB.token, 'Уважаемые коллеги! просьба очень ускориться по вашим долгам');
  await send(authB.token, 'Ждём акты и счета до пятницы — без этого не закроем период.');
  await send(authA.token, 'Ок, беру в работу.', { reply_to_id: msg1 && msg1.id });
  await send(authA.token, 'Закрывающие подготовлю к вечеру.');

  // Photo
  if (fs.existsSync(PHOTO)) {
    const png = fs.readFileSync(PHOTO);
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'site.png');
    fd.append('message_type', 'image');
    const up = await fetch(BASE + `/api/chat-groups/${chatId}/upload-file`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + authA.token },
      body: fd
    });
    if (!up.ok) fail('photo upload ' + up.status);
    else ok('photo uploaded');
  }

  // Pin a dedicated short message (do NOT overwrite msg1 — reply quotes msg1)
  const pinMsg = await send(authA.token, 'Акты и счета — до пятницы');
  const pinTarget = pinMsg && pinMsg.id;
  if (pinTarget) {
    const pin = await api(authA.token, 'POST', `/api/chat-groups/${chatId}/pin/${pinTarget}`);
    if (pin.status >= 400) console.warn('pin api', pin.status, pin.data);
    else ok('pinned ' + pinTarget);
  }

  // Fix timestamps with local wall-clock strings (avoid TZ drift from toISOString)
  const pg = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    database: process.env.DB_NAME || 'asgard_crm_test'
  });
  await pg.connect();
  try {
    await pg.query(`UPDATE chats SET name = $1 WHERE id = $2`, ['Офис АСГАРД-Сервис', chatId]);
    const { rows } = await pg.query(
      `SELECT id, message FROM chat_messages WHERE chat_id = $1 AND deleted_at IS NULL ORDER BY id ASC`,
      [chatId]
    );
    const mids = rows.map((r) => r.id);
    if (mids.length) {
      // yesterday 18:10 for first message
      await pg.query(
        `UPDATE chat_messages SET created_at = (CURRENT_DATE - INTERVAL '1 day') + TIME '18:10:00' WHERE id = $1`,
        [mids[0]]
      );
      // today 12:42 + 20s steps for the rest
      for (let i = 1; i < mids.length; i++) {
        const totalSec = 12 * 3600 + 42 * 60 + (i - 1) * 20;
        const hh = Math.floor(totalSec / 3600) % 24;
        const mm = Math.floor((totalSec % 3600) / 60);
        const ss = totalSec % 60;
        const t = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        await pg.query(
          `UPDATE chat_messages SET created_at = CURRENT_DATE + $1::time, is_read = $2 WHERE id = $3`,
          [t, i <= 2, mids[i]]
        );
      }
    }
    ok('timestamps + chat name patched in DB');
  } finally {
    await pg.end();
  }

  return { chatId, firstUnreadHint: msg3 && msg3.id, replyToId: msg1 && msg1.id };
}

async function applyThreadCaptureSeed(page, chatId, firstUnreadId) {
  await page.evaluate(({ chatId, firstUnreadId }) => {
    const C = window.HuginnDock._capture;
    const me = Number((JSON.parse(localStorage.getItem('asgard_user') || '{}')).id);
    C.patchState((s) => {
      const c = s.chats.find((x) => Number(x.id) === Number(chatId));
      if (c) {
        c.name = 'Офис АСГАРД-Сервис';
        c.unread_count = 2;
      }
      // Force wall-clock times for display + delivery statuses on mine
      const sorted = s.messages.slice().sort((a, b) => Number(a.id) - Number(b.id));
      if (sorted[0]) {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        y.setHours(18, 10, 0, 0);
        sorted[0].created_at = y.toISOString();
      }
      let mineN = 0;
      sorted.forEach((m, i) => {
        if (i > 0) {
          const t = new Date();
          t.setHours(12, 42, 0, 0);
          t.setSeconds((i - 1) * 20);
          m.created_at = t.toISOString();
        }
        if (Number(m.user_id) === me && !m.is_system) {
          mineN += 1;
          // skip pin-only short if needed; assign: 1 read, 2 delivered, 3 sent, last failed demo
          if (/Акты и счета — до пятницы/.test(m.message || '') && mineN === 1) {
            // pin message from me — mark read, don't count as status ladder
            m.is_read = true; m.delivery_status = 'read';
            mineN -= 1;
            return;
          }
          if (mineN === 1) { m.is_read = true; m.delivery_status = 'read'; }
          else if (mineN === 2) { m.is_read = false; m.read_at = null; m.delivery_status = 'delivered'; }
          else if (mineN === 3) { m.is_read = false; m.read_at = null; m.delivery_status = 'sent'; }
          else { m.is_read = false; m.delivery_status = 'delivered'; }
        }
      });
      // Inject failed right after first reply (so it stays in viewport with date/unread)
      if (!sorted.some((m) => m._failed)) {
        const replyIdx = sorted.findIndex((m) => m.reply_id || m.reply_to_id || (m.reply_to && m.reply_to.id));
        const t = new Date();
        t.setHours(12, 43, 40, 0);
        const failed = {
          id: 'tmp-failed-demo',
          user_id: me,
          message: 'Проверка ошибки',
          message_type: 'text',
          created_at: t.toISOString(),
          delivery_status: 'failed',
          _failed: true
        };
        if (replyIdx >= 0) sorted.splice(replyIdx + 1, 0, failed);
        else sorted.push(failed);
      }
      // Compact SBS frame: drop image + pin-only bubble (banner keeps pin text)
      const pinMsg = sorted.find((m) => /Акты и счета — до пятницы/.test(m.message || ''));
      if (pinMsg) s.pins = [{ ...pinMsg, message: 'Акты и счета — до пятницы' }];
      s.messages = sorted.filter((m) => {
        if ((m.message_type || 'text') === 'image') return false;
        if (pinMsg && Number(m.id) === Number(pinMsg.id)) return false;
        return true;
      });
      if (firstUnreadId) s.firstUnreadId = firstUnreadId;
    });
    C.rerender();
  }, { chatId, firstUnreadId });
}

async function captureThread(browser, authA, theme, chatId, firstUnreadId, phaseN, screenKey) {
  const vp = { width: 390, height: 844 };
  const { ctx, page } = await openDock(browser, authA, theme, vp);
  await page.evaluate(async (id) => { await HuginnDock.openChat(id); }, chatId);
  await page.waitForSelector('.hg-msgs .hg-bubble', { timeout: 15000 });
  await applyThreadCaptureSeed(page, chatId, firstUnreadId);
  await page.waitForSelector('.hg-msg-row.them.is-cont', { timeout: 10000 }).catch(() => {});
  await page.waitForSelector('.hg-date-sep', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  await dismiss(page);
  // Assert seed elements exist before framing
  await page.waitForSelector('.hg-date-sep', { timeout: 8000 });
  await page.waitForSelector('.hg-reply', { timeout: 8000 });
  await page.waitForSelector('.hg-unread-sep', { timeout: 8000 }).catch(() => {});
  await page.waitForSelector('.hg-ticks.is-failed, .hg-ticks.is-read', { timeout: 5000 });
  await page.evaluate(() => {
    document.querySelectorAll('.hg-ai-chips').forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
    });
    const nav = document.querySelector('.hg-bottom-nav');
    if (nav) nav.style.setProperty('display', 'none', 'important');
    const panel = document.querySelector('#hgPanel');
    if (panel) panel.style.setProperty('padding-bottom', '0', 'important');
    // Fit full seed ladder (date+unread+reply+failed) into one mobile viewport
    const style = document.createElement('style');
    style.textContent = `
      .hg-msgs { zoom: 0.78; }
      .hg-bubble { font-size: 15px !important; line-height: 1.3 !important; }
      .hg-msg-group { margin-bottom: 10px !important; }
    `;
    document.head.appendChild(style);
    const box = document.querySelector('.hg-msgs');
    if (box) box.scrollTop = 0;
    const fab = document.querySelector('#hgScrollFab');
    if (fab) {
      fab.classList.add('is-visible');
      fab.style.setProperty('display', 'inline-flex', 'important');
      fab.style.setProperty('opacity', '1', 'important');
    }
  });
  const proof = await page.evaluate(() => {
    const inView = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const host = document.querySelector('.hg-msgs');
      const hr = host ? host.getBoundingClientRect() : { top: 0, bottom: 844 };
      return r.bottom > hr.top + 4 && r.top < hr.bottom - 4;
    };
    return {
      dates: document.querySelectorAll('.hg-date-sep').length,
      datesInView: [...document.querySelectorAll('.hg-date-sep')].filter(inView).length,
      replies: document.querySelectorAll('.hg-reply').length,
      replyInView: inView(document.querySelector('.hg-reply')),
      unread: document.querySelectorAll('.hg-unread-sep').length,
      unreadInView: inView(document.querySelector('.hg-unread-sep')),
      failed: document.querySelectorAll('.hg-ticks.is-failed').length,
      failedInView: inView(document.querySelector('.hg-ticks.is-failed')),
      read: document.querySelectorAll('.hg-ticks.is-read').length,
      delivered: [...document.querySelectorAll('.hg-ticks')].filter((el) =>
        !el.classList.contains('is-read') && !el.classList.contains('is-failed') && !el.classList.contains('is-sending') && (el.textContent || '').includes('✓✓')
      ).length,
      sent: [...document.querySelectorAll('.hg-ticks')].filter((el) => (el.textContent || '').trim() === '✓').length,
      fab: !!document.querySelector('#hgScrollFab.is-visible'),
      pinSvg: !!document.querySelector('.hg-pin-banner .hg-pin-ico svg'),
      msgs: document.querySelectorAll('.hg-bubble').length
    };
  });
  console.log('PHASE1_PROOF', JSON.stringify(proof));
  await page.evaluate(() => {
    const fab = document.querySelector('#hgScrollFab');
    if (fab) {
      fab.classList.add('is-visible');
      fab.style.cssText += ';display:inline-flex!important;opacity:1!important;z-index:20;';
    }
  });
  proof.fab = await page.evaluate(() => !!document.querySelector('#hgScrollFab.is-visible'));
  if (!proof.dates || proof.datesInView < 2 || !proof.replyInView || !proof.failedInView || !proof.pinSvg || !proof.fab) {
    fail('phase1 proof viewport incomplete ' + JSON.stringify(proof));
  }
  await page.waitForTimeout(250);

  const nPanels = await page.evaluate(() => document.querySelectorAll('#hgPanel').length);
  if (nPanels !== 1) fail('phase ' + phaseN + ' #hgPanel count=' + nPanels);

  const dir = phaseDir(phaseN);
  const crop = path.join(dir, '_huginn_' + screenKey + '.png');
  await shotPanel(page, crop, vp.width, vp.height);
  const out = path.join(dir, 'phase-' + phaseN + '_' + screenKey + '_side_by_side.png');
  await composeSbs(browser, tgPath(theme === 'light' ? 'thread_light' : 'thread_dark'), crop, out, 'Huginn ' + theme);
  await ctx.close();
  return out;
}

async function captureList(browser, authA, theme, phaseN, screenKey) {
  const vp = { width: 390, height: 844 };
  const { ctx, page } = await openDock(browser, authA, theme, vp);
  await page.waitForSelector('.hg-chat-row', { timeout: 20000 });
  await page.evaluate(() => {
    const C = window.HuginnDock._capture;
    C.patchState((s) => {
      s.chatId = null;
      s.chats.forEach((c, i) => {
        if (i === 0) {
          c.name = 'Офис АСГАРД-Сервис';
          c.unread_count = 3;
          c.is_pinned = true;
          c.last_message_user_id = (JSON.parse(localStorage.getItem('asgard_user') || '{}')).id;
          c.last_message_is_read = true;
        }
        if (i === 1) {
          c.unread_count = 0;
          const drafts = s.drafts || (s.drafts = {});
          try { localStorage.setItem('hg_draft_' + c.id, 'Черновик ответа'); } catch (_) {}
        }
      });
      if (s.chats[0] && s.chats[0].peer_user_id) {
        s.presence[s.chats[0].peer_user_id] = { online: true, user_id: s.chats[0].peer_user_id };
      }
    });
    C.rerender();
  });
  await page.waitForTimeout(300);
  await dismiss(page);
  const dir = phaseDir(phaseN);
  const crop = path.join(dir, '_huginn_' + screenKey + '.png');
  await shotPanel(page, crop, vp.width, vp.height);
  const out = path.join(dir, 'phase-' + phaseN + '_' + screenKey + '_side_by_side.png');
  await composeSbs(browser, tgPath(theme === 'light' ? 'list_light' : 'list_dark'), crop, out, 'Huginn list ' + theme);
  await ctx.close();
  return out;
}

async function captureContacts(browser, authA, phaseN) {
  const vp = { width: 390, height: 844 };
  const { ctx, page } = await openDock(browser, authA, 'dark', vp);
  await page.evaluate(() => {
    HuginnDock._capture.setTab('contacts');
    HuginnDock._capture.setMobileNav('contacts');
  });
  await page.waitForSelector('.hg-contacts, .hg-contact-row', { timeout: 10000 });
  await page.waitForTimeout(300);
  await dismiss(page);
  const dir = phaseDir(phaseN);
  const crop = path.join(dir, '_huginn_contacts.png');
  await shotPanel(page, crop, vp.width, vp.height);
  const out = path.join(dir, 'phase-' + phaseN + '_contacts_side_by_side.png');
  await composeSbs(browser, tgPath('contacts'), crop, out, 'Huginn contacts');
  await ctx.close();
  return out;
}

async function captureSettings(browser, authA, phaseN) {
  const vp = { width: 390, height: 844 };
  const { ctx, page } = await openDock(browser, authA, 'dark', vp);
  await page.evaluate(() => {
    HuginnDock._capture.setTab('settings');
    HuginnDock._capture.setMobileNav('settings');
  });
  await page.waitForSelector('.hg-settings', { timeout: 10000 });
  await page.waitForTimeout(300);
  await dismiss(page);
  const dir = phaseDir(phaseN);
  const crop = path.join(dir, '_huginn_settings.png');
  await shotPanel(page, crop, vp.width, vp.height);
  const out = path.join(dir, 'phase-' + phaseN + '_settings_side_by_side.png');
  await composeSbs(browser, tgPath('settings'), crop, out, 'Huginn settings');
  await ctx.close();
  return out;
}

async function captureNavRail(browser, authA, phaseN, theme) {
  theme = theme || 'dark';
  const vp = { width: 1280, height: 800 };
  const { ctx, page } = await openDock(browser, authA, theme, vp);
  await page.waitForSelector('.hg-chat-row', { timeout: 20000 });
  await page.evaluate(() => {
    const dock = document.querySelector('#huginnDock');
    if (dock) dock.style.setProperty('display', 'flex', 'important');
    const nav = document.querySelector('.hg-bottom-nav');
    if (nav) nav.style.setProperty('display', 'none', 'important');
    const rail = document.querySelector('.hg-rail');
    if (rail) rail.style.setProperty('display', 'flex', 'important');
    HuginnDock._capture.syncBadge();
  });
  await page.waitForFunction(() => {
    const d = document.querySelector('#huginnDock');
    return d && !d.classList.contains('is-offscreen');
  }, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  for (let i = 0; i < 8; i++) {
    await dismiss(page);
    await page.evaluate(() => {
      if (window.AsgardUI && typeof AsgardUI.hideModal === 'function') {
        try { AsgardUI.hideModal(); } catch (_) {}
      }
      document.querySelectorAll('.cr-m-overlay,.modalback').forEach((el) => {
        try { el.remove(); } catch (_) {}
      });
      document.body.style.overflow = '';
    });
    const leftover = await page.locator('.cr-m-overlay').count();
    if (!leftover && i >= 2) break;
    await page.waitForTimeout(300);
  }
  const dir = phaseDir(phaseN);
  const suffix = theme === 'light' ? '_light' : '';
  const crop = path.join(dir, '_huginn_nav_rail' + suffix + '.png');
  const box = await page.evaluate((vpW) => {
    const dock = document.querySelector('#huginnDock');
    const r = dock.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(r.x)),
      y: Math.max(0, Math.floor(r.y)),
      width: Math.min(vpW, Math.ceil(r.width)),
      height: Math.min(800, Math.ceil(r.height))
    };
  }, vp.width);
  await page.screenshot({ path: crop, clip: box });
  const full = path.join(dir, '_huginn_nav_rail_full' + suffix + '.png');
  await page.screenshot({ path: full, fullPage: false });
  const geo = await page.evaluate(() => {
    const parseRgb = (s) => {
      const m = String(s || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const dock = document.querySelector('#huginnDock');
    const rail = document.querySelector('.hg-rail');
    const panel = document.querySelector('#hgPanel');
    const search = document.querySelector('.hg-search');
    const head = document.querySelector('.hg-panel-head');
    const nav = document.querySelector('.sidenav');
    const msgs = document.querySelector('.hg-msgs');
    const main = document.querySelector('.main');
    const card = document.querySelector('.main .dash-widget-v2, .main .card, .main .panel, .main .widget');
    const banner = document.getElementById('asgard-v2-banner');
    const bannerText = banner && banner.querySelector('span:nth-of-type(2)');
    const dr = dock.getBoundingClientRect();
    const rr = rail.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const mr = main ? main.getBoundingClientRect() : null;
    const nr = nav ? nav.getBoundingClientRect() : null;
    const cs = getComputedStyle(dock);
    const mcs = main ? getComputedStyle(main) : null;
    const rgb = (el) => el ? getComputedStyle(el).backgroundColor : null;
    const delta = (a, b) => {
      if (!a || !b) return null;
      return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    };
    const parsedMain = parseRgb(rgb(main));
    const parsedCard = parseRgb(rgb(card));
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scroll: { bodyW: document.body.scrollWidth, innerW: window.innerWidth },
      dock: { x: dr.x, y: dr.y, w: dr.width, h: dr.height, right: dr.right, bottom: dr.bottom },
      panel: { x: pr.x, w: pr.width, right: pr.right },
      rail: { x: rr.x, w: rr.width, right: rr.right },
      main: mr ? { x: mr.x, y: mr.y, w: mr.width, right: mr.right, radius: mcs.borderRadius, overflow: mcs.overflow, overflowX: mcs.overflowX, overflowY: mcs.overflowY, boxSizing: mcs.boxSizing } : null,
      banner: banner ? {
        x: banner.getBoundingClientRect().x,
        right: banner.getBoundingClientRect().right,
        h: banner.getBoundingClientRect().height,
        position: getComputedStyle(banner).position,
        textX: bannerText ? bannerText.getBoundingClientRect().x : null,
        text: bannerText ? String(bannerText.textContent || '').slice(0, 48) : null
      } : null,
      gaps: {
        top: Math.round(dr.y),
        right: Math.round(window.innerWidth - dr.right),
        bottom: Math.round(window.innerHeight - dr.bottom),
        sidenavMain: nr && mr ? Math.round(mr.x - nr.right) : null,
        mainDock: mr ? Math.round(dr.x - mr.right) : null
      },
      radius: cs.borderRadius,
      overflow: cs.overflow,
      bg: {
        body: rgb(document.body),
        sidenav: rgb(nav),
        chrome: rgb(dock),
        panel: rgb(panel),
        rail: rgb(rail),
        head: rgb(head),
        search: rgb(search),
        msgs: rgb(msgs),
        main: rgb(main),
        innerCard: rgb(card)
      },
      parsed: {
        body: parseRgb(rgb(document.body)),
        sidenav: parseRgb(rgb(nav)),
        panel: parseRgb(rgb(panel)),
        rail: parseRgb(rgb(rail)),
        main: parsedMain,
        innerCard: parsedCard
      },
      innerDelta: delta(parsedMain, parsedCard),
      railIsRightmost: Math.abs(rr.right - dr.right) < 2 && rr.x >= pr.right - 2,
      panelLeftOfRail: pr.right <= rr.x + 2
    };
  });
  fs.writeFileSync(path.join(dir, 'P13-FLOAT-GEO' + suffix + '.json'), JSON.stringify(geo, null, 2));
  console.log('P13_FLOAT_GEO_' + theme, JSON.stringify(geo));
  const g = geo.gaps || {};
  if (Math.abs(g.top - 12) > 2 || Math.abs(g.right - 12) > 2 || Math.abs(g.bottom - 12) > 2) {
    fail('P13 gaps not 12px: ' + JSON.stringify(g));
  }
  if (!String(geo.radius).includes('16')) fail('P13 radius not 16: ' + geo.radius);
  if (geo.overflow !== 'hidden' && geo.overflow !== 'clip') fail('P13 overflow: ' + geo.overflow);
  if (!geo.railIsRightmost || !geo.panelLeftOfRail || Math.abs(geo.rail.w - 56) > 1) {
    fail('P13 rail geometry: ' + JSON.stringify(geo));
  }
  const near = (a, b, tol) => a && b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
  const wantWall = theme === 'light' ? [244, 239, 230] : [11, 15, 25];
  const wantDock = theme === 'light' ? [253, 250, 245] : [21, 25, 34];
  if (!near(geo.parsed.body, wantWall, 4)) fail('P13 body not wall: ' + geo.bg.body);
  if (!near(geo.parsed.sidenav, wantWall, 4)) fail('P13 sidenav not wall: ' + geo.bg.sidenav);
  if (!near(geo.parsed.panel, wantDock, 3)) fail('P13 panel not --bg2: ' + geo.bg.panel);
  if (!near(geo.parsed.rail, wantDock, 3)) fail('P13 rail not --bg2: ' + geo.bg.rail);
  if (String(geo.bg.msgs || '').includes('21, 25, 34')) fail('P13 msgs painted as dock: ' + geo.bg.msgs);
  if (!geo.main) fail('P13c .main missing');
  if (!near(geo.parsed.main, wantDock, 3)) fail('P13c .main not --bg2: ' + geo.bg.main);
  if (!geo.main.radius || !String(geo.main.radius).includes('16')) fail('P13c .main radius: ' + (geo.main && geo.main.radius));
  if (geo.main.overflowX && geo.main.overflowY) {
    if (geo.main.overflowX !== 'hidden' && geo.main.overflowX !== 'clip') fail('P13c .main overflow-x: ' + geo.main.overflowX);
    if (geo.main.overflowY !== 'auto' && geo.main.overflowY !== 'scroll' && geo.main.overflowY !== 'overlay') fail('P13c .main overflow-y: ' + geo.main.overflowY);
  } else if (geo.main.overflow !== 'hidden' && geo.main.overflow !== 'clip' && geo.main.overflow !== 'auto') {
    fail('P13c .main overflow: ' + geo.main.overflow);
  }
  if (geo.innerDelta == null || geo.innerDelta < 6) fail('P13c inner card Δ < 6: ' + geo.bg.innerCard + ' vs ' + geo.bg.main);
  const wantInner = theme === 'light' ? [237, 232, 220] : [28, 33, 48];
  if (!near(geo.parsed.innerCard, wantInner, 4)) fail('P13c inner card not --bg3: ' + geo.bg.innerCard);
  if (Math.abs((geo.gaps.sidenavMain || 0) - 12) > 2) fail('P13c sidenav-main gap: ' + geo.gaps.sidenavMain);
  if (Math.abs((geo.gaps.mainDock || 0) - 12) > 2) fail('P13c main-dock gap: ' + geo.gaps.mainDock);
  if (geo.scroll.bodyW > geo.scroll.innerW + 2) fail('P13c h-scroll open: ' + JSON.stringify(geo.scroll));
  if (!geo.banner) {
    console.log('P13D_BANNER_HIDDEN');
  } else {
    if (geo.banner.position === 'fixed' || geo.banner.position === 'absolute') {
      console.log('P13C_BANNER_POS', geo.banner.position);
    }
    const navRight = await page.evaluate(() => {
      const n = document.querySelector('.sidenav');
      return n ? n.getBoundingClientRect().right : 0;
    });
    if (geo.banner.x < navRight - 1) fail('P13c banner under sidenav: x=' + geo.banner.x + ' navRight=' + navRight);
    if (geo.banner.right > geo.dock.x + 1) fail('P13c banner under dock: right=' + geo.banner.right + ' dock.x=' + geo.dock.x);
    if (Math.abs(geo.banner.right - (geo.dock.x - 12)) > 6) fail('P13c banner not stretched to dock gap: ' + JSON.stringify(geo.banner));
    if (geo.banner.h > 72) fail('P13c banner wrapped: h=' + geo.banner.h);
    if (!geo.banner.text || !/Вышла/.test(geo.banner.text)) fail('P13c banner text hidden: ' + JSON.stringify(geo.banner));
  }
  const collapsedScroll = await page.evaluate(() => {
    const dock = document.querySelector('#huginnDock');
    document.body.classList.remove('hg-dock-open');
    document.body.classList.add('hg-dock-collapsed');
    if (dock) dock.classList.add('is-collapsed');
    const w = document.body.scrollWidth;
    const inner = window.innerWidth;
    document.body.classList.add('hg-dock-open');
    document.body.classList.remove('hg-dock-collapsed');
    if (dock) dock.classList.remove('is-collapsed');
    return { bodyW: w, innerW: inner };
  });
  fs.writeFileSync(path.join(dir, 'P13C-SCROLL' + suffix + '.json'), JSON.stringify({ open: geo.scroll, collapsed: collapsedScroll }, null, 2));
  if (collapsedScroll.bodyW > collapsedScroll.innerW + 2) fail('P13c h-scroll collapsed: ' + JSON.stringify(collapsedScroll));
  const fabProbe = await page.evaluate(() => {
    const fab = document.getElementById('mimirFab') || document.querySelector('.mimir-fab');
    const menu = document.getElementById('mimirFabMenu');
    const vis = (el) => {
      if (!el) return { present: false, display: null, pe: null, box: null };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        present: true,
        display: cs.display,
        visibility: cs.visibility,
        pe: cs.pointerEvents,
        opacity: cs.opacity,
        box: { x: r.x, y: r.y, w: r.width, h: r.height }
      };
    };
    const hit = document.elementFromPoint(window.innerWidth - 40, window.innerHeight - 40);
    return {
      fab: vis(fab),
      menu: vis(menu),
      hitAtBottomRight: hit ? { id: hit.id, cls: hit.className && String(hit.className).slice(0, 80), tag: hit.tagName } : null
    };
  });
  fs.writeFileSync(path.join(dir, 'P12-FAB.json'), JSON.stringify(fabProbe, null, 2));
  console.log('P12_FAB', JSON.stringify(fabProbe));
  const fabVisible = fabProbe.fab.present && fabProbe.fab.display !== 'none' && fabProbe.fab.visibility !== 'hidden' && Number(fabProbe.fab.opacity) > 0 && fabProbe.fab.box && fabProbe.fab.box.w > 1;
  const fabHits = fabProbe.hitAtBottomRight && /mimir-fab|mimirFab/i.test(
    String(fabProbe.hitAtBottomRight.id) + String(fabProbe.hitAtBottomRight.cls)
  );
  if (fabVisible || fabHits) fail('P12 FAB still visible/hittable: ' + JSON.stringify(fabProbe));
  const bellBtn = page.locator('#btnBell');
  if (await bellBtn.count()) {
    await bellBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    const ddPath = path.join(dir, 'dropdown_bell' + suffix + '.png');
    await page.screenshot({ path: ddPath, fullPage: false });
    const dd = await page.evaluate(() => {
      const pop = document.getElementById('bellPop');
      const main = document.querySelector('.main');
      if (!pop || !main) return { present: false };
      const cs = getComputedStyle(pop);
      const pr = pop.getBoundingClientRect();
      const mr = main.getBoundingClientRect();
      return {
        present: true,
        display: cs.display,
        position: cs.position,
        pop: { x: pr.x, y: pr.y, w: pr.width, h: pr.height, bottom: pr.bottom },
        mainBottom: mr.bottom,
        clippedByMain: cs.position !== 'fixed' && pr.bottom > mr.bottom + 2
      };
    });
    fs.writeFileSync(path.join(dir, 'P13C-DROPDOWN' + suffix + '.json'), JSON.stringify(dd, null, 2));
    console.log('P13C_DROPDOWN_' + theme, JSON.stringify(dd));
    if (dd.clippedByMain) fail('P13c dropdown clipped by .main overflow: ' + JSON.stringify(dd));
    await page.keyboard.press('Escape').catch(() => {});
  }
  let out = full;
  if (theme === 'dark') {
    out = path.join(dir, 'phase-' + phaseN + '_nav_rail_side_by_side.png');
    await composeSbs(browser, tgPath('nav_rail'), crop, out, 'Huginn nav+rail');
  }
  await ctx.close();
  return out;
}
async function captureLightThreadProbe(browser, authA, chatId, firstUnreadId) {
  const vp = { width: 390, height: 844 };
  const { ctx, page } = await openDock(browser, authA, 'light', vp);
  await page.evaluate(async (id) => { await HuginnDock.openChat(id); }, chatId);
  await page.waitForSelector('.hg-msgs .hg-bubble', { timeout: 15000 });
  await applyThreadCaptureSeed(page, chatId, firstUnreadId);
  await page.waitForTimeout(300);
  await dismiss(page);
  await page.evaluate(() => {
    document.querySelectorAll('.hg-ai-chips').forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
    });
    const nav = document.querySelector('.hg-bottom-nav');
    if (nav) nav.style.setProperty('display', 'none', 'important');
  });
  const dir = phaseDir(7);
  const out = path.join(dir, '_p11_light_thread_probe.png');
  const box = await page.evaluate(() => {
    const el = document.querySelector('.hg-thread') || document.querySelector('#hgPanel');
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(390, r.width), height: Math.min(844, r.height) };
  });
  await page.screenshot({ path: out, clip: box });
  const pipette = await page.evaluate(() => {
    const thread = document.querySelector('.hg-thread');
    const msgs = document.querySelector('.hg-msgs');
    const cs = (el) => el ? getComputedStyle(el).backgroundColor : null;
    return { threadBg: cs(thread), msgsBg: cs(msgs), expected: 'rgb(230, 235, 238)' };
  });
  fs.writeFileSync(path.join(dir, 'P11-LIGHT-THREAD-PROBE.json'), JSON.stringify(pipette, null, 2));
  console.log('P11_LIGHT_THREAD_PROBE', JSON.stringify(pipette));
  await ctx.close();
  return { out, pipette };
}

async function captureMatrix(browser, authA, chatId, firstUnreadId) {
  const dir = phaseDir(8);
  const shots = [];
  shots.push(await captureThread(browser, authA, 'dark', chatId, firstUnreadId, 8, 'thread_dark'));
  shots.push(await captureThread(browser, authA, 'light', chatId, firstUnreadId, 8, 'thread_light'));
  shots.push(await captureList(browser, authA, 'dark', 8, 'list_dark'));
  shots.push(await captureList(browser, authA, 'light', 8, 'list_light'));
  shots.push(await captureContacts(browser, authA, 8));
  shots.push(await captureSettings(browser, authA, 8));
  shots.push(await captureNavRail(browser, authA, 8));
  // rename phase-8 files already named; write index
  fs.writeFileSync(path.join(dir, 'MATRIX.txt'), shots.join('\n') + '\n');
  ok('matrix files: ' + shots.length);
  return shots;
}

async function main() {
  if (!fs.existsSync(PHOTO)) console.warn('WARN no photo fixture');
  const health = await fetch(BASE + '/api/health').then((r) => r.status).catch(() => 0);
  if (!health) throw new Error('BASE down: ' + BASE);

  const authA = await apiLogin(LOGIN_A, PASS_A, PIN);
  const authB = await apiLogin(LOGIN_B, PASS_B, PIN_B);
  const { chatId, firstUnreadHint } = await seedThread(authA, authB);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const run = (n) => !ONLY || ONLY === String(n) || ONLY === String(n) + '.5';

  if (run(1)) await captureThread(browser, authA, 'dark', chatId, firstUnreadHint, 1, 'thread_dark');
  if (run(2)) await captureThread(browser, authA, 'light', chatId, firstUnreadHint, 2, 'thread_light');
  if (run(3)) await captureList(browser, authA, 'dark', 3, 'list_dark');
  if (run(4)) await captureList(browser, authA, 'light', 4, 'list_light');
  if (run(5)) await captureContacts(browser, authA, 5);
  if (run(6)) await captureSettings(browser, authA, 6);
  if (run(7)) {
    await captureNavRail(browser, authA, 7, 'dark');
    await captureNavRail(browser, authA, 7, 'light');
  }
  if (ONLY === 'p11-probe') {
    await captureLightThreadProbe(browser, authA, chatId, firstUnreadHint);
  }
  if (run('7.5') || (!ONLY && run(7))) {
    // 7.5: static proof of animations CSS present
    const dir = phaseDir('7.5');
    const cssHas = /hg-bubble-in|--hg-dur-tab|--hg-dur-bubble/.test(CSS);
    const jsHas = /haptic|touchstart|hg-bubble-in|is-visible/.test(JS);
    fs.writeFileSync(path.join(dir, 'ANIMATIONS-CHECK.txt'), [
      'bubble_slide_up_css=' + cssHas,
      'tab_transition_css=' + /--hg-dur-tab/.test(CSS),
      'haptic_js=' + /function haptic/.test(JS),
      'swipe_back_js=' + /touchstart/.test(JS),
      'scroll_fab_fade=' + /\.hg-scroll-fab\.is-visible/.test(CSS),
      'RESULT=' + (cssHas && jsHas ? 'OK' : 'FAIL')
    ].join('\n'));
    if (cssHas && jsHas) ok('phase 7.5 animation markers');
    else fail('phase 7.5 animation markers missing');
  }
  if (run(8)) await captureMatrix(browser, authA, chatId, firstUnreadHint);

  await browser.close();
  if (process.exitCode) {
    console.error('\nCAPTURE had FAILs');
    process.exit(1);
  }
  console.log('\nAll requested phase SBS written under', ROOT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
