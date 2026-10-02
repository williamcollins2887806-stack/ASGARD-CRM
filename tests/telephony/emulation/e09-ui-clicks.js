'use strict';

/**
 * E09: Playwright click-chains for softphone + journal + missed + PBX Save.
 * LOCAL :3100 only. PBX/telephony APIs route-intercepted (no live SIP / Mock CMD required).
 */
const { chromium } = require('playwright');
const { assert } = require('./harness');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const PASSWORD = process.env.TEST_PASSWORD || 'Test123!';
const PIN = process.env.TEST_PIN || '0000';

module.exports.id = 'E09';
module.exports.title = 'UI click chains softphone+journal+missed+PBX';

const MOCK_CALL = {
  id: 900901,
  call_type: 'inbound',
  from_number: '79001234567',
  to_number: '74993223062',
  line_number: '74993223062',
  duration_seconds: 84,
  created_at: new Date().toISOString(),
  record_path: '/emu/rec/900901.mp3',
  recording_id: 'emu_rec_900901',
  // Keep non-expandable so .call-row click opens detail panel (not inline expand)
  transcript_status: 'none',
  transcript_text: '',
  ai_summary: null,
  quality_score: null,
  client_name: 'Emu Client',
  user_name: 'Emu Admin',
};

async function loginFull() {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: process.env.TEST_LOGIN || 'test_admin', password: PASSWORD }),
  }).then((r) => r.json());
  let token = lr.token;
  let user = lr.user;
  if (lr.need_pin || lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: PIN }),
    }).then((r) => r.json());
    token = pr.token || token;
    user = pr.user || user;
  }
  if (!token) throw new Error('login failed');
  if (!user) user = { id: 1, login: 'test_admin', role: 'ADMIN', name: 'Test Admin' };
  if (!user.role) user.role = 'ADMIN';
  return { token, user };
}

function waitReq(log, pred, ms, label) {
  const deadline = Date.now() + (ms || 8000);
  return new Promise((resolve, reject) => {
    const tick = () => {
      const hit = log.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() > deadline) {
        return reject(
          new Error(
            'timeout waiting ' +
              (label || 'request') +
              '; seen=' +
              log.map((x) => x.method + ' ' + x.path).slice(-12).join(', ')
          )
        );
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function installRoutes(page, log) {
  await page.route('**/api/telephony/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    let postData = null;
    try {
      postData = req.postDataJSON();
    } catch (_) {
      postData = req.postData();
    }
    log.push({ method, path, postData, ts: Date.now() });

    if (path.includes('/api/telephony/pbx/softphone/credentials')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sip_username: 'emu1001',
          sip_password: 'emu-pass',
          ws_url: '/pbx/ws',
          stun: null,
        }),
      });
    }
    if (path.includes('/api/telephony/pbx/operator/status') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (path.includes('/api/telephony/pbx/operator/webrtc') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (path.includes('/api/telephony/pbx/call/answer') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (path.includes('/api/telephony/pbx/call/hold') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"hold":true}' });
    }
    if (path.includes('/api/telephony/pbx/call/hangup') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (path.includes('/api/telephony/pbx/call/outbound') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (path.includes('/api/telephony/pbx/call/transfer') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (path.includes('/api/telephony/pbx/lookup/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ name: 'Emu Caller', company: 'Emu Co' }),
      });
    }
    if (path.endsWith('/api/telephony/pbx/settings') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          routing_mode: 'duty_first',
          dial_strategy: 'duty_first',
          parallel_ring: false,
          work_hours_from: '09:00',
          work_hours_to: '18:00',
          recording_enabled: true,
          ai_postcall_enabled: false,
          greeting_text: 'Privet',
          after_hours_text: 'Closed',
          lines: [],
        }),
      });
    }
    if (path.endsWith('/api/telephony/pbx/settings') && method === 'PUT') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (path.includes('/api/telephony/pbx/reports/staff')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ staff: [{ user_id: 2, on_line: true, receive_mode: 'browser' }] }),
      });
    }
    if (path.includes('/api/telephony/pbx/health')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (path.includes('/api/telephony/pbx/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' });
    }

    if (path === '/api/telephony/calls' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [MOCK_CALL], total: 1 }),
      });
    }
    if (path === '/api/telephony/calls/' + MOCK_CALL.id + '/transcribe' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'EMU retranscribe queued' }),
      });
    }
    if (path.startsWith('/api/telephony/calls/') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CALL),
      });
    }

    if (path.startsWith('/api/telephony/missed')) {
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 7001,
                from_number: '79007654321',
                created_at: new Date().toISOString(),
                missed_acknowledged: false,
                client_name: 'Missed Emu',
              },
            ],
            unacknowledged: 1,
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (path === '/api/telephony/call/start' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'EMU callback' }),
      });
    }
    if (path === '/api/telephony/employees') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          employees: [{ id: 2, name: 'РљРѕР»Р»РµРіР° Р­РјСѓ', phone: '1002', internal_phone: '1002' }],
        }),
      });
    }
    if (path === '/api/telephony/managers') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ managers: [] }),
      });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' });
  });
}

async function boot(page, auth) {
  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('asgard_token', token);
      localStorage.setItem('auth_token', token);
      localStorage.setItem('asgard_user', JSON.stringify(user || {}));
      localStorage.setItem('asgard_theme_chosen', '1');
      localStorage.setItem('asgard_theme', 'light');
      localStorage.setItem('asgard_shell_banner_dismissed', '1');
      // leave safe_mode unset вЂ” e06 used it; topbar still appears without it
    },
    auth
  );
  await page.goto(BASE + '/?nocache=' + Date.now() + '#/telephony', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  try {
    await page.waitForFunction(
      () => !!(window.AsgardPhone && window.AsgardPhoneUI && document.querySelector('.topbar')),
      { timeout: 45000 }
    );
  } catch (e) {
    const snap = await page.evaluate(() => ({
      phone: !!window.AsgardPhone,
      ui: !!window.AsgardPhoneUI,
      topbar: !!document.querySelector('.topbar'),
      href: location.href,
      title: document.title,
    }));
    throw new Error('boot wait failed: ' + JSON.stringify(snap) + ' вЂ” ' + e.message);
  }
  await page.evaluate(() => {
    if (window.AsgardPhoneUI && AsgardPhoneUI.init) AsgardPhoneUI.init();
    if (window.AsgardPhone && AsgardPhone.checkMic) {
      AsgardPhone.checkMic = function () {
        return Promise.resolve({ ok: true });
      };
    }
  });
  await page.waitForSelector('#asgardPhoneBtn', { timeout: 15000 });
}

async function injectRing(page, meta) {
  await page.evaluate((m) => {
    var menu = document.getElementById('asgardPhoneMenu');
    if (menu) menu.style.display = 'none';
    var incall = document.getElementById('asgardPhoneIncall');
    if (incall) incall.style.display = 'none';
    AsgardPhone.applyIncoming(m);
    var el = document.getElementById('asgardPhoneIncoming');
    if (el) el.style.display = 'block';
  }, meta);
  await page.waitForFunction(() => {
    var el = document.getElementById('asgardPhoneIncoming');
    var btn = document.getElementById('phAnswer');
    return !!(el && el.style.display === 'block' && btn);
  }, { timeout: 5000 });
}

async function clickPhoneAct(page, selector) {
  try {
    await page.locator(selector).click({ timeout: 2500, force: true });
  } catch (_) {
    await page.evaluate((sel) => {
      var el = document.querySelector(sel);
      if (!el) throw new Error('missing ' + sel);
      el.click();
    }, selector);
  }
}

async function settleIdle(page) {
  await page.evaluate(async () => {
    try {
      await AsgardPhone.hangup();
    } catch (_) {}
  });
  await page.waitForFunction(() => {
    var st = AsgardPhone.getState();
    return st === 'offline' || st === 'on_line_browser' || st === 'on_line_mobile';
  }, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 250));
}

module.exports.run = async function run() {
  const u = new URL(BASE);
  assert(['127.0.0.1', 'localhost'].includes(u.hostname), 'E09 LOCAL only, got ' + BASE);

  const auth = await loginFull();
  const browser = await chromium.launch({ headless: true });
  const log = [];
  const meta = { chains: [] };

  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    await installRoutes(page, log);
    await boot(page, auth);

    // вЂ”вЂ”вЂ” 1. Online вЂ”вЂ”вЂ”
    await page.click('#asgardPhoneBtn');
    await page.waitForSelector('[data-action="online-browser"]', { timeout: 5000 });
    await page.click('[data-action="online-browser"]');
    await waitReq(
      log,
      (r) => r.method === 'GET' && r.path.includes('/softphone/credentials'),
      10000,
      'credentials'
    );
    await page.waitForFunction(() => window.AsgardPhone && AsgardPhone.getState() !== 'offline', {
      timeout: 8000,
    });
    await new Promise((r) => setTimeout(r, 600));
    await page.evaluate(() => {
      var menu = document.getElementById('asgardPhoneMenu');
      if (menu) menu.style.display = 'none';
    });
    meta.chains.push('online');
    meta.onlineVia = 'credentials+state';

    // вЂ”вЂ”вЂ” 2. Incoming answer вЂ”вЂ”вЂ”
    await injectRing(page, {
      number: '79001112233',
      channel: 'PJSIP/emu-e09-1',
      pbx_uid: 'e09uid1',
      call_id: 'pbx_e09_1',
    });
    await clickPhoneAct(page, '#phAnswer');
    await waitReq(
      log,
      (r) => r.method === 'POST' && r.path.includes('/call/answer'),
      8000,
      'answer'
    );
    meta.chains.push('answer');

    await settleIdle(page);

    await injectRing(page, {
      number: '79001112234',
      channel: 'PJSIP/emu-e09-decline',
      pbx_uid: 'e09uidD',
      call_id: 'pbx_e09_d',
    });
    const hangupBefore = log.filter((r) => r.path.includes('/call/hangup')).length;
    await clickPhoneAct(page, '#phDecline');
    await waitReq(
      log,
      (r) =>
        r.method === 'POST' &&
        r.path.includes('/call/hangup') &&
        log.filter((x) => x.path.includes('/call/hangup')).indexOf(r) >= hangupBefore,
      8000,
      'decline hangup'
    );
    meta.chains.push('decline');

    await settleIdle(page);

    // вЂ”вЂ”вЂ” 3. Hold в†’ Unhold в†’ Hangup вЂ”вЂ”вЂ”
    await injectRing(page, {
      number: '79005556677',
      channel: 'PJSIP/emu-e09-hold',
      pbx_uid: 'e09uidH',
      call_id: 'pbx_e09_h',
    });
    await clickPhoneAct(page, '#phAnswer');
    await waitReq(
      log,
      (r) =>
        r.method === 'POST' &&
        r.path.includes('/call/answer') &&
        r.postData &&
        String(r.postData.channel || '').includes('emu-e09-hold'),
      8000,
      'answer for hold'
    );
    await page.waitForFunction(() => window.AsgardPhone && AsgardPhone.getState() === 'in_call', {
      timeout: 5000,
    });
    await page.evaluate(() => {
      var bar = document.getElementById('asgardPhoneIncall');
      if (bar) bar.style.display = 'flex';
      if (!document.getElementById('phHold')) {
        document.dispatchEvent(
          new CustomEvent('asgard-phone', {
            detail: { type: 'state', state: 'in_call', number: '79005556677' },
          })
        );
      }
      bar = document.getElementById('asgardPhoneIncall');
      if (bar) bar.style.display = 'flex';
    });
    await page.waitForSelector('#phHold', { state: 'attached', timeout: 8000 });
    await clickPhoneAct(page, '#phHold');
    await waitReq(
      log,
      (r) => r.method === 'POST' && r.path.includes('/call/hold') && r.postData && r.postData.hold === true,
      8000,
      'hold on'
    );
    await page.waitForFunction(() => AsgardPhone.getState() === 'held', { timeout: 5000 });
    await clickPhoneAct(page, '#phHold');
    await waitReq(
      log,
      (r) => r.method === 'POST' && r.path.includes('/call/hold') && r.postData && r.postData.hold === false,
      8000,
      'hold off'
    );
    await page.waitForFunction(() => AsgardPhone.getState() === 'in_call', { timeout: 5000 });
    await clickPhoneAct(page, '#phHangup');
    await waitReq(
      log,
      (r) => r.method === 'POST' && r.path.includes('/call/hangup'),
      8000,
      'incall hangup'
    );
    meta.chains.push('hold_hangup');

    await settleIdle(page);
    await page.evaluate(async () => {
      if (AsgardPhone.getState() === 'offline') {
        await AsgardPhone.goOnline('browser');
      }
    });
    await page.waitForFunction(
      () => {
        var st = AsgardPhone.getState();
        return st === 'on_line_browser' || st === 'on_line_mobile';
      },
      { timeout: 10000 }
    );

    // вЂ”вЂ”вЂ” 4. Dialpad в†’ outbound вЂ”вЂ”вЂ”
    await page.click('#asgardPhoneBtn');
    await page.waitForSelector('[data-action="dial"]', { timeout: 5000 });
    await page.click('[data-action="dial"]');
    await page.waitForSelector('#phDialCall', { timeout: 5000 });
    await page.click('.ph-dial-key:has-text("7")');
    await page.fill('#phDialNum', '79009876543');
    await page.click('#phDialCall');
    await waitReq(
      log,
      (r) => r.method === 'POST' && r.path.includes('/call/outbound'),
      8000,
      'outbound'
    );
    meta.chains.push('dialpad');

    await settleIdle(page);

    // вЂ”вЂ”вЂ” 5. Transfer вЂ”вЂ”вЂ”
    await injectRing(page, {
      number: '79003334455',
      channel: 'PJSIP/emu-e09-tr',
      pbx_uid: 'e09uidT',
      call_id: 'pbx_e09_t',
    });
    await clickPhoneAct(page, '#phAnswer');
    await waitReq(
      log,
      (r) =>
        r.method === 'POST' &&
        r.path.includes('/call/answer') &&
        r.postData &&
        String(r.postData.channel || '').includes('emu-e09-tr'),
      8000,
      'answer for transfer'
    );
    await page.waitForFunction(() => AsgardPhone.getState() === 'in_call', { timeout: 5000 });
    await page.evaluate(() => {
      var bar = document.getElementById('asgardPhoneIncall');
      if (bar) bar.style.display = 'flex';
    });
    await page.waitForSelector('#phTransfer', { state: 'attached', timeout: 8000 });
    await clickPhoneAct(page, '#phTransfer');
    await page.waitForSelector('.ph-tr-row', { timeout: 8000 });
    await page.click('.ph-tr-row');
    await waitReq(
      log,
      (r) => r.method === 'POST' && r.path.includes('/call/transfer'),
      8000,
      'transfer'
    );
    meta.chains.push('transfer');

    await settleIdle(page);

    // вЂ”вЂ”вЂ” 6. Journal в†’ retranscribe вЂ”вЂ”вЂ”
    await page.click('.telephony-tab[data-tab="log"]');
    await page.waitForSelector('.call-row', { timeout: 10000 });
    await page.click('.call-row');
    await page.waitForFunction(
      () => {
        var p = document.getElementById('detailPanel');
        return p && p.classList.contains('call-detail-panel--open');
      },
      { timeout: 8000 }
    );
    await page.waitForSelector('#retranscribeBtn', { timeout: 8000 });
    await page.click('#retranscribeBtn');
    await waitReq(
      log,
      (r) => r.method === 'POST' && r.path.includes('/transcribe'),
      8000,
      'retranscribe'
    );
    meta.chains.push('journal');

    // Close detail overlay so tabs are clickable
    await page.evaluate(() => {
      if (window.AsgardTelephonyPage && AsgardTelephonyPage.closeDetailPanel) {
        AsgardTelephonyPage.closeDetailPanel();
      } else {
        var panel = document.getElementById('detailPanel');
        var overlay = document.getElementById('detailOverlay');
        if (panel) panel.classList.remove('call-detail-panel--open');
        if (overlay) overlay.classList.remove('call-detail-overlay--visible');
      }
    });
    await new Promise((r) => setTimeout(r, 200));

    // вЂ”вЂ”вЂ” 7. Missed callback вЂ”вЂ”вЂ”
    await page.click('.telephony-tab[data-tab="missed"]');
    await page.waitForSelector('.missed-call-btn--callback', { timeout: 10000 });
    await page.click('.missed-call-btn--callback');
    await page.waitForSelector('#telCbConfirm', { timeout: 5000 });
    await page.click('#telCbConfirm');
    await waitReq(
      log,
      (r) =>
        (r.method === 'POST' && r.path.includes('/call/outbound')) ||
        (r.method === 'POST' && r.path.includes('/call/start')),
      8000,
      'missed callback'
    );
    meta.chains.push('missed');

    // вЂ”вЂ”вЂ” 8. PBX Save вЂ”вЂ”вЂ”
    await page.click('.telephony-tab[data-tab="pbx"]');
    await page.waitForSelector('#pbxSaveSettings', { timeout: 10000 });
    await page.fill('#pbxGreeting', 'E09 greeting ' + Date.now());
    await page.click('#pbxSaveSettings');
    await waitReq(
      log,
      (r) => r.method === 'PUT' && r.path.endsWith('/api/telephony/pbx/settings'),
      8000,
      'pbx settings PUT'
    );
    meta.chains.push('pbx_save');

    const required = [
      'online',
      'answer',
      'decline',
      'hold_hangup',
      'dialpad',
      'transfer',
      'journal',
      'missed',
      'pbx_save',
    ];
    for (const id of required) {
      assert(meta.chains.includes(id), 'missing chain ' + id + ' in ' + meta.chains.join(','));
    }
    // Strip debug noise from returned meta
    delete meta.onlineVia;
    return meta;
  } finally {
    await browser.close();
  }
};
