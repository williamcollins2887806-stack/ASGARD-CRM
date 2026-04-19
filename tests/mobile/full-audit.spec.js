// @ts-nocheck
/**
 * ASGARD CRM — Комплексный мобильный аудит
 *
 * Запуск:
 *   npx playwright test tests/mobile/full-audit.spec.js --project=mobile --reporter=list
 *
 * Только по одной части:
 *   npx playwright test tests/mobile/full-audit.spec.js --project=mobile -g "PART 1"
 *   npx playwright test tests/mobile/full-audit.spec.js --project=mobile -g "PART 3"
 *
 * ВАЖНО: Все тесты READ-ONLY. Ничего не создаёт, не меняет, не удаляет.
 */

var { test, expect } = require('@playwright/test');
var { loginByToken } = require('./auth.helper');

// ═══════════════════════════════════════════════════════
// КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════════════

var GO = { waitUntil: 'domcontentloaded', timeout: 30000 };
var PAGE_WAIT = 4000;
var ROLE_PAGE_WAIT = 3000;
var BTN_MAX = 25;

var ROLES = [
  { role: 'ADMIN', id: 1, login: 'admin' },
  { role: 'DIRECTOR_GEN', id: 3455, login: 'ok' },
  { role: 'DIRECTOR_COMM', id: 3456, login: 'go' },
  { role: 'DIRECTOR_DEV', id: 3457, login: 'a.storozhev' },
  { role: 'CHIEF_ENGINEER', id: 3458, login: 'd.klimakin' },
  { role: 'HEAD_PM', id: 3459, login: 'iu.ivaneikin' },
  { role: 'HEAD_TO', id: 3460, login: 'hv' },
  { role: 'TO', id: 3461, login: 'ev' },
  { role: 'HR', id: 3462, login: 'a.trukhin' },
  { role: 'PM', id: 3463, login: 'r.rochshupkin' },
  { role: 'PROC', id: 3467, login: 'bv' },
  { role: 'WAREHOUSE', id: 3468, login: 'a.pantuzenko' },
  { role: 'BUH', id: 3469, login: 'glavbuh' },
  { role: 'OFFICE_MANAGER', id: 3471, login: 'office' },
];

var ALL_ROUTES = [
  '/home', '/my-dashboard', '/more', '/profile', '/settings',
  '/tasks', '/tasks-admin',
  '/tenders', '/pre-tenders', '/funnel',
  '/pm-works', '/all-works', '/all-estimates', '/pm-calcs',
  '/cash', '/cash-admin', '/approval-payment', '/approvals',
  '/finances', '/invoices', '/acts', '/payroll',
  '/personnel', '/worker-profiles', '/workers-schedule', '/hr-requests',
  '/customers', '/contracts',
  '/warehouse', '/my-equipment', '/tmc-requests', '/proc-requests',
  '/messenger', '/meetings', '/alerts',
  '/correspondence', '/my-mail', '/office-expenses',
  '/pass-requests', '/permits', '/seals', '/proxies',
  '/telegram', '/integrations', '/diag',
  '/mimir', '/mimir-page',
  '/gantt', '/training', '/travel',
];

var DESKTOP_ROUTES = [
  '/home', '/more', '/mob-more', '/dashboard', '/my-dashboard', '/big-screen',
  '/to-analytics', '/pm-analytics', '/kpi-works', '/kpi-money',
  '/engineer-dashboard', '/object-map',
  '/tenders', '/pre-tenders', '/funnel', '/tkp',
  '/customers', '/customer',
  '/pm-calcs', '/pm-works', '/pm-consents', '/approvals', '/bonus-approval',
  '/all-works', '/all-estimates',
  '/finances', '/buh-registry', '/acts', '/invoices', '/cash', '/cash-admin',
  '/approval-payment', '/payroll', '/payroll-sheet', '/self-employed', '/one-time-pay',
  '/personnel', '/employee', '/hr-rating', '/hr-requests', '/collections',
  '/workers-schedule', '/office-schedule', '/training',
  '/contracts', '/seals', '/permits', '/permit-applications', '/permit-application-form', '/proxies',
  '/office-expenses', '/correspondence', '/travel', '/pass-requests', '/tmc-requests',
  '/warehouse', '/my-equipment',
  '/telephony', '/chat', '/chat-groups', '/messenger', '/meetings', '/reminders',
  '/mailbox', '/my-mail', '/mail-settings', '/inbox-applications',
  '/tasks', '/tasks-admin', '/kanban',
  '/settings', '/telegram', '/sync', '/mango', '/backup', '/diag', '/user-requests', '/alerts', '/integrations',
  '/gantt', '/gantt-calcs', '/gantt-works', '/gantt-objects',
  '/calendar', '/birthdays', '/proc-requests',
  '/mimir', '/calculator', '/analytics', '/profile',
];

// Кнопки, которые НЕ КЛИКАЕМ (могут создать/удалить данные)
var DANGEROUS_BTN_RE = /Создать|Сохранить|Отправить|Удалить|Подтвердить|Оплатить|Согласовать|Отклонить|Архив/i;

// ═══════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════

// Retry-обёртка для loginByToken (защита от сетевых сбоев)
async function loginWithRetry(page, opts, maxRetries) {
  maxRetries = maxRetries || 3;
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await loginByToken(page, opts);
      return;
    } catch (e) {
      var isConnectionError = e.message && (
        e.message.includes('ERR_CONNECTION_RESET') ||
        e.message.includes('ERR_INTERNET_DISCONNECTED') ||
        e.message.includes('ERR_CONNECTION_REFUSED') ||
        e.message.includes('ERR_NETWORK_CHANGED') ||
        e.message.includes('net::ERR_')
      );
      if (isConnectionError && attempt < maxRetries) {
        console.log('  [RETRY] attempt ' + attempt + '/' + maxRetries + ' failed: ' + e.message.substring(0, 60));
        await page.waitForTimeout(5000 * attempt);
        continue;
      }
      throw e;
    }
  }
}

function slug(route) {
  return route.replace(/\//g, '-') || '-root';
}

async function getPageStatus(page, route, jsErrors) {
  var finalUrl = page.url();
  var text = await page.evaluate(function () {
    return document.body ? document.body.innerText : '';
  });
  var bodyLen = text.length;

  var errorVisible = false;
  try {
    errorVisible = await page.locator(
      'text=/Ошибка загрузки|Не удалось загрузить|Error 500|Internal Server Error/i'
    ).first().isVisible({ timeout: 500 });
  } catch (e) { /* нет */ }

  var status = 'OK';
  if (finalUrl.includes('/welcome') || finalUrl.includes('/login')) status = 'REDIRECT_AUTH';
  else if (bodyLen < 10) status = 'EMPTY';
  else if (errorVisible) status = 'UI_ERROR';
  else if (jsErrors && jsErrors.length > 0) status = 'JS_ERROR';

  return { status: status, bodyLen: bodyLen, text: text, finalUrl: finalUrl };
}


// ═══════════════════════════════════════════════════════
// ЧАСТЬ 1: ВСЕ СТРАНИЦЫ ОТ ADMIN
// ═══════════════════════════════════════════════════════

test.describe('PART 1: All pages — ADMIN', function () {
  for (var i = 0; i < ALL_ROUTES.length; i++) {
    (function (route) {
      test('page ' + route + ' loads', async function ({ page }) {
        var jsErrors = [];
        page.on('pageerror', function (e) { jsErrors.push(e.message); });

        await loginByToken(page, { id: 1, role: 'ADMIN', login: 'admin' });
        await page.goto('/#' + route, GO);
        await page.waitForTimeout(PAGE_WAIT);

        var res = await getPageStatus(page, route, jsErrors);

        if (res.status !== 'OK' || jsErrors.length > 0) {
          await page.screenshot({ path: 'test-results/p1-admin' + slug(route) + '.png' });
        }

        console.log('[P1][ADMIN] ' + route + ' → ' + res.status +
          ' (len=' + res.bodyLen + ')' +
          (jsErrors.length ? ' JS: ' + jsErrors.join('; ').substring(0, 120) : ''));

        expect(res.status === 'REDIRECT_AUTH', 'Redirected on ' + route).toBe(false);
        expect(res.bodyLen, 'Empty page ' + route).toBeGreaterThan(5);
      });
    })(ALL_ROUTES[i]);
  }
});


// ═══════════════════════════════════════════════════════
// ЧАСТЬ 2: КНОПКИ НА ВСЕХ СТРАНИЦАХ
// ═══════════════════════════════════════════════════════

test.describe('PART 2: Buttons on all pages', function () {
  for (var i = 0; i < ALL_ROUTES.length; i++) {
    (function (route) {
      test('buttons on ' + route, async function ({ page }) {
        test.setTimeout(180000); // 3 мин на кнопки

        await loginByToken(page, { id: 1, role: 'ADMIN', login: 'admin' });

        var jsErrors = [];
        page.on('pageerror', function (e) { jsErrors.push(e.message); });

        await page.goto('/#' + route, GO);
        await page.waitForTimeout(PAGE_WAIT);

        // Собрать все кнопки
        var buttons = await page.locator(
          'button, [role="button"], a[href]:not([href^="tel:"]):not([href^="mailto:"]), [onclick]'
        ).all();
        var totalFound = buttons.length;
        var results = [];

        for (var j = 0; j < Math.min(buttons.length, BTN_MAX); j++) {
          var btn = buttons[j];
          var isVisible = false;
          try { isVisible = await btn.isVisible(); } catch (e) { continue; }
          if (!isVisible) continue;

          // Получить текст кнопки
          var btnText = '';
          try {
            btnText = (await btn.innerText()).trim().substring(0, 50);
          } catch (e) { btnText = '?'; }
          if (!btnText || btnText === '?') {
            try {
              btnText = (await btn.getAttribute('aria-label')) ||
                (await btn.getAttribute('title')) || '(no-text)';
            } catch (e) { btnText = '(no-text)'; }
          }

          // Пропустить опасные кнопки (создание/удаление)
          if (DANGEROUS_BTN_RE.test(btnText)) {
            results.push({ text: btnText, status: 'SKIPPED_DANGEROUS' });
            continue;
          }

          var urlBefore = page.url();
          var jsErrBefore = jsErrors.length;

          try {
            await btn.click({ timeout: 3000 });
            await page.waitForTimeout(1000);
          } catch (e) {
            results.push({ text: btnText, status: 'CLICK_FAILED', error: e.message.substring(0, 80) });
            continue;
          }

          var urlAfter = page.url();
          var newJsErr = jsErrors.length - jsErrBefore;

          // Проверить реакцию
          var modalVisible = false;
          try {
            modalVisible = await page.locator(
              '.asgard-sheet, .m-bottom-sheet, .m-dialog, [class*="modal"], [class*="overlay"]:not([style*="display: none"])'
            ).first().isVisible({ timeout: 500 });
          } catch (e) { /* нет */ }

          var btnStatus = 'OK';
          if (newJsErr > 0) btnStatus = 'JS_ERROR';
          else if (urlAfter !== urlBefore || modalVisible) btnStatus = 'OK';
          else btnStatus = 'NO_REACTION';

          results.push({ text: btnText, status: btnStatus });

          // Вернуться если URL изменился
          if (urlAfter !== urlBefore) {
            await page.goto('/#' + route, GO);
            await page.waitForTimeout(2000);
            // Пересобрать кнопки т.к. DOM обновился
            buttons = await page.locator(
              'button, [role="button"], a[href]:not([href^="tel:"]):not([href^="mailto:"]), [onclick]'
            ).all();
          }

          // Закрыть модалку
          if (modalVisible) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            try {
              var overlayStill = await page.locator(
                '.asgard-sheet-overlay, .m-bottom-sheet-overlay'
              ).first().isVisible({ timeout: 300 });
              if (overlayStill) {
                await page.locator('.asgard-sheet-overlay, .m-bottom-sheet-overlay').first().click({ force: true });
                await page.waitForTimeout(500);
              }
            } catch (e) { /* ок */ }
          }
        }

        var ok = results.filter(function (r) { return r.status === 'OK'; }).length;
        var noReact = results.filter(function (r) { return r.status === 'NO_REACTION'; }).length;
        var failed = results.filter(function (r) { return r.status === 'CLICK_FAILED'; }).length;
        var jsErr = results.filter(function (r) { return r.status === 'JS_ERROR'; }).length;
        var skipped = results.filter(function (r) { return r.status === 'SKIPPED_DANGEROUS'; }).length;

        console.log('[P2] ' + route + ': found=' + totalFound +
          ' tested=' + results.length +
          ' OK=' + ok + ' NO_REACT=' + noReact +
          ' FAIL=' + failed + ' JS_ERR=' + jsErr +
          ' SKIP=' + skipped);

        if (noReact > 0 || failed > 0 || jsErr > 0) {
          var issues = results.filter(function (r) {
            return r.status !== 'OK' && r.status !== 'SKIPPED_DANGEROUS';
          });
          console.log('[P2] ' + route + ' issues: ' + JSON.stringify(issues));
          await page.screenshot({ path: 'test-results/p2-buttons' + slug(route) + '.png' });
        }
      });
    })(ALL_ROUTES[i]);
  }
});


// ═══════════════════════════════════════════════════════
// ЧАСТЬ 3: 14 РОЛЕЙ — ДОСТУП К СТРАНИЦАМ
// ═══════════════════════════════════════════════════════

test.describe('PART 3: Role access', function () {
  for (var r = 0; r < ROLES.length; r++) {
    (function (roleObj) {
      test.describe('Role: ' + roleObj.role, function () {
        for (var i = 0; i < ALL_ROUTES.length; i++) {
          (function (route) {
            test(route, async function ({ page }) {
              test.setTimeout(90000);

              var jsErrors = [];
              page.on('pageerror', function (e) { jsErrors.push(e.message); });

              await loginWithRetry(page, {
                id: roleObj.id,
                role: roleObj.role,
                login: roleObj.login,
              });
              await page.goto('/#' + route, GO);
              await page.waitForTimeout(ROLE_PAGE_WAIT);

              var finalUrl = page.url();
              var text = await page.evaluate(function () {
                return document.body ? document.body.innerText : '';
              });
              var bodyLen = text.length;

              // Проверяем ролевые ограничения
              var accessDenied = false;
              try {
                accessDenied = await page.locator(
                  'text=/Доступ запрещён|Нет доступа|403|Forbidden|Недостаточно прав/i'
                ).first().isVisible({ timeout: 500 });
              } catch (e) { /* нет */ }

              var errorVisible = false;
              try {
                errorVisible = await page.locator(
                  'text=/Ошибка загрузки|Не удалось загрузить|Error 500|Internal Server Error/i'
                ).first().isVisible({ timeout: 500 });
              } catch (e) { /* нет */ }

              var status = 'OK';
              if (finalUrl.includes('/welcome') || finalUrl.includes('/login')) status = 'REDIRECT_AUTH';
              else if (accessDenied) status = 'ACCESS_DENIED';
              else if (bodyLen < 10) status = 'EMPTY';
              else if (errorVisible) status = 'UI_ERROR';
              else if (jsErrors.length > 0) status = 'JS_ERROR';

              console.log('[P3][' + roleObj.role + '] ' + route + ' → ' + status +
                ' (len=' + bodyLen + ')' +
                (jsErrors.length ? ' JS: ' + jsErrors[0].substring(0, 80) : ''));
            });
          })(ALL_ROUTES[i]);
        }
      });
    })(ROLES[r]);
  }
});


// ═══════════════════════════════════════════════════════
// ЧАСТЬ 4: МОБИЛКА vs ДЕСКТОП — СРАВНЕНИЕ МАРШРУТОВ
// ═══════════════════════════════════════════════════════

test.describe('PART 4: Mobile vs Desktop routes', function () {
  test('route comparison', async function () {
    var mobileSet = {};
    ALL_ROUTES.forEach(function (r) { mobileSet[r] = true; });

    var desktopSet = {};
    DESKTOP_ROUTES.forEach(function (r) { desktopSet[r] = true; });

    var allRoutes = {};
    ALL_ROUTES.forEach(function (r) { allRoutes[r] = true; });
    DESKTOP_ROUTES.forEach(function (r) { allRoutes[r] = true; });

    var both = [];
    var desktopOnly = [];
    var mobileOnly = [];

    Object.keys(allRoutes).sort().forEach(function (r) {
      var inD = !!desktopSet[r];
      var inM = !!mobileSet[r];
      if (inD && inM) both.push(r);
      else if (inD) desktopOnly.push(r);
      else mobileOnly.push(r);
    });

    console.log('\n[P4] ═══ MOBILE vs DESKTOP ═══');
    console.log('[P4] Desktop routes: ' + DESKTOP_ROUTES.length);
    console.log('[P4] Mobile routes: ' + ALL_ROUTES.length);
    console.log('[P4] Both: ' + both.length);
    console.log('[P4] Desktop only (not ported): ' + desktopOnly.length);
    console.log('[P4] Mobile only: ' + mobileOnly.length);

    console.log('\n[P4] === BOTH (' + both.length + ') ===');
    both.forEach(function (r) { console.log('[P4]   ' + r); });

    console.log('\n[P4] === DESKTOP ONLY (' + desktopOnly.length + ') ===');
    desktopOnly.forEach(function (r) { console.log('[P4]   ' + r); });

    console.log('\n[P4] === MOBILE ONLY (' + mobileOnly.length + ') ===');
    mobileOnly.forEach(function (r) { console.log('[P4]   ' + r); });
  });
});


// ═══════════════════════════════════════════════════════
// ЧАСТЬ 5: ДАННЫЕ — СРАВНЕНИЕ API И МОБИЛКИ
// ═══════════════════════════════════════════════════════

test.describe('PART 5: Data accuracy', function () {
  var DATA_CHECKS = [
    { route: '/pm-works', api: '/api/works', label: 'Works' },
    { route: '/tenders', api: '/api/tenders', label: 'Tenders' },
    { route: '/personnel', api: '/api/employees', label: 'Employees' },
    { route: '/cash', api: '/api/cash', label: 'Cash' },
    { route: '/tasks', api: '/api/tasks', label: 'Tasks' },
    { route: '/invoices', api: '/api/invoices', label: 'Invoices' },
    { route: '/customers', api: '/api/customers', label: 'Customers' },
    { route: '/contracts', api: '/api/contracts', label: 'Contracts' },
  ];

  for (var i = 0; i < DATA_CHECKS.length; i++) {
    (function (check) {
      test('data: ' + check.label, async function ({ page }) {
        test.setTimeout(90000);

        await loginByToken(page, { id: 1, role: 'ADMIN', login: 'admin' });

        var jsErrors = [];
        page.on('pageerror', function (e) { jsErrors.push(e.message); });

        // Запросить API напрямую (с таймаутом 20с)
        var apiResult = await page.evaluate(async function (apiPath) {
          try {
            var token = localStorage.getItem('auth_token');
            var controller = new AbortController();
            var tid = setTimeout(function () { controller.abort(); }, 20000);
            var resp = await fetch(apiPath, {
              headers: { 'Authorization': 'Bearer ' + token },
              signal: controller.signal,
            });
            clearTimeout(tid);
            if (!resp.ok) return { error: 'HTTP ' + resp.status, count: -1 };
            var text = await resp.text();
            try {
              var data = JSON.parse(text);
              var count = -1;
              if (Array.isArray(data)) count = data.length;
              else if (data && data.rows) count = data.rows.length;
              else if (data && data.data) count = data.data.length;
              else if (data && typeof data.total === 'number') count = data.total;
              return { count: count, keys: Object.keys(data).join(',') };
            } catch (pe) {
              return { error: 'JSON parse failed', raw: text.substring(0, 100), count: -1 };
            }
          } catch (e) {
            return { error: e.name === 'AbortError' ? 'TIMEOUT_20s' : e.message, count: -1 };
          }
        }, check.api);

        // Открыть страницу
        await page.goto('/#' + check.route, GO);
        await page.waitForTimeout(6000);

        var mobileText = await page.evaluate(function () {
          return document.body ? document.body.innerText.substring(0, 500) : '';
        });

        // Попробовать найти счётчик/бейдж на странице
        var badgeText = '';
        try {
          var badge = page.locator('.m-badge, [class*="count"], [class*="total"], [class*="badge"]').first();
          if (await badge.isVisible({ timeout: 500 })) {
            badgeText = await badge.innerText();
          }
        } catch (e) { /* нет бейджа */ }

        // Проверить пустоту
        var emptyVisible = false;
        try {
          emptyVisible = await page.locator(
            'text=/Нет данных|Пусто|Ничего не найдено|No data/i'
          ).first().isVisible({ timeout: 500 });
        } catch (e) { /* нет */ }

        var apiCount = apiResult.count;
        var status = 'OK';
        if (apiResult.error) status = 'API_ERROR: ' + apiResult.error;
        else if (apiCount > 0 && emptyVisible) status = 'BUG: API has data but mobile shows empty';
        else if (apiCount === 0 && !emptyVisible) status = 'OK (both empty or API format differs)';

        if (status !== 'OK') {
          await page.screenshot({ path: 'test-results/p5-data-' + check.label + '.png' });
        }

        console.log('[P5] ' + check.label +
          ': API=' + apiCount + ' (' + (apiResult.keys || apiResult.error || '') + ')' +
          ' badge="' + badgeText + '"' +
          ' empty=' + emptyVisible +
          ' → ' + status);

        if (jsErrors.length) {
          console.log('[P5] ' + check.label + ' JS errors: ' + jsErrors.join('; ').substring(0, 200));
        }
      });
    })(DATA_CHECKS[i]);
  }
});


// ═══════════════════════════════════════════════════════
// ЧАСТЬ 6: МОДАЛКИ СОЗДАНИЯ (открыть и закрыть, НЕ сохранять)
// ═══════════════════════════════════════════════════════

test.describe('PART 6: Creation modals', function () {
  var MODALS = [
    { route: '/messenger', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Messenger new chat' },
    { route: '/tasks', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Tasks new task' },
    { route: '/cash', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Cash new request' },
    { route: '/tenders', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Tenders new' },
    { route: '/pm-works', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Works new' },
    { route: '/meetings', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Meetings new' },
    { route: '/pass-requests', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Pass request new' },
    { route: '/correspondence', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Correspondence new' },
    { route: '/tmc-requests', trigger: 'button:has-text("+"), [class*="fab"]', label: 'TMC request new' },
    { route: '/proc-requests', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Proc request new' },
    { route: '/hr-requests', trigger: 'button:has-text("+"), [class*="fab"]', label: 'HR request new' },
    { route: '/travel', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Travel new' },
    { route: '/alerts', trigger: 'button:has-text("+"), [class*="fab"]', label: 'Alerts new' },
  ];

  for (var i = 0; i < MODALS.length; i++) {
    (function (modal) {
      test('modal: ' + modal.label, async function ({ page }) {
        test.setTimeout(90000);

        await loginByToken(page, { id: 1, role: 'ADMIN', login: 'admin' });

        var jsErrors = [];
        page.on('pageerror', function (e) { jsErrors.push(e.message); });

        await page.goto('/#' + modal.route, GO);
        await page.waitForTimeout(PAGE_WAIT);

        // Найти триггер (кнопку +/FAB)
        var triggers = modal.trigger.split(', ');
        var triggerEl = null;
        for (var t = 0; t < triggers.length; t++) {
          try {
            var el = page.locator(triggers[t]).first();
            if (await el.isVisible({ timeout: 1000 })) {
              triggerEl = el;
              break;
            }
          } catch (e) { /* след. селектор */ }
        }

        if (!triggerEl) {
          console.log('[P6] ' + modal.label + ' → NO_TRIGGER (кнопка + не найдена на ' + modal.route + ')');
          await page.screenshot({ path: 'test-results/p6-' + modal.label.replace(/\s+/g, '-') + '-no-trigger.png' });
          return;
        }

        await triggerEl.click({ timeout: 3000 });
        await page.waitForTimeout(1500);

        // Проверить что модалка/sheet открылись
        var sheetVisible = false;
        try {
          sheetVisible = await page.locator(
            '.asgard-sheet, .m-bottom-sheet, .m-dialog, [class*="modal"]:not([style*="display: none"])'
          ).first().isVisible({ timeout: 1000 });
        } catch (e) { /* нет */ }

        // Или URL изменился (перешли на страницу создания)
        var urlChanged = !page.url().includes(modal.route.split('/').pop());

        if (!sheetVisible && !urlChanged) {
          console.log('[P6] ' + modal.label + ' → MODAL_NOT_OPENED');
          await page.screenshot({ path: 'test-results/p6-' + modal.label.replace(/\s+/g, '-') + '-no-modal.png' });
          return;
        }

        // Проверить inputs не выходят за экран (iPhone 14 width = 390)
        var inputs = await page.locator('input, textarea, select').all();
        var overflows = [];
        for (var idx = 0; idx < inputs.length; idx++) {
          try {
            if (await inputs[idx].isVisible()) {
              var box = await inputs[idx].boundingBox();
              if (box && (box.x + box.width > 395 || box.x < -5)) {
                var inputName = await inputs[idx].getAttribute('name') ||
                  await inputs[idx].getAttribute('placeholder') || 'input-' + idx;
                overflows.push(inputName + ' (x=' + Math.round(box.x) + ' w=' + Math.round(box.width) + ')');
              }
            }
          } catch (e) { /* элемент исчез */ }
        }

        // Проверить наличие полей ввода
        var visibleInputs = 0;
        for (var idx2 = 0; idx2 < inputs.length; idx2++) {
          try {
            if (await inputs[idx2].isVisible()) visibleInputs++;
          } catch (e) { /* */ }
        }

        var status = 'OK';
        if (overflows.length > 0) status = 'OVERFLOW';

        if (status !== 'OK' || jsErrors.length > 0) {
          await page.screenshot({ path: 'test-results/p6-' + modal.label.replace(/\s+/g, '-') + '.png' });
        }

        console.log('[P6] ' + modal.label + ' → ' + status +
          ' inputs=' + visibleInputs +
          (overflows.length ? ' OVERFLOWS: ' + overflows.join(', ') : '') +
          (jsErrors.length ? ' JS: ' + jsErrors.join('; ').substring(0, 100) : ''));

        // Закрыть модалку (НЕ нажимать Сохранить!)
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        try {
          var overlayEl = page.locator('.asgard-sheet-overlay, .m-bottom-sheet-overlay').first();
          if (await overlayEl.isVisible({ timeout: 300 })) {
            await overlayEl.click({ force: true });
          }
        } catch (e) { /* ок */ }
      });
    })(MODALS[i]);
  }
});


// ═══════════════════════════════════════════════════════
// SUMMARY — выводит итоговую строку после всех тестов
// ═══════════════════════════════════════════════════════

test('SUMMARY — parse results from log', async function () {
  // Этот тест-заглушка. Реальный отчёт формируется из вывода в консоль.
  // Парсинг: grep '\[P[1-6]\]' test-results/full-audit.log
  console.log('\n═══════════════════════════════════════════');
  console.log('ASGARD CRM — МОБИЛЬНЫЙ АУДИТ ЗАВЕРШЁН');
  console.log('Парсинг результатов:');
  console.log('  Часть 1: grep "\\[P1\\]" test-results/full-audit.log');
  console.log('  Часть 2: grep "\\[P2\\]" test-results/full-audit.log');
  console.log('  Часть 3: grep "\\[P3\\]" test-results/full-audit.log');
  console.log('  Часть 4: grep "\\[P4\\]" test-results/full-audit.log');
  console.log('  Часть 5: grep "\\[P5\\]" test-results/full-audit.log');
  console.log('  Часть 6: grep "\\[P6\\]" test-results/full-audit.log');
  console.log('═══════════════════════════════════════════\n');
});
