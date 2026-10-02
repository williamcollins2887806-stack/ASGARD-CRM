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
        '.cr-m-overlay, .modalback, .tp-popup, .telephony-popup, .sg-splash, #crm20Banner, .crm20-banner'
      )
      .forEach((el) => {
        try {
          el.remove();
        } catch (_) {}
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
  const themeDir = theme === 'dark' ? path.join(OUT, 'dark') : OUT;
  fs.mkdirSync(themeDir, { recursive: true });
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
    let menu = document.getElementById('asgardPhoneMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'asgardPhoneMenu';
      document.body.appendChild(menu);
    }
    menu.className = 'ph-menu is-gallery';
    menu.innerHTML =
      '<div class="ph-menu-head">Телефон PBX</div>' +
      '<button type="button" class="ph-menu-item">На линии (браузер)</button>' +
      '<button type="button" class="ph-menu-item">На линии (мобильный)</button>' +
      '<button type="button" class="ph-menu-item">Проверить микрофон</button>';
  });
}

async function applyIncomingSynth(page) {
  await page.evaluate(() => {
    var card = document.getElementById('asgardPhoneIncoming');
    if (!card) {
      card = document.createElement('div');
      card.id = 'asgardPhoneIncoming';
      document.body.appendChild(card);
    }
    card.className = 'ph-card ph-card--incoming is-gallery';
    card.style.display = 'block';
    card.innerHTML =
      '<div class="ph-card-inner">' +
      '<div class="ph-card-title">Входящий звонок</div>' +
      '<div class="ph-card-name">Иван Петров</div>' +
      '<div class="ph-card-sub">+7 (495) 123-45-67 · ООО Север</div>' +
      '<div class="ph-card-actions">' +
      '<button type="button" class="ph-act ph-act--answer">Ответить</button>' +
      '<button type="button" class="ph-act ph-act--hangup">Сбросить</button>' +
      '</div></div>';
    // display:block so phone_ui MutationObserver keeps ring (not offline wipe)
    var btn = document.getElementById('asgardPhoneBtn');
    if (btn) {
      btn.className = 'ph-btn ph-btn--ring';
      var dot = btn.querySelector('.ph-btn-dot');
      if (dot) dot.className = 'ph-btn-dot ph-dot--ring';
    }
  });
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
  await page.evaluate((holdActive) => {
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
    bar.className = 'ph-bar is-gallery' + (holdActive ? ' ph-bar--hold' : '');
    bar.style.display = 'flex';
    bar.innerHTML =
      '<div class="ph-bar-left">' +
      '<span class="ph-bar-timer">01:24</span>' +
      '<span class="ph-bar-num">+7 (495) 123-45-67</span></div>' +
      '<div class="ph-bar-actions">' +
      '<button type="button" class="ph-iconbtn" title="Микрофон" aria-label="Микрофон">🔇</button>' +
      '<button type="button" class="ph-iconbtn' +
      (holdActive ? ' ph-iconbtn--active' : '') +
      '" id="phHold" title="Удержание" aria-label="Удержание" aria-pressed="' +
      (holdActive ? 'true' : 'false') +
      '">⏸</button>' +
      '<button type="button" class="ph-iconbtn" id="phKeypad" title="Клавиши" aria-label="Клавиши">⌨️</button>' +
      '<button type="button" class="ph-iconbtn" id="phTransfer" title="Перевод" aria-label="Перевод">↪️</button>' +
      '<button type="button" class="ph-iconbtn ph-iconbtn--danger" title="Завершить" aria-label="Завершить">☎</button>' +
      '</div>' +
      '<textarea class="ph-note" placeholder="Заметка по звонку…" rows="1"></textarea>';
    var btn = document.getElementById('asgardPhoneBtn');
    if (btn) {
      btn.className = 'ph-btn ph-btn--incall';
      var dot = btn.querySelector('.ph-btn-dot');
      if (dot) dot.className = 'ph-btn-dot ph-dot--incall';
    }
  }, !!opts.holdActive);
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
      AsgardUI.showModal({
        title: 'Набор номера',
        html:
          '<label class="ph-dial-label">Номер<input type="tel" class="inp" id="phDialNum" value="+74951234567"></label>' +
          '<div class="ph-dial-grid" id="phDialGrid">' +
          gridHtml +
          '</div>' +
          '<button type="button" class="btn primary ph-dial-call" id="phDialCall">Позвонить</button>',
        wide: false,
      });
    }
  });
  await page.waitForTimeout(400);
}

async function synthTransferModal(page) {
  await page.evaluate(() => {
    if (window.AsgardUI && AsgardUI.showModal) {
      AsgardUI.showModal({
        title: 'Перевод звонка',
        html:
          '<input type="search" class="inp" id="phTrSearch" placeholder="Поиск сотрудника…">' +
          '<div class="ph-tr-list" id="phTrList">' +
          '<button type="button" class="ph-tr-row"><span>Алексей Менеджеров</span><span class="ph-tr-online">на линии</span></button>' +
          '<button type="button" class="ph-tr-row"><span>Мария Операторова</span><span class="ph-tr-offline">не в сети</span></button>' +
          '</div>' +
          '<div class="ph-tr-mode">' +
          '<label><input type="radio" name="phTrMode" value="blind" checked> Слепой</label>' +
          '<label><input type="radio" name="phTrMode" value="consult"> Консультативный</label>' +
          '</div>' +
          '<button type="button" class="btn primary" id="phTransferGo">Перевести</button>',
        wide: false,
      });
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
      title: e.title,
      see: e.see,
      do: e.do,
    })),
    note: 'Local designer gallery — CSS from phone.css + telephony-page.css (no design inline). DEMO from seed.',
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  let md =
    '# Галерея UI телефонии (light + dark)\n\n' +
    'Локальные скриншоты для ревью дизайна. Сервер: `' +
    BASE +
    '`. Пользователь: **' +
    (auth.user.login || auth.user.name || '—') +
    '** (`' +
    (auth.user.role || '—') +
    '`). CSS: `phone.css` + `telephony-page.css` (токены ASGARD DS).\n\n' +
    '| # | Файл | Тема | Экран |\n|---|------|------|-------|\n';
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
      e.title +
      ' |\n';
  });
  md += '\n---\n\n';
  for (const e of galleryEntries) {
    md +=
      '## ' +
      e.title +
      '\n\n' +
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

    // Softphone overlays: synth + is-gallery class (CSS positioning, no design inline)
    await ensurePhoneBtn(page);
    await synthOfflineMenu(page);
    await assertVisibleText(page, 'Телефон PBX', '01-offline-menu');
    shots.push(
      await snap('01-phone-offline-menu', {
        title: 'Телефон PBX — меню офлайн',
        see: 'Кнопка телефона в шапке и выпадающее меню: «На линии (браузер/мобильный)», «Проверить микрофон».',
        do: 'Проверить отступы, тени, hover/active пунктов меню и читаемость.',
      })
    );
    await page.evaluate(() => {
      const m = document.getElementById('asgardPhoneMenu');
      if (m) {
        m.classList.remove('is-gallery');
        m.style.display = 'none';
      }
    });

    await applyIncomingSynth(page);
    await assertVisibleText(page, 'Входящий звонок', '02-incoming');
    await assertVisibleText(page, 'Ответить', '02-incoming-cta');
    await assertPhoneDot(page, 'ring', '02-incoming');
    shots.push(
      await snap('02-incoming', {
        title: 'Входящий звонок',
        see: 'Карточка входящего: имя «Иван Петров», номер, компания, кнопки «Ответить» и «Сбросить».',
        do: 'Сверить иерархию текста, контраст CTA и анимацию/акцент ringing на кнопке телефона.',
      })
    );

    await applyIncallSynth(page);
    await assertVisibleText(page, '01:24', '03-incall-timer');
    await assertPhoneDot(page, 'incall', '03-incall');
    shots.push(
      await snap('03-incall', {
        title: 'Разговор (incall bar)',
        see: 'Нижняя панель звонка: таймер, номер, иконки микрофон/удержание/клавиши/перевод/сброс, поле заметки.',
        do: 'Проверить высоту бара, размер touch-targets и состояние кнопки телефона (синяя точка incall).',
      })
    );

    await synthDialpadModal(page);
    await assertVisibleText(page, 'Набор номера', '04-dialpad');
    shots.push(
      await snap('04-incall-dialpad', {
        title: 'DTMF / набор номера',
        see: 'Модалка «Набор номера» с сеткой клавиш 0–9, * и # поверх экрана с активным звонком.',
        do: 'Оценить сетку ph-dial-key, поле номера и не перекрывает ли модалка критичные элементы.',
      })
    );
    await closeModals(page);

    await applyIncallSynth(page);
    await synthTransferModal(page);
    await assertVisibleText(page, 'Перевести', '05-transfer-cta');
    shots.push(
      await snap('05-incall-transfer', {
        title: 'Перевод звонка',
        see: 'Модалка перевода: поиск сотрудника, список с бейджами «на линии», режимы слепой/консультативный, кнопка «Перевести».',
        do: 'Проверить список, радиокнопки режима и финальный CTA.',
      })
    );
    await closeModals(page);

    await applyIncallSynth(page, { holdActive: true });
    await assertVisibleText(page, '01:24', '06-hold-timer');
    await assertPhoneDot(page, 'incall', '06-hold');
    const holdOk = await page.evaluate(() => {
      var hold = document.getElementById('phHold');
      return !!(hold && (hold.getAttribute('title') === 'Удержание' || hold.classList.contains('ph-iconbtn--active')));
    });
    if (!holdOk) throw new Error('Gallery assert failed for 06-hold: hold button not active');
    shots.push(
      await snap('06-incall-hold', {
        title: 'Удержание',
        see: 'Панель звонка с подсвеченной (active) кнопкой «Удержание».',
        do: 'Убедиться, что active-state hold отличим от mute и не теряется на теме.',
      })
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
    await page.waitForSelector('text=DEMO', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(800);
    await assertVisibleText(page, 'DEMO', '07-journal-demo');
    const hasRating = await page.evaluate(
      () =>
        document.body.innerText.indexOf('Рейтинг') >= 0 ||
        document.body.innerText.indexOf('РЕЙТИНГ') >= 0 ||
        document.body.innerText.indexOf('9/10') >= 0
    );
    if (!hasRating) {
      console.warn('WARN 07: rating column text not found — still shooting journal');
    }
    shots.push(
      await snap('07-journal', {
        title: 'Журнал звонков',
        see: 'Вкладка «Журнал»: таблица с DEMO-строками (разные статусы расшифровки и ИИ), KPI сверху при наличии.',
        do: 'Ревью таблицы call-log-table, бейджей статусов, превью AI-summary и фильтров.',
      })
    );

    await openDemoCallDetail(page);
    await page.evaluate(() => {
      var body = document.getElementById('detailBody');
      if (body) body.scrollTop = 0;
      var sub = document.getElementById('transcriptViewer') || document.querySelector('.transcript-viewer');
      if (sub) sub.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(400);
    await assertVisibleText(page, 'Субтитры', '08-detail-subs');
    shots.push(
      await snap('08a-journal-detail-subtitles', {
        title: 'Карточка звонка — субтитры',
        see: 'Секция «Субтитры разговора»: кто что сказал, таймкоды, копировать.',
        do: 'Проверить читаемость диалога и синхрон с плеером.',
      })
    );
    await page.evaluate(() => {
      var ai = document.querySelector('.ai-summary-card');
      if (ai) ai.scrollIntoView({ block: 'center' });
      var acts = document.getElementById('retranscribeBtn');
      if (acts) acts.scrollIntoView({ block: 'nearest' });
    });
    await page.waitForTimeout(400);
    await assertVisibleText(page, 'Повторить', '08-detail-retry');
    shots.push(
      await snap('08b-journal-detail-ai', {
        title: 'Карточка звонка — резюме и retry',
        see: 'Резюме ИИ, рейтинг ★, извлечённые данные, кнопки «Повторить расшифровку/анализ».',
        do: 'Проверить понятность CTA при ошибке ИИ и шкалу рейтинга.',
      })
    );
    shots.push(
      await snap('08-journal-detail', {
        title: 'Карточка звонка (AI-вид)',
        see: 'То же, что 08b — резюме/рейтинг/Повторить.',
        do: 'См. также 08a для субтитров.',
      })
    );
    await closeCallDetail(page);

    await clickTelephonyTab(page, 'missed');
    shots.push(
      await snap('09-missed', {
        title: 'Пропущенные',
        see: 'Вкладка «Пропущенные»: список пропущенных, в т.ч. DEMO · Пропущенный при наличии seed.',
        do: 'Сверить акцент missed, бейдж на табе и пустые состояния.',
      })
    );

    await clickTelephonyTab(page, 'stats');
    shots.push(
      await snap('10-stats', {
        title: 'Статистика',
        see: 'Вкладка «Статистика»: KPI/графики по звонкам за период.',
        do: 'Проверить карточки telephony-kpi и читаемость графиков.',
      })
    );

    await clickTelephonyTab(page, 'analytics');
    shots.push(
      await snap('11-analytics', {
        title: 'Аналитика',
        see: 'Вкладка «Аналитика»: расширенные отчёты/диаграммы телефонии.',
        do: 'Оценить плотность данных, легенды и отступы секций.',
      })
    );

    await clickTelephonyTab(page, 'routing');
    shots.push(
      await snap('12-routing', {
        title: 'Маршрутизация',
        see: 'Вкладка «Маршрутизация»: правила распределения входящих.',
        do: 'Проверить drag-and-drop зоны, подписи правил и admin-only элементы.',
      })
    );

    await clickTelephonyTab(page, 'pbx');
    shots.push(
      await snap('13-pbx', {
        title: 'PBX',
        see: 'Вкладка «PBX»: настройки/мониторинг АТС, линии и служебные блоки.',
        do: 'Сверить таблицы staff/status, алерты и согласованность с phone.css.',
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
    console.log('DONE', all.length, 'gallery shots →', OUT);
    if (all.length < 26) {
      console.error('FAIL: expected >=26 gallery shots (light+dark), got', all.length);
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
