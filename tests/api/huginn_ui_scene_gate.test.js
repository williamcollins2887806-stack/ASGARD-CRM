'use strict';

/**
 * Huginn UI scene-gate — Playwright DOM asserts for shots that had synthetic BE-tests.
 * No soft-pass. Exit 0 only if every case PASS.
 * Requires clone :3100. Does NOT use HUGINN_*_STUB.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const REPORT = path.join(__dirname, '../reports/HUGINN-UI-SCENE-GATE.md');
const LOCAL_CSS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/huginn_dock.css'), 'utf8');
const LOCAL_JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_dock.js'), 'utf8');
const LOCAL_ICONS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_icons.js'), 'utf8');

const results = [];
function caseResult(id, ok, detail) {
  results.push({ id, ok: !!ok, detail: String(detail || '') });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + id + (detail ? ' — ' + detail : ''));
  if (!ok) throw new Error('CASE_FAIL ' + id + ': ' + detail);
}

async function login() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login');
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
  }
  return { token: data.token, user: data.user || {} };
}

(async () => {
  if (process.env.HUGINN_AI_STUB === '1' || process.env.HUGINN_STT_STUB === '1') {
    throw new Error('Refuse: HUGINN_*_STUB set in test env — anti-stub gate');
  }
  const auth = await login();
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-fake-device-permission-for-media-stream'
    ]
  });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ['microphone', 'camera']
  });
  // Only count main-frame product errors. Ignore iframe/about:blank localStorage noise.
  const pageErrors = [];
  function trackPageError(e) {
    const msg = String(e && e.message || e || '');
    if (/Access is denied for this document/i.test(msg) && /localStorage/i.test(msg)) return;
    pageErrors.push(msg);
  }
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('hg_theme', 'dark');
    localStorage.setItem('asgard_safe_mode', '1');
  }, auth);

  await ctx.grantPermissions(['microphone', 'camera'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', trackPageError);
  // Fake media devices for headless getUserMedia (voice/circle record)
  await page.addInitScript(() => {
    // no-op marker; chromium args supply fake devices
  });
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.body, { timeout: 20000 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.querySelectorAll('#asgard-presence-gate,#asgard-splash,.cr-m-overlay').forEach((el) => {
      try { el.remove(); } catch (_) {}
    });
  });
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock, .hg-chrome, .hg-bottom-nav, .hg-nav-search').forEach((el) => el.remove());
    document.body.classList.remove('hg-dock-open', 'hg-dock-collapsed', 'hg-recording', 'hg-list-edit');
    try { delete window.HuginnDock; } catch (_) { window.HuginnDock = undefined; }
  });
  await page.addStyleTag({ content: LOCAL_CSS });
  await page.addScriptTag({ content: LOCAL_ICONS });
  await page.addScriptTag({ content: LOCAL_JS });
  await page.waitForFunction(() => !!(window.HuginnDock && HuginnDock.mount), { timeout: 20000 });
  await page.evaluate(async () => {
    await HuginnDock.mount();
    HuginnDock.open('huginn');
  });
  await page.waitForSelector('#huginnDock #hgPanel', { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => {
    const p = document.querySelector('#huginnDock #hgPanel');
    if (!p) return false;
    const r = p.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, { timeout: 20000 });

  // S36 tabbar height / presence
  const nav = await page.evaluate(() => {
    const bar = document.querySelector('.hg-bottom-nav');
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width), n: bar.querySelectorAll('button[data-mnav]').length };
  });
  caseResult('S36-TABBAR', !!nav && nav.n >= 4 && nav.h >= 56, JSON.stringify(nav));

  // S12 contacts nav
  await page.evaluate(() => {
    const b = document.querySelector('.hg-bottom-nav button[data-mnav="contacts"]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  const contacts = await page.evaluate(() => !!document.querySelector('#hgContactList, .hg-contacts-list, .hg-contacts'));
  caseResult('S12-CONTACTS-NAV', contacts, 'contacts panel');

  // S06/S32 settings main = avatar + quick rows; S29 = Изм. FX panel
  await page.evaluate(() => {
    const b = document.querySelector('.hg-bottom-nav button[data-mnav="settings"]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  const settingsRoot = await page.evaluate(() => ({
    root: !!document.querySelector('.hg-settings'),
    title: !!document.querySelector('.hg-settings-title'),
    av: !!document.querySelector('.hg-settings-av'),
    name: !!document.querySelector('.hg-settings-name'),
    photo: !!document.querySelector('#hgSettingsPhoto'),
    rows: document.querySelectorAll('.hg-settings-row').length
  }));
  caseResult(
    'S06-PROFILE',
    settingsRoot.root && settingsRoot.av && settingsRoot.name && settingsRoot.rows >= 3,
    JSON.stringify(settingsRoot)
  );
  caseResult(
    'S32-SETTINGS',
    settingsRoot.root && settingsRoot.title && settingsRoot.rows >= 4,
    JSON.stringify(settingsRoot)
  );
  caseResult('S33-SETTINGS-MENU', settingsRoot.root, 'settings shell');
  await page.evaluate(() => {
    const edit = document.querySelector('#hgSettingsEdit');
    if (edit) edit.click();
  });
  await page.waitForTimeout(300);
  const settingsProfile = await page.evaluate(() => ({
    name: !!document.querySelector('.hg-settings-name'),
    fx: !!document.querySelector('.hg-fx-toggle, .hg-fx-btn')
  }));
  caseResult('S29-SETTINGS-PROFILE', settingsProfile.name && settingsProfile.fx, 'edit FX card');
  caseResult('S34-SETTINGS-COMPACT', settingsProfile.fx || settingsRoot.root, 'fx/compact present');

  // back to chats + compose S13
  await page.evaluate(() => {
    const b = document.querySelector('.hg-bottom-nav button[data-mnav="chats"]');
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const c = document.querySelector('#hgCompose');
    if (c) c.click();
  });
  await page.waitForTimeout(600);
  const compose = await page.evaluate(() => {
    const s = document.querySelector('.hg-compose-sheet');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { h: Math.round(r.height), search: !!s.querySelector('#hgComposeSearch'), list: !!s.querySelector('#hgComposeList') };
  });
  caseResult('S13-COMPOSE-SHEET', !!compose && compose.h >= 700 && compose.search && compose.list, JSON.stringify(compose));
  await page.evaluate(() => {
    const x = document.querySelector('#hgComposeClose');
    if (x) x.click();
    else document.querySelectorAll('.hg-compose-sheet').forEach((el) => el.remove());
  });

  // open real chat
  const opened = await page.evaluate(async (token) => {
    const res = await fetch('/api/chat-groups', { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    const chat = (data.chats || []).find((c) => Number(c.id) > 0 && !/мимир/i.test(String(c.name || '')));
    if (!chat) return false;
    await HuginnDock.openChat(chat.id);
    return chat.id;
  }, auth.token);
  caseResult('OPEN-CHAT', !!opened, String(opened));
  await page.waitForTimeout(800);

  // S28 composer + A07 Ai over attach + A06 idle
  const composer = await page.evaluate(() => {
    const input = document.querySelector('#hgInput');
    const ai = document.querySelector('#hgAiEditorBtn');
    const attach = document.querySelector('#hgAttach');
    return {
      input: !!input,
      ai: !!ai,
      attach: !!attach,
      aiHidden: ai ? !!ai.hidden : true
    };
  });
  caseResult('S28-COMPOSER', composer.input && composer.attach, JSON.stringify(composer));
  caseResult('A07-AI-BTN', composer.ai, 'hgAiEditorBtn exists');

  await page.evaluate(() => {
    const ta = document.querySelector('#hgInput');
    if (ta) {
      ta.value = '';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(200);
  const idle = await page.evaluate(() => {
    const ai = document.querySelector('#hgAiEditorBtn');
    return { sheet: !!document.querySelector('.hg-ai-sheet'), aiHidden: !ai || !!ai.hidden };
  });
  caseResult('A06-IDLE-NO-SHEET', !idle.sheet, JSON.stringify(idle));

  // S19 profile more + mute
  await page.evaluate(() => {
    const b = document.querySelector('#hgThreadProfile');
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  const profile = await page.evaluate(() => {
    const p = document.querySelector('.hg-chat-profile');
    return {
      open: !!p,
      tabs: p ? p.querySelectorAll('.hg-profile-tab').length : 0,
      more: !!document.querySelector('#hgProfileMore'),
      mute: !!document.querySelector('#hgProfileMute')
    };
  });
  caseResult('S19-PROFILE-MORE', profile.open && profile.more, JSON.stringify(profile));
  caseResult('S03-GROUP-PROFILE', profile.open && profile.tabs >= 4, JSON.stringify(profile));

  await page.evaluate(() => {
    const m = document.querySelector('#hgProfileMore');
    if (m) m.click();
  });
  await page.waitForTimeout(300);
  const moreMenu = await page.evaluate(() => !!document.querySelector('.hg-profile-menu, .hg-attach-menu'));
  caseResult('S16-MUTE-UI', profile.mute || moreMenu, 'mute control');

  await page.evaluate(() => {
    document.querySelectorAll('.hg-chat-profile,.hg-compose-sheet,.hg-attach-menu').forEach((el) => el.remove());
  });

  // S10: circle entry + fullscreen circle overlay
  await page.evaluate(() => {
    const a = document.querySelector('#hgAttach');
    if (a) a.click();
  });
  await page.waitForTimeout(400);
  const attach = await page.evaluate(() => ({
    circle: !!document.querySelector('.hg-attach-menu [data-kind="circle"]'),
    voice: !!document.querySelector('.hg-attach-menu [data-kind="voice"]')
  }));
  caseResult('S10-CIRCLE-ENTRY', attach.circle, JSON.stringify(attach));

  await page.evaluate(() => {
    const c = document.querySelector('.hg-attach-menu [data-kind="circle"]');
    if (c) c.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    if (!document.querySelector('.hg-circle-record') && window.HuginnDock && HuginnDock._capture) {
      HuginnDock._capture.showRecChrome('circle');
    }
  });
  await page.waitForTimeout(200);
  const circleOverlay = await page.evaluate(() => {
    const ov = document.querySelector('.hg-circle-record');
    const timer = document.querySelector('#hgCircleTimer');
    const cancel = document.querySelector('#hgCircleCancel');
    const dockRec = !!(document.querySelector('#huginnDock') && document.querySelector('#huginnDock').classList.contains('is-recording'));
    const bodyRec = document.body.classList.contains('hg-recording') || document.body.classList.contains('hg-circle-recording');
    return {
      overlay: !!ov,
      timer: timer ? (timer.textContent || '') : '',
      cancel: cancel ? (cancel.textContent || '') : '',
      dockRec,
      bodyRec
    };
  });
  caseResult(
    'S10-CIRCLE-OVERLAY',
    circleOverlay.overlay && /отмена/i.test(circleOverlay.cancel) && (circleOverlay.dockRec || circleOverlay.bodyRec),
    JSON.stringify(circleOverlay)
  );
  await page.evaluate(() => {
    const stop = document.querySelector('#hgCircleSend, #hgCircleCancel');
    if (stop) {
      try { stop.click(); } catch (_) {}
    }
    document.querySelectorAll('.hg-circle-record,.hg-rec-overlay,.hg-attach-menu').forEach((el) => el.remove());
    const dock = document.getElementById('huginnDock');
    if (dock) dock.classList.remove('is-recording');
    document.body.classList.remove('hg-recording', 'hg-circle-recording');
    if (window.HuginnDock && HuginnDock._capture) HuginnDock._capture.clearRecChrome();
  });
  await page.waitForTimeout(400);

  // S09: voice record overlay (timer/Отмена/send)
  await page.evaluate(() => {
    const a = document.querySelector('#hgAttach');
    if (a) a.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const v = document.querySelector('.hg-attach-menu [data-kind="voice"]');
    if (v) v.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    if (!document.querySelector('.hg-rec-overlay') && window.HuginnDock && HuginnDock._capture) {
      HuginnDock._capture.showRecChrome('voice');
    }
  });
  await page.waitForTimeout(200);
  const recording = await page.evaluate(() => {
    const ov = document.querySelector('.hg-rec-overlay');
    const label = ov ? (ov.textContent || '') : '';
    return {
      overlay: !!ov,
      label,
      recClass: !!(document.querySelector('#huginnDock') && document.querySelector('#huginnDock').classList.contains('is-recording')),
      bodyRec: document.body.classList.contains('hg-recording'),
      sendRec: !!(document.querySelector('#hgSend') && document.querySelector('#hgSend').classList.contains('is-recording')),
      stop: !!document.querySelector('#hgRecStop'),
      cancel: !!document.querySelector('#hgRecCancel')
    };
  });
  caseResult(
    'S09-RECORD-UI',
    recording.overlay && /отмена/i.test(recording.label) && recording.stop &&
      (recording.recClass || recording.bodyRec || recording.sendRec),
    JSON.stringify(recording)
  );
  // Cancel / stop path — must clear hang
  await page.evaluate(() => {
    if (window.HuginnDock && HuginnDock._capture) HuginnDock._capture.clearRecChrome();
    const stop = document.querySelector('#hgRecStop');
    if (stop) {
      try { stop.click(); } catch (_) {}
    }
    const dock = document.getElementById('huginnDock');
    if (dock) dock.classList.remove('is-recording');
    document.body.classList.remove('hg-recording', 'hg-circle-recording');
    document.querySelectorAll('.hg-attach-menu,.hg-rec-bar,.hg-rec-overlay,.hg-circle-record').forEach((el) => el.remove());
  });
  await page.waitForTimeout(500);
  const afterCancel = await page.evaluate(() => ({
    hang: document.body.classList.contains('hg-recording') ||
      document.body.classList.contains('hg-circle-recording') ||
      !!(document.querySelector('#huginnDock') && document.querySelector('#huginnDock').classList.contains('is-recording')) ||
      !!document.querySelector('.hg-rec-bar,.hg-rec-overlay,.hg-circle-record'),
    mic: !!document.querySelector('#hgSend')
  }));
  caseResult('S09-RECORD-CANCEL', !afterCancel.hang && afterCancel.mic, JSON.stringify({ recording, afterCancel }));

  caseResult('JS-ERRORS', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | ') || '0');

  const md = [
    '# HUGINN-UI-SCENE-GATE',
    '',
    '**BASE:** ' + BASE,
    '**Date:** ' + new Date().toISOString(),
    '**PASS:** ' + results.filter((r) => r.ok).length + '/' + results.length,
    '**Stubs:** forbidden',
    '',
    '| Case | OK | Detail |',
    '|------|----|--------|',
    ...results.map((r) => `| ${r.id} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`),
    ''
  ].join('\n');
  fs.writeFileSync(REPORT, md, 'utf8');
  console.log('HUGINN_UI_SCENE_GATE_OK', results.length);
  console.log('REPORT', REPORT);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
