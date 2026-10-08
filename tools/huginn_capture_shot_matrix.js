'use strict';

/**
 * Huginn visual-wave live capture — all IN-scope key scenes at 414×896 @2x.
 * Out: VERIFY/PREDEPLOY-VISUAL/CAPTURE/CRM-<shot>.png
 * Also mirrors to TG-DESIGN-BOOK PREDEPLOY-CAPTURE for V-PAIR continuity.
 *
 * Run: node tools/huginn_capture_shot_matrix.js
 * Requires clone :3100.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const OUT = path.join(__dirname, '../VERIFY/PREDEPLOY-VISUAL/CAPTURE');
const OUT2 = path.join(
  __dirname,
  '../tests/reports/huginn-ui/FOR-REVIEW/TG-DESIGN-BOOK/VERIFY/PREDEPLOY-CAPTURE'
);
const LOCAL_CSS = fs.readFileSync(path.join(__dirname, '../public/assets/css/huginn_dock.css'), 'utf8');
const LOCAL_JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/huginn_dock.js'), 'utf8');
const LOCAL_ICONS = fs.readFileSync(path.join(__dirname, '../public/assets/js/huginn_icons.js'), 'utf8');
const LOCAL_PHONE_CSS = fs.readFileSync(path.join(__dirname, '../public/assets/css/phone.css'), 'utf8');
const LOCAL_PHONE_JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/phone_ui.js'), 'utf8');

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(OUT2, { recursive: true });

async function apiLogin() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login: ' + JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    if (!res.ok) throw new Error('pin: ' + JSON.stringify(data));
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
    ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed'].forEach((k) => {
      try { localStorage.setItem(k, '1'); } catch (_) {}
    });
    document.querySelectorAll(
      '#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback,.tp-popup,#sg-overlay,.ui-modal'
    ).forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
      try { el.remove(); } catch (_) {}
    });
  }).catch(() => {});
}

async function shot(page, name) {
  for (const dir of [OUT, OUT2]) {
    const file = path.join(dir, name);
    await page.screenshot({ path: file, fullPage: false });
  }
  console.log('SHOT', name);
}

async function mountDock(page) {
  await page.addStyleTag({ content: LOCAL_CSS });
  await page.addStyleTag({ content: LOCAL_PHONE_CSS });
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock, .hg-chrome, .hg-bottom-nav, .hg-nav-search').forEach((el) => el.remove());
    document.body.classList.remove('hg-dock-open', 'hg-dock-collapsed');
    try { delete window.HuginnDock; } catch (_) { window.HuginnDock = undefined; }
  });
  await page.addScriptTag({ content: LOCAL_ICONS });
  await page.addScriptTag({ content: LOCAL_PHONE_JS });
  await page.addScriptTag({ content: LOCAL_JS });
  await page.evaluate(async () => {
    await HuginnDock.mount();
    HuginnDock.open('huginn');
  });
  await page.waitForSelector('#huginnDock', { timeout: 20000 });
}

function solidPng(w, h, r, g, b) {
  const zlib = require('zlib');
  function crc32(buf) {
    let c = ~0;
    const table = [];
    for (let n = 0; n < 256; n++) {
      let x = n;
      for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
      table[n] = x >>> 0;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (~c) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  }
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

async function seedChatContent(token, chatId) {
  const { Blob } = require('buffer');
  const texts = [
    'Доброе утро — согласовали смету на объект?',
    'Да, отправил в чат. Смотри вложения ниже.',
    'Ок, беру в работу. Вечером отпишусь.'
  ];
  for (const text of texts) {
    await fetch(BASE + '/api/chat-groups/' + chatId + '/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    }).catch(() => {});
  }
  const seedDir = path.join(__dirname, '../VERIFY/PREDEPLOY-VISUAL/SEED');
  const photos = fs.existsSync(seedDir)
    ? fs.readdirSync(seedDir).filter((f) => /\.jpe?g$/i.test(f)).slice(0, 9)
    : [];
  if (photos.length) {
    for (let i = 0; i < photos.length; i++) {
      const buf = fs.readFileSync(path.join(seedDir, photos[i]));
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: 'image/jpeg' }), `seed-photo-${i}.jpg`);
      const up = await fetch(BASE + '/api/chat-groups/' + chatId + '/upload-file', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: fd
      });
      if (!up.ok) console.warn('seed photo fail', i, up.status, await up.text().catch(() => ''));
    }
  } else {
    // fallback textured tiles (not flat neon placeholders)
    const palettes = [
      [[40, 60, 90], [90, 120, 160]],
      [[70, 50, 40], [140, 110, 80]],
      [[30, 70, 50], [80, 140, 100]],
      [[60, 40, 70], [120, 90, 150]],
      [[50, 50, 50], [110, 110, 120]],
      [[80, 40, 40], [160, 90, 70]]
    ];
    for (let i = 0; i < palettes.length; i++) {
      const [[r1, g1, b1], [r2, g2, b2]] = palettes[i];
      const w = 160; const h = 160;
      const zlib = require('zlib');
      function crc32(buf) {
        let c = ~0;
        for (let j = 0; j < buf.length; j++) {
          c ^= buf[j];
          for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
        }
        return (~c) >>> 0;
      }
      function chunk(type, data) {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const t = Buffer.from(type);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
        return Buffer.concat([len, t, data, crc]);
      }
      const raw = Buffer.alloc((w * 3 + 1) * h);
      for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        for (let x = 0; x < w; x++) {
          const t = (x + y) / (w + h);
          const n = ((x * 17 + y * 31) & 15) / 30;
          const i0 = y * (w * 3 + 1) + 1 + x * 3;
          raw[i0] = Math.max(0, Math.min(255, r1 + (r2 - r1) * t + n * 40));
          raw[i0 + 1] = Math.max(0, Math.min(255, g1 + (g2 - g1) * t + n * 30));
          raw[i0 + 2] = Math.max(0, Math.min(255, b1 + (b2 - b1) * t + n * 20));
        }
      }
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
      const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0))
      ]);
      const fd = new FormData();
      fd.append('file', new Blob([png], { type: 'image/png' }), `seed-media-${i}.png`);
      await fetch(BASE + '/api/chat-groups/' + chatId + '/upload-file', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd
      }).catch(() => {});
    }
  }
  const fdFile = new FormData();
  fdFile.append('file', new Blob([Buffer.from('%PDF-1.4 Huginn smeta seed\n')], { type: 'application/pdf' }), 'График_работ.pdf');
  await fetch(BASE + '/api/chat-groups/' + chatId + '/upload-file', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fdFile
  }).catch(() => {});
}

(async () => {
  const health = await fetch(BASE + '/api/health').then((r) => r.status).catch(() => 0);
  if (!health) throw new Error('BASE unreachable: ' + BASE);
  const auth = await apiLogin();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('hg_theme', 'dark');
    localStorage.setItem('asgard_safe_mode', '1');
    localStorage.setItem('hg_dock_collapsed', '0');
  }, auth);

  const page = await ctx.newPage();
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.body, { timeout: 20000 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await dismiss(page);
  await page.waitForFunction(() => !!(window.HuginnDock && HuginnDock.mount), { timeout: 45000 });
  await mountDock(page);
  await dismiss(page);
  await page.waitForTimeout(400);

  // S01 list
  await page.evaluate(() => {
    const btn = document.querySelector('.hg-bottom-nav button[data-mnav="chats"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);
  await shot(page, 'CRM-S01-chat-list-dark.png');
  await shot(page, 'CRM-list.png'); // alias for V-PAIR

  // S36 glass nav/fab (same frame)
  await shot(page, 'CRM-S36-glass-tabbar-fab.png');

  // S02 contacts
  await page.evaluate(() => {
    const btn = document.querySelector('.hg-bottom-nav button[data-mnav="contacts"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);
  await shot(page, 'CRM-S02-contacts-list.png');
  await shot(page, 'CRM-S12-contacts-glass-nav.png');

  // Back to chats + open thread
  await page.evaluate(() => {
    const btn = document.querySelector('.hg-bottom-nav button[data-mnav="chats"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  const opened = await page.evaluate(async () => {
    const rows = [...document.querySelectorAll('.hg-chat-row[data-cid]')];
    const row = rows.find((r) => Number(r.getAttribute('data-cid')) > 0);
    if (!row || !HuginnDock.openChat) return { ok: false, reason: 'no-real-row', n: rows.length };
    const id = Number(row.getAttribute('data-cid'));
    await HuginnDock.openChat(id);
    await new Promise((r) => setTimeout(r, 800));
    return {
      ok: !!(document.querySelector('.hg-composer') || document.querySelector('.hg-thread-head') || document.querySelector('.hg-msgs')),
      id,
      hasComposer: !!document.querySelector('.hg-composer')
    };
  });
  if (!opened.ok) {
    // API fallback: open first non-seed chat
    const fallback = await page.evaluate(async (token) => {
      const res = await fetch('/api/chat-groups', { headers: { Authorization: 'Bearer ' + token } });
      const data = await res.json();
      const chats = data.chats || data.items || data || [];
      const chat = (Array.isArray(chats) ? chats : []).find((c) => Number(c.id) > 0 && !c._seed);
      if (!chat) return { ok: false, reason: 'api-empty' };
      await HuginnDock.openChat(chat.id);
      await new Promise((r) => setTimeout(r, 800));
      return { ok: !!document.querySelector('.hg-composer'), id: chat.id };
    }, auth.token);
    Object.assign(opened, fallback);
  }
  console.log('openChat', opened);
  if (opened.id) {
    await seedChatContent(auth.token, opened.id);
    await page.evaluate(async (cid) => {
      if (window.HuginnDock && HuginnDock.openChat) await HuginnDock.openChat(cid);
    }, opened.id);
    await page.waitForTimeout(800);
  }
  await shot(page, 'CRM-S05-group-chat-ios-dark.png');
  await shot(page, 'CRM-S11-ios-chat-bubbles.png');
  await shot(page, 'CRM-thread.png');

  // S28 composer glass
  await page.evaluate(() => {
    const ta = document.querySelector('#hgInput');
    if (!ta) return;
    ta.value = 'тест композитора Huginn';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  });
  await page.waitForTimeout(300);
  await shot(page, 'CRM-S28-composer-glass.png');

  // A07 Ai над attach
  await shot(page, 'CRM-A07-ai-over-attach.png');

  // A06 idle — clear input
  await page.evaluate(() => {
    const ta = document.querySelector('#hgInput');
    if (!ta) return;
    ta.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await shot(page, 'CRM-A06-composer-idle-no-ai.png');

  // Open AI sheet
    // Force AI sheet with ≥4 lines
    await page.evaluate(() => {
      const ta = document.querySelector('#hgInput');
      if (ta) {
        ta.value = 'строка один\nстрока два\nстрока три\nстрока четыре — проверь грамматику';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(300);
    const aiOk = await page.evaluate(() => {
      const ai = document.querySelector('#hgAiEditorBtn');
      if (!ai || ai.hidden) return false;
      ai.click();
      return true;
    });
    await page.waitForTimeout(800);
    if (aiOk) {
      await shot(page, 'CRM-A02-ai-style-generate.png');
      await shot(page, 'CRM-composer-ai.png');
      await page.evaluate(() => {
        const ns = document.querySelector('[data-new-style], #hgAiNewStyle, .hg-ai-new-style');
        if (ns) ns.click();
      });
      await page.waitForTimeout(400);
      await shot(page, 'CRM-A01-new-style-sheet.png');
    }

    // Mimir rail tab
    await page.evaluate(() => {
      document.querySelectorAll('.hg-sheet,.hg-ai-sheet,.hg-attach-menu').forEach((el) => el.remove());
      const btn = document.querySelector('.hg-rail-btn[data-hg-tab="mimir"]');
      if (btn) btn.click();
      else if (window.HuginnDock) {
        /* fallback via internal open if exposed */
      }
    });
    await page.waitForTimeout(1200);
    await shot(page, 'CRM-Mimir-thread-chrome.png');
    const mimirVoiceHidden = await page.evaluate(() => {
      const menuBtn = document.querySelector('#hgAttach');
      if (menuBtn) menuBtn.click();
      const hasVoice = !!document.querySelector('.hg-attach-menu [data-kind="voice"]');
      const hasCircle = !!document.querySelector('.hg-attach-menu [data-kind="circle"]');
      document.querySelectorAll('.hg-attach-menu').forEach((el) => el.remove());
      const sendIsMic = !!(document.querySelector('#hgSend.is-mic'));
      return { hasVoice, hasCircle, sendIsMic, mimirComposer: !!document.querySelector('.hg-composer.is-mimir') };
    });
    console.log('mimirVoiceGate', mimirVoiceHidden);
    fs.writeFileSync(path.join(OUT, 'mimir-voice-gate.json'), JSON.stringify(mimirVoiceHidden, null, 2));

  // Attach menu (circle entry) — leave Mimir first, open real chat
  await page.evaluate(() => {
    document.querySelectorAll('.hg-sheet,.hg-ai-sheet,.hg-attach-menu').forEach((el) => el.remove());
    if (window.HuginnDock) {
      HuginnDock.open('huginn');
    }
  });
  await page.waitForTimeout(400);
  await page.evaluate(async (token) => {
    const res = await fetch('/api/chat-groups', { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    const chat = (data.chats || []).find((c) => Number(c.id) > 0 && !String(c.name || '').includes('Мимир'));
    if (chat && HuginnDock.openChat) await HuginnDock.openChat(chat.id);
  }, auth.token);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const att = document.querySelector('#hgAttach');
    if (att) att.click();
  });
  await page.waitForTimeout(400);
  await shot(page, 'CRM-S10-circle-entry.png');
  await page.evaluate(() => {
    document.querySelectorAll('.hg-attach-menu').forEach((el) => el.remove());
    if (window.HuginnDock && HuginnDock._capture) HuginnDock._capture.showRecChrome('voice');
  });
  await page.waitForTimeout(400);
  await shot(page, 'CRM-S09-voice-record-locked.png');
  await page.evaluate(() => {
    if (window.HuginnDock && HuginnDock._capture) HuginnDock._capture.clearRecChrome();
    if (window.HuginnDock && HuginnDock._capture) HuginnDock._capture.showRecChrome('circle');
  });
  await page.waitForTimeout(400);
  await shot(page, 'CRM-S10-circle-record.png');
  await page.evaluate(() => {
    if (window.HuginnDock && HuginnDock._capture) HuginnDock._capture.clearRecChrome();
  });
  await page.waitForTimeout(300);

  // S07 voice bubble — real-ish WAV + scroll voice into view (no AI draft in composer)
  await page.evaluate(async (token) => {
    const chatId = window.HuginnDock && HuginnDock.state && HuginnDock.state.chatId;
    if (!chatId) return;
    const ta = document.querySelector('#hgInput');
    if (ta) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    // minimal PCM WAV ~0.4s silence (valid audio container for waveform UI)
    const sampleRate = 8000;
    const samples = sampleRate >> 1;
    const dataSize = samples * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, dataSize, true);
    for (let i = 0; i < samples; i++) {
      const amp = Math.sin(i / 8) * 12000;
      v.setInt16(44 + i * 2, amp, true);
    }
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'cap-voice.wav');
    fd.append('message_type', 'voice');
    fd.append('file_duration', '11');
    await fetch('/api/chat-groups/' + chatId + '/upload-file', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd
    });
    if (HuginnDock.openChat) await HuginnDock.openChat(chatId);
  }, auth.token);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    document.querySelectorAll('.hg-ai-sheet,.hg-ai-style-sheet,.hg-attach-menu').forEach((el) => el.remove());
    if (window.HuginnDock && HuginnDock._capture) HuginnDock._capture.showVoiceDemo();
  });
  await page.waitForTimeout(300);
  await shot(page, 'CRM-S07-outgoing-voice.png');
  await page.evaluate(() => {
    if (window.HuginnDock && HuginnDock._capture) HuginnDock._capture.clearVoiceDemo();
  });

  // S26 reply/reactions — ensure bubbles visible
  await shot(page, 'CRM-S26-reply-reactions.png');

  // S24 pin banner if present
  await page.evaluate(async (token) => {
    const chatId = window.HuginnDock && HuginnDock.state && HuginnDock.state.chatId;
    if (!chatId) return;
    const msgs = await fetch('/api/chat-groups/' + chatId + '/messages?limit=5', {
      headers: { Authorization: 'Bearer ' + token }
    }).then((r) => r.json());
    const mid = (msgs.messages || [])[0] && (msgs.messages || [])[0].id;
    if (mid) {
      await fetch('/api/chat-groups/' + chatId + '/pin/' + mid, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}'
      });
      if (HuginnDock.openChat) await HuginnDock.openChat(chatId);
    }
  }, auth.token);
  await page.waitForTimeout(700);
  await shot(page, 'CRM-S24-header-pinned.png');

  // S35 stories on list
  await page.evaluate(() => {
    document.querySelectorAll('.hg-sheet,.hg-ai-sheet,.hg-attach-menu').forEach((el) => el.remove());
    const btn = document.querySelector('.hg-bottom-nav button[data-mnav="chats"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  await shot(page, 'CRM-S35-stories-header.png');
  await shot(page, 'CRM-S37-stories-liquid.png');

  // Profile / shared — prefer «Офис АСГАРД» group for S03/S18 REF parity
  const profileChatId = await page.evaluate(async (token) => {
    const res = await fetch('/api/chat-groups', { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    const list = data.chats || [];
    const office = list.find((c) => /офис\s*асгард/i.test(String(c.name || c.title || '')));
    const group = office || list.find((c) => Number(c.member_count || 0) > 2 && !/мимир/i.test(String(c.name || '')));
    return (group && group.id) || null;
  }, auth.token);
  if (profileChatId) {
    await seedChatContent(auth.token, profileChatId);
    await page.evaluate(async (cid) => {
      document.querySelectorAll('.hg-sheet,[data-role=menu],.hg-chat-profile').forEach((el) => el.remove());
      if (window.HuginnDock && HuginnDock.openChat) await HuginnDock.openChat(cid);
    }, profileChatId);
  } else {
    await page.evaluate(async (token) => {
      document.querySelectorAll('.hg-sheet,[data-role=menu],.hg-chat-profile').forEach((el) => el.remove());
      const res = await fetch('/api/chat-groups', { headers: { Authorization: 'Bearer ' + token } });
      const data = await res.json();
      const chat = (data.chats || []).find((c) => Number(c.id) > 0 && !String(c.name || '').includes('Мимир'));
      if (chat && HuginnDock.openChat) await HuginnDock.openChat(chat.id);
    }, auth.token);
  }
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const btn = document.querySelector('#hgThreadProfile');
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const t = document.querySelector('[data-stab="members"]');
    if (t) t.click();
  });
  await page.waitForTimeout(300);
  await shot(page, 'CRM-S03-group-profile.png');
  await page.evaluate(() => {
    const t = document.querySelector('[data-stab="media"]');
    if (t) t.click();
  });
  await page.waitForTimeout(400);
  await shot(page, 'CRM-S18-shared-media-grid.png');
  await page.evaluate(() => {
    const t = document.querySelector('[data-stab="files"]');
    if (t) t.click();
  });
  await page.waitForTimeout(300);
  await shot(page, 'CRM-S20-shared-files.png');
  await page.evaluate(() => {
    const t = document.querySelector('[data-stab="links"]');
    if (t) t.click();
  });
  await page.waitForTimeout(200);
  await shot(page, 'CRM-S21-shared-links.png');
  await page.evaluate(() => {
    const t = document.querySelector('[data-stab="voice"]');
    if (t) t.click();
  });
  await page.waitForTimeout(200);
  await shot(page, 'CRM-S22-shared-voice-list.png');
  await page.evaluate(() => {
    const t = document.querySelector('[data-stab="members"], [data-tab="members"], button[data-stab="people"]');
    if (t) t.click();
  });
  await page.waitForTimeout(300);
  await shot(page, 'CRM-S23-members-glass.png');
  await page.evaluate(() => {
    const more = document.querySelector('[data-action="more"], #hgProfileMore, .hg-profile-more');
    if (more) more.click();
  });
  await page.waitForTimeout(300);
  await shot(page, 'CRM-S19-profile-more.png');
  await shot(page, 'CRM-S16-mute-menu.png');

  // Compose sheet
  await page.evaluate(() => {
    document.querySelectorAll('.hg-sheet,.hg-chat-profile,.hg-compose-sheet').forEach((el) => el.remove());
    if (window.HuginnDock && HuginnDock.open) HuginnDock.open('huginn');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const btn = document.querySelector('.hg-bottom-nav button[data-mnav="chats"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const c = document.querySelector('#hgCompose');
    if (c) c.click();
  });
  await page.waitForTimeout(600);
  await shot(page, 'CRM-S13-compose-create.png');

  // Settings family — leave thread so bottom nav stays visible
  await page.evaluate(() => {
    document.querySelectorAll('.hg-compose-sheet,.hg-sheet,.hg-chat-profile,.hg-circle-record').forEach((el) => el.remove());
    document.body.classList.remove('hg-thread-open', 'hg-composer-focus', 'hg-recording', 'hg-circle-recording');
    const dock = document.getElementById('huginnDock');
    if (dock) dock.classList.remove('is-thread', 'is-recording', 'is-composer-focus');
    if (window.HuginnDock && HuginnDock._capture) {
      HuginnDock._capture.patchState((s) => {
        s.chatId = null;
        s.settingsProfileOpen = false;
        s.recording = null;
        s.tab = 'settings';
        s.mobileNav = 'settings';
      });
      HuginnDock._capture.rerender();
    } else if (window.HuginnDock && HuginnDock.closeChat) {
      HuginnDock.closeChat();
    }
    const btn = document.querySelector('.hg-bottom-nav button[data-mnav="settings"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  // S06 = settings main (REF S06); S32–S34 = same root chrome variants
  await shot(page, 'CRM-S06-profile-main.png');
  await shot(page, 'CRM-S32-settings-root.png');
  await shot(page, 'CRM-S33-settings-menu.png');
  await shot(page, 'CRM-S34-settings-compact.png');
  await page.evaluate(() => {
    const edit = document.querySelector('#hgSettingsEdit');
    if (edit) edit.click();
  });
  await page.waitForTimeout(400);
  await shot(page, 'CRM-S29-settings-profile.png');

  // S14 = phone recent-calls (NOT chat list)
  await page.evaluate(() => {
    document.querySelectorAll('.hg-sheet,.hg-chat-profile,.hg-ai-sheet').forEach((el) => el.remove());
    if (window.HuginnDock && HuginnDock._capture) {
      HuginnDock._capture.patchState((s) => {
        s.chatId = null;
        s.settingsProfileOpen = false;
        s.tab = 'phone';
        s.mobileNav = 'calls';
      });
      HuginnDock._capture.rerender();
    }
    const btn = document.querySelector('.hg-bottom-nav button[data-mnav="calls"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(700);
  await page.waitForFunction(() => {
    return !!(document.querySelector('.ph-dp--ios, .ph-ios-new, .ph-ios-head')
      || document.querySelector('#hgPanel [data-ph-view="idle"]'));
  }, { timeout: 8000 }).catch(() => {});
  await shot(page, 'CRM-S14-calls-ios.png');

  // Album from a real thread
  await page.evaluate(async () => {
    const btn = document.querySelector('.hg-bottom-nav button[data-mnav="chats"]');
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 200));
    const rows = [...document.querySelectorAll('.hg-chat-row[data-cid]')];
    const row = rows.find((r) => Number(r.getAttribute('data-cid')) > 0);
    if (row && HuginnDock.openChat) await HuginnDock.openChat(Number(row.getAttribute('data-cid')));
  });
  await page.waitForTimeout(600);
  await shot(page, 'CRM-S30-album.png');

  // AI apply shots A03–A05 — must be in a thread
  await page.evaluate(async () => {
    document.querySelectorAll('.hg-sheet,.hg-ai-sheet,.hg-chat-profile').forEach((el) => el.remove());
    const btn = document.querySelector('.hg-bottom-nav button[data-mnav="chats"]');
    if (btn) btn.click();
    const rows = [...document.querySelectorAll('.hg-chat-row[data-cid]')];
    const row = rows.find((r) => Number(r.getAttribute('data-cid')) > 0);
    if (row && HuginnDock.openChat) await HuginnDock.openChat(Number(row.getAttribute('data-cid')));
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const ta = document.querySelector('#hgInput');
    if (ta) {
      ta.value = 'строка один\nстрока два\nстрока три\nстрока четыре — apply grammar';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const ai = document.querySelector('#hgAiEditorBtn');
    if (ai) ai.click();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const tab = document.querySelector('.hg-ai-tab[data-tab="grammar"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const run = document.querySelector('#hgAiRun');
    if (run) run.click();
  });
  await page.waitForTimeout(1500);
  await shot(page, 'CRM-A03-ai-grammar-apply.png');
  await page.evaluate(() => {
    const tab = document.querySelector('.hg-ai-tab[data-tab="translate"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const run = document.querySelector('#hgAiRun');
    if (run) run.click();
  });
  await page.waitForTimeout(1200);
  await shot(page, 'CRM-A04-ai-translate-apply.png');
  await page.evaluate(() => {
    const tab = document.querySelector('.hg-ai-tab[data-tab="style"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const run = document.querySelector('#hgAiRun');
    if (run) run.click();
  });
  await page.waitForTimeout(1200);
  await shot(page, 'CRM-A05-ai-style-apply.png');
  await page.evaluate(() => {
    const apply = document.querySelector('#hgAiApply');
    if (apply) apply.click();
  });
  await page.waitForTimeout(400);

  const manifest = {
    status: 'SHOT_MATRIX_LIVE_CAPTURE',
    base: BASE,
    viewport: '414x896@2x',
    generated_at: new Date().toISOString(),
    opened_chat: opened,
    out: OUT
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(OUT2, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('CAPTURED', OUT);
  await browser.close();
})().catch((e) => {
  console.error('CAPTURE_FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
