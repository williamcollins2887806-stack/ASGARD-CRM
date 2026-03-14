/**
 * Visual Audit V4 - ASGARD CRM
 * СТРОГАЯ ПРОВЕРКА: каждая страница должна:
 * 1. Загрузиться без navigation error
 * 2. Иметь реальный контент в #layout (не пустой, не skeleton)
 * 3. Не иметь JS ошибок в консоли
 * 4. Содержать видимый текст (минимум 30 символов)
 * 5. Не иметь API ошибок (403/500)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://127.0.0.1';
const OUT_DIR = '/tmp/visual_audit_v4';
const VIEWPORT = { width: 1280, height: 720 };

const ROLES = [
  { role: 'ADMIN', login: 'test_admin', pass: 'Test123!' },
  { role: 'PM', login: 'test_pm', pass: 'Test123!' },
  { role: 'TO', login: 'test_to', pass: 'Test123!' },
  { role: 'HEAD_PM', login: 'test_head_pm', pass: 'Test123!' },
  { role: 'HEAD_TO', login: 'test_head_to', pass: 'Test123!' },
  { role: 'HR', login: 'test_hr', pass: 'Test123!' },
  { role: 'HR_MANAGER', login: 'test_hr_manager', pass: 'Test123!' },
  { role: 'BUH', login: 'test_buh', pass: 'Test123!' },
  { role: 'DIRECTOR_GEN', login: 'test_director_gen', pass: 'Test123!' },
  { role: 'OFFICE_MANAGER', login: 'test_office_manager', pass: 'Test123!' },
  { role: 'CHIEF_ENGINEER', login: 'test_chief_engineer', pass: 'Test123!' },
  { role: 'WAREHOUSE', login: 'test_warehouse', pass: 'Test123!' },
  { role: 'PROC', login: 'test_proc', pass: 'Test123!' },
];

const ROLE_PAGES = {
  ADMIN: ['home','tenders','pre-tenders','customers','tkp','invoices','contracts','gantt','gantt-works','all-works','all-estimates','cash','cash-admin','buh-registry','finances','tasks','tasks-admin','kanban','calendar','meetings','personnel','hr-requests','user-requests','workers-schedule','permits','permit-applications','pass-requests','warehouse','office-expenses','correspondence','settings','calculator','my-mail','alerts'],
  PM: ['home','tenders','pre-tenders','customers','tkp','invoices','contracts','gantt','gantt-works','pm-works','pm-calcs','cash','finances','tasks','kanban','calendar','meetings','hr-requests','workers-schedule','permits','permit-applications','correspondence','calculator','my-mail','alerts'],
  TO: ['home','gantt','gantt-works','tasks','kanban','calendar','meetings','workers-schedule','permits','permit-applications','warehouse','my-mail','alerts'],
  HEAD_PM: ['home','tenders','pre-tenders','customers','tkp','invoices','contracts','gantt','gantt-works','all-works','all-estimates','cash','finances','tasks','kanban','calendar','meetings','hr-requests','workers-schedule','permits','permit-applications','correspondence','calculator','my-mail','alerts'],
  HEAD_TO: ['home','gantt','gantt-works','tasks','kanban','calendar','meetings','workers-schedule','permits','permit-applications','warehouse','my-mail','alerts'],
  HR: ['home','personnel','hr-requests','workers-schedule','training','permits','permit-applications','pass-requests','tasks','calendar','my-mail','alerts'],
  HR_MANAGER: ['home','personnel','hr-requests','workers-schedule','training','permits','permit-applications','pass-requests','payroll','one-time-pay','tasks','calendar','my-mail','alerts'],
  BUH: ['home','invoices','cash','buh-registry','finances','payroll','one-time-pay','self-employed','tasks','calendar','my-mail','alerts'],
  DIRECTOR_GEN: ['home','tenders','pre-tenders','customers','tkp','invoices','contracts','gantt','all-works','all-estimates','cash','finances','tasks','calendar','meetings','personnel','hr-requests','permits','warehouse','correspondence','my-mail','alerts'],
  OFFICE_MANAGER: ['home','office-expenses','correspondence','seals','tasks','calendar','my-mail','alerts'],
  CHIEF_ENGINEER: ['home','gantt','gantt-works','all-works','tasks','calendar','permits','permit-applications','warehouse','my-mail','alerts'],
  WAREHOUSE: ['home','warehouse','tasks','kanban','calendar','my-mail','alerts'],
  PROC: ['home','tasks','kanban','calendar','warehouse','my-mail','alerts'],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function apiCall(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request({
      hostname: '127.0.0.1', port: 443, path: urlPath,
      method, headers, rejectUnauthorized: false
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAuthData(login, pass) {
  const loginRes = await apiCall('POST', '/api/auth/login', null, JSON.stringify({ login, password: pass }));
  let token = loginRes.token;
  if (loginRes.status === 'need_pin' && token) {
    const pinRes = await apiCall('POST', '/api/auth/verify-pin', token, JSON.stringify({ pin: '0000' }));
    if (pinRes.token) token = pinRes.token;
  }
  const userData = await apiCall('GET', '/api/auth/me', token);
  const user = userData.user || userData;
  return { token, user };
}

async function checkPageContent(page, pageName) {
  return await page.evaluate(() => {
    const layout = document.getElementById('layout');
    if (!layout) return { ok: false, reason: 'no #layout element', textLen: 0 };

    const html = layout.innerHTML;
    const text = layout.innerText || '';

    if (!html || html.trim().length < 20) {
      return { ok: false, reason: 'empty content (innerHTML < 20 chars)', textLen: text.length };
    }

    const totalElements = layout.querySelectorAll('*').length;
    if (totalElements < 3) {
      return { ok: false, reason: 'too few DOM elements (' + totalElements + ')', textLen: text.length };
    }

    const cleanText = text.replace(/\s+/g, '').replace(/[^\w\u0400-\u04FF]/g, '');
    if (cleanText.length < 30) {
      return { ok: false, reason: 'insufficient visible text (' + cleanText.length + ' chars)', textLen: cleanText.length };
    }

    const errorPatterns = ['Ошибка загрузки', 'Error loading', 'Something went wrong', '500 Internal'];
    for (const pat of errorPatterns) {
      if (text.includes(pat)) {
        return { ok: false, reason: 'error message found: ' + pat, textLen: text.length };
      }
    }

    return {
      ok: true,
      textLen: cleanText.length,
      elements: totalElements
    };
  });
}

console.log('Visual Audit V4 starting (strict content checks)...');

async function run() {
  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors']
  });

  const summary = { total: 0, pass: 0, fail: 0, jsErrors: 0, roles: [], failures: [] };

  for (const { role, login, pass } of ROLES) {
    const pages = ROLE_PAGES[role] || [];
    if (!pages.length) continue;

    const roleDir = path.join(OUT_DIR, role);
    fs.mkdirSync(roleDir, { recursive: true });

    console.log('[' + role + '] Logging in as ' + login + '...');

    const { token, user } = await getAuthData(login, pass);

    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      ignoreHTTPSErrors: true,
      storageState: {
        cookies: [],
        origins: [{
          origin: 'https://127.0.0.1',
          localStorage: [
            { name: 'token', value: token },
            { name: 'asgard_token', value: token },
            { name: 'asgard_user', value: JSON.stringify(user) }
          ]
        }]
      }
    });

    const page = await ctx.newPage();
    const jsErrors = [];
    page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text().slice(0, 300)); });

    const apiErrors = [];
    page.on('response', resp => {
      const url = resp.url();
      const status = resp.status();
      if (url.includes('/api/') && status >= 400) {
        apiErrors.push({ url: url.replace(/.*\/api\//, '/api/'), status });
      }
    });

    await page.goto(BASE_URL + '/#/home', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await sleep(4000);

    let rolePass = 0;
    let roleFail = 0;
    let roleJsErrors = 0;

    for (const pg of pages) {
      jsErrors.length = 0;
      apiErrors.length = 0;

      try {
        if (pg !== 'home') {
          await page.evaluate((hash) => { location.hash = '#/' + hash; }, pg);
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          await sleep(3000);
        }

        // Закрываем модалки
        await page.evaluate(() => {
          const overlay = document.getElementById('modalOverlay');
          if (overlay && overlay.style.display !== 'none') {
            const close = overlay.querySelector('.modal-close, button.close, .btn-close');
            if (close) close.click();
          }
        }).catch(() => {});
        await sleep(300);

        // СТРОГАЯ проверка контента
        const check = await checkPageContent(page, pg);

        const filepath = path.join(roleDir, pg + '.jpg');
        await page.screenshot({ path: filepath, type: 'jpeg', quality: 70 });
        summary.total++;

        // Фильтруем JS ошибки — только реальные (не network/SSE шум)
        const realJsErrors = jsErrors.filter(e =>
          !e.includes('net::ERR_') &&
          !e.includes('sse/stream') &&
          !e.includes('Failed to load resource') &&
          !e.includes('favicon') &&
          !e.includes('service-worker') &&
          !e.includes('ServiceWorker')
        );

        // Фильтруем API ошибки
        const realApiErrors = apiErrors.filter(e =>
          !e.url.includes('/sse/') &&
          !e.url.includes('favicon') &&
          !e.url.includes('/push/')
        );

        let failed = false;
        let failReason = '';

        if (!check.ok) {
          failed = true;
          failReason = 'CONTENT: ' + check.reason;
        } else if (realJsErrors.length > 0) {
          failed = true;
          failReason = 'JS ERROR (' + realJsErrors.length + '): ' + realJsErrors[0].slice(0, 150);
          roleJsErrors += realJsErrors.length;
          summary.jsErrors += realJsErrors.length;
        } else if (realApiErrors.length > 0) {
          failed = true;
          failReason = 'API ERRORS: ' + realApiErrors.map(e => e.status + ' ' + e.url).join(', ').slice(0, 200);
        }

        if (failed) {
          roleFail++;
          summary.fail++;
          console.log('  \u274C [' + role + '] ' + pg + ' — ' + failReason);
          summary.failures.push({ role, page: pg, reason: failReason });
        } else {
          rolePass++;
          summary.pass++;
          console.log('  \u2705 [' + role + '] ' + pg + ' — ' + check.elements + ' el, ' + check.textLen + ' chars');
        }
      } catch (e) {
        roleFail++;
        summary.fail++;
        summary.total++;
        const msg = 'NAV FAIL: ' + e.message.slice(0, 150);
        console.log('  \u274C [' + role + '] ' + pg + ' — ' + msg);
        summary.failures.push({ role, page: pg, reason: msg });
      }
    }

    summary.roles.push({ role, pass: rolePass, fail: roleFail, jsErrors: roleJsErrors });
    await ctx.close();
  }

  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n========================================');
  console.log('  VISUAL AUDIT V4 RESULTS');
  console.log('========================================');
  console.log('Total: ' + summary.total + ' pages');
  console.log('  Pass: ' + summary.pass);
  console.log('  Fail: ' + summary.fail);
  console.log('  JS errors: ' + summary.jsErrors);
  console.log('');
  for (const r of summary.roles) {
    const status = r.fail === 0 ? 'PASS' : 'FAIL';
    console.log('  [' + status + '] ' + r.role + ': ' + r.pass + ' pass, ' + r.fail + ' fail');
  }

  if (summary.failures.length > 0) {
    console.log('\n  ALL FAILURES:');
    for (const f of summary.failures) {
      console.log('    - ' + f.role + '/' + f.page + ': ' + f.reason);
    }
  }
  console.log('========================================');
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
