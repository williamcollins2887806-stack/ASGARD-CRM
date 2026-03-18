const { test } = require('@playwright/test');
const { loginByToken } = require('./auth.helper');

const GO = { waitUntil: 'domcontentloaded', timeout: 30000 };

const ALL_ROUTES = [
  '/home', '/my-dashboard', '/more', '/profile', '/settings',
  '/tasks', '/tasks-admin', '/tenders', '/pre-tenders', '/funnel',
  '/pm-works', '/all-works', '/all-estimates', '/pm-calcs',
  '/cash', '/cash-admin', '/approval-payment', '/approvals',
  '/finances', '/invoices', '/acts', '/payroll',
  '/personnel', '/worker-profiles', '/workers-schedule', '/hr-requests',
  '/customers', '/contracts', '/warehouse', '/my-equipment',
  '/tmc-requests', '/proc-requests', '/messenger', '/meetings',
  '/alerts', '/correspondence', '/my-mail', '/office-expenses',
  '/pass-requests', '/permits', '/seals', '/proxies',
  '/telegram', '/integrations', '/diag', '/mimir', '/mimir-page',
  '/gantt', '/training', '/travel'
];

test('CSS alignment audit — all 50 pages', async ({ page }) => {
  test.setTimeout(600000);
  await loginByToken(page, { id: 1, role: 'ADMIN', login: 'admin' });

  var allIssues = [];

  for (var i = 0; i < ALL_ROUTES.length; i++) {
    var route = ALL_ROUTES[i];
    try {
      await page.goto('/#' + route, GO);
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log('[CSS] ' + route + ' — SKIP (timeout)');
      continue;
    }

    var issues = await page.evaluate(function(currentRoute) {
      var problems = [];
      var screenW = window.innerWidth;

      // 1. Элементы выходящие за экран (overflow)
      document.querySelectorAll('input, textarea, select, button, div, span, table, img').forEach(function(el) {
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (getComputedStyle(el).display === 'none') return;
        if (rect.right > screenW + 5 || rect.left < -5) {
          problems.push({
            type: 'OVERFLOW',
            route: currentRoute,
            tag: el.tagName,
            className: (el.className || '').substring(0, 50),
            text: (el.innerText || el.placeholder || '').substring(0, 30),
            rect: { x: Math.round(rect.x), w: Math.round(rect.width), right: Math.round(rect.right) },
            screenW: screenW,
          });
        }
      });

      // 2. Текст обрезанный без ellipsis
      document.querySelectorAll('div, span, p, td, th').forEach(function(el) {
        var style = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 5 &&
            style.overflow !== 'hidden' &&
            style.textOverflow !== 'ellipsis' &&
            el.innerText.length > 20) {
          problems.push({
            type: 'TEXT_OVERFLOW',
            route: currentRoute,
            text: el.innerText.substring(0, 40),
            scrollW: el.scrollWidth,
            clientW: el.clientWidth,
          });
        }
      });

      // 3. Ассиметричный padding в карточках/шитах
      document.querySelectorAll('[class*="sheet"], [class*="card"], [class*="Card"]').forEach(function(el) {
        var style = getComputedStyle(el);
        var pl = parseInt(style.paddingLeft);
        var pr = parseInt(style.paddingRight);
        if (Math.abs(pl - pr) > 4 && pl > 0) {
          problems.push({
            type: 'ASYMMETRIC_PADDING',
            route: currentRoute,
            className: (el.className || '').substring(0, 50),
            paddingLeft: pl,
            paddingRight: pr,
          });
        }
      });

      // 4. Кнопки без центрирования
      document.querySelectorAll('button, [role="button"]').forEach(function(el) {
        var style = getComputedStyle(el);
        if ((style.display === 'flex' || style.display === 'inline-flex') &&
            style.justifyContent !== 'center' && style.alignItems !== 'center') {
          if (el.offsetWidth > 40 && el.offsetHeight > 30) {
            problems.push({
              type: 'BUTTON_NOT_CENTERED',
              route: currentRoute,
              text: (el.innerText || '').substring(0, 30),
            });
          }
        }
      });

      // 5. Input/select шире родителя
      document.querySelectorAll('input, textarea, select').forEach(function(el) {
        var rect = el.getBoundingClientRect();
        var parentRect = el.parentElement ? el.parentElement.getBoundingClientRect() : null;
        if (parentRect && rect.width > parentRect.width + 5 && rect.width > 50) {
          problems.push({
            type: 'INPUT_OVERFLOW',
            route: currentRoute,
            tag: el.tagName,
            inputW: Math.round(rect.width),
            parentW: Math.round(parentRect.width),
          });
        }
      });

      return problems;
    }, route);

    if (issues.length > 0) {
      allIssues = allIssues.concat(issues);
      issues.forEach(function(issue) {
        console.log('[CSS] ' + issue.type + ' on ' + route + ': ' + JSON.stringify(issue));
      });
    } else {
      console.log('[CSS] ' + route + ' — CLEAN');
    }
  }

  // Итоговый отчёт
  console.log('\n═══ CSS AUDIT SUMMARY ═══');
  console.log('Total issues: ' + allIssues.length);

  var byType = {};
  allIssues.forEach(function(issue) {
    byType[issue.type] = (byType[issue.type] || 0) + 1;
  });
  Object.keys(byType).forEach(function(type) {
    console.log('  ' + type + ': ' + byType[type]);
  });

  var byRoute = {};
  allIssues.forEach(function(issue) {
    byRoute[issue.route] = (byRoute[issue.route] || 0) + 1;
  });
  console.log('\nBy route:');
  Object.keys(byRoute).sort(function(a, b) { return byRoute[b] - byRoute[a]; }).forEach(function(route) {
    console.log('  ' + route + ': ' + byRoute[route]);
  });

  // Сохранить JSON для анализа
  require('fs').writeFileSync(
    'audit-logs/css-audit-results.json',
    JSON.stringify({ total: allIssues.length, byType: byType, byRoute: byRoute, issues: allIssues }, null, 2)
  );
  console.log('\nSaved: audit-logs/css-audit-results.json');
});
