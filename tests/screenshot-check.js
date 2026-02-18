#!/usr/bin/env node
/**
 * ASGARD CRM — Targeted Screenshot Audit (только проблемные страницы)
 * 
 * Запуск:
 *   cd /var/www/asgard-crm
 *   set -a && source .env && set +a && node tests/screenshot-check.js
 *   tar -czf screenshots-check.tar.gz screenshots-check/
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing';
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots-check');
const VIEWPORT = { width: 1440, height: 900 };
const PAGE_WAIT = 3000;

// ─── ТОЛЬКО проблемные страницы ─────────────────────────────
const CHECKS = [
  // ЭТАП 1: Ошибки
  { role: 'ADMIN', route: '/home',             issue: '401 ошибки виджетов' },
  { role: 'ADMIN', route: '/reminders',        issue: 'layout.setMain crash' },
  { role: 'ADMIN', route: '/office-schedule',  issue: 'staff_plan 500' },
  { role: 'ADMIN', route: '/tasks',            issue: 'белые карточки + тост danger + todo 400' },
  { role: 'ADMIN', route: '/mailbox',          issue: 'email send 400 валидация' },

  // ЭТАП 1: 403 для не-ADMIN ролей
  { role: 'PM',    route: '/home',             issue: 'PM 403 на home' },
  { role: 'PM',    route: '/bonus-approval',   issue: 'PM 403' },
  { role: 'PM',    route: '/chat',             issue: 'PM 403' },
  { role: 'PM',    route: '/travel',           issue: 'PM 403' },
  { role: 'PM',    route: '/office-schedule',  issue: 'PM 403' },
  { role: 'TO',    route: '/calendar',         issue: 'TO 403' },
  { role: 'TO',    route: '/funnel',           issue: 'TO 403' },
  { role: 'TO',    route: '/tenders',          issue: 'TO 403' },
  { role: 'HR',    route: '/hr-requests',      issue: 'HR 403' },
  { role: 'HR',    route: '/travel',           issue: 'HR 403' },
  { role: 'BUH',   route: '/finances',         issue: 'BUH 400' },
  { role: 'BUH',   route: '/buh-registry',     issue: 'BUH 400' },
  { role: 'BUH',   route: '/acts',             issue: 'BUH 400' },

  // ЭТАП 2: Визуал
  { role: 'ADMIN', route: '/funnel',           issue: 'текст не виден в колонках' },
  { role: 'ADMIN', route: '/tasks-admin',      issue: 'были белые фоны' },
  { role: 'ADMIN', route: '/cash',             issue: 'серые формы Bootstrap' },
  { role: 'ADMIN', route: '/cash-admin',       issue: 'серые секции' },
  { role: 'ADMIN', route: '/finances',         issue: 'stat-карточки круглые рамки' },
  { role: 'ADMIN', route: '/buh-registry',     issue: 'stat-карточки белёсые' },
  { role: 'ADMIN', route: '/invoices',         issue: 'полосатые строки' },
  { role: 'ADMIN', route: '/office-expenses',  issue: 'полосатые строки' },
  { role: 'ADMIN', route: '/all-works',        issue: 'линия на текст + 0 из 16' },
  { role: 'ADMIN', route: '/big-screen',       issue: 'border-radius 20px' },
  { role: 'ADMIN', route: '/warehouse',        issue: 'stat-card белые' },
  { role: 'ADMIN', route: '/hr-rating',        issue: 'SQL-инъекции в ФИО' },
  { role: 'ADMIN', route: '/payroll',          issue: 'зависание табов' },
  { role: 'ADMIN', route: '/dashboard',        issue: 'контроль — должен быть ОК' },
];

// ─── Утилиты ────────────────────────────────────────────────

function mintToken(role, userId) {
  return jwt.sign({
    id: userId,
    login: `check_${role.toLowerCase()}`,
    name: `Check ${role}`,
    role,
    email: `${role.toLowerCase()}@asgard.local`,
    pinVerified: true
  }, JWT_SECRET, { expiresIn: '2h' });
}

async function fetchRealUsers(token) {
  try {
    const res = await fetch(`${BASE_URL}/api/users`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.users || []);
  } catch { return []; }
}

async function fetchPermissions(token) {
  try {
    const res = await fetch(`${BASE_URL}/api/permissions/my`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

function safeFilename(role, route) {
  return `${role}_${route.replace(/^\//, '').replace(/\//g, '_') || 'root'}`;
}

// ─── Главная ────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🔍  ASGARD — Targeted Screenshot Check      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Checks: ${CHECKS.length} pages\n`);

  if (fs.existsSync(SCREENSHOT_DIR)) fs.rmSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-gpu', '--window-size=1440,900']
  });

  // Получить реальных пользователей
  const adminToken = mintToken('ADMIN', 1);
  const realUsers = await fetchRealUsers(adminToken);
  console.log(`  Found ${realUsers.length} real users\n`);

  const roleUserMap = {};
  const roles = [...new Set(CHECKS.map(c => c.role))];
  for (const role of roles) {
    const u = realUsers.find(u => u.role === role);
    roleUserMap[role] = u ? u.id : 9000;
  }

  const results = [];
  let prevRole = null;
  let page = null;

  for (const check of CHECKS) {
    // Новая роль — новая вкладка с новым localStorage
    if (check.role !== prevRole) {
      if (page) await page.close().catch(() => {});

      page = await browser.newPage();
      await page.setViewport(VIEWPORT);

      const userId = roleUserMap[check.role];
      const token = mintToken(check.role, userId);
      const permissions = await fetchPermissions(token);

      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.evaluate((tok, role, userId, perms) => {
        localStorage.setItem('asgard_token', tok);
        localStorage.setItem('asgard_user', JSON.stringify({
          id: userId, login: `check_${role.toLowerCase()}`,
          name: `Check ${role}`, role, permissions: perms
        }));
        localStorage.setItem('asgard_permissions', JSON.stringify(perms));
        localStorage.setItem('asgard_menu_settings', '{}');
      }, token, check.role, userId, permissions);

      prevRole = check.role;
      console.log(`\n━━━ ${check.role} ━━━`);
    }

    // Собираем ошибки
    const errors = [];
    const onError = msg => { if (msg.type() === 'error') errors.push(msg.text()); };
    const onPageError = err => errors.push(`[PageError] ${err.message}`);
    const onReqFail = req => {
      if (!req.url().includes('favicon'))
        errors.push(`[HTTP] ${req.method()} ${req.url().split('/').slice(-2).join('/')} — ${req.failure()?.errorText || ''}`);
    };

    page.on('console', onError);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onReqFail);

    const filename = safeFilename(check.role, check.route) + '.png';
    const filepath = path.join(SCREENSHOT_DIR, filename);

    try {
      await page.goto(`${BASE_URL}/#${check.route}`, {
        waitUntil: 'networkidle2', timeout: 15000
      });
      await new Promise(r => setTimeout(r, PAGE_WAIT));
      await page.screenshot({ path: filepath, fullPage: true });

      const status = errors.length > 0 ? '❌' : '✅';
      const errInfo = errors.length > 0 ? ` (${errors.length} err)` : '';
      console.log(`  ${status} ${check.route}${errInfo} — ${check.issue}`);

      results.push({
        role: check.role,
        route: check.route,
        issue: check.issue,
        errors: [...errors],
        status: errors.length > 0 ? 'FAIL' : 'PASS',
        screenshot: filename
      });
    } catch (err) {
      console.log(`  💥 ${check.route} — CRASH: ${err.message.substring(0, 60)}`);
      results.push({
        role: check.role, route: check.route, issue: check.issue,
        errors: [`CRASH: ${err.message}`], status: 'CRASH', screenshot: null
      });
    }

    page.off('console', onError);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onReqFail);
  }

  if (page) await page.close().catch(() => {});
  await browser.close();

  // ─── Отчёт ──────────────────────────────────────────────
  const report = [];
  report.push('╔══════════════════════════════════════════════════╗');
  report.push('║  ASGARD — Targeted Check Report                  ║');
  report.push('╚══════════════════════════════════════════════════╝');
  report.push(`Date: ${new Date().toISOString()}`);
  report.push(`Total checks: ${results.length}`);
  report.push(`PASS: ${results.filter(r => r.status === 'PASS').length}`);
  report.push(`FAIL: ${results.filter(r => r.status === 'FAIL').length}`);
  report.push(`CRASH: ${results.filter(r => r.status === 'CRASH').length}`);
  report.push('');
  report.push('| Роль | Маршрут | Проблема | Ошибки | Статус |');
  report.push('|------|---------|----------|--------|--------|');

  for (const r of results) {
    const errCount = r.errors.length;
    const errPreview = errCount > 0 ? r.errors[0].substring(0, 50) + '...' : '—';
    report.push(`| ${r.role} | ${r.route} | ${r.issue} | ${errCount > 0 ? errCount + ': ' + errPreview : '0'} | ${r.status === 'PASS' ? '✅' : '❌'} |`);
  }

  report.push('');
  if (results.some(r => r.status !== 'PASS')) {
    report.push('─── Детали ошибок ───');
    for (const r of results.filter(r => r.status !== 'PASS')) {
      report.push(`\n${r.role} ${r.route} (${r.issue}):`);
      for (const e of r.errors) {
        report.push(`  • ${e.substring(0, 150)}`);
      }
    }
  }

  const reportPath = path.join(SCREENSHOT_DIR, 'report.txt');
  fs.writeFileSync(reportPath, report.join('\n'));

  const errorsPath = path.join(SCREENSHOT_DIR, 'errors.json');
  fs.writeFileSync(errorsPath, JSON.stringify(results, null, 2));

  console.log('\n' + '═'.repeat(50));
  console.log(`  ✅ PASS: ${results.filter(r => r.status === 'PASS').length}`);
  console.log(`  ❌ FAIL: ${results.filter(r => r.status === 'FAIL').length}`);
  console.log(`  💥 CRASH: ${results.filter(r => r.status === 'CRASH').length}`);
  console.log(`  📁 ${SCREENSHOT_DIR}/`);
  console.log(`  📄 ${reportPath}`);
  console.log('═'.repeat(50));
  console.log('\n  tar -czf screenshots-check.tar.gz screenshots-check/\n');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
