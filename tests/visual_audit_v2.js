/**
 * Visual Audit V3 - ASGARD CRM
 * Uses storageState to pre-set localStorage (token + user)
 * before loading any pages. Zero 401 errors.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://127.0.0.1';
const OUT_DIR = '/tmp/visual_audit_v2';
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

console.log('Visual Audit V3 starting...');

async function run() {
  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors']
  });

  const summary = { total: 0, errors: 0, jsErrors: 0, roles: [] };

  for (const { role, login, pass } of ROLES) {
    const pages = ROLE_PAGES[role] || [];
    if (!pages.length) continue;

    const roleDir = path.join(OUT_DIR, role);
    fs.mkdirSync(roleDir, { recursive: true });

    console.log('[' + role + '] Logging in as ' + login + '...');

    // Get token and user data via API
    const { token, user } = await getAuthData(login, pass);

    // Create context with pre-set localStorage (no 401 errors!)
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
    page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text().slice(0, 200)); });

    // Go directly to home — token already in localStorage
    await page.goto(BASE_URL + '/#/home', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await sleep(3000);

    let roleErrors = 0;
    let roleJsErrors = 0;
    const rolePages = [];

    for (const pg of pages) {
      try {
        if (pg === 'home') {
          // Already on home, just take screenshot
        } else {
          // Navigate via hash change (keeps auth state!)
          await page.evaluate((hash) => { location.hash = '#/' + hash; }, pg);
          await sleep(2500);
        }

        // Close any modals that may have popped up
        await page.evaluate(() => {
          const overlay = document.getElementById('modalOverlay');
          if (overlay && overlay.style.display !== 'none') {
            const close = overlay.querySelector('.modal-close, button.close');
            if (close) close.click();
          }
        }).catch(() => {});
        await sleep(300);

        const filepath = path.join(roleDir, pg + '.jpg');
        await page.screenshot({ path: filepath, type: 'jpeg', quality: 70 });
        rolePages.push(pg);
        summary.total++;

        const errCount = jsErrors.length;
        if (errCount > 0) {
          roleJsErrors += errCount;
          summary.jsErrors += errCount;
          // Log first error for debugging
          console.log('  [' + role + '] ' + pg + ' OK (' + errCount + ' JS errors: ' + jsErrors[0].slice(0, 100) + ')');
        } else {
          console.log('  [' + role + '] ' + pg + ' OK');
        }
      } catch (e) {
        console.log('  [' + role + '] ' + pg + ' FAIL: ' + e.message.slice(0, 100));
        roleErrors++;
        summary.errors++;
      }
      jsErrors.length = 0;
    }

    summary.roles.push({ role, pages: rolePages.length, errors: roleErrors, jsErrors: roleJsErrors });
    await ctx.close();
  }

  await browser.close();

  // Save summary
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== VISUAL AUDIT V3 DONE ===');
  console.log('Total pages: ' + summary.total + ', Navigation errors: ' + summary.errors + ', JS errors: ' + summary.jsErrors);
  for (const r of summary.roles) {
    let line = '  ' + r.role + ': ' + r.pages + ' pages';
    if (r.errors) line += ', ' + r.errors + ' nav errors';
    if (r.jsErrors) line += ', ' + r.jsErrors + ' JS errors';
    console.log(line);
  }
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
