'use strict';

/**
 * Sprint 1: thread_dark_side_by_side.png + 5 pixel checks.
 * Run: node tests/huginn/capture_thread_dark_sbs.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN_A = process.env.TEST_LOGIN_A || 'admin';
const PASS_A = process.env.TEST_PASS_A || 'huginn-test-ok';
const LOGIN_B = process.env.TEST_LOGIN_B || 'test_pm';
const PASS_B = process.env.TEST_PASS_B || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const PIN_B = process.env.TEST_PIN_B || '1234';

const OUT_DIR = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/ROUND-7');
const OUT = path.join(OUT_DIR, 'thread_dark_side_by_side.png');
const TG_REF = path.join(
  process.env.USERPROFILE || '',
  'Desktop',
  'месенджер',
  'IMG_20261003_194822.jpg'
);
const PHOTO = path.join(__dirname, 'fixtures_photo.png');

function fail(m) { console.error('FAIL', m); process.exitCode = 1; }
function ok(m) { console.log('PASS', m); }

async function apiLogin(login, password, pinPrefer) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login ' + login + ': ' + JSON.stringify(data));
  if (data.status === 'need_setup') {
    throw new Error('login ' + login + ' needs setup (pick another test user)');
  }
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
  if (!data.user || !data.user.id) throw new Error('login ' + login + ': no user');
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
    document.querySelectorAll(
      '#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback,.tp-popup,#sg-overlay,.ui-modal,.modal-overlay,.cr-m-overlay--visible'
    ).forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      try { el.remove(); } catch (_) {}
    });
  }).catch(() => {});
}

function parseRgb(s) {
  const m = String(s || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function rgbClose(a, b, tol = 2) {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(TG_REF)) throw new Error('Telegram ref missing: ' + TG_REF);
  if (!fs.existsSync(PHOTO)) throw new Error('photo fixture missing: ' + PHOTO);

  const health = await fetch(BASE + '/api/health').then((r) => r.status).catch(() => 0);
  if (!health) throw new Error('BASE down');

  const authA = await apiLogin(LOGIN_A, PASS_A, PIN);
  const authB = await apiLogin(LOGIN_B, PASS_B, PIN_B);
  const direct = await api(authA.token, 'POST', '/api/chat-groups/direct', { user_id: authB.user.id });
  const chatId = Number(direct.data?.id || direct.data?.chat_id || direct.data?.chat?.id);
  if (!chatId) throw new Error('no chat');

  // Seed: consecutive them (CRIT2 group) + me reply + them + photo
  for (const [tok, text] of [
    [authB.token, 'Уважаемые коллеги! просьба очень ускориться по вашим долгам'],
    [authB.token, 'Ждём акты и счета до пятницы — без этого не закроем период.'],
    [authA.token, 'Коллеги, доброго дня! Напомню, что акты и счета нужно сдать до пятницы.'],
    [authB.token, 'Принял, сегодня отправлю закрывающие.']
  ]) {
    const r = await api(tok, 'POST', `/api/chat-groups/${chatId}/messages`, { text });
    if (r.status >= 400) throw new Error('seed msg ' + r.status + ' ' + JSON.stringify(r.data));
  }

  // Real photo
  const png = fs.readFileSync(PHOTO);
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'site.png');
  fd.append('message_type', 'image');
  const up = await fetch(BASE + `/api/chat-groups/${chatId}/upload-file`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + authA.token },
    body: fd
  });
  if (!up.ok) throw new Error('photo upload ' + up.status);
  ok('photo uploaded');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  // Mobile frame matches Telegram Mobile ref (rail hidden, bottom nav)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('hg_theme', 'dark');
    localStorage.setItem('asgard_safe_mode', '1');
    localStorage.setItem('hg_dock_collapsed', '0');
    document.documentElement?.setAttribute('data-theme', 'dark');
  }, authA);

  const page = await ctx.newPage();
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.body, { timeout: 15000 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  // Force latest dock CSS (shell ?v= cache otherwise sticks)
  const cssPath = path.join(__dirname, '../../public/assets/css/huginn_dock.css');
  const jsPath = path.join(__dirname, '../../public/assets/js/huginn_dock.js');
  await page.addStyleTag({ content: fs.readFileSync(cssPath, 'utf8') });
  // Force latest dock JS once: tear down any prior dock then remount
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock, .hg-chrome, .hg-bottom-nav').forEach((el) => el.remove());
    if (document.body) {
      document.body.classList.remove('hg-dock-open', 'hg-dock-collapsed');
    }
  });
  await page.addScriptTag({ content: fs.readFileSync(jsPath, 'utf8') });
  await dismiss(page);
  await page.waitForTimeout(500);
  await dismiss(page);
  await page.evaluate(async () => {
    if (!window.HuginnDock) throw new Error('HuginnDock missing');
    await HuginnDock.mount();
    HuginnDock.open();
  });
  await page.waitForSelector('#huginnDock', { timeout: 20000 });
  await dismiss(page);
  await page.evaluate(async (id) => { await HuginnDock.openChat(id); }, chatId);
  await page.waitForSelector('.hg-msgs .hg-bubble', { timeout: 15000 });
  await page.waitForSelector('.hg-bubble.them', { timeout: 15000 });
  await page.waitForSelector('.hg-media-photo', { state: 'attached', timeout: 10000 });
  await page.waitForTimeout(600);
  await dismiss(page);
  // Frame a multi-bubble them group (CRIT2: av on first, indent on rest)
  await page.evaluate(() => {
    const box = document.querySelector('.hg-msgs');
    const groups = [...document.querySelectorAll('.hg-msg-group.them')];
    const multi = [...groups].reverse().find((g) => g.querySelectorAll('.hg-bubble').length >= 2);
    if (multi) multi.scrollIntoView({ block: 'center' });
    else if (box) box.scrollTop = box.scrollHeight;
  });
  await page.waitForTimeout(300);

  // Hide non-Telegram chrome for parity shot
  await page.evaluate(() => {
    document.querySelectorAll('.hg-ai-chips,.hg-unread-sep,.hg-bottom-nav').forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
    });
  });

  const metrics = await page.evaluate(() => {
    const msgs = document.querySelector('.hg-msgs');
    const me = [...document.querySelectorAll('.hg-bubble.me')].reverse().find((el) =>
      !(el.querySelector('.hg-media-photo'))
    ) || document.querySelector('.hg-bubble.me');
    const them = [...document.querySelectorAll('.hg-bubble.them')].find((el) =>
      (el.textContent || '').includes('Принял, сегодня')
    ) || [...document.querySelectorAll('.hg-bubble.them')].pop();
    const group = them && them.closest('.hg-msg-group.them');
    const av = group ? group.querySelector('.hg-msg-av') : document.querySelector('.hg-msg-group.them .hg-msg-av');
    const panel = document.querySelector('#hgPanel') || document.querySelector('.hg-panel');
    const rail = document.querySelector('.hg-rail');
    const sampleBg = (el) => (el ? getComputedStyle(el).backgroundColor : '');
    let avGap = null;
    if (av && them) {
      const ar = av.getBoundingClientRect();
      const br = them.getBoundingClientRect();
      avGap = Math.round(br.left - ar.right);
    }
    const railDisp = rail ? getComputedStyle(rail).display : 'none';
    const railRight = rail && railDisp !== 'none' ? rail.getBoundingClientRect().right : null;
    const panelLeft = panel ? panel.getBoundingClientRect().left : null;
    const metas = [...document.querySelectorAll('.hg-bubble:not(.image) .hg-meta')];
    const metaBroken = metas.some((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const text = (el.textContent || '').replace(/\s/g, '');
      /* vertical stack of digits: height huge or width tiny vs char count */
      return r.height > 18 || (text.length >= 4 && r.width < 22) || cs.whiteSpace === 'normal';
    });
    const themGroups = [...document.querySelectorAll('.hg-msg-group.them')];
    const avPerGroup = themGroups.map((g) => g.querySelectorAll('.hg-msg-av').length);
    const contRows = document.querySelectorAll('.hg-msg-row.them.is-cont').length;
    const groups = [...document.querySelectorAll('.hg-msg-group')];
    let gapSame = null;
    let gapBetween = null;
    if (groups.length) {
      const g0 = groups[0];
      const rows = [...g0.querySelectorAll('.hg-msg-row, .hg-bubble')];
      if (rows.length >= 2) {
        gapSame = Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom);
      }
      if (groups.length >= 2) {
        gapBetween = Math.round(groups[1].getBoundingClientRect().top - groups[0].getBoundingClientRect().bottom);
      }
    }
    return {
      threadBg: sampleBg(msgs),
      meBg: sampleBg(me),
      themBg: sampleBg(them),
      meW: me ? Math.round(me.getBoundingClientRect().width) : 0,
      themW: them ? Math.round(them.getBoundingClientRect().width) : 0,
      avGap,
      railLeftOfPanel: railDisp === 'none'
        ? true
        : (railRight != null && panelLeft != null ? railRight <= panelLeft + 2 : false),
      railHiddenMobile: railDisp === 'none',
      hasPhoto: !!document.querySelector('.hg-media-photo'),
      techHit: /ROUND\s*5|E2E|seed[-_]|must not show|zzz_/i.test((document.querySelector('.hg-thread') || {}).innerText || ''),
      yellowBorder: [...document.querySelectorAll('.hg-bubble, .hg-reacts button')].some((el) => {
        const b = getComputedStyle(el).borderColor;
        return /212,\s*168,\s*67|245,\s*197,\s*66|212,\s*168/.test(b);
      }),
      headAv: (() => {
        const a = document.querySelector('.hg-thread-av');
        return a ? Math.round(a.getBoundingClientRect().width) : 0;
      })(),
      headH: (() => {
        const h = document.querySelector('.hg-thread-head');
        return h ? Math.round(h.getBoundingClientRect().height) : 0;
      })(),
      metaBroken,
      metaSample: metas[0] ? {
        h: Math.round(metas[0].getBoundingClientRect().height),
        w: Math.round(metas[0].getBoundingClientRect().width),
        text: (metas[0].textContent || '').trim(),
        whiteSpace: getComputedStyle(metas[0]).whiteSpace
      } : null,
      avPerGroup,
      contRows,
      gapSame,
      gapBetween,
      presenceVisible: (() => {
        const p = document.querySelector('.hg-presence-wrap');
        return p ? getComputedStyle(p).display !== 'none' : false;
      })()
    };
  });

  console.log('METRICS', JSON.stringify(metrics, null, 2));

  // Pixel checks 1–3
  const threadRgb = parseRgb(metrics.threadBg);
  const meRgb = parseRgb(metrics.meBg);
  const themRgb = parseRgb(metrics.themBg);
  if (threadRgb && rgbClose(threadRgb, [14, 22, 33])) ok('P1 thread bg #0E1621');
  else fail('P1 thread bg want rgb(14,22,33) got ' + metrics.threadBg);
  if (meRgb && rgbClose(meRgb, [43, 82, 120])) ok('P2 me #2B5278');
  else fail('P2 me want rgb(43,82,120) got ' + metrics.meBg);
  if (themRgb && rgbClose(themRgb, [24, 37, 51])) ok('P3 them #182533');
  else fail('P3 them want rgb(24,37,51) got ' + metrics.themBg);

  if (!metrics.hasPhoto) fail('photo missing in thread');
  else ok('photo in thread');
  if (metrics.techHit) fail('tech junk in dock DOM');
  else ok('no tech junk');
  if (metrics.yellowBorder) fail('yellow/gold border on bubble/react');
  else ok('no yellow borders');
  if (!metrics.railLeftOfPanel) fail('rail not left of panel');
  else ok('rail left of panel');
  if (metrics.headAv < 34 || metrics.headAv > 38) fail('header avatar size ' + metrics.headAv + ' (want 36)');
  else ok('header avatar ~36');
  if (metrics.headH < 54 || metrics.headH > 58) fail('header height ' + metrics.headH + ' (want 56)');
  else ok('header height ~56');

  // ROUND-7 CRIT checks (mechanical; eyes still required)
  if (metrics.metaBroken) fail('CRIT1 meta broken/vertical');
  else ok('CRIT1 meta single-line');
  if (metrics.avPerGroup.some((n) => n !== 1)) fail('CRIT2 avatars per them-group ' + JSON.stringify(metrics.avPerGroup));
  else ok('CRIT2 one avatar per them-group');
  if (metrics.contRows < 1) fail('CRIT2 no continuation rows (need consecutive them)');
  else ok('CRIT2 continuation rows=' + metrics.contRows);
  if (metrics.gapBetween != null && (metrics.gapBetween < 12 || metrics.gapBetween > 20)) {
    fail('CRIT3 between-author gap ' + metrics.gapBetween + ' (want ~16)');
  } else ok('CRIT3 between-author gap ~16');
  if (metrics.presenceVisible) fail('presence strip still visible');
  else ok('presence strip hidden');

  // Crop Huginn panel (+rail) for right side
  const huginnCrop = path.join(OUT_DIR, '_huginn_thread_dark.png');
  // Prefer panel-only (no rail) for mobile parity with Telegram
  const panelBox = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('#hgPanel')];
    const live = panels.filter((p) => document.body.contains(p) && p.offsetParent !== null);
    const el = live.find((p) => p.querySelector('.hg-thread')) || live[live.length - 1] || panels[panels.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const box = panelBox || await page.locator('#huginnDock').boundingBox();
  if (!box) throw new Error('no dock box');
  await page.screenshot({
    path: huginnCrop,
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.min(box.width, 390 - box.x),
      height: Math.min(box.height, 844 - box.y)
    }
  });

  // Compose side-by-side; measure bubble width vs telegram approx from ref scale
  const compose = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const cpage = await compose.newPage();
  const tgB64 = fs.readFileSync(TG_REF).toString('base64');
  const hgB64 = fs.readFileSync(huginnCrop).toString('base64');
  const tgMime = TG_REF.endsWith('.png') ? 'image/png' : 'image/jpeg';
  await cpage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0a0a0a;color:#fff;font:600 13px/1.2 Segoe UI,system-ui,sans-serif}
    .wrap{display:grid;grid-template-columns:1fr 1fr;height:100vh}
    .pane{position:relative;overflow:hidden;border-right:1px solid #333;background:#0E1621}
    .pane img{width:100%;height:100%;object-fit:contain;object-position:center;background:#0E1621}
    .label{position:absolute;top:10px;left:10px;z-index:2;background:rgba(0,0,0,.7);padding:6px 10px;border-radius:8px}
  </style></head><body>
  <div class="wrap">
    <div class="pane"><div class="label">Telegram (ref)</div>
      <img id="tg" src="data:${tgMime};base64,${tgB64}" alt="tg">
    </div>
    <div class="pane"><div class="label">Huginn dark</div>
      <img id="hg" src="data:image/png;base64,${hgB64}" alt="hg">
    </div>
  </div></body></html>`);
  await cpage.waitForTimeout(300);
  await cpage.screenshot({ path: OUT, fullPage: false });
  ok('wrote ' + OUT);

  // P4: known seeded them text vs Telegram layout probe (15/1.35, pad 8×12)
  const SEED_THEM = 'Принял, сегодня отправлю закрывающие.';
  const p4 = await page.evaluate((seed) => {
    const them = [...document.querySelectorAll('.hg-bubble.them')].find((el) =>
      (el.textContent || '').includes(seed.slice(0, 20))
    ) || document.querySelector('.hg-bubble.them');
    const huginnW = them ? them.getBoundingClientRect().width : 0;
    const stack = them && them.closest('.hg-msg-stack');
    const colW = stack ? Math.round(stack.getBoundingClientRect().width) : 310;
    const col = document.createElement('div');
    col.style.cssText = 'position:absolute;left:-9999px;top:0;width:' + colW + 'px;';
    const probe = document.createElement('div');
    probe.style.cssText = 'display:inline-block;padding:8px 12px;border-radius:12px;font:400 15px/1.35 Inter,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;max-width:82%;background:#182533;color:#fff;box-sizing:border-box;white-space:pre-wrap;';
    probe.innerHTML = seed + '<span style="float:right;margin:4px 0 0 12px;font:400 11px/1.2 sans-serif;color:rgba(255,255,255,0.5)">12:00</span>';
    col.appendChild(probe);
    document.body.appendChild(col);
    const tgW = probe.getBoundingClientRect().width;
    const cs = them ? getComputedStyle(them) : null;
    col.remove();
    return {
      text: seed,
      huginnW: Math.round(huginnW),
      tgW: Math.round(tgW),
      colW,
      diff: Math.abs(Math.round(huginnW) - Math.round(tgW)),
      computed: cs ? { width: cs.width, maxWidth: cs.maxWidth, display: cs.display } : null
    };
  }, SEED_THEM);
  console.log('P4 detail', p4);
  if (p4.diff < 8) ok('P4 them width huginn=' + p4.huginnW + ' tgProbe=' + p4.tgW + ' Δ=' + p4.diff);
  else fail('P4 them width huginn=' + p4.huginnW + ' tgProbe=' + p4.tgW + ' Δ=' + p4.diff);

  // P5: av→bubble gap vs Telegram 8px; allow <4px delta
  const TG_AV_GAP = 8;
  if (metrics.avGap == null) fail('P5 av→bubble gap missing');
  else if (Math.abs(metrics.avGap - TG_AV_GAP) < 4) ok('P5 av→bubble gap ' + metrics.avGap + ' (tg ' + TG_AV_GAP + ')');
  else fail('P5 av→bubble gap ' + metrics.avGap + ' vs ' + TG_AV_GAP);

  await compose.close();
  await ctx.close();
  await browser.close();

  if (process.exitCode) {
    console.error('\nPIXEL GATE FAIL — not presenting');
    process.exit(1);
  }
  console.log('\nSBS ready:', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
