// @ts-nocheck
/**
 * ASGARD CRM — Ретест + Быстрый Part 3 (роли)
 * Запуск: npx playwright test tests/mobile/full-audit-retry.spec.js --project=mobile --reporter=list
 */

var { test, expect } = require('@playwright/test');
var { loginByToken, setupLocalAssets } = require('./auth.helper');

var GO = { waitUntil: 'domcontentloaded', timeout: 30000 };

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

// Страницы, упавшие в Part 1 (нужен ретест)
var FAILED_P1 = [
  '/home', '/more', '/settings', '/tasks',
  '/pre-tenders', '/funnel', '/pm-works', '/all-works',
  '/approval-payment', '/approvals',
  '/finances', '/invoices', '/acts', '/payroll',
  '/personnel', '/worker-profiles', '/workers-schedule',
];

// Ключевые страницы для Part 3 (доступ ролей)
var KEY_ROUTES = [
  '/home', '/tasks', '/tenders', '/pm-works', '/cash',
  '/finances', '/personnel', '/messenger', '/warehouse',
  '/more', '/customers', '/my-equipment', '/settings',
  '/invoices', '/hr-requests',
];

// Retry-обёртка для loginByToken
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
        e.message.includes('net::ERR_')
      );
      if (isConnectionError && attempt < maxRetries) {
        console.log('  [RETRY] attempt ' + attempt + '/' + maxRetries + ' failed: ' + e.message.substring(0, 60));
        await page.waitForTimeout(5000 * attempt); // прогрессивная задержка
        continue;
      }
      throw e;
    }
  }
}


// ═══════════════════════════════════════════════════════
// РЕТЕСТ: Упавшие страницы Part 1
// ═══════════════════════════════════════════════════════

test.describe('RETEST P1: Failed pages', function () {
  for (var i = 0; i < FAILED_P1.length; i++) {
    (function (route) {
      test('retest ' + route, async function ({ page }) {
        test.setTimeout(90000); // 90 сек вместо 60

        var jsErrors = [];
        page.on('pageerror', function (e) { jsErrors.push(e.message); });

        await loginWithRetry(page, { id: 1, role: 'ADMIN', login: 'admin' });
        await page.goto('/#' + route, GO);
        await page.waitForTimeout(6000); // больше времени на загрузку

        var finalUrl = page.url();
        var text = await page.evaluate(function () {
          return document.body ? document.body.innerText : '';
        });
        var bodyLen = text.length;

        var errorVisible = false;
        try {
          errorVisible = await page.locator(
            'text=/Ошибка загрузки|Не удалось загрузить|Error 500/i'
          ).first().isVisible({ timeout: 500 });
        } catch (e) { /* нет */ }

        var status = 'OK';
        if (finalUrl.includes('/welcome') || finalUrl.includes('/login')) status = 'REDIRECT_AUTH';
        else if (bodyLen < 10) status = 'EMPTY';
        else if (errorVisible) status = 'UI_ERROR';
        else if (jsErrors.length > 0) status = 'JS_ERROR';

        if (status !== 'OK') {
          try {
            await page.screenshot({ path: 'test-results/retest-p1' + route.replace(/\//g, '-') + '.png', timeout: 5000 });
          } catch (e) { /* скриншот таймаут */ }
        }

        console.log('[R1][ADMIN] ' + route + ' → ' + status +
          ' (len=' + bodyLen + ')' +
          (jsErrors.length ? ' JS: ' + jsErrors.join('; ').substring(0, 100) : ''));
      });
    })(FAILED_P1[i]);
  }
});


// ═══════════════════════════════════════════════════════
// ЧАСТЬ 3: РОЛИ × КЛЮЧЕВЫЕ СТРАНИЦЫ (14 × 15 = 210)
// ═══════════════════════════════════════════════════════

test.describe('PART 3: Role access — key pages', function () {
  for (var r = 0; r < ROLES.length; r++) {
    (function (roleObj) {
      test.describe('Role: ' + roleObj.role, function () {
        for (var i = 0; i < KEY_ROUTES.length; i++) {
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
              await page.waitForTimeout(3000);

              var finalUrl = page.url();
              var text = await page.evaluate(function () {
                return document.body ? document.body.innerText : '';
              });
              var bodyLen = text.length;

              var errorVisible = false;
              try {
                errorVisible = await page.locator(
                  'text=/Ошибка загрузки|Не удалось|Доступ запрещён|Нет доступа|403|Forbidden/i'
                ).first().isVisible({ timeout: 500 });
              } catch (e) { /* нет */ }

              var status = 'OK';
              if (finalUrl.includes('/welcome') || finalUrl.includes('/login')) status = 'REDIRECT_AUTH';
              else if (bodyLen < 10) status = 'EMPTY';
              else if (errorVisible) status = 'ACCESS_DENIED';
              else if (jsErrors.length > 0) status = 'JS_ERROR';

              console.log('[P3][' + roleObj.role + '] ' + route + ' → ' + status +
                ' (len=' + bodyLen + ')' +
                (jsErrors.length ? ' JS: ' + jsErrors[0].substring(0, 60) : ''));
            });
          })(KEY_ROUTES[i]);
        }
      });
    })(ROLES[r]);
  }
});


// ═══════════════════════════════════════════════════════
// ЧАСТЬ 2 LIGHT: Кнопки на 10 ключевых страницах
// ═══════════════════════════════════════════════════════

var BTN_PAGES = [
  '/home', '/messenger', '/tasks', '/tenders', '/pm-works',
  '/more', '/personnel', '/cash', '/worker-profiles', '/meetings',
];

var DANGEROUS_BTN_RE = /Создать|Сохранить|Отправить|Удалить|Подтвердить|Оплатить|Согласовать|Отклонить|Архив/i;

test.describe('PART 2 LIGHT: Buttons on key pages', function () {
  for (var i = 0; i < BTN_PAGES.length; i++) {
    (function (route) {
      test('buttons on ' + route, async function ({ page }) {
        test.setTimeout(180000);

        await loginWithRetry(page, { id: 1, role: 'ADMIN', login: 'admin' });

        var jsErrors = [];
        page.on('pageerror', function (e) { jsErrors.push(e.message); });

        await page.goto('/#' + route, GO);
        await page.waitForTimeout(5000);

        var buttons = await page.locator(
          'button, [role="button"], a[href]:not([href^="tel:"]):not([href^="mailto:"]), [onclick]'
        ).all();
        var totalFound = buttons.length;
        var results = [];

        for (var j = 0; j < Math.min(buttons.length, 25); j++) {
          var btn = buttons[j];
          var isVisible = false;
          try { isVisible = await btn.isVisible(); } catch (e) { continue; }
          if (!isVisible) continue;

          var btnText = '';
          try { btnText = (await btn.innerText()).trim().substring(0, 50); } catch (e) { btnText = '?'; }
          if (!btnText || btnText === '?') {
            try { btnText = (await btn.getAttribute('aria-label')) || '(no-text)'; } catch (e) { btnText = '(no-text)'; }
          }

          if (DANGEROUS_BTN_RE.test(btnText)) {
            results.push({ text: btnText, status: 'SKIP' });
            continue;
          }

          var urlBefore = page.url();
          var jsErrBefore = jsErrors.length;

          try {
            await btn.click({ timeout: 3000 });
            await page.waitForTimeout(1000);
          } catch (e) {
            results.push({ text: btnText, status: 'CLICK_FAIL' });
            continue;
          }

          var urlAfter = page.url();
          var newJsErr = jsErrors.length - jsErrBefore;

          var modalVisible = false;
          try {
            modalVisible = await page.locator(
              '.asgard-sheet, .m-bottom-sheet, .m-dialog, [class*="modal"]'
            ).first().isVisible({ timeout: 500 });
          } catch (e) { /* нет */ }

          var btnStatus = 'OK';
          if (newJsErr > 0) btnStatus = 'JS_ERR';
          else if (urlAfter !== urlBefore || modalVisible) btnStatus = 'OK';
          else btnStatus = 'NO_REACT';

          results.push({ text: btnText, status: btnStatus });

          if (urlAfter !== urlBefore) {
            await page.goto('/#' + route, GO);
            await page.waitForTimeout(2000);
            buttons = await page.locator(
              'button, [role="button"], a[href]:not([href^="tel:"]):not([href^="mailto:"]), [onclick]'
            ).all();
          }
          if (modalVisible) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
          }
        }

        var ok = results.filter(function (r) { return r.status === 'OK'; }).length;
        var noReact = results.filter(function (r) { return r.status === 'NO_REACT'; }).length;
        var failed = results.filter(function (r) { return r.status === 'CLICK_FAIL'; }).length;
        var jsErr = results.filter(function (r) { return r.status === 'JS_ERR'; }).length;

        console.log('[P2] ' + route + ': found=' + totalFound +
          ' tested=' + results.length +
          ' OK=' + ok + ' NO_REACT=' + noReact +
          ' FAIL=' + failed + ' JS_ERR=' + jsErr);

        if (noReact > 0 || failed > 0 || jsErr > 0) {
          var issues = results.filter(function (r) { return r.status !== 'OK' && r.status !== 'SKIP'; });
          console.log('[P2] ' + route + ' issues: ' + JSON.stringify(issues));
        }
      });
    })(BTN_PAGES[i]);
  }
});
