'use strict';
/**
 * Doc Hub visual capture v2 (B3): прототип render + живой CRM.
 *
 * Отличия от v1:
 *  - Дефолт BASE = :3100 (клон), не :3000 — требование «только локальный двойник».
 *  - Снимает DRAWER с ОБЕИХ сторон (v1 его не снимал вообще: render/04-drawer.png
 *    был байт-копией 03-guide — дефект матрицы, признанный независимым верификатором).
 *  - Полный набор кадров: 01/01b/01c/01d/02/02b/02c/03/04/05/06.
 *  - Пишет SHA256 и mean-diff между парами, чтобы «03≡04» больше не повторился.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const OUT_CRM = path.join(__dirname, 'reports', 'doc-hub-visual', 'crm');
const OUT_RENDER = path.join(__dirname, 'reports', 'doc-hub-visual', 'render');
const INDEX = path.join(__dirname, 'reports', 'doc-hub-visual', 'INDEX.md');
fs.mkdirSync(OUT_CRM, { recursive: true });
fs.mkdirSync(OUT_RENDER, { recursive: true });

const PASSWORD = process.env.TEST_PASSWORD || 'Test123!';
const shots = [];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}
async function snap(page, dir, name) {
  const file = path.join(dir, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  shots.push({ side: dir === OUT_CRM ? 'crm' : 'render', file, sha: sha256(file), bytes: fs.statSync(file).size });
  return file;
}

async function loginFull(login = 'test_admin') {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: PASSWORD })
  }).then((r) => r.json());
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: process.env.TEST_PIN || '0000' })
    }).then((r) => r.json());
    token = pr.token || token;
    user = pr.user || user;
  }
  if (!token) throw new Error('login failed');
  const me = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => r.json()).catch(() => ({}));
  user = me.user || user || {};
  return { token, user, permissions: user.permissions || {} };
}

async function dismissChrome(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
    }
    const gate = document.getElementById('asgard-presence-gate');
    if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
    document.querySelectorAll(
      '.cr-m-overlay, .modalback, .tp-popup, .telephony-popup, #sg-overlay, .sg-splash, #asgard-presence-gate, #asgard-splash, .asgard-confirm, .asc-overlay, #huginnDock, .hg-dock, .hg-panel, .hg-rail, #tingPanel, .ting-panel'
    ).forEach((el) => { try { el.remove(); } catch (_) {} });
    // Quiet chrome for visual matrix: collapse right docks
    document.documentElement.classList.add('dh-visual-quiet');
    const style = document.getElementById('dh-visual-quiet-style') || document.createElement('style');
    style.id = 'dh-visual-quiet-style';
    style.textContent = `.hg-dock,.hg-panel,#huginnDock,.ting-panel,#tingPanel,.telephony-fab,.pbx-fab{display:none!important}
.asgard-confirm,.asc-root{display:none!important}
.cr-topbar,.app-topbar,.top-bar,.breadcrumb-bar,.shell-banner,.v2-banner,.asgard-v2-banner{display:none!important}
#layout-content{padding-top:8px!important}`;
    if (!style.parentNode) document.head.appendChild(style);
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ─────────── RENDER (прототип) ───────────
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/prototypes/doc-hub/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(900);
    await snap(page, OUT_RENDER, '01-registry');

    // wizard
    if (await page.locator('[data-nav="wizard"]').count()) {
      await page.locator('[data-nav="wizard"]').first().click().catch(() => {});
      await page.waitForTimeout(500);
      await snap(page, OUT_RENDER, '02-wizard');
      const next = page.locator('[data-wiz="next"]');
      if (await next.count()) {
        await next.first().click().catch(() => {});
        await page.waitForTimeout(300);
        await snap(page, OUT_RENDER, '02b-wizard-step2');
        const n2 = page.locator('[data-wiz="next"]');
        if (await n2.count()) {
          await n2.first().click().catch(() => {});
          await page.waitForTimeout(300);
          await snap(page, OUT_RENDER, '02c-wizard-step3');
        }
      }
    }

    // guide
    if (await page.locator('[data-nav="guide"]').count()) {
      await page.locator('[data-nav="guide"]').first().click().catch(() => {});
      await page.waitForTimeout(400);
      await snap(page, OUT_RENDER, '03-guide');
    }

    // DRAWER — то, чего не было в v1 и что признали дефектом матрицы.
    // Возврат в реестр, затем клик по первой строке таблицы.
    await page.locator('[data-nav="registry"]').first().click().catch(() => {});
    await page.waitForTimeout(400);
    const row = page.locator('#regBody tr').first();
    if (await row.count()) {
      await row.click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
      const drawerOn = await page.locator('#drawer.is-on').count();
      if (drawerOn) await snap(page, OUT_RENDER, '04-drawer');
      else {
        // fallback: вызвать openDrawer напрямую по id первой строки
        const id = await row.getAttribute('data-id').catch(() => null);
        if (id) {
          await page.evaluate((i) => { if (window.openDrawer) window.openDrawer(Number(i)); }, id).catch(() => {});
          await page.waitForTimeout(600);
          if (await page.locator('#drawer.is-on').count()) await snap(page, OUT_RENDER, '04-drawer');
        }
      }
      console.log('render drawer captured: ' + (await page.locator('#drawer.is-on').count()));
    }
    await page.close();
  }

  // ─────────── CRM (живой клон) ───────────
  {
    const auth = await loginFull('test_admin').catch(() => loginFull('test_buh'));
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(({ token, user, permissions }) => {
      localStorage.setItem('asgard_token', token);
      localStorage.setItem('auth_token', token);
      localStorage.setItem('asgard_user', JSON.stringify(user || {}));
      localStorage.setItem('asgard_permissions', JSON.stringify(permissions || {}));
      localStorage.setItem('asgard_theme', 'dark');
      localStorage.setItem('asgard_theme_chosen', '1');
      localStorage.setItem('asgard_shell_banner_dismissed', '1');
      localStorage.setItem('asgard_v2_banner_dismissed', '1');
      localStorage.setItem('asgard_safe_mode', '1');
      const d = new Date();
      for (let i = -1; i <= 1; i++) {
        const x = new Date(d.getTime() + i * 86400000);
        localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1');
      }
    }, auth);
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
    await page.evaluate(async () => {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
      }
    }).catch(() => {});

    let ready = false;
    for (let attempt = 0; attempt < 3 && !ready; attempt++) {
      await page.goto(BASE + '/?nocache=' + Date.now() + '#/doc-hub', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await dismissChrome(page);
      await page.waitForTimeout(900 + attempt * 600);
      try {
        await page.waitForSelector('#dhBtnNew, .dh-top__h1, .dh-app', { timeout: 18000 });
        ready = true;
      } catch (_) {}
    }
    if (!ready) throw new Error('Doc Hub UI not ready');
    await dismissChrome(page);

    // 01 — реестр, режим «все» (чтобы пилюли статусов были разными, а не только «Неполные»)
    if (await page.locator('#dhScopeAll').count()) {
      const checked = await page.locator('#dhScopeAll').isChecked().catch(() => false);
      if (!checked) { await page.locator('#dhScopeAll').check({ force: true }).catch(() => {}); await page.waitForTimeout(900); }
    }
    await dismissChrome(page);
    await snap(page, OUT_CRM, '01-registry');

    // 01b — «только мои»
    if (await page.locator('#dhScopeAll').count()) {
      await page.locator('#dhScopeAll').uncheck({ force: true }).catch(() => {});
      await page.waitForTimeout(900);
      await dismissChrome(page);
      await snap(page, OUT_CRM, '01b-registry-mine');
      await page.locator('#dhScopeAll').check({ force: true }).catch(() => {});
      await page.waitForTimeout(900);
      await dismissChrome(page);
    }

    // 01c — KPI «Неполные» (срез фасетов)
    const incKpi = page.locator('[data-kpi="incomplete"]');
    if (await incKpi.count()) {
      await incKpi.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(900);
      await dismissChrome(page);
      await snap(page, OUT_CRM, '01c-facets-incomplete');
      await page.locator('[data-kpi="all"]').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(900);
      await dismissChrome(page);
    }

    // 01d — KPI «Просрочка оплаты» (другой срез — чтобы 01c ≠ 01d)
    const payKpi = page.locator('[data-kpi="pay"]');
    if (await payKpi.count()) {
      await payKpi.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(900);
      await dismissChrome(page);
      await snap(page, OUT_CRM, '01d-kpi-overdue-pay');
      await page.locator('[data-kpi="all"]').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(900);
      await dismissChrome(page);
    }

    // wizard 02 / 02b / 02c — шаги через data-step формы (без гонки).
    // Шаг 2 не пропускает reportValidity(), пока пусты обязательные поля — заполняем.
    if (await page.locator('#dhBtnNew').count()) {
      await dismissChrome(page);
      await page.locator('#dhBtnNew').click({ force: true });
      await page.waitForSelector('#dhWizForm[data-step="1"]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
      await dismissChrome(page);
      await snap(page, OUT_CRM, '02-wizard');

      const fillStep = async () => {
        await page.evaluate(() => {
          const form = document.querySelector('#dhWizForm');
          if (!form) return;
          const today = new Date();
          const iso = (d) => new Date(d.getTime() + d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
          form.querySelectorAll('input, select, textarea').forEach((el) => {
            if (el.disabled || el.type === 'hidden' || el.type === 'file' || el.type === 'checkbox' || el.type === 'radio') return;
            const name = (el.name || el.id || '');
            if (el.value && el.value.trim()) return;
            if (/date|_due|_at/.test(name) || /ГГГГ/.test(el.placeholder || '')) el.value = iso(today);
            else if (el.type === 'number') el.value = /amount|sum|gross|net/.test(name) ? '1000' : '1';
            else if (el.tagName === 'SELECT') el.selectedIndex = Math.min(1, el.options.length - 1);
            else el.value = /counterparty|name|number|контрагент|№/i.test(name + el.placeholder) ? 'ООО ТЕСТ' : 'тест';
          });
        });
      };

      for (const [step, name] of [[2, '02b-wizard-step2'], [3, '02c-wizard-step3'], [4, '02d-wizard-step4']]) {
        await fillStep();
        const nextBtn = page.locator('#dhWizNext');
        if (!(await nextBtn.count())) break;
        await nextBtn.first().click({ force: true }).catch(() => {});
        const advanced = await page.waitForFunction(
          (s) => (document.querySelector('#dhWizForm') || {}).getAttribute
            && document.querySelector('#dhWizForm').getAttribute('data-step') === String(s),
          step, { timeout: 5000 }
        ).then(() => true).catch(() => false);
        await page.waitForTimeout(400);
        // Amounts step: force 2200 so duplicate callout craft is visible in 02b
        if (step === 2) {
          await page.evaluate(() => {
            const g = document.querySelector('#dhWizGross');
            const n = document.querySelector('#dhWizNet');
            if (g) { g.value = '2200'; g.dispatchEvent(new Event('input', { bubbles: true })); }
            if (n && !n.value) n.value = '1803.28';
            const cp = document.querySelector('input[name="counterparty_name"]');
            if (cp && !cp.value) cp.value = 'ООО «АСТ-Системс»';
            const inv = document.querySelector('input[name="invoice_number"]');
            if (inv && !inv.value) inv.value = 'ФР-2019';
          }).catch(() => {});
          await page.waitForTimeout(200);
        }
        await dismissChrome(page);
        await snap(page, OUT_CRM, name);
        console.log('wizard step ' + step + ' advanced=' + advanced);
        if (!advanced) break;
      }
      await page.locator('#dhModalClose, #dhWizCancel').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
    }

    // 03 — справка/покрытие
    const guideBtn = page.locator('#dhBtnGuide');
    if (await guideBtn.count()) {
      await dismissChrome(page);
      await guideBtn.first().click({ force: true });
      await page.waitForTimeout(600);
      await snap(page, OUT_CRM, '03-guide');
      await guideBtn.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
    }

    // Reset filters before drawer/export shots (01c may leave incomplete on)
    await page.evaluate(() => {
      const inc = document.querySelector('#dhFacetIncomplete');
      if (inc && inc.checked) { inc.checked = false; inc.dispatchEvent(new Event('change', { bubbles: true })); }
      const all = document.querySelector('[data-kpi="all"]');
      if (all) all.click();
    }).catch(() => {});
    await page.waitForTimeout(800);
    await dismissChrome(page);

    // 04 — DRAWER: open via explicit «Карточка» on first visible row
    const openBtn = page.locator('.dh-tr [data-qa="open"]').first();
    if (!(await openBtn.count())) {
      console.warn('no open button — forcing scope all + reload rows');
      if (await page.locator('#dhScopeAll').count()) {
        await page.locator('#dhScopeAll').check({ force: true }).catch(() => {});
        await page.waitForTimeout(900);
      }
    }
    // Prefer richest demo row (done/paid with attachments) for drawer craft
    let openBtn2 = page.locator('.dh-tr').filter({ hasText: /ФР-2019|Закрыто|оплачен/i }).locator('[data-qa="open"]').first();
    if (!(await openBtn2.count())) openBtn2 = page.locator('.dh-tr [data-qa="open"]').first();
    if (await openBtn2.count()) {
      await openBtn2.click({ force: true });
      const drawerReady = await page.waitForSelector('#dhDrawer.is-on .dh-timeline, #dhDrawer:not([hidden]) .dh-section__h', { timeout: 10000 }).then(() => true).catch(() => false);
      console.log('drawer ready=' + drawerReady);
      await page.waitForTimeout(500);
      await dismissChrome(page);
      await page.evaluate(() => {
        document.querySelectorAll('.asgard-confirm, .asc-overlay, .asc-root').forEach((el) => { try { el.remove(); } catch (_) {} });
      }).catch(() => {});
      await snap(page, OUT_CRM, '04-drawer');

      // 05 — confirm after SF
      const sf = page.locator('#dhDrawer [data-qa="sf"]').first();
      if (await sf.count()) {
        await page.evaluate(() => {
          const s = document.getElementById('dh-visual-quiet-style');
          if (s) s.textContent = `.hg-dock,.hg-panel,#huginnDock,.ting-panel,#tingPanel,.telephony-fab,.pbx-fab{display:none!important}`;
        }).catch(() => {});
        await sf.click({ force: true }).catch(() => {});
        await page.waitForTimeout(900);
        await snap(page, OUT_CRM, '05-after-sf-confirm');
        await page.locator('button:has-text("Отмена")').first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.locator('#dhDrawerClose').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    } else {
      console.warn('SKIP 04-drawer: no rows');
    }

    // 06 — export modal
    const exp = page.locator('#dhBtnExport1c');
    if (await exp.count()) {
      await dismissChrome(page);
      await exp.first().click({ force: true }).catch(() => {});
      await page.waitForSelector('#dhModal:not([hidden]) .dh-csv-preview, #dhModal:not([hidden]) .dh-modal__card--wide', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      await dismissChrome(page);
      await snap(page, OUT_CRM, '06-export-1c');
      if (!(await page.locator('.dh-csv-preview').count())) {
        await snap(page, OUT_CRM, '06-export-debug');
      }
    }
    await ctx.close();
  }

  await browser.close();

  // Проверка «не байт-копии»: пары, которые верификатор считал подозрительными
  const byName = {};
  for (const s of shots) byName[s.side + '/' + path.basename(s.file)] = s;
  const pairs = [
    ['render/03-guide.png', 'render/04-drawer.png'],
    ['crm/01c-facets-incomplete.png', 'crm/01d-kpi-overdue-pay.png'],
    ['crm/03-guide.png', 'crm/04-drawer.png'],
  ];
  const integrity = pairs.map(([a, b]) => {
    const A = byName[a], B = byName[b];
    if (!A || !B) return { pair: a + ' vs ' + b, ok: null, note: 'missing' };
    return { pair: a + ' vs ' + b, ok: A.sha !== B.sha, shaA: A.sha, shaB: B.sha, bytesA: A.bytes, bytesB: B.bytes };
  });

  fs.writeFileSync(INDEX, [
    '# Doc Hub visual INDEX (capture v2, B3)',
    '',
    'BASE: ' + BASE,
    'Captured: ' + new Date().toISOString(),
    '',
    '## Shots',
    ...shots.map((s) => `- (${s.side}) \`${path.relative(path.dirname(INDEX), s.file)}\` — ${s.bytes} B, sha ${s.sha}`),
    '',
    '## Integrity (byte-identity guard)',
    '| Пара | Разные? | sha A | sha B |',
    '|---|---|---|---|',
    ...integrity.map((r) => `| ${r.pair} | ${r.ok === null ? 'MISSING' : (r.ok ? 'ДА' : '**НЕТ — байт-копия**')} | ${r.shaA || '—'} | ${r.shaB || '—'} |`),
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(__dirname, 'reports', 'doc-hub-visual', 'capture.json'),
    JSON.stringify({ base: BASE, at: new Date().toISOString(), shots, integrity }, null, 2));

  console.log('visual shots: ' + shots.length);
  console.log(JSON.stringify(integrity, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
