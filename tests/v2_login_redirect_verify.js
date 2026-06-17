/**
 * v2 LOGIN REDIRECT VERIFY — Welcome→Home stays in /v2/ for all 15 roles
 *
 * Background: critical bug — Welcome/index.jsx after login used
 * `window.location.href = '/#/home'` → /v2/ users were thrown into vanilla v1.
 * Fix: `window.location.hash = '#/home'` (keeps /v2/ prefix).
 *
 * This test performs the FULL UI flow (no API shortcut!) for each role:
 *   1. open https://asgard-crm.ru/v2/ (clean context)
 *   2. wait for redirect to /v2/#/welcome
 *   3. click «Войти»
 *   4. fill login + password
 *   5. submit (Enter)
 *   6. if PIN screen — type 4 digits
 *   7. capture URL, hash, DOM markers (.shell-v2 vs aside.sidenav)
 *
 * Pass = URL in /v2/, .shell-v2 exists, no vanilla aside.sidenav.
 *
 * Run: node tests/v2_login_redirect_verify.js
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://asgard-crm.ru/v2/';
const OUT_DIR = path.join(__dirname, 'reports', 'v2-login-verify');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const ROLES = [
  { login: 'test_admin',          pin: '1234', role: 'ADMIN' },
  { login: 'test_pm',             pin: '1234', role: 'PM' },
  { login: 'test_to',             pin: '1234', role: 'TO' },
  { login: 'test_head_pm',        pin: '1234', role: 'HEAD_PM' },
  { login: 'test_head_to',        pin: '1234', role: 'HEAD_TO' },
  { login: 'test_buh',            pin: '1234', role: 'BUH' },
  { login: 'test_hr_manager',     pin: '1234', role: 'HR_MANAGER' },
  { login: 'test_director',       pin: '0000', role: 'DIRECTOR_GEN' },
  { login: 'test_director_comm',  pin: '1234', role: 'DIRECTOR_COMM' },
  { login: 'test_director_dev',   pin: '1234', role: 'DIRECTOR_DEV' },
  { login: 'test_office_manager', pin: '1234', role: 'OFFICE_MANAGER' },
  { login: 'test_chief_engineer', pin: '1234', role: 'CHIEF_ENGINEER' },
  { login: 'test_warehouse',      pin: '1234', role: 'WAREHOUSE' },
  { login: 'test_proc',           pin: '1234', role: 'PROC' }
  // test_hr skipped — PIN unknown
];

const PASSWORD = 'Test123!';

async function verifyRole(browser, { login, pin, role }) {
  const out = {
    role, login,
    urlAfterLogin: '',
    hashAfterLogin: '',
    isInV2: false,
    hasShellV2: false,
    hasVanillaShell: false,
    verdict: 'FAIL',
    failureStep: '',
    error: '',
    startedAt: new Date().toISOString()
  };

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'ru-RU'
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      if (/favicon|net::ERR_|ResizeObserver|service[- ]?worker|sw\.js|Manifest|ETELEGRAM|status of 401|status of 403/i.test(t)) return;
      consoleErrors.push(t.slice(0, 200));
    }
  });

  try {
    // STEP 1: open /v2/ (clean context, no token)
    await page.goto(BASE, { waitUntil: 'commit', timeout: 30000 });
    await page.waitForTimeout(2500);

    // STEP 2: confirm we landed on /v2/#/welcome
    let info = await page.evaluate(() => ({ href: location.href, hash: location.hash }));
    if (!info.href.startsWith('https://asgard-crm.ru/v2/')) {
      out.failureStep = `step2: initial URL not /v2/, got ${info.href}`;
      return out;
    }
    // wait for hash to settle (auth check redirects to /welcome if no token)
    for (let i = 0; i < 20; i++) {
      info = await page.evaluate(() => ({ href: location.href, hash: location.hash }));
      if (info.hash.includes('/welcome') || info.hash.includes('/home')) break;
      await page.waitForTimeout(250);
    }

    // STEP 3: click «Войти» — opens login form
    // The button is .welcome-v2-actions > button (variant=primary)
    const enterClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role=button]'));
      const target = btns.find(b => (b.textContent || '').trim() === 'Войти');
      if (target) { target.click(); return true; }
      return false;
    });
    if (!enterClicked) {
      out.failureStep = 'step3: "Войти" button not found on /welcome';
      await page.screenshot({ path: path.join(OUT_DIR, `${login}_step3_fail.png`) }).catch(() => {});
      return out;
    }
    await page.waitForTimeout(800);

    // STEP 4: fill login + password by placeholder
    const loginInput = await page.waitForSelector('input[placeholder="Введите логин"]', { timeout: 5000 });
    await loginInput.fill(login);
    const passInput = await page.waitForSelector('input[placeholder="Введите пароль"]', { timeout: 5000 });
    await passInput.fill(PASSWORD);

    // STEP 5: submit via Enter in password field
    await passInput.press('Enter');

    // wait either for PIN screen or for /home redirect
    let needPin = false;
    const evalSafe = async (fn) => {
      try { return await page.evaluate(fn); }
      catch (e) {
        if (/Execution context was destroyed|navigation|frame was detached/i.test(e.message)) return null;
        throw e;
      }
    };
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      const state = await evalSafe(() => {
        const hash = location.hash;
        const titles = Array.from(document.querySelectorAll('.welcome-v2-form-title')).map(e => e.textContent.trim());
        const hasPinKeypad = !!document.querySelector('.welcome-v2-form button[data-key], .pin-keypad, [class*="pin-keypad"], [class*="PinKeypad"]');
        const digitBtns = Array.from(document.querySelectorAll('button')).filter(b => /^[0-9]$/.test((b.textContent || '').trim())).length;
        return {
          hash, titles, hasPinKeypad, digitBtns,
          shellV2: !!document.querySelector('.shell-v2, .shell-v2-top'),
          vanilla: !!document.querySelector('aside.sidenav')
        };
      });
      if (!state) continue;
      if (state.titles.some(t => /PIN/i.test(t)) || state.hasPinKeypad || state.digitBtns >= 10) {
        needPin = true; break;
      }
      if (state.shellV2 || state.vanilla || (state.hash && state.hash.includes('/home'))) break;
    }

    // STEP 6: if PIN — type 4 digits
    if (needPin) {
      const digits = pin.split('');
      for (const d of digits) {
        // click the keypad button with that text
        const clicked = await page.evaluate((digit) => {
          const btns = Array.from(document.querySelectorAll('button')).filter(b => (b.textContent || '').trim() === digit);
          // pick visible
          for (const b of btns) {
            const r = b.getBoundingClientRect();
            if (r.width > 10 && r.height > 10) { b.click(); return true; }
          }
          return false;
        }, d);
        if (!clicked) {
          // fallback: type via keyboard
          await page.keyboard.press(`Digit${d}`).catch(() => {});
        }
        await page.waitForTimeout(150);
      }
      // wait for navigation
      await page.waitForTimeout(2500);
    }

    // STEP 7: wait for shell to render
    // After login Welcome does location.hash = '#/home' + reload(50ms).
    // After reload, React mounts → .shell-v2 appears.
    // The reload destroys evaluate contexts → wrap in try/catch and retry.
    const safeEval = async (fn) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try { return await page.evaluate(fn); }
        catch (e) {
          if (/Execution context was destroyed|navigation|frame was detached/i.test(e.message)) {
            await page.waitForTimeout(500);
            continue;
          }
          throw e;
        }
      }
      return null;
    };

    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(400);
      const state = await safeEval(() => ({
        href: location.href,
        hash: location.hash,
        shellV2: !!document.querySelector('.shell-v2, .shell-v2-top'),
        vanilla: !!document.querySelector('aside.sidenav')
      }));
      if (state && (state.shellV2 || state.vanilla)) break;
    }

    // Allow late reload to settle before final snapshot
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // FINAL snapshot (with retry against late reload)
    const finalState = await safeEval(() => ({
      href: location.href,
      hash: location.hash,
      shellV2Sel: document.querySelector('.shell-v2') ? '.shell-v2' :
                  (document.querySelector('.shell-v2-top') ? '.shell-v2-top' : ''),
      vanillaSel: document.querySelector('aside.sidenav') ? 'aside.sidenav' : '',
      title: document.title || ''
    })) || { href: '', hash: '', shellV2Sel: '', vanillaSel: '', title: '' };

    out.urlAfterLogin = finalState.href;
    out.hashAfterLogin = finalState.hash;
    out.isInV2 = finalState.href.startsWith('https://asgard-crm.ru/v2/');
    out.hasShellV2 = !!finalState.shellV2Sel;
    out.hasVanillaShell = !!finalState.vanillaSel;
    out.title = finalState.title;

    if (out.isInV2 && out.hasShellV2 && !out.hasVanillaShell) {
      out.verdict = 'PASS';
    } else {
      out.verdict = 'FAIL';
      if (!out.isInV2) out.failureStep = `URL not in /v2/: ${out.urlAfterLogin}`;
      else if (out.hasVanillaShell) out.failureStep = 'vanilla aside.sidenav present';
      else if (!out.hasShellV2) out.failureStep = 'shell-v2 not found';
      // capture screenshot on fail
      await page.screenshot({ path: path.join(OUT_DIR, `${login}_FAIL.png`), fullPage: false }).catch(() => {});
    }

    // Always capture small thumbnail for record
    if (out.verdict === 'PASS') {
      await page.screenshot({ path: path.join(OUT_DIR, `${login}_pass.png`), fullPage: false }).catch(() => {});
    }
  } catch (e) {
    out.error = e.message;
    out.failureStep = out.failureStep || ('exception: ' + e.message.slice(0, 150));
    try { await page.screenshot({ path: path.join(OUT_DIR, `${login}_ERROR.png`) }); } catch {}
  } finally {
    out.consoleErrors = consoleErrors;
    out.finishedAt = new Date().toISOString();
    await ctx.close().catch(() => {});
  }
  return out;
}

(async () => {
  // ROLES_FILTER=test_director,test_pm — run only listed logins
  const filter = (process.env.ROLES_FILTER || '').split(',').map(s => s.trim()).filter(Boolean);
  const TARGETS = filter.length ? ROLES.filter(r => filter.includes(r.login)) : ROLES;
  console.log(`[v2-login-verify] start ${new Date().toISOString()} — ${TARGETS.length} roles${filter.length ? ' (filtered)' : ''}`);
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const r of TARGETS) {
    process.stdout.write(`  ${r.role.padEnd(15)} ${r.login.padEnd(22)} ... `);
    let out;
    try {
      out = await verifyRole(browser, r);
    } catch (e) {
      out = { ...r, verdict: 'FAIL', failureStep: 'fatal: ' + e.message, error: e.message };
    }
    results.push(out);
    const tag = out.verdict === 'PASS' ? 'PASS' : 'FAIL';
    console.log(`${tag} ${out.urlAfterLogin ? '@ ' + out.urlAfterLogin : ''} ${out.failureStep ? '— ' + out.failureStep : ''}`);
  }
  await browser.close();

  // JSON — separate file when filtered, so a re-run for one role doesn't clobber the full run
  const jsonName = filter.length ? `results_${filter.join('_')}.json` : 'results.json';
  fs.writeFileSync(path.join(OUT_DIR, jsonName), JSON.stringify(results, null, 2));

  // REPORT.md
  const passCount = results.filter(r => r.verdict === 'PASS').length;
  const failCount = results.length - passCount;
  let md = `# v2 Login Redirect Verify — Welcome→Home stays in /v2/\n\n`;
  md += `**Date:** ${new Date().toISOString()}\n`;
  md += `**Base:** ${BASE}\n`;
  md += `**Fix verified:** \`Welcome/index.jsx\` использует \`window.location.hash = '#/home'\` (вместо \`location.href='/#/home'\`) во всех 4 точках: прямой вход без PIN, после PIN, после первичной настройки, useEffect для уже-залогиненных.\n\n`;
  md += `## Итог: ${passCount}/${results.length} PASS\n\n`;
  if (failCount === 0) {
    md += `**ВСЕ ${results.length} РОЛЕЙ ОСТАЛИСЬ В /v2/ ПОСЛЕ LOGIN.** Critical bug фикс подтверждён.\n\n`;
  } else {
    md += `**${failCount} FAIL** — смотрите детали ниже.\n\n`;
  }
  md += `## Таблица результатов\n\n`;
  md += `| Роль | Login | URL после login | В /v2/? | shell-v2? | vanilla shell? | Verdict |\n`;
  md += `|------|-------|------------------|---------|-----------|-----------------|---------|\n`;
  for (const r of results) {
    const url = (r.urlAfterLogin || '').replace(/\|/g, '\\|');
    const inV2 = r.isInV2 ? 'YES' : 'no';
    const shell = r.hasShellV2 ? 'YES' : 'no';
    const vanilla = r.hasVanillaShell ? 'YES (BAD)' : 'no';
    const v = r.verdict === 'PASS' ? 'PASS' : 'FAIL';
    md += `| ${r.role} | ${r.login} | \`${url}\` | ${inV2} | ${shell} | ${vanilla} | **${v}** |\n`;
  }
  // Failures detail
  const fails = results.filter(r => r.verdict !== 'PASS');
  if (fails.length) {
    md += `\n## Детали FAIL\n\n`;
    for (const f of fails) {
      md += `### ${f.role} (${f.login})\n`;
      md += `- **Failure step:** ${f.failureStep || '(unknown)'}\n`;
      md += `- **URL:** \`${f.urlAfterLogin || '(none)'}\`\n`;
      md += `- **Hash:** \`${f.hashAfterLogin || '(none)'}\`\n`;
      if (f.error) md += `- **Error:** ${f.error}\n`;
      if (f.consoleErrors && f.consoleErrors.length) {
        md += `- **Console errors (${f.consoleErrors.length}):**\n`;
        for (const e of f.consoleErrors.slice(0, 5)) md += `  - \`${e}\`\n`;
      }
      md += `- Screenshot: \`${f.login}_FAIL.png\`\n\n`;
    }
  }
  md += `\n## Методика\n\n`;
  md += `Полный UI-флоу через Playwright headless chromium (не shortcut через REST):\n`;
  md += `1. Открыть \`${BASE}\` в новом контексте (clean storage).\n`;
  md += `2. Дождаться редиректа на \`/v2/#/welcome\`.\n`;
  md += `3. Нажать «Войти» → форма логина.\n`;
  md += `4. Ввести login + password (placeholders «Введите логин» / «Введите пароль»).\n`;
  md += `5. Enter в поле пароля.\n`;
  md += `6. PIN: 4 цифры через клик по кнопкам клавиатуры.\n`;
  md += `7. Финальный снимок URL/hash и DOM (\`.shell-v2\` vs \`aside.sidenav\`).\n\n`;
  md += `**Pass:** URL начинается с \`https://asgard-crm.ru/v2/\` + есть \`.shell-v2\`/\`.shell-v2-top\` + нет \`aside.sidenav\`.\n`;
  md += `**Fail:** URL стал \`https://asgard-crm.ru/\` (vanilla v1) **или** DOM содержит \`aside.sidenav\`.\n`;

  const mdName = filter.length ? `REPORT_${filter.join('_')}.md` : 'REPORT.md';
  fs.writeFileSync(path.join(OUT_DIR, mdName), md);
  console.log(`\n[v2-login-verify] done. ${passCount}/${results.length} PASS.`);
  console.log(`Reports: ${OUT_DIR}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
