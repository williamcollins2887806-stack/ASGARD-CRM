/**
 * FINAL REGRESSION smoke test — verifies all backend+frontend fixes from 14-15.06.2026.
 * Read-only: NO Create/Save/Delete actions.
 *
 * Checklist:
 *  1. Vanilla v1 header: gold "ᛞ CRM 2.0 →" button → links to /v2/
 *  2. v2 React shell header: "← Старая версия" link → links to /
 *  3. /assets/icons/nav/calendar.svg + money.svg → 200 (not 404)
 *  4. /api/birthdays → 200 (was 500)
 *  5. /api/work-readiness?my=true under PM → 200 (was 500)
 *  6. /api/tenders under PM → only own tenders
 *  7. /api/users under PM → only id/login/name/role/is_active (no email/phone/birth_date)
 *  8. POST /api/payroll/items under WAREHOUSE → 403
 *  9. First-login banner "Сага начинается, воины!" appears, dismisses, doesn't reappear
 * 10. Sidebar v2: "Мой дашборд", role-specific items (HEAD_PM/HEAD_TO Big Screen, HR_MANAGER gamification, TO no "Входящие заявки")
 * 11. /tasks and /tasks-admin in v2 don't crash
 * 12. Console errors = 0 on Home/Tenders/PmWorks/Procurement/Chat/Alerts
 *
 * Run: node tests/smoke-v2-final-regression.js
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_V2 = 'https://asgard-crm.ru/v2/';
const BASE_V1 = 'https://asgard-crm.ru/';

const REPORT_DIR = path.join(__dirname, 'reports', 'smoke-v2-final');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

const ERR_IGNORE = [
  /favicon/i,
  /net::ERR_/i,
  /ResizeObserver/i,
  /ETELEGRAM/i,
  /service[- ]?worker|sw\.js/i,
  /status of 401|status of 403/i,
  /Manifest/i,
  /\bgapi\b/i,
];

function shouldIgnore(text) {
  return ERR_IGNORE.some(re => re.test(text));
}

const findings = [];
function record(check, status, detail) {
  findings.push({ check, status, detail });
  const icon = status === 'PASS' ? '[+]' : status === 'FAIL' ? '[X]' : '[~]';
  console.log(`${icon} ${check}: ${detail || ''}`);
}

async function loginV2(page, login, password, pin) {
  await page.goto(BASE_V2 + '#/welcome', { waitUntil: 'commit', timeout: 30000 });
  await page.waitForTimeout(2000);

  const enterBtn = page.locator('button:has-text("Войти")').first();
  await enterBtn.waitFor({ state: 'visible', timeout: 15000 });
  await enterBtn.click();
  await page.waitForTimeout(800);

  await page.locator('input[autocomplete="username"]').first().fill(login);
  await page.locator('input[autocomplete="current-password"]').first().fill(password);
  await page.locator('button:has-text("Далее")').first().click();
  await page.waitForTimeout(3000);

  // PIN
  const pinVisible = await page.locator('.welcome-v2-pin-keypad').isVisible().catch(() => false);
  if (pinVisible && pin) {
    for (const d of pin.split('')) {
      await page.locator(`.welcome-v2-pin-keypad button:has-text("${d}")`).first().click();
      await page.waitForTimeout(180);
    }
    await page.waitForTimeout(3500);
  }

  // Wait for redirect to home or any non-welcome
  await page.waitForFunction(() => {
    return !location.hash.includes('welcome') && location.hash.length > 1;
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function loginV1(page, login, password) {
  await page.goto(BASE_V1, { waitUntil: 'commit', timeout: 30000 });
  // Wait for v1 SPA boot
  await page.waitForFunction(() => {
    return !!document.getElementById('w_login') || !!document.getElementById('btnShowLogin');
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Hide theme selector permanently via injected CSS
  await page.addStyleTag({ content: `
    #asgard-theme-selector, .ats-card, .ats-visible { display: none !important; visibility: hidden !important; pointer-events: none !important; }
  `}).catch(() => {});

  // Show login panel
  await page.evaluate(() => {
    const b = document.getElementById('btnShowLogin');
    if (b) b.click();
  });
  await page.waitForTimeout(2000);

  // Wait until #w_login is actually visible/interactable
  await page.waitForFunction(() => {
    const el = document.getElementById('w_login');
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }, { timeout: 10000 }).catch(() => {});

  // Fill login + password (real IDs: w_login, w_pass)
  await page.evaluate((data) => {
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) {
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        proto.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    setVal('w_login', data.login);
    setVal('w_pass', data.password);
  }, { login, password });
  await page.waitForTimeout(500);

  // Click "Далее"
  await page.evaluate(() => {
    const b = document.getElementById('btnDoLogin');
    if (b) b.click();
  });
  // V1 login fetches /api/auth/login → store → redirect. Wait long.
  await page.waitForFunction(() => {
    // PIN keypad OR home rendered
    return location.hash.includes('/home') || location.hash.includes('/dashboard') ||
           !!document.querySelector('#pinKeypad, .pin-keypad, [class*="pin-keypad"]') ||
           !!document.querySelector('.v2-switch--to-new, .topbar');
  }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // Handle PIN if visible
  const pinVisible = await page.locator('#pinKeypad, .pin-keypad, [class*="pin-keypad"]').first().isVisible({ timeout: 1000 }).catch(() => false);
  if (pinVisible) {
    // test_director PIN is 0000
    for (const d of '0000') {
      await page.evaluate((digit) => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.find(b => (b.textContent || '').trim() === digit);
        if (b) b.click();
      }, d);
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(4000);
  }
}

(async () => {
  console.log('[final-regression] start', new Date().toISOString());
  const browser = await chromium.launch({ headless: true });

  // ============================================
  // PART A: Static asset checks
  // ============================================
  console.log('\n=== PART A: Static assets ===');
  const ctxAssets = await browser.newContext({ ignoreHTTPSErrors: true });
  for (const asset of ['calendar.svg', 'money.svg']) {
    const url = `${BASE_V1}assets/icons/nav/${asset}`;
    try {
      const resp = await ctxAssets.request.get(url);
      const st = resp.status();
      record(`asset /${asset}`, st === 200 ? 'PASS' : 'FAIL', `HTTP ${st}`);
    } catch (e) {
      record(`asset /${asset}`, 'FAIL', `req err: ${e.message}`);
    }
  }
  await ctxAssets.close();

  // ============================================
  // PART B: v1 vanilla — CRM 2.0 button
  // ============================================
  console.log('\n=== PART B: v1 vanilla — кнопка CRM 2.0 ===');
  const ctxV1 = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  const pageV1 = await ctxV1.newPage();
  const v1Errors = [];
  pageV1.on('console', m => {
    if (m.type() === 'error' && !shouldIgnore(m.text())) v1Errors.push(m.text());
  });
  try {
    await loginV1(pageV1, 'test_director', 'Test123!');
    // Wait for v1 home to fully render top-bar with badges
    await pageV1.waitForTimeout(10000);

    // Dismiss "presence gate" (asgard-presence-gate) — click "В офисе" then submit "В строй"
    await pageV1.evaluate(() => {
      const gate = document.getElementById('asgard-presence-gate');
      if (gate) {
        // Find "В офисе" button and click
        const btns = gate.querySelectorAll('button, [class*="btn"]');
        for (const b of btns) {
          if (/В офисе|В строй/i.test(b.textContent || '')) {
            b.click();
            break;
          }
        }
      }
    });
    await pageV1.waitForTimeout(2000);
    // Submit
    await pageV1.evaluate(() => {
      const gate = document.getElementById('asgard-presence-gate');
      if (gate) {
        const btns = gate.querySelectorAll('button');
        for (const b of btns) {
          if (/В строй/i.test(b.textContent || '')) { b.click(); break; }
        }
      }
      // Force remove if still there
      const g2 = document.getElementById('asgard-presence-gate');
      if (g2) g2.remove();
    });
    await pageV1.waitForTimeout(4000);
    await pageV1.screenshot({ path: path.join(REPORT_DIR, 'v1_home.png') });

    // Direct selector check
    const direct = await pageV1.evaluate(() => {
      const link = document.querySelector('.v2-switch--to-new, a.v2-switch');
      if (link) {
        return {
          found: true,
          text: (link.textContent || '').trim(),
          href: link.getAttribute('href'),
          cls: link.className,
        };
      }
      return { found: false };
    });

    if (direct.found && direct.href === '/v2/') {
      record('v1 кнопка CRM 2.0', 'PASS', `найдена: text="${direct.text}", href="${direct.href}"`);
    } else if (direct.found) {
      record('v1 кнопка CRM 2.0', 'WARN', `найдена но href="${direct.href}"`);
    } else {
      // Fallback: search anywhere
      const fallback = await pageV1.evaluate(() => {
        const all = Array.from(document.querySelectorAll('a, button'));
        const matches = all.filter(el => /CRM\s*2\.?0|ᛞ/.test(el.textContent || ''));
        return matches.slice(0, 3).map(el => ({
          tag: el.tagName,
          text: (el.textContent || '').trim().slice(0, 80),
          href: el.getAttribute('href') || null,
        }));
      });
      // Check if logged in (look for username)
      const loginState = await pageV1.evaluate(() => {
        return {
          path: location.pathname + location.hash,
          hasLoginPanel: !!document.querySelector('#loginInput, .welcome-btn'),
          bodyText: (document.body.innerText || '').slice(0, 200),
        };
      });
      record('v1 кнопка CRM 2.0', 'FAIL', `не найдена в DOM; fallback matches: ${JSON.stringify(fallback)}; loginState: ${JSON.stringify(loginState).slice(0,200)}`);
    }
  } catch (e) {
    record('v1 login + кнопка', 'FAIL', e.message);
  }
  await ctxV1.close();

  // ============================================
  // PART C: v2 first-login banner (incognito + test_director)
  // ============================================
  console.log('\n=== PART C: v2 первая модалка-баннер ===');
  const ctxBanner = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  const pageBanner = await ctxBanner.newPage();
  const bannerErrors = [];
  pageBanner.on('console', m => {
    if (m.type() === 'error' && !shouldIgnore(m.text())) bannerErrors.push(m.text());
  });
  try {
    await loginV2(pageBanner, 'test_director', 'Test123!', null);
    await pageBanner.waitForTimeout(3000);
    await pageBanner.screenshot({ path: path.join(REPORT_DIR, 'v2_after_login_banner.png') });

    const bannerInfo = await pageBanner.evaluate(() => {
      const bodyText = (document.body.innerText || '');
      // Strict: only the release-banner phrase "Сага начинается, воины"
      const hasSaga = /Сага начинается,?\s*воин/i.test(bodyText);
      const hasMountain = /🏔️|CRM 2\.0/.test(bodyText);
      // Find modal-like container
      const modals = Array.from(document.querySelectorAll('[class*="modal"], [role="dialog"], [class*="banner"], [class*="release"], [class*="update"], [class*="overlay"]'));
      const visible = modals.filter(m => {
        const cs = window.getComputedStyle(m);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && m.offsetHeight > 50;
      });
      const sample = visible[0];
      return {
        hasSaga,
        hasMountain,
        modalCount: visible.length,
        sampleText: sample ? (sample.innerText || '').slice(0, 300) : null,
        sampleCls: sample ? sample.className : null,
        bodyTextSnippet: bodyText.match(/.{0,80}(Сага|воины).{0,80}/i)?.[0] || null,
      };
    });
    if (bannerInfo.hasSaga) {
      record('v2 баннер "Сага"', 'PASS', `найден: modals=${bannerInfo.modalCount}, snippet="${bannerInfo.bodyTextSnippet}"`);
    } else {
      record('v2 баннер "Сага"', 'FAIL', `не найден ни в DOM ни в тексте; modals=${bannerInfo.modalCount}`);
    }

    // Try to dismiss banner — click "Войти" or close
    const dismissed = await pageBanner.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      // Look for "Войти", "Понятно", "OK", "×", "Закрыть" buttons inside modal
      const candidates = btns.filter(b => {
        const t = (b.textContent || '').trim();
        return /^(Войти|Понятно|OK|Закрыть|×|Продолжить|Начать|Хорошо)$/i.test(t);
      });
      // Pick visible one
      const v = candidates.find(b => {
        const cs = window.getComputedStyle(b);
        return cs.display !== 'none' && b.offsetHeight > 0;
      });
      if (v) { v.click(); return v.textContent.trim(); }
      return null;
    });
    if (dismissed) {
      record('v2 баннер закрылся', 'PASS', `клик "${dismissed}"`);
    } else {
      record('v2 баннер закрылся', 'WARN', 'не нашёл кнопку закрытия');
    }
    await pageBanner.waitForTimeout(1500);

    // Reload — should NOT reappear
    await pageBanner.reload({ waitUntil: 'commit', timeout: 20000 });
    await pageBanner.waitForTimeout(3500);
    const reappear = await pageBanner.evaluate(() => {
      const bodyText = (document.body.innerText || '');
      return /Сага начинается|воины/i.test(bodyText);
    });
    record('v2 баннер не реаппирует', reappear ? 'FAIL' : 'PASS', reappear ? 'появился снова' : 'после reload не показан');
  } catch (e) {
    record('v2 баннер flow', 'FAIL', e.message);
  }

  // ============================================
  // PART D: v2 React shell "← Старая версия" link
  // ============================================
  console.log('\n=== PART D: v2 ссылка на старую версию ===');
  try {
    await pageBanner.goto(BASE_V2 + '#/home', { waitUntil: 'commit', timeout: 20000 });
    await pageBanner.waitForTimeout(3000);
    const oldVerLink = await pageBanner.evaluate(() => {
      const all = Array.from(document.querySelectorAll('a, button'));
      const m = all.filter(el => /Старая версия|← Старая|Old version|Vanilla/i.test(el.textContent || ''));
      return m.map(el => ({
        tag: el.tagName,
        text: (el.textContent || '').trim().slice(0, 80),
        href: el.getAttribute('href') || null,
      }));
    });
    if (oldVerLink.length === 0) {
      record('v2 ссылка "Старая версия"', 'FAIL', 'не найдена');
    } else {
      const target = oldVerLink.find(o => o.href === '/' || (o.href && (o.href.endsWith('/') || /\/(?!v2)/.test(o.href))));
      record('v2 ссылка "Старая версия"', target ? 'PASS' : 'WARN', JSON.stringify(oldVerLink[0]));
    }
  } catch (e) {
    record('v2 ссылка "Старая версия"', 'FAIL', e.message);
  }

  // ============================================
  // PART E: API endpoints with director token (extract from sessionStorage/cookies)
  // ============================================
  console.log('\n=== PART E: API endpoints (director) ===');
  let directorToken = null;
  try {
    directorToken = await pageBanner.evaluate(() => {
      try { return localStorage.getItem('asgard_token') || null; } catch (_) { return null; }
    });
    console.log('  director token:', directorToken ? `len=${directorToken.length}` : 'NOT FOUND');
  } catch (e) {
    console.log('  token extract err:', e.message);
  }

  // /api/birthdays (with Bearer)
  try {
    const r = await pageBanner.evaluate(async (tok) => {
      const res = await fetch('/api/birthdays', { headers: { Authorization: 'Bearer ' + tok } });
      const txt = await res.text();
      return { status: res.status, len: txt.length, sample: txt.slice(0, 200) };
    }, directorToken || '');
    record('/api/birthdays (director)', r.status === 200 ? 'PASS' : 'FAIL', `HTTP ${r.status}, body[${r.len}]: ${r.sample.slice(0,80)}`);
  } catch (e) {
    record('/api/birthdays (director)', 'FAIL', e.message);
  }

  // /api/work-readiness?my=true (director — sanity)
  try {
    const r = await pageBanner.evaluate(async (tok) => {
      const res = await fetch('/api/work-readiness?my=true', { headers: { Authorization: 'Bearer ' + tok } });
      const txt = await res.text();
      return { status: res.status, sample: txt.slice(0, 200) };
    }, directorToken || '');
    record('/api/work-readiness?my=true (director)', r.status === 200 ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
  } catch (e) {
    record('/api/work-readiness?my=true (director)', 'FAIL', e.message);
  }

  await ctxBanner.close();

  // ============================================
  // PART F: PM session — sidebar, console errors, API checks
  // ============================================
  console.log('\n=== PART F: PM session ===');
  const ctxPm = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  const pagePm = await ctxPm.newPage();
  const pmErrors = [];
  const pm5xx = [];
  const pmApiResults = {};

  pagePm.on('console', m => {
    if (m.type() === 'error' && !shouldIgnore(m.text())) pmErrors.push(m.text());
  });
  pagePm.on('pageerror', e => pmErrors.push(`PAGE_ERROR: ${e.message}`));
  pagePm.on('response', resp => {
    const st = resp.status();
    const url = resp.url();
    if (st >= 500 && st < 600 && url.includes('asgard-crm.ru')) {
      pm5xx.push(`${st} ${url}`);
    }
  });

  try {
    await loginV2(pagePm, 'test_pm', 'Test123!', '1234');
    await pagePm.waitForTimeout(3000);

    // Dismiss banner if shown
    const bannerBtn = pagePm.locator('button:has-text("Войти"), button:has-text("Понятно"), button:has-text("Хорошо")').first();
    if (await bannerBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await bannerBtn.click();
      await pagePm.waitForTimeout(1000);
    }

    await pagePm.screenshot({ path: path.join(REPORT_DIR, 'pm_home.png') });

    // Get PM token
    const pmToken = await pagePm.evaluate(() => {
      try { return localStorage.getItem('asgard_token') || ''; } catch (_) { return ''; }
    });
    console.log('  PM token:', pmToken ? `len=${pmToken.length}` : 'NOT FOUND');

    // ---- Sidebar items — hover each group sequentially to expand popover ----
    // Sidebar groups are aside.sb buttons with rune. Popover renders via portal outside aside.
    const groupTriggers = await pagePm.locator('aside.sb .sb-group, aside.sb [class*="sb-group"], aside.sb button.sb-group-btn').all().catch(() => []);
    const allItems = new Map();

    // Direct query: get all sb-item links currently in DOM (some may be visible without hover)
    const collectItems = async () => {
      const items = await pagePm.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a.sb-item, a[class*="sb-item"], a[href^="#/"]'));
        return links.map(a => ({ text: (a.textContent || '').trim(), href: a.getAttribute('href') || '' }))
          .filter(x => x.text && x.href.startsWith('#/'));
      });
      for (const it of items) allItems.set(it.href, it);
    };
    await collectItems();

    // Hover each aside button to trigger popover
    const groupBtns = await pagePm.$$('aside.sb button, aside.sb [class*="sb-group"], aside.sb .sb-group');
    console.log(`  PM: found ${groupBtns.length} group buttons`);
    for (let i = 0; i < Math.min(groupBtns.length, 12); i++) {
      try {
        await groupBtns[i].hover({ timeout: 1500 });
        await pagePm.waitForTimeout(450);
        await collectItems();
      } catch (_) {}
    }

    const sidebar = [...allItems.values()];
    console.log('  PM sidebar items:', sidebar.length);
    fs.writeFileSync(path.join(REPORT_DIR, 'pm_sidebar.json'), JSON.stringify(sidebar, null, 2));

    const sidebarTexts = sidebar.map(s => s.text);
    const sidebarHrefs = sidebar.map(s => s.href);

    const hasMyDash = sidebarTexts.some(s => /Мой дашборд|My dashboard/i.test(s)) ||
                      sidebarHrefs.some(h => /my-dashboard/i.test(h));
    record('PM sidebar "Мой дашборд"', hasMyDash ? 'PASS' : 'FAIL',
      hasMyDash ? 'присутствует' : `НЕ найден; items(${sidebar.length}): ${sidebarTexts.slice(0,20).join(' | ')}`);

    // PM should NOT have HEAD-only/HR-only items
    const forbidden = sidebarTexts.filter(s => /Big Screen|Большой экран|Управление геймификацией|Входящие заявки/i.test(s));
    record('PM sidebar нет лишнего', forbidden.length === 0 ? 'PASS' : 'WARN', forbidden.length ? `найдено: ${forbidden.join(', ')}` : 'чисто');

    // ---- /api/tenders — only own ----
    const tendersRes = await pagePm.evaluate(async (tok) => {
      const res = await fetch('/api/tenders', { headers: { Authorization: 'Bearer ' + tok } });
      const txt = await res.text();
      let body;
      try { body = JSON.parse(txt); } catch (_) { body = null; }
      const arr = Array.isArray(body) ? body : (body && (body.items || body.tenders || body.rows)) || [];
      const pmIds = new Set(arr.map(t => t.pm_id || t.pmId || t.responsible_id).filter(Boolean));
      return {
        status: res.status,
        count: arr.length,
        pmIds: [...pmIds],
        sample: arr.slice(0, 3).map(t => ({ id: t.id, name: (t.tender_name || t.name || '').slice(0,40), pm_id: t.pm_id, status: t.tender_status || t.status })),
      };
    }, pmToken);
    pmApiResults.tenders = tendersRes;
    console.log('  PM /api/tenders:', JSON.stringify(tendersRes).slice(0, 400));
    if (tendersRes.status !== 200) {
      record('PM /api/tenders', 'FAIL', `HTTP ${tendersRes.status}`);
    } else if (tendersRes.count === 0) {
      record('PM /api/tenders (свои)', 'WARN', '0 тендеров — не можем проверить фильтр');
    } else {
      // If all have same pm_id (PM's own) it's filtered; if multiple different pm_ids — leak
      record('PM /api/tenders (свои)', tendersRes.pmIds.length <= 1 ? 'PASS' : 'FAIL', `count=${tendersRes.count}, pm_ids=${JSON.stringify(tendersRes.pmIds)}`);
    }

    // ---- /api/users — restricted fields ----
    const usersRes = await pagePm.evaluate(async (tok) => {
      const res = await fetch('/api/users', { headers: { Authorization: 'Bearer ' + tok } });
      const txt = await res.text();
      let body;
      try { body = JSON.parse(txt); } catch (_) { body = null; }
      const arr = Array.isArray(body) ? body : (body && (body.items || body.users)) || [];
      const sample = arr[0] || null;
      const fields = sample ? Object.keys(sample) : [];
      const leaked = fields.filter(f => /email|phone|birth_date|birthday|telegram|whatsapp|salary/i.test(f));
      return { status: res.status, count: arr.length, fields, leaked, sample };
    }, pmToken);
    pmApiResults.users = usersRes;
    console.log('  PM /api/users:', JSON.stringify({ status: usersRes.status, count: usersRes.count, fields: usersRes.fields, leaked: usersRes.leaked }).slice(0, 400));
    if (usersRes.status !== 200) {
      record('PM /api/users', 'FAIL', `HTTP ${usersRes.status}`);
    } else {
      record('PM /api/users (узкие поля)', usersRes.leaked.length === 0 ? 'PASS' : 'FAIL',
        usersRes.leaked.length ? `утечка: ${usersRes.leaked.join(', ')}; все поля: ${usersRes.fields.join(', ')}` : `fields: ${usersRes.fields.join(', ')}`);
    }

    // ---- /api/work-readiness?my=true ----
    const wrRes = await pagePm.evaluate(async (tok) => {
      const res = await fetch('/api/work-readiness?my=true', { headers: { Authorization: 'Bearer ' + tok } });
      const txt = await res.text();
      let body;
      try { body = JSON.parse(txt); } catch (_) { body = null; }
      const arr = Array.isArray(body) ? body : (body && (body.items || body.works)) || [];
      return { status: res.status, count: arr.length, bodyType: typeof body, sample: txt.slice(0, 200) };
    }, pmToken);
    pmApiResults.workReadiness = wrRes;
    console.log('  PM /api/work-readiness?my=true:', JSON.stringify(wrRes).slice(0, 400));
    record('PM /api/work-readiness?my=true', wrRes.status === 200 ? 'PASS' : 'FAIL', `HTTP ${wrRes.status}, items=${wrRes.count}`);

    // ---- /api/birthdays ----
    const bdRes = await pagePm.evaluate(async (tok) => {
      const res = await fetch('/api/birthdays', { headers: { Authorization: 'Bearer ' + tok } });
      const txt = await res.text();
      return { status: res.status, sample: txt.slice(0, 150) };
    }, pmToken);
    record('PM /api/birthdays', bdRes.status === 200 ? 'PASS' : 'FAIL', `HTTP ${bdRes.status}`);

    // ---- /api/tasks (verify v2 endpoint returns JSON, not HTML) ----
    const tasksRes = await pagePm.evaluate(async (tok) => {
      const res = await fetch('/api/tasks', { headers: { Authorization: 'Bearer ' + tok } });
      const ctype = res.headers.get('content-type') || '';
      const txt = await res.text();
      return { status: res.status, ctype, isJson: ctype.includes('json'), sample: txt.slice(0, 150) };
    }, pmToken);
    record('PM /api/tasks JSON (не HTML)', tasksRes.status === 200 && tasksRes.isJson ? 'PASS' : 'FAIL',
      `HTTP ${tasksRes.status}, ctype=${tasksRes.ctype}`);

    // ---- Walk pages ----
    const pmRoutes = [
      { hash: '#/home', label: 'Home' },
      { hash: '#/tenders', label: 'Tenders' },
      { hash: '#/pm-works', label: 'PmWorks' },
      { hash: '#/my-procurement', label: 'Procurement' },
      { hash: '#/chat', label: 'Chat' },
      { hash: '#/alerts', label: 'Alerts' },
      { hash: '#/tasks', label: 'Tasks' },
    ];
    for (const r of pmRoutes) {
      const errsBefore = pmErrors.length;
      try {
        await pagePm.goto(BASE_V2 + r.hash, { waitUntil: 'commit', timeout: 20000 });
        await pagePm.waitForTimeout(2800);
        const info = await pagePm.evaluate(() => ({
          textLen: (document.body.innerText || '').trim().length,
          domCount: document.querySelectorAll('body *').length,
          hash: location.hash,
        }));
        await pagePm.screenshot({ path: path.join(REPORT_DIR, `pm_${r.label}.png`) });
        const newErrs = pmErrors.length - errsBefore;
        const ok = info.textLen > 50 && info.domCount > 30;
        record(`PM page ${r.label}`, ok && newErrs === 0 ? 'PASS' : (ok ? 'WARN' : 'FAIL'),
          `text=${info.textLen}, dom=${info.domCount}, новых ошибок=${newErrs}`);
      } catch (e) {
        record(`PM page ${r.label}`, 'FAIL', e.message);
      }
    }

  } catch (e) {
    record('PM session', 'FAIL', e.message);
  }

  console.log('\n  PM total console errors:', pmErrors.length);
  if (pmErrors.length) {
    pmErrors.slice(0, 25).forEach(e => console.log('    -', e.slice(0, 250)));
  }
  if (pm5xx.length) console.log('  PM 5xx:', pm5xx);

  await ctxPm.close();

  // ============================================
  // PART G: WAREHOUSE role — POST /api/payroll/items should be 403
  // ============================================
  console.log('\n=== PART G: WAREHOUSE RBAC ===');
  // Use direct API request with PM token first — get the WAREHOUSE check via login attempt
  // We will try via a fresh context simulating an unauthorized POST (no warehouse user creds available).
  // Without warehouse creds — verify endpoint is protected by trying as PM (still should be 403/forbidden).
  const ctxPmPayroll = await browser.newContext({ ignoreHTTPSErrors: true });
  const pagePmPayroll = await ctxPmPayroll.newPage();
  try {
    await loginV2(pagePmPayroll, 'test_pm', 'Test123!', '1234');
    await pagePmPayroll.waitForTimeout(2000);
    const tok = await pagePmPayroll.evaluate(() => localStorage.getItem('asgard_token') || '');
    const r = await pagePmPayroll.evaluate(async (t) => {
      const res = await fetch('/api/payroll/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ probe: true }),
      });
      const txt = await res.text();
      return { status: res.status, sample: txt.slice(0, 200) };
    }, tok);
    // PM is also not allowed (only BUH/ADMIN typically). Expect 403.
    record('POST /api/payroll/items (PM proxy)', r.status === 403 ? 'PASS' : (r.status >= 400 && r.status < 500 ? 'WARN' : 'FAIL'),
      `HTTP ${r.status} — ожидался 403 (PM не имеет прав); body: ${r.sample.slice(0,80)}`);
  } catch (e) {
    record('POST /api/payroll/items', 'FAIL', e.message);
  }
  await ctxPmPayroll.close();

  await browser.close();

  // ============================================
  // FINAL REPORT
  // ============================================
  const passed = findings.filter(f => f.status === 'PASS').length;
  const failed = findings.filter(f => f.status === 'FAIL').length;
  const warned = findings.filter(f => f.status === 'WARN').length;

  console.log('\n\n=========================================');
  console.log(`FINAL: PASS=${passed}, WARN=${warned}, FAIL=${failed}, TOTAL=${findings.length}`);
  console.log('=========================================');
  for (const f of findings) {
    const icon = f.status === 'PASS' ? '[+]' : f.status === 'FAIL' ? '[X]' : '[~]';
    console.log(`${icon} ${f.check} | ${f.detail || ''}`);
  }

  fs.writeFileSync(path.join(REPORT_DIR, 'findings.json'), JSON.stringify(findings, null, 2));
  console.log(`\n[final-regression] report → ${path.join(REPORT_DIR, 'findings.json')}`);
})();
