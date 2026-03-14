#!/usr/bin/env node
/**
 * ASGARD CRM v8.8.1 — Comprehensive Mobile Audit
 * Checks: JS errors, overflow, empty pages, render issues, text anomalies
 */
const puppeteer = require('puppeteer-core');

const BASE = 'https://127.0.0.1';
const BROWSER_PATH = '/usr/bin/chromium-browser';

// All mobile routes to test
const ROUTES = [
  '#/home', '#/tasks', '#/tenders', '#/customers', '#/finances',
  '#/pm-works', '#/contracts', '#/invoices', '#/acts',
  '#/all-estimates', '#/workers', '#/warehouse', '#/correspondence',
  '#/my-mail', '#/chat', '#/reminders', '#/alerts',
  '#/approvals', '#/more', '#/settings', '#/profile',
  '#/hr-requests', '#/kanban', '#/reports', '#/to-analytics',
  '#/pm-analytics', '#/calendar', '#/meetings'
];

const MOBILE_VP = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESKTOP_VP = { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false };

const results = { pass: 0, warn: 0, fail: 0, details: [] };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function login(page) {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(3000);

  // Step 1: Click "Войти" on welcome page
  try {
    await page.waitForSelector('#btnShowLogin', { timeout: 5000 });
    await page.click('#btnShowLogin');
    await wait(1000);
  } catch(e) { console.log('  Note: btnShowLogin not found, trying direct login'); }

  // Step 2: Fill login + password
  try {
    await page.waitForSelector('#w_login', { visible: true, timeout: 5000 });
  } catch(e) {}
  await page.type('#w_login', 'admin');
  await page.type('#w_pass', 'admin123');

  // Step 3: Click "Далее"
  await page.click('#btnDoLogin');
  await wait(3000);

  // Step 4: Enter PIN
  try {
    const pinVisible = await page.evaluate(() => {
      const el = document.querySelector('#w_pin, .sg-keypad');
      return el && el.offsetHeight > 0;
    });
    if (pinVisible) {
      // Try typing PIN via keypad buttons or input
      const pinInput = await page.$('#w_pin');
      if (pinInput) {
        await pinInput.type('1234');
      } else {
        // Click keypad buttons
        for (const digit of ['1', '2', '3', '4']) {
          const btns = await page.$$('.sg-key, .pk-key');
          for (const btn of btns) {
            const text = await page.evaluate(el => el.textContent.trim(), btn);
            if (text === digit) { await btn.click(); await wait(200); break; }
          }
        }
      }
      // Click verify PIN button if exists
      const verifyBtn = await page.$('#btnVerifyPin');
      if (verifyBtn) await verifyBtn.click();
      await wait(4000);
    }
  } catch(e) { console.log('  Note: PIN entry issue:', e.message); }

  // Verify login
  const loggedIn = await page.evaluate(() => {
    return !!document.querySelector('.m-tabbar, .sidebar, .m-header, #sidebar');
  });
  console.log('  Login status:', loggedIn ? 'SUCCESS' : 'PENDING');
  if (!loggedIn) await wait(3000);
}

async function checkPage(page, route) {
  const issues = [];
  const jsErrors = [];

  // Listen for JS errors
  const errorHandler = msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon') && !text.includes('manifest') && !text.includes('net::ERR'))
        jsErrors.push(text.substring(0, 200));
    }
  };
  page.on('console', errorHandler);

  try {
    await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle2', timeout: 15000 });
  } catch(e) {
    await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  }
  await wait(2000);

  // Check 1: JS errors
  if (jsErrors.length > 0) {
    issues.push({ type: 'ERROR', msg: `JS errors: ${jsErrors.join('; ').substring(0, 300)}` });
  }

  // Check 2: Horizontal overflow
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth + 5;
  });
  if (hasOverflow) {
    issues.push({ type: 'ERROR', msg: 'Horizontal overflow detected' });
  }

  // Check 3: Empty page (no visible content)
  const contentCheck = await page.evaluate(() => {
    const content = document.querySelector('#content, .m-content, [data-mobile-native]');
    if (!content) return { empty: true, text: '' };
    const text = content.innerText.trim();
    const cards = content.querySelectorAll('.m-card, .m-stat-card, .m-chat-list-item, .m-mail-item');
    return {
      empty: text.length < 10 && cards.length === 0,
      text: text.substring(0, 100),
      cards: cards.length
    };
  });
  if (contentCheck.empty) {
    issues.push({ type: 'WARN', msg: `Page appears empty (text: "${contentCheck.text}")` });
  }

  // Check 4: Text anomalies (undefined, null, NaN, [object)
  const textAnomalies = await page.evaluate(() => {
    const body = document.body.innerText;
    const anomalies = [];
    if (/\bundefined\b/.test(body)) anomalies.push('undefined');
    if (/\bnull\b/i.test(body) && !/\bnull\b/.test(body.toLowerCase().replace(/nullable|not null|is null/g, ''))) anomalies.push('null');
    if (/\bNaN\b/.test(body)) anomalies.push('NaN');
    if (/\[object\s/.test(body)) anomalies.push('[object]');
    return anomalies;
  });
  if (textAnomalies.length > 0) {
    issues.push({ type: 'WARN', msg: `Text anomalies: ${textAnomalies.join(', ')}` });
  }

  // Check 5: Mobile layout is active
  const hasMobileLayout = await page.evaluate(() => {
    const tabbar = document.querySelector('.m-tabbar');
    const header = document.querySelector('.m-header, .m-toolbar');
    return !!(tabbar || header);
  });
  if (!hasMobileLayout) {
    issues.push({ type: 'WARN', msg: 'No mobile layout detected (missing tabbar/header)' });
  }

  // Check 6: Cut off text (elements wider than viewport)
  const overflowingElements = await page.evaluate(() => {
    const vw = window.innerWidth;
    let count = 0;
    document.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.right > vw + 10 && rect.width > 0 && el.offsetHeight > 0) count++;
    });
    return count;
  });
  if (overflowingElements > 3) {
    issues.push({ type: 'WARN', msg: `${overflowingElements} elements overflow viewport` });
  }

  page.off('console', errorHandler);

  const status = issues.some(i => i.type === 'ERROR') ? 'FAIL' : issues.length > 0 ? 'WARN' : 'PASS';
  if (status === 'PASS') results.pass++;
  else if (status === 'WARN') results.warn++;
  else results.fail++;

  results.details.push({ route, status, issues });

  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`  ${icon} ${route} — ${status}${issues.length ? ': ' + issues.map(i => i.msg).join('; ').substring(0, 120) : ''}`);
}

async function checkDesktop(page) {
  console.log('\n--- Desktop Integrity Check ---');
  await page.setViewport(DESKTOP_VP);
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2', timeout: 15000 });
  await wait(2000);

  const desktop = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar, .left-menu, nav.nav-sidebar, #sidebar');
    const tabbar = document.querySelector('.m-tabbar');
    const hasSidebar = sidebar && sidebar.offsetWidth > 50;
    const hasTabbar = tabbar && tabbar.offsetHeight > 0;
    return { hasSidebar, hasTabbar, sidebarWidth: sidebar ? sidebar.offsetWidth : 0 };
  });

  if (desktop.hasSidebar) {
    console.log(`  ✅ Desktop sidebar visible (${desktop.sidebarWidth}px)`);
  } else {
    console.log('  ❌ Desktop sidebar MISSING');
    results.fail++;
  }

  if (!desktop.hasTabbar) {
    console.log('  ✅ Mobile tabbar hidden on desktop');
  } else {
    console.log('  ❌ Mobile tabbar VISIBLE on desktop');
    results.fail++;
  }

  // Reset to mobile
  await page.setViewport(MOBILE_VP);
}

(async () => {
  console.log('='.repeat(60));
  console.log('ASGARD CRM v8.8.1 — COMPREHENSIVE MOBILE AUDIT');
  console.log('='.repeat(60));

  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors',
           '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
  });

  const page = await browser.newPage();
  await page.setViewport(MOBILE_VP);
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

  console.log('\n--- Login ---');
  await login(page);
  console.log('  Logged in as admin');

  console.log('\n--- Mobile Pages Audit ---');
  for (const route of ROUTES) {
    await checkPage(page, route);
  }

  await checkDesktop(page);

  // Landscape check
  console.log('\n--- Landscape Check ---');
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  for (const route of ['#/home', '#/tasks', '#/tenders']) {
    await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    await wait(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5);
    console.log(`  ${overflow ? '❌' : '✅'} ${route} landscape — ${overflow ? 'OVERFLOW' : 'OK'}`);
  }

  await browser.close();

  console.log('\n' + '='.repeat(60));
  console.log(`RESULTS: ${results.pass} PASS, ${results.warn} WARN, ${results.fail} FAIL`);
  console.log('='.repeat(60));

  // Save results
  const fs = require('fs');
  fs.writeFileSync('/tmp/audit_v881_results.json', JSON.stringify(results, null, 2));
  console.log('Results saved to /tmp/audit_v881_results.json');
})();
