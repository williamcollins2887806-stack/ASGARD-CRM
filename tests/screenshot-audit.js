#!/usr/bin/env node
/**
 * ASGARD CRM — Visual Audit: Screenshot All Pages × All Roles
 * 
 * Запуск:
 *   cd /var/www/asgard-crm
 *   npm install puppeteer --save-dev   # первый раз
 *   node tests/screenshot-audit.js
 * 
 * Результат:
 *   screenshots/
 *   ├── ADMIN/
 *   │   ├── home.png
 *   │   ├── dashboard.png
 *   │   ├── tasks-admin.png
 *   │   └── ...
 *   ├── PM/
 *   │   ├── home.png
 *   │   └── ...
 *   ├── console-errors.json    — все ошибки консоли по ролям/страницам
 *   └── report.txt             — текстовый отчёт
 * 
 *  Потом: tar -czf screenshots.tar.gz screenshots/
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// ─── Конфигурация ───────────────────────────────────────────
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing';
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');
const VIEWPORT = { width: 1440, height: 900 };
const PAGE_LOAD_WAIT = 2500;  // мс — ждём рендера SPA после навигации
const EXTRA_WAIT_ROUTES = ['/dashboard', '/big-screen', '/kpi-works', '/kpi-money', '/finances'];
const EXTRA_WAIT_MS = 3000;   // доп. ожидание для тяжёлых страниц

// ─── Маршруты по ролям ──────────────────────────────────────
// Каждый маршрут будет открыт для указанных ролей
const ROLE_ROUTES = {
  ADMIN: [
    '/home', '/dashboard', '/calendar', '/birthdays',
    '/contracts', '/seals', '/permits', '/permit-applications',
    '/pre-tenders', '/funnel', '/tenders', '/customers',
    '/pm-calcs', '/calculator', '/pm-consents', '/approvals', '/bonus-approval',
    '/pm-works', '/all-works', '/all-estimates',
    '/finances', '/buh-registry', '/office-expenses', '/correspondence', '/proxies',
    '/travel', '/user-requests',
    '/kpi-works', '/kpi-money',
    '/settings', '/telegram', '/mango',
    '/chat', '/big-screen', '/backup',
    '/personnel', '/hr-rating', '/hr-requests',
    '/proc-requests', '/workers-schedule', '/office-schedule',
    '/gantt-calcs', '/gantt-works',
    '/acts', '/invoices', '/warehouse', '/my-equipment',
    '/cash', '/cash-admin',
    '/payroll', '/self-employed', '/one-time-pay',
    '/tasks', '/tasks-admin',
    '/alerts', '/reminders',
  ],
  PM: [
    '/home', '/calendar', '/birthdays',
    '/customers', '/pm-calcs', '/calculator', '/pm-consents',
    '/pm-works', '/bonus-approval',
    '/chat', '/travel',
    '/acts', '/invoices', '/my-equipment', '/cash',
    '/payroll', '/one-time-pay',
    '/gantt-calcs', '/gantt-works',
    '/tasks', '/office-schedule',
    '/alerts', '/reminders', '/warehouse',
  ],
  TO: [
    '/home', '/calendar', '/birthdays',
    '/pre-tenders', '/funnel', '/tenders', '/customers',
    '/chat', '/permits', '/permit-applications',
    '/tasks', '/office-schedule',
    '/alerts', '/reminders', '/warehouse',
  ],
  HR: [
    '/home', '/calendar', '/birthdays',
    '/personnel', '/hr-rating', '/hr-requests',
    '/travel', '/workers-schedule', '/office-schedule',
    '/permits', '/permit-applications',
    '/chat', '/tasks',
    '/alerts', '/reminders', '/warehouse',
  ],
  BUH: [
    '/home', '/calendar', '/birthdays',
    '/finances', '/buh-registry',
    '/acts', '/invoices',
    '/payroll', '/self-employed',
    '/chat', '/tasks', '/office-schedule',
    '/alerts', '/reminders', '/warehouse',
  ],
  OFFICE_MANAGER: [
    '/home', '/calendar', '/birthdays',
    '/contracts', '/seals', '/office-expenses',
    '/correspondence', '/proxies', '/travel',
    '/chat', '/tasks', '/office-schedule',
    '/alerts', '/reminders', '/warehouse',
  ],
  DIRECTOR_GEN: [
    '/home', '/dashboard', '/calendar', '/birthdays',
    '/contracts', '/seals', '/permits', '/permit-applications',
    '/pre-tenders', '/funnel', '/tenders', '/customers',
    '/pm-calcs', '/calculator', '/pm-consents', '/approvals', '/bonus-approval',
    '/pm-works', '/all-works', '/all-estimates',
    '/finances', '/buh-registry', '/office-expenses', '/correspondence', '/proxies',
    '/travel', '/kpi-works', '/kpi-money', '/settings',
    '/chat', '/big-screen',
    '/personnel', '/hr-rating', '/hr-requests',
    '/proc-requests', '/workers-schedule', '/office-schedule',
    '/gantt-calcs', '/gantt-works',
    '/acts', '/invoices', '/warehouse', '/my-equipment',
    '/cash', '/cash-admin',
    '/payroll', '/self-employed', '/one-time-pay',
    '/tasks', '/tasks-admin',
    '/alerts', '/reminders',
  ],
  HEAD_PM: [
    '/home', '/dashboard', '/calendar', '/birthdays',
    '/pm-works', '/all-works', '/bonus-approval',
    '/gantt-calcs', '/gantt-works',
    '/payroll', '/one-time-pay',
    '/tasks', '/office-schedule',
    '/alerts', '/reminders', '/warehouse',
  ],
  PROC: [
    '/home', '/calendar', '/birthdays',
    '/proc-requests',
    '/tasks', '/office-schedule',
    '/alerts', '/reminders', '/warehouse',
  ],
  WAREHOUSE: [
    '/home', '/calendar', '/birthdays',
    '/warehouse',
    '/tasks', '/office-schedule',
    '/alerts', '/reminders',
  ],
};

// ─── Утилиты ────────────────────────────────────────────────

/** Создать JWT токен для роли */
function mintToken(role, userId = 9000) {
  return jwt.sign({
    id: userId,
    login: `screenshot_${role.toLowerCase()}`,
    name: `Screenshot ${role}`,
    role: role,
    email: `${role.toLowerCase()}@asgard.local`,
    pinVerified: true
  }, JWT_SECRET, { expiresIn: '2h' });
}

/** Получить реальных пользователей через API */
async function fetchRealUsers(adminToken) {
  try {
    const res = await fetch(`${BASE_URL}/api/users`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.users || []);
  } catch (e) {
    console.warn('⚠️  Не удалось загрузить пользователей:', e.message);
    return [];
  }
}

/** Получить permissions для роли через API */
async function fetchPermissions(token) {
  try {
    const res = await fetch(`${BASE_URL}/api/permissions/my`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return {};
    return await res.json();
  } catch (e) {
    return {};
  }
}

/** Безопасное имя файла */
function safeFilename(route) {
  return route.replace(/^\//, '').replace(/\//g, '_').replace(/[?&=#]/g, '_') || 'root';
}

// ─── Главная логика ─────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  📸  ASGARD CRM — Visual Screenshot Audit    ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  URL: ${BASE_URL}`);
  console.log(`  Viewport: ${VIEWPORT.width}×${VIEWPORT.height}`);
  console.log(`  Roles: ${Object.keys(ROLE_ROUTES).length}`);
  console.log(`  Routes: ${new Set(Object.values(ROLE_ROUTES).flat()).size} unique\n`);

  // Подготовить папки
  if (fs.existsSync(SCREENSHOT_DIR)) {
    fs.rmSync(SCREENSHOT_DIR, { recursive: true });
  }
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Запустить браузер
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1440,900'
    ]
  });

  // Результаты
  const allErrors = {};   // { role: { route: [errors] } }
  const report = [];      // текстовые строки отчёта
  let totalScreenshots = 0;
  let totalErrors = 0;

  // Получить реальных пользователей
  const adminToken = mintToken('ADMIN', 1);
  const realUsers = await fetchRealUsers(adminToken);
  console.log(`  Found ${realUsers.length} real users in DB\n`);

  // Маппинг роль → реальный user ID
  const roleUserMap = {};
  for (const role of Object.keys(ROLE_ROUTES)) {
    const realUser = realUsers.find(u => u.role === role);
    roleUserMap[role] = realUser ? realUser.id : (9000 + Object.keys(ROLE_ROUTES).indexOf(role));
  }

  // Обход ролей
  for (const [role, routes] of Object.entries(ROLE_ROUTES)) {
    const roleDir = path.join(SCREENSHOT_DIR, role);
    fs.mkdirSync(roleDir, { recursive: true });
    allErrors[role] = {};

    const userId = roleUserMap[role];
    const token = mintToken(role, userId);
    
    // Получить permissions
    const permissions = await fetchPermissions(token);

    console.log(`\n━━━ ${role} (user_id: ${userId}, ${routes.length} pages) ━━━`);

    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    // Собираем ошибки консоли
    const pageErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        pageErrors.push(msg.text());
      }
    });
    page.on('pageerror', err => {
      pageErrors.push(`[PageError] ${err.message}`);
    });
    page.on('requestfailed', req => {
      const url = req.url();
      // Игнорируем favicon и т.п.
      if (!url.includes('favicon')) {
        pageErrors.push(`[HTTP FAIL] ${req.method()} ${url} — ${req.failure()?.errorText || 'unknown'}`);
      }
    });

    // Установить auth в localStorage перед навигацией
    // Сначала открываем пустую страницу чтобы получить доступ к localStorage домена
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.evaluate((tok, r, userId, perms) => {
      const user = {
        id: userId,
        login: `screenshot_${r.toLowerCase()}`,
        name: `Screenshot ${r}`,
        role: r,
        email: `${r.toLowerCase()}@asgard.local`,
        permissions: perms
      };
      localStorage.setItem('asgard_token', tok);
      localStorage.setItem('asgard_user', JSON.stringify(user));
      localStorage.setItem('asgard_permissions', JSON.stringify(perms));
      localStorage.setItem('asgard_menu_settings', '{}');
    }, token, role, userId, permissions);

    // Обходим маршруты
    for (const route of routes) {
      pageErrors.length = 0;  // сброс ошибок для новой страницы

      const filename = safeFilename(route) + '.png';
      const filepath = path.join(roleDir, filename);

      try {
        // Навигация через hash
        await page.goto(`${BASE_URL}/#${route}`, {
          waitUntil: 'networkidle2',
          timeout: 15000
        });
        
        // Ждём рендера SPA
        const waitTime = EXTRA_WAIT_ROUTES.includes(route)
          ? PAGE_LOAD_WAIT + EXTRA_WAIT_MS
          : PAGE_LOAD_WAIT;
        await new Promise(r => setTimeout(r, waitTime));

        // Скриншот
        await page.screenshot({ path: filepath, fullPage: true });
        totalScreenshots++;

        // Собрать ошибки
        const errors = [...pageErrors];
        allErrors[role][route] = errors;

        const status = errors.length > 0 ? `❌ ${errors.length} err` : '✅';
        const errPreview = errors.length > 0 ? ` — ${errors[0].substring(0, 80)}...` : '';
        console.log(`  ${status} ${route}${errPreview}`);

        if (errors.length > 0) totalErrors += errors.length;

      } catch (err) {
        console.log(`  💥 ${route} — TIMEOUT/CRASH: ${err.message.substring(0, 80)}`);
        allErrors[role][route] = [`[CRASH] ${err.message}`];
        totalErrors++;
      }
    }

    await page.close();
  }

  await browser.close();

  // ─── Генерация отчётов ──────────────────────────────────

  // 1. JSON с ошибками
  const errorsPath = path.join(SCREENSHOT_DIR, 'console-errors.json');
  fs.writeFileSync(errorsPath, JSON.stringify(allErrors, null, 2));

  // 2. Текстовый отчёт
  report.push('╔══════════════════════════════════════════════════╗');
  report.push('║  ASGARD CRM — Visual Audit Report               ║');
  report.push('╚══════════════════════════════════════════════════╝');
  report.push(`Date: ${new Date().toISOString()}`);
  report.push(`URL: ${BASE_URL}`);
  report.push(`Screenshots: ${totalScreenshots}`);
  report.push(`Console errors: ${totalErrors}`);
  report.push('');

  for (const [role, routes] of Object.entries(allErrors)) {
    const roleErrors = Object.entries(routes).filter(([_, errs]) => errs.length > 0);
    const status = roleErrors.length > 0 ? '❌' : '✅';
    report.push(`${status} ${role}: ${Object.keys(routes).length} pages, ${roleErrors.length} with errors`);
    
    for (const [route, errs] of roleErrors) {
      report.push(`   ❌ ${route}:`);
      for (const err of errs) {
        report.push(`      • ${err.substring(0, 120)}`);
      }
    }
  }

  report.push('');
  report.push('─── Pages with errors (summary) ───');
  let errorPages = 0;
  for (const [role, routes] of Object.entries(allErrors)) {
    for (const [route, errs] of Object.entries(routes)) {
      if (errs.length > 0) {
        report.push(`  ${role} ${route}: ${errs.length} error(s)`);
        errorPages++;
      }
    }
  }
  report.push(`\nTotal: ${errorPages} pages with errors out of ${totalScreenshots} screenshots`);

  const reportPath = path.join(SCREENSHOT_DIR, 'report.txt');
  fs.writeFileSync(reportPath, report.join('\n'));

  // ─── Итог ───────────────────────────────────────────────
  console.log('\n' + '═'.repeat(50));
  console.log(`  📸 Screenshots: ${totalScreenshots}`);
  console.log(`  ❌ Console errors: ${totalErrors}`);
  console.log(`  📁 Output: ${SCREENSHOT_DIR}/`);
  console.log(`  📄 Report: ${reportPath}`);
  console.log(`  📋 Errors: ${errorsPath}`);
  console.log('═'.repeat(50));
  console.log('\n  Для архива:');
  console.log('  tar -czf screenshots.tar.gz screenshots/\n');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
