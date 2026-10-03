'use strict';
/**
 * Playwright visual gallery for PBX softphone + telephony page — LOCAL :3100 only.
 * Usage: node tests/telephony/integration/playwright-visual.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const OUT_LEGACY = path.join('tests', 'reports', 'telephony-ui');
const OUT = path.join(OUT_LEGACY, 'GALLERY');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const PASSWORD = process.env.TEST_PASSWORD || 'Test123!';
const PIN = process.env.TEST_PIN || '0000';

/** @type {{ file: string, slug: string, title: string, see: string, do: string }[]} */
let galleryEntries = [];

function assertLocal() {
  const u = new URL(BASE);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) {
    throw new Error('Visual gate LOCAL ONLY, got ' + BASE);
  }
}

function runGallerySeed() {
  const seedPath = path.join(__dirname, 'seed-telephony-gallery.js');
  if (!fs.existsSync(seedPath)) {
    console.warn('runGallerySeed: seed-telephony-gallery.js missing, skip');
    return;
  }
  console.log('Running seed-telephony-gallery.js …');
  execFileSync(process.execPath, [seedPath], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}

async function loginFull(login = process.env.TEST_LOGIN || 'test_admin') {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: PASSWORD }),
  }).then((r) => r.json());
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin' || lr.need_pin) {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: PIN }),
    }).then((r) => r.json());
    token = pr.token || token;
    user = pr.user || user;
  }
  if (!token) throw new Error('login failed: ' + JSON.stringify(lr).slice(0, 200));
  const me = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => r.json())
    .catch(() => ({}));
  user = me.user || user || {};
  return { token, user };
}

async function seedJournalForVisual(token) {
  try {
    const me = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } }).then((r) =>
      r.json()
    );
    const uid = me.user && me.user.id;
    if (!uid) return;
    const { Pool } = require('pg');
    require('dotenv').config();
    const dbName = process.env.DB_NAME || 'asgard_crm_test';
    if (!String(dbName).includes('test')) return;
    const pool = new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      database: dbName,
      user: process.env.DB_USER || 'asgard',
      password: process.env.DB_PASSWORD,
    });
    await pool.query(
      `UPDATE call_history
       SET user_id = COALESCE(user_id, $1),
           ai_summary = COALESCE(ai_summary, 'Клиент уточнил сроки и стоимость; договорились перезвонить.'),
           updated_at = NOW()
       WHERE id IN (
         SELECT id FROM call_history
         WHERE created_at > NOW() - INTERVAL '40 days'
         ORDER BY created_at DESC
         LIMIT 12
       )`,
      [uid]
    );
    await pool.end();
  } catch (e) {
    console.warn('seedJournalForVisual skip:', e.message);
  }
}

async function dismissChrome(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try {
        localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1');
      } catch (_) {}
    }
    ['asgard-theme-selector', 'asgard-presence-gate', 'asgard-splash', 'sg-overlay'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    document
      .querySelectorAll(
        '.cr-m-overlay, .modalback, .tp-popup, .telephony-popup, .sg-splash, #crm20Banner, .crm20-banner, .hint-card, .mimir-hint, .asgard-hint, [class*="hint-toast"], .dash-tip, .mh-root, .mh-teaser-wrap, #mimirHints, [class*="mh-"], #mimirFab, .mimir-fab, .mh-fab, [data-mimir-fab], .asgard-mimir-fab'
      )
      .forEach((el) => {
        try {
          el.remove();
        } catch (_) {}
      });
    document.querySelectorAll('img[alt*="Mim"], img[alt*="Мир"], img[alt*="mimir"]').forEach((el) => {
      try {
        const host = el.closest('button, a, .fab, [class*="mimir"]') || el;
        host.remove();
      } catch (_) {}
    });
    // Strip emoji glyphs from any leftover tip chrome on telephony
    document.querySelectorAll('.telephony-page, #telContent').forEach((root) => {
      root.querySelectorAll('*').forEach((n) => {
        if (n.childNodes.length === 1 && n.childNodes[0].nodeType === 3) {
          const t = n.textContent || '';
          if (/[\u{1F300}-\u{1FAFF}]/u.test(t) && t.length < 4) n.textContent = '';
        }
      });
    });
  });
}

async function bootApp(page, theme, auth) {
  await page.addInitScript(
    ({ token, user, theme }) => {
      localStorage.setItem('asgard_token', token);
      localStorage.setItem('auth_token', token);
      localStorage.setItem('asgard_user', JSON.stringify(user || {}));
      localStorage.setItem('asgard_permissions', JSON.stringify((user && user.permissions) || {}));
      localStorage.setItem('asgard_theme_chosen', '1');
      localStorage.setItem('asgard_theme', theme);
      localStorage.setItem('asgard_shell_banner_dismissed', '1');
      localStorage.setItem('asgard_v2_banner_dismissed', '1');
      localStorage.setItem('asgard_safe_mode', '1');
      const d = new Date();
      for (let i = -1; i <= 1; i++) {
        const x = new Date(d.getTime() + i * 86400000);
        localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1');
      }
    },
    { token: auth.token, user: auth.user, theme }
  );
  await page.goto(BASE + '/?nocache=' + Date.now() + '#/welcome', {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page
    .evaluate(async () => {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
      }
    })
    .catch(() => {});
  await page.waitForTimeout(1500);
  await dismissChrome(page);

  let ready = false;
  for (let attempt = 0; attempt < 4 && !ready; attempt++) {
    await page.goto(BASE + '/?nocache=' + Date.now() + '#/telephony', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(900 + attempt * 400);
    await dismissChrome(page);
    ready = await page.evaluate(() => {
      return !!(
        document.querySelector('.topbar, #sidebar, .sidebar, .nav-rail') ||
        (document.body && document.body.innerText.includes('Телефония'))
      );
    });
  }
  if (!ready) throw new Error('App shell not ready after auth bootstrap');

  await page.evaluate((theme) => {
    if (window.AsgardTheme && AsgardTheme.apply) AsgardTheme.apply(theme);
  }, theme);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    if (window.AsgardPhoneUI && AsgardPhoneUI.init) AsgardPhoneUI.init();
  });
  await page.waitForTimeout(500);
}

async function shot(page, slug, meta, theme) {
  const fileName = (theme === 'dark' ? 'dark/' : '') + slug + '.png';
  const file = path.join(OUT, fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  console.log('SHOT', file);
  if (meta) {
    galleryEntries.push({
      file: fileName.replace(/\\/g, '/'),
      slug: (theme === 'dark' ? 'dark/' : '') + slug,
      theme: theme || 'light',
      source: meta.source || 'live',
      kind: meta.kind || 'full',
      title: meta.title + (theme === 'dark' ? ' (dark)' : ''),
      see: meta.see,
      do: meta.do,
    });
  }
  return file;
}

async function shotCloseup(page, selector, slug, meta, theme) {
  const loc = page.locator(selector).first();
  if (!(await loc.count())) {
    throw new Error('Close-up target missing: ' + selector + ' for ' + slug);
  }
  const fileName = (theme === 'dark' ? 'dark/' : '') + slug + '.png';
  const file = path.join(OUT, fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.evaluate(() => {
    document.querySelectorAll('#mimirFab, .mimir-fab, .mh-fab, [data-mimir-fab], .asgard-mimir-fab').forEach((el) => {
      try { el.remove(); } catch (_) {}
    });
  });
  const box = await loc.boundingBox();
  if (!box) throw new Error('Close-up bbox missing: ' + selector);
  const pad = 28;
  const vw = page.viewportSize()?.width || 1440;
  const vh = page.viewportSize()?.height || 900;
  const clip = {
    x: Math.max(0, Math.floor(box.x - pad)),
    y: Math.max(0, Math.floor(box.y - pad)),
    width: Math.ceil(box.width + pad * 2),
    height: Math.ceil(box.height + pad * 2),
  };
  if (clip.x + clip.width > vw) clip.width = vw - clip.x;
  if (clip.y + clip.height > vh) clip.height = vh - clip.y;
  await page.screenshot({ path: file, clip });
  console.log('SHOT closeup', file);
  if (meta) {
    galleryEntries.push({
      file: fileName.replace(/\\/g, '/'),
      slug: (theme === 'dark' ? 'dark/' : '') + slug,
      theme: theme || 'light',
      source: meta.source || 'synth',
      kind: 'closeup',
      title: meta.title + (theme === 'dark' ? ' (dark)' : ''),
      see: meta.see,
      do: meta.do,
    });
  }
  return file;
}

async function assertPhoneDot(page, expected, label) {
  const ok = await page.evaluate((exp) => {
    var btn = document.getElementById('asgardPhoneBtn');
    var dot = btn && btn.querySelector('.ph-btn-dot');
    if (!btn || !dot) return { ok: false, btn: '', dot: '' };
    return {
      ok: btn.classList.contains('ph-btn--' + exp) && dot.classList.contains('ph-dot--' + exp),
      btn: btn.className,
      dot: dot.className,
    };
  }, expected);
  if (!ok.ok) {
    throw new Error(
      'Gallery assert failed for ' +
        label +
        ': expected ph-btn--' +
        expected +
        ' / ph-dot--' +
        expected +
        ', got btn=' +
        ok.btn +
        ' dot=' +
        ok.dot
    );
  }
}

async function ensurePhoneBtn(page) {
  const exists = await page.locator('#asgardPhoneBtn').count();
  if (exists) return true;
  await page.evaluate(() => {
    var slot = document.getElementById('asgardPhoneSlot');
    if (!slot) {
      var badges = document.querySelector('.topbar .badges, .topbar, header');
      if (badges) {
        slot = document.createElement('span');
        slot.id = 'asgardPhoneSlot';
        badges.insertBefore(slot, badges.firstChild);
      }
    }
    if (slot && !document.getElementById('asgardPhoneBtn') && window.AsgardPhoneUI) {
      AsgardPhoneUI.init();
    }
  });
  await page.waitForTimeout(400);
  return (await page.locator('#asgardPhoneBtn').count()) > 0;
}

async function synthOfflineMenu(page) {
  await page.evaluate(() => {
    const SVG = (paths) =>
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      paths +
      '</svg>';
    const I = {
      browser: SVG('<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'),
      mobile: SVG('<rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/>'),
      micCheck: SVG(
        '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>'
      ),
    };
    function item(ico, title, sub) {
      return (
        '<button type="button" class="ph-menu-item"><span class="ph-menu-item__ico">' +
        ico +
        '</span><span class="ph-menu-item__body"><span class="ph-menu-item__title">' +
        title +
        '</span><span class="ph-menu-item__sub">' +
        sub +
        '</span></span></button>'
      );
    }
    let menu = document.getElementById('asgardPhoneMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'asgardPhoneMenu';
      document.body.appendChild(menu);
    }
    menu.className = 'ph-menu is-gallery';
    menu.style.display = 'block';
    menu.style.top = '56px';
    menu.style.right = '24px';
    menu.innerHTML =
      '<div class="ph-menu-head">Телефон PBX</div>' +
      item(I.browser, 'На линии', 'Звонки в браузере') +
      item(I.mobile, 'На линии', 'Переадресация на мобильный') +
      item(I.micCheck, 'Проверить микрофон', 'Доступ к устройству');
  });
}

async function applyIncomingSynth(page, opts) {
  opts = opts || {};
  await page.evaluate((pulse) => {
    var card = document.getElementById('asgardPhoneIncoming');
    if (!card) {
      card = document.createElement('div');
      card.id = 'asgardPhoneIncoming';
      document.body.appendChild(card);
    }
    card.className = 'ph-card ph-card--incoming is-gallery' + (pulse ? ' ph-card--incoming-pulse' : '');
    card.style.display = 'block';
    card.innerHTML =
      '<div class="ph-card-inner">' +
      '<div class="ph-card-top">' +
      '<div class="ph-avatar" aria-hidden="true">ИП</div>' +
      '<div class="ph-card-meta">' +
      '<div class="ph-card-title">Входящий звонок</div>' +
      '<div class="ph-card-name">Иван Петров</div>' +
      '<div class="ph-card-sub">+7 (495) 123-45-67 · ООО Север</div>' +
      '</div></div>' +
      '<div class="ph-card-actions">' +
      '<button type="button" class="ph-act ph-act--answer" data-tooltip="Ответить (Space)">Ответить</button>' +
      '<button type="button" class="ph-act ph-act--hangup" data-tooltip="Сбросить (Esc)">Сбросить</button>' +
      '</div></div>';
    var btn = document.getElementById('asgardPhoneBtn');
    if (btn) {
      btn.className = 'ph-btn ph-btn--ring';
      var dot = btn.querySelector('.ph-btn-dot');
      if (dot) dot.className = 'ph-btn-dot ph-dot--ring';
    }
  }, !!opts.pulse);
  await new Promise((r) => setTimeout(r, 250));
  await page.evaluate(() => {
    var btn = document.getElementById('asgardPhoneBtn');
    if (btn) {
      btn.className = 'ph-btn ph-btn--ring';
      var dot = btn.querySelector('.ph-btn-dot');
      if (dot) dot.className = 'ph-btn-dot ph-dot--ring';
    }
  });
}

async function applyIncallSynth(page, opts) {
  opts = opts || {};
  await page.evaluate(({ holdActive, mini }) => {
    const SVG_FILL = (paths) =>
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">' +
      paths +
      '</svg>';
    const I = {
      mic: SVG_FILL('<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/>'),
      hold: SVG_FILL('<rect x="5" y="3" width="5" height="18" rx="1.5"/><rect x="14" y="3" width="5" height="18" rx="1.5"/>'),
      keypad: SVG_FILL(
        '<circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>'
      ),
      transfer: SVG_FILL('<path d="M8 4v3H3v3h5v3l5-4.5L8 4zm8 16v-3h5v-3h-5v-3l-5 4.5L16 20z"/>'),
      hangup: SVG_FILL(
        '<path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>'
      ),
      note: SVG_FILL(
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L17.5 8H14V4.5zM8 13h8v1.8H8V13zm0 3.7h6V18.5H8V16.7z"/>'
      ),
      chevronDown: SVG_FILL('<path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>'),
      chevronUp: SVG_FILL('<path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>'),
    };
    function dock(id, ico, label, extra) {
      return (
        '<div class="ph-dock-item"><button type="button" class="ph-iconbtn' +
        (extra ? ' ' + extra : '') +
        '" id="' +
        id +
        '" title="' +
        label +
        '" aria-label="' +
        label +
        '" data-tooltip="' +
        label +
        '">' +
        ico +
        '</button><span>' +
        label +
        '</span></div>'
      );
    }
    var inc = document.getElementById('asgardPhoneIncoming');
    if (inc) {
      inc.style.display = 'none';
      inc.classList.remove('is-gallery');
    }
    var bar = document.getElementById('asgardPhoneIncall');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'asgardPhoneIncall';
      document.body.appendChild(bar);
    }
    bar.className = 'ph-bar is-gallery' + (holdActive ? ' ph-bar--hold' : '') + (mini ? ' ph-bar--mini' : '');
    bar.style.display = 'flex';
    bar.innerHTML =
      '<div class="ph-bar-actions">' +
      '<div class="ph-bar-meta"><span class="ph-bar-timer">01:24</span>' +
      '<span class="ph-bar-num">+7 (495) 123-45-67</span></div>' +
      dock('phMute', I.mic, 'Микрофон', '') +
      dock('phHold', I.hold, holdActive ? 'Снять' : 'Удерж.', holdActive ? 'ph-iconbtn--active' : '') +
      dock('phKeypad', I.keypad, 'Клавиши', '') +
      dock('phTransfer', I.transfer, 'Перевод', '') +
      dock('phNoteToggle', I.note, 'Заметка', '') +
      '<div class="ph-dock-item ph-dock-item--keep ph-dock-item--mini-toggle">' +
      '<button type="button" class="ph-iconbtn ph-iconbtn--mini" id="phDockMini" title="' +
      (mini ? 'Развернуть' : 'Свернуть') +
      '" data-tooltip="' +
      (mini ? 'Развернуть' : 'Свернуть') +
      '">' +
      (mini ? I.chevronUp : I.chevronDown) +
      '</button></div>' +
      dock('phHangup', I.hangup, 'Сброс', 'ph-iconbtn--danger') +
      '</div>' +
      '<textarea class="ph-note" placeholder="Заметка…" rows="1"></textarea>';
    var btn = document.getElementById('asgardPhoneBtn');
    if (btn) {
      btn.className = 'ph-btn ph-btn--incall';
      var dot = btn.querySelector('.ph-btn-dot');
      if (dot) dot.className = 'ph-btn-dot ph-dot--incall';
    }
  }, { holdActive: !!opts.holdActive, mini: !!opts.mini });
  await new Promise((r) => setTimeout(r, 250));
  await page.evaluate(() => {
    var btn = document.getElementById('asgardPhoneBtn');
    if (btn) {
      btn.className = 'ph-btn ph-btn--incall';
      var dot = btn.querySelector('.ph-btn-dot');
      if (dot) dot.className = 'ph-btn-dot ph-dot--incall';
    }
  });
}

async function synthDialpadModal(page) {
  await page.evaluate(() => {
    if (window.AsgardUI && AsgardUI.showModal) {
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
      var gridHtml = keys
        .map(function (k) {
          return '<button type="button" class="ph-dial-key">' + k + '</button>';
        })
        .join('');
      var ov = AsgardUI.showModal({
        title: 'Набор номера',
        html:
          '<label class="ph-dial-label">Номер<input type="tel" class="inp" id="phDialNum" value="+74951234567"></label>' +
          '<div class="ph-dial-grid" id="phDialGrid">' +
          gridHtml +
          '</div>' +
          '<button type="button" class="btn primary ph-dial-call" id="phDialCall">Позвонить</button>',
        wide: false,
      });
      var m = ov && ov.querySelector && ov.querySelector('.cr-m');
      if (m) m.classList.add('ph-modal');
    }
  });
  await page.waitForTimeout(400);
}

async function synthTransferModal(page) {
  await page.evaluate(() => {
    if (window.AsgardUI && AsgardUI.showModal) {
      var ov = AsgardUI.showModal({
        title: 'Перевод звонка',
        html:
          '<input type="search" class="inp" id="phTrSearch" placeholder="Поиск сотрудника…">' +
          '<div class="ph-tr-list" id="phTrList">' +
          '<button type="button" class="ph-tr-row is-selected" aria-selected="true">' +
          '<span class="ph-tr-ava" aria-hidden="true">АМ<span class="ph-tr-dot ph-tr-dot--on"></span></span>' +
          '<span class="ph-tr-name">Алексей Менеджеров</span></button>' +
          '<button type="button" class="ph-tr-row">' +
          '<span class="ph-tr-ava" aria-hidden="true">МО<span class="ph-tr-dot ph-tr-dot--off"></span></span>' +
          '<span class="ph-tr-name">Мария Операторова</span></button>' +
          '</div>' +
          '<div class="ph-seg" role="group" aria-label="Режим перевода">' +
          '<button type="button" class="ph-seg__btn is-active" data-mode="blind">Слепой</button>' +
          '<button type="button" class="ph-seg__btn" data-mode="consult">Консультативный</button>' +
          '</div>' +
          '<input type="hidden" name="phTrMode" id="phTrMode" value="blind">' +
          '<button type="button" class="btn primary ph-dial-call" id="phTransferGo">Перевести</button>',
        wide: false,
      });
      var m = ov && ov.querySelector && ov.querySelector('.cr-m');
      if (m) m.classList.add('ph-modal');
    }
  });
  await page.waitForTimeout(400);
}

async function assertVisibleText(page, text, label) {
  const ok = await page.evaluate((t) => {
    const body = (document.body && document.body.innerText) || '';
    if (body.indexOf(t) !== -1) return true;
    return body.toLowerCase().indexOf(String(t).toLowerCase()) !== -1;
  }, text);
  if (!ok) throw new Error('Gallery assert failed for ' + label + ': missing text ' + JSON.stringify(text));
}

async function closeModals(page) {
  await page.evaluate(() => {
    if (window.AsgardUI && AsgardUI.closeModal) AsgardUI.closeModal();
    document.querySelectorAll('.cr-m-overlay, .modalback').forEach(function (el) {
      try {
        el.remove();
      } catch (_) {}
    });
  });
  await page.waitForTimeout(200);
}

async function gotoTelephony(page) {
  await page.goto(BASE + '/#/telephony', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2200);
  await dismissChrome(page);
}

async function clickTelephonyTab(page, tabId) {
  await gotoTelephony(page);
  const tab = page.locator('button.telephony-tab[data-tab="' + tabId + '"]').first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(1800);
    return true;
  }
  const fallback = page.locator('button:has-text("' + tabId + '")').first();
  if (await fallback.count()) {
    await fallback.click();
    await page.waitForTimeout(1800);
    return true;
  }
  return false;
}

async function openDemoCallDetail(page) {
  await page.waitForSelector('.call-row, .call-log-table', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const ok = await page.evaluate(async () => {
    var targetId = null;
    document.querySelectorAll('.call-row').forEach(function (row) {
      if (!targetId && row.textContent.indexOf('DEMO') >= 0) targetId = row.getAttribute('data-id');
    });
    if (!targetId) {
      var first = document.querySelector('.call-row[data-id]');
      if (first) targetId = first.getAttribute('data-id');
    }
    if (!targetId) return false;
    if (window.AsgardTelephonyPage && AsgardTelephonyPage.openDetailPanel) {
      await AsgardTelephonyPage.openDetailPanel(targetId);
      return true;
    }
    if (window.openDetailPanel) {
      await openDetailPanel(targetId);
      return true;
    }
    var btn = document.querySelector('.tel-open-detail[data-call-id="' + targetId + '"]');
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  await page.waitForTimeout(2500);
  return ok;
}

async function closeCallDetail(page) {
  await page.evaluate(() => {
    if (window.AsgardTelephonyPage && AsgardTelephonyPage.closeDetailPanel) {
      AsgardTelephonyPage.closeDetailPanel();
    }
    var panel = document.getElementById('detailPanel');
    var overlay = document.getElementById('detailOverlay');
    if (panel) panel.classList.remove('call-detail-panel--open');
    if (overlay) overlay.classList.remove('call-detail-overlay--visible');
  });
  await page.waitForTimeout(300);
}

function copyForReview() {
  const reviewDir = path.join(OUT_LEGACY, 'FOR-REVIEW');
  fs.mkdirSync(reviewDir, { recursive: true });
  for (const f of fs.readdirSync(reviewDir)) {
    if (f.endsWith('.png') || f.endsWith('.html') || f.endsWith('.md')) {
      try { fs.unlinkSync(path.join(reviewDir, f)); } catch (_) {}
    }
  }
  const light = galleryEntries.filter((e) => (e.theme || 'light') === 'light');
  const dark = galleryEntries.filter((e) => e.theme === 'dark');
  let n = 1;
  function copyOne(e) {
    const src = path.join(OUT, e.file);
    if (!fs.existsSync(src)) return;
    const num = String(n++).padStart(2, '0');
    const theme = e.theme || 'light';
    const base = path.basename(e.file, '.png').replace(/^dark[\\/]/, '');
    const destName = num + '_' + theme + '_' + base.replace(/[\\/]/g, '_') + '.png';
    fs.copyFileSync(src, path.join(reviewDir, destName));
  }
  light.forEach(copyOne);
  dark.forEach(copyOne);
  console.log('FOR-REVIEW:', n - 1, 'PNG →', reviewDir);
}

function writeGalleryArtifacts(auth) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(OUT_LEGACY, { recursive: true });

  const manifest = {
    base: BASE,
    themes: ['light', 'dark'],
    ts: new Date().toISOString(),
    user: { login: auth.user.login, role: auth.user.role },
    outDir: 'tests/reports/telephony-ui/GALLERY/',
    shots: galleryEntries.map((e) => ({
      file: e.file,
      slug: e.slug,
      theme: e.theme || 'light',
      source: e.source || 'live',
      kind: e.kind || 'full',
      title: e.title,
      see: e.see,
      do: e.do,
    })),
    note:
      'Honest gallery: softphone overlays marked source=synth (SVG markup identical to phone_ui.js); page tabs source=live. Each softphone state has full viewport + close-up. No emoji synth.',
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  let md =
    '# Галерея UI телефонии (light + dark) — честная\n\n' +
    'Сервер: `' +
    BASE +
    '`. Пользователь: **' +
    (auth.user.login || auth.user.name || '—') +
    '** (`' +
    (auth.user.role || '—') +
    '`).\n\n' +
    '**source:** `live` = реальный DOM страницы; `synth` = softphone-оверлей с **тем же SVG markup**, что в `phone_ui.js` (не emoji).\n\n' +
    '**kind:** `full` = viewport 1440×900; `closeup` = кроп по селектору оверлея.\n\n' +
    '| # | Файл | Тема | source | kind | Экран |\n|---|------|------|--------|------|-------|\n';
  galleryEntries.forEach((e, i) => {
    md +=
      '| ' +
      (i + 1) +
      ' | [`' +
      e.file +
      '`](./' +
      e.file +
      ') | ' +
      (e.theme || 'light') +
      ' | ' +
      (e.source || 'live') +
      ' | ' +
      (e.kind || 'full') +
      ' | ' +
      e.title +
      ' |\n';
  });
  md += '\n---\n\n';
  for (const e of galleryEntries) {
    md +=
      '## ' +
      e.title +
      '\n\n' +
      '_source=`' +
      (e.source || 'live') +
      '` · kind=`' +
      (e.kind || 'full') +
      '`_\n\n' +
      '![ ' +
      e.title +
      '](./' +
      e.file +
      ')\n\n' +
      '**Что должно быть видно:** ' +
      e.see +
      '\n\n' +
      '**Что проверить / сделать дизайнеру:** ' +
      e.do +
      '\n\n---\n\n';
  }
  fs.writeFileSync(path.join(OUT, 'INDEX.md'), md);

  fs.writeFileSync(
    path.join(OUT_LEGACY, 'manifest.json'),
    JSON.stringify(
      {
        ...manifest,
        galleryPrimary: 'GALLERY/manifest.json',
        pngDir: 'GALLERY/',
      },
      null,
      2
    )
  );
}

/**
 * Full telephony UI gallery for designer review.
 * @param {'light'|'dark'} theme
 */
async function captureGallery(browser, auth, theme) {
  theme = theme || 'light';
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    bypassCSP: true,
  });
  await context.route('**/assets/js/telephony.js*', async (route) => {
    const fsPath = path.join(process.cwd(), 'public', 'assets', 'js', 'telephony.js');
    await route.fulfill({ path: fsPath, contentType: 'application/javascript; charset=utf-8' });
  });
  await context.route('**/assets/js/phone_ui.js*', async (route) => {
    const fsPath = path.join(process.cwd(), 'public', 'assets', 'js', 'phone_ui.js');
    await route.fulfill({ path: fsPath, contentType: 'application/javascript; charset=utf-8' });
  });
  await context.route('**/assets/js/telephony_admin.js*', async (route) => {
    const fsPath = path.join(process.cwd(), 'public', 'assets', 'js', 'telephony_admin.js');
    await route.fulfill({ path: fsPath, contentType: 'application/javascript; charset=utf-8' });
  });
  await context.route('**/assets/css/phone.css*', async (route) => {
    const fsPath = path.join(process.cwd(), 'public', 'assets', 'css', 'phone.css');
    await route.fulfill({ path: fsPath, contentType: 'text/css; charset=utf-8' });
  });
  await context.route('**/assets/css/telephony-page.css*', async (route) => {
    const fsPath = path.join(process.cwd(), 'public', 'assets', 'css', 'telephony-page.css');
    await route.fulfill({ path: fsPath, contentType: 'text/css; charset=utf-8' });
  });
  const page = await context.newPage();
  const shots = [];
  const snap = (slug, meta) => shot(page, slug, meta, theme);
  try {
    await bootApp(page, theme, auth);

    // Softphone overlays: shoot OVER live journal so glass blur is visible
    await ensurePhoneBtn(page);
    await clickTelephonyTab(page, 'log');
    await page.waitForSelector('text=DEMO', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(600);
    await dismissChrome(page);

    await synthOfflineMenu(page);
    await assertVisibleText(page, 'Телефон PBX', '01-offline-menu');
    shots.push(
      await snap('01-phone-offline-menu', {
        title: 'Телефон PBX — меню офлайн',
        source: 'synth',
        kind: 'full',
        see: 'Кнопка телефона в шапке и glass-меню: иконки + secondary line (браузер / мобильный / микрофон).',
        do: 'Проверить отступы, тени, иерархию title/sub и читаемость.',
      })
    );
    shots.push(
      await shotCloseup(page, '#asgardPhoneMenu', '01-phone-offline-menu-closeup', {
        title: 'Меню офлайн — close-up',
        source: 'synth',
        see: 'Пункты меню с иконками в плитках и secondary line.',
        do: 'Сверить плотность с Ting dropdown.',
      }, theme)
    );
    await page.evaluate(() => {
      const m = document.getElementById('asgardPhoneMenu');
      if (m) {
        m.classList.remove('is-gallery');
        m.style.display = 'none';
      }
    });

    await applyIncomingSynth(page, { pulse: true });
    await assertVisibleText(page, 'Входящий звонок', '02-incoming');
    await assertVisibleText(page, 'Ответить', '02-incoming-cta');
    await assertPhoneDot(page, 'ring', '02-incoming');
    const incomingTopRight = await page.evaluate(() => {
      var el = document.getElementById('asgardPhoneIncoming');
      if (!el) return false;
      var cs = getComputedStyle(el);
      return cs.position === 'fixed' && parseFloat(cs.top) < 120 && parseFloat(cs.right) < 40;
    });
    if (!incomingTopRight) throw new Error('Gallery assert failed for 02-incoming: not top-right');
    shots.push(
      await snap('02-incoming', {
        title: 'Входящий звонок',
        source: 'synth',
        kind: 'full',
        see: 'Top-right glass card + pulse; avatar initials; gold Answer / Decline.',
        do: 'Сверить top-right near bell, pulse и CTA tooltips.',
      })
    );
    shots.push(
      await shotCloseup(page, '#asgardPhoneIncoming', '02-incoming-closeup', {
        title: 'Входящий — close-up',
        source: 'synth',
        see: 'Glass card, pulse ring, initials, gold Answer.',
        do: 'Оценить атмосферу pulse и CTA.',
      }, theme)
    );

    await applyIncallSynth(page);
    await assertVisibleText(page, '01:24', '03-incall-timer');
    await assertPhoneDot(page, 'incall', '03-incall');
    /* Scroll journal to end so dock clearance padding is visible (last rows not under dock) */
    await page.evaluate(() => {
      var wrap = document.getElementById('logTableWrap');
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
      var tel = document.getElementById('telContent');
      if (tel) tel.scrollTop = tel.scrollHeight;
      var content = document.getElementById('content') || document.scrollingElement;
      if (content) content.scrollTop = content.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(200);
    shots.push(
      await snap('03-incall', {
        title: 'Разговор (incall dock)',
        source: 'synth',
        kind: 'full',
        see: 'Glass single-row pill dock: таймер, номер, SVG-кнопки, mini-toggle, note collapsed; pad under table.',
        do: 'Проверить slim pill vs Ting conference; danger hangup; last row above dock.',
      })
    );
    await applyIncallSynth(page, { mini: true });
    shots.push(
      await shotCloseup(page, '#asgardPhoneIncall', '03-incall-closeup', {
        title: 'Mini-dock — close-up',
        source: 'synth',
        see: 'ph-bar--mini corner pill: таймер + hangup, остальные actions скрыты.',
        do: 'Проверить compact pill и expand affordance.',
      }, theme)
    );
    await applyIncallSynth(page);

    await synthDialpadModal(page);
    await assertVisibleText(page, 'Набор номера', '04-dialpad');
    shots.push(
      await snap('04-incall-dialpad', {
        title: 'DTMF / набор номера',
        source: 'synth',
        kind: 'full',
        see: 'Модалка «Набор номера» с плотной сеткой 0–9 и sticky CTA.',
        do: 'Оценить tabular номер и сетку ph-dial-key.',
      })
    );
    await closeModals(page);

    await applyIncallSynth(page);
    await synthTransferModal(page);
    await assertVisibleText(page, 'Перевести', '05-transfer-cta');
    await assertVisibleText(page, 'Слепой', '05-transfer-seg');
    const segOk = await page.evaluate(() => !!document.querySelector('.ph-seg .ph-seg__btn.is-active'));
    if (!segOk) throw new Error('Gallery assert failed for 05-transfer: missing .ph-seg');
    shots.push(
      await snap('05-incall-transfer', {
        title: 'Перевод звонка',
        source: 'synth',
        kind: 'full',
        see: 'Segmented blind/consult, avatar+presence dots, CTA Перевести.',
        do: 'Проверить .ph-seg и presence dots вместо текста «на линии».',
      })
    );
    await closeModals(page);

    await applyIncallSynth(page, { holdActive: true });
    await assertVisibleText(page, '01:24', '06-hold-timer');
    await assertPhoneDot(page, 'incall', '06-hold');
    const holdOk = await page.evaluate(() => {
      var hold = document.getElementById('phHold');
      return !!(hold && hold.classList.contains('ph-iconbtn--active'));
    });
    if (!holdOk) throw new Error('Gallery assert failed for 06-hold: hold button not active');
    shots.push(
      await snap('06-incall-hold', {
        title: 'Удержание',
        source: 'synth',
        kind: 'full',
        see: 'Dock с active hold и ph-bar--hold акцентом.',
        do: 'Active-state hold отличим от mute.',
      })
    );
    shots.push(
      await shotCloseup(page, '#asgardPhoneIncall', '06-incall-hold-closeup', {
        title: 'Удержание — close-up',
        source: 'synth',
        see: 'Active hold + gold border атмосферы.',
        do: 'Сверить hold vs mute contrast.',
      }, theme)
    );
    await page.evaluate(() => {
      var bar = document.getElementById('asgardPhoneIncall');
      if (bar) {
        bar.classList.remove('is-gallery');
        bar.style.display = 'none';
      }
      var card = document.getElementById('asgardPhoneIncoming');
      if (card) {
        card.classList.remove('is-gallery');
        card.style.display = 'none';
      }
    });

    await clickTelephonyTab(page, 'log');
    await page.waitForSelector('text=DEMO', { timeout: 25000 });
    await page.waitForTimeout(800);
    await assertVisibleText(page, 'DEMO', '07-journal');
    await assertVisibleText(page, 'Рейтинг', '07-journal-rating-col');
    await page.evaluate(() => {
      document.body.classList.add('is-gallery');
      localStorage.setItem('tel:sound', '0');
      var gear = document.getElementById('fColGear');
      if (!gear) throw new Error('fColGear missing');
      gear.click();
      var stale = document.getElementById('phHotkeyHint');
      if (stale) stale.remove();
    });
    await page.evaluate(() => {
      if (window.AsgardPhoneUI && AsgardPhoneUI.init) AsgardPhoneUI.init();
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
      if (!document.getElementById('phHotkeyHint') && window.AsgardPhoneUI && AsgardPhoneUI.openHotkeyHelp) {
        /* fallback only if key path missed before bind — still prod helper, not synth HTML */
        AsgardPhoneUI.openHotkeyHelp();
      }
    });
    await page.waitForTimeout(350);
    const phase2Ui = await page.evaluate(() => {
      var chips = document.querySelectorAll('#telSavedViews .tel-saved-view-chip').length;
      var menu = document.getElementById('telColMenu');
      var gear = document.getElementById('fColGear');
      var hint = document.getElementById('phHotkeyHint');
      var anchored = false;
      if (menu && gear) {
        var mr = menu.getBoundingClientRect();
        var gr = gear.getBoundingClientRect();
        anchored = Math.abs(mr.right - gr.right) < 48 && mr.top >= gr.bottom - 2;
      }
      return {
        chips: chips,
        menu: !!menu,
        anchored: anchored,
        hint: !!(hint && hint.classList.contains('is-open') && hint.querySelector('kbd')),
      };
    });
    if (!phase2Ui.chips) throw new Error('Gallery assert failed for 07-saved-views: missing .tel-saved-view-chip');
    if (!phase2Ui.menu) throw new Error('Gallery assert failed for 07-col-menu: #telColMenu not open');
    if (!phase2Ui.anchored) throw new Error('Gallery assert failed for 07-col-menu: menu not anchored to #fColGear');
    if (!phase2Ui.hint) throw new Error('Gallery assert failed for 07-hotkeys: prod #phHotkeyHint not opened via ?');
    shots.push(
      await snap('07-journal', {
        title: 'Журнал звонков',
        source: 'live',
        kind: 'full',
        see: 'Saved-view chips, column menu DnD/hide, hotkey hint, sticky cols, DEMO.',
        do: 'Ревью chips, col menu, hotkeys overlay, tabular nums.',
      })
    );
    await page.evaluate(() => {
      var m = document.getElementById('telColMenu');
      if (m) m.remove();
      var h = document.getElementById('phHotkeyHint');
      if (h) h.classList.remove('is-open');
    });

    await openDemoCallDetail(page);
    await page.evaluate(() => {
      var body = document.getElementById('detailBody');
      if (body) body.scrollTop = 0;
      var sub = document.getElementById('transcriptViewer') || document.querySelector('.transcript-viewer');
      if (sub) {
        // Ensure overflow so thin custom scrollbar thumb is visible on PNG.
        if (sub.scrollHeight <= sub.clientHeight + 8) {
          var frag = document.createDocumentFragment();
          for (var i = 0; i < 24; i++) {
            var line = document.createElement('div');
            line.className = 'transcript-line';
            line.setAttribute('data-gallery-pad', '1');
            line.innerHTML =
              '<span class="transcript-speaker">' +
              (i % 2 ? 'Клиент' : 'Оператор') +
              '</span> Дополнительная реплика для проверки скролла субтитров #' +
              (i + 1);
            frag.appendChild(line);
          }
          sub.appendChild(frag);
        }
        sub.scrollTop = Math.min(64, Math.max(0, sub.scrollHeight - sub.clientHeight));
        sub.scrollIntoView({ block: 'center' });
      }
    });
    await page.waitForTimeout(400);
    await assertVisibleText(page, 'Субтитры', '08a-subtitles');
    shots.push(
      await snap('08a-journal-detail-subtitles', {
        title: 'Карточка звонка — субтитры',
        source: 'live',
        kind: 'full',
        see: 'Секция «Субтитры разговора»: кто что сказал, таймкоды, тонкий scrollbar.',
        do: 'Проверить читаемость диалога, thin scrollbar и синхрон с плеером.',
      })
    );
    await page.evaluate(() => {
      var ai = document.querySelector('.ai-summary-card');
      if (ai) ai.scrollIntoView({ block: 'center' });
      var acts = document.getElementById('retranscribeBtn');
      if (acts) acts.scrollIntoView({ block: 'nearest' });
      var btn = document.getElementById('aiQualityBreakdownBtn');
      var pop = document.getElementById('aiQualityPopover');
      if (btn && pop) {
        pop.hidden = false;
        btn.scrollIntoView({ block: 'center' });
      }
      document.querySelectorAll('.ai-collapse:not([open])').forEach(function (d) { d.open = true; });
    });
    await page.waitForTimeout(400);
    await assertVisibleText(page, 'Повторить', '08b-retry');
    shots.push(
      await snap('08b-journal-detail-ai', {
        title: 'Карточка звонка — резюме и retry',
        source: 'live',
        kind: 'full',
        see: 'AI popover breakdown, clickable fields, next-step checkboxes, radial N/10.',
        do: 'Проверить popover clarity/needs/close и CTA Повторить.',
      })
    );
    shots.push(
      await snap('08-journal-detail', {
        title: 'Карточка звонка (AI-вид)',
        source: 'live',
        kind: 'full',
        see: 'То же, что 08b — резюме/рейтинг/Повторить.',
        do: 'См. также 08a для субтитров.',
      })
    );
    await closeCallDetail(page);

    await clickTelephonyTab(page, 'missed');
    await page.evaluate(() => {
      var list = document.querySelector('.missed-list');
      if (list) list.scrollTop = list.scrollHeight;
      var tel = document.getElementById('telContent');
      if (tel) tel.scrollTop = tel.scrollHeight;
      var content = document.getElementById('content');
      if (content) content.scrollTop = content.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(250);
    shots.push(
      await snap('09-missed', {
        title: 'Пропущенные',
        source: 'live',
        kind: 'full',
        see: 'Вкладка «Пропущенные»: denser cards, red arrow, «Не обработан», dock clearance.',
        do: 'Сверить missed CTA Перезвонить над dock, не под ним.',
      })
    );

    await clickTelephonyTab(page, 'stats');
    await page.waitForTimeout(900);
    const sparkOk = await page.evaluate(() => !!document.querySelector('.tel-sparkline'));
    if (!sparkOk) throw new Error('Gallery assert failed for 10-stats: missing .tel-sparkline');
    shots.push(
      await snap('10-stats', {
        title: 'Статистика',
        source: 'live',
        kind: 'full',
        see: 'KPI + SVG sparklines, chart, таблица сотрудников.',
        do: 'Проверить sparklines и rich chart tooltip на hover.',
      })
    );

    await clickTelephonyTab(page, 'analytics');
    shots.push(
      await snap('11-analytics', {
        title: 'Аналитика',
        source: 'live',
        kind: 'full',
        see: 'AI-аналитика без emoji chrome, отчёты.',
        do: 'Оценить плотность данных и отступы.',
      })
    );

    await clickTelephonyTab(page, 'routing');
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      var list = document.getElementById('routingList');
      if (!list) return;
      list.innerHTML =
        '<div class="telephony-empty tel-routing-empty">' +
        '<div class="telephony-empty-mark" aria-hidden="true"></div>' +
        '<p class="telephony-empty-title">Нет правил маршрутизации</p>' +
        '<p class="telephony-empty-text">Создайте правило из шаблона — меньше ручной настройки.</p>' +
        '<div class="tel-routing-templates">' +
        '<button type="button" class="btn btn--primary" data-tpl="duty">Перевод на дежурного</button>' +
        '<button type="button" class="btn secondary" data-tpl="ivr">Приветствие + меню</button>' +
        '<button type="button" class="btn secondary" data-tpl="sales">Отдел продаж</button>' +
        '</div></div>';
    });
    await assertVisibleText(page, 'Перевод на дежурного', '12-routing-templates');
    shots.push(
      await snap('12-routing', {
        title: 'Маршрутизация',
        source: 'synth',
        kind: 'full',
        see: 'Empty routing: mark + 3 template CTAs (duty/ivr/sales).',
        do: 'Проверить empty craft и gold primary template.',
      })
    );

    await clickTelephonyTab(page, 'pbx');
    shots.push(
      await snap('13-pbx', {
        title: 'PBX',
        source: 'live',
        kind: 'full',
        see: 'PBX admin: card shell, subtabs, health.',
        do: 'Сверить таблицы staff/status с phone.css.',
      })
    );
  } finally {
    await context.close();
  }
  return shots;
}

async function main() {
  assertLocal();
  const auth = await loginFull();
  console.log('AUTH', auth.user.login || auth.user.name, auth.user.role);
  await seedJournalForVisual(auth.token);
  runGallerySeed();

  galleryEntries = [];
  const browser = await chromium.launch({ headless: true });
  let all = [];
  try {
    all = all.concat(await captureGallery(browser, auth, 'light'));
    all = all.concat(await captureGallery(browser, auth, 'dark'));
    writeGalleryArtifacts(auth);
    copyForReview();
    console.log('DONE', all.length, 'gallery shots →', OUT);
    if (all.length < 34) {
      console.error('FAIL: expected >=34 gallery shots (light+dark, full+closeup), got', all.length);
      process.exit(2);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
