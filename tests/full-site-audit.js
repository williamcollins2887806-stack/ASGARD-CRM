/**
 * ASGARD CRM - Full Site E2E Audit
 * ==================================
 * Puppeteer script that logs in as admin, visits every route,
 * clicks every visible button, and records JS / HTTP errors.
 *
 * Usage:  node tests/full-site-audit.js
 * Output: tests/audit-report.json, tests/audit-report.txt,
 *         tests/audit-screenshots/<route>.png
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// --- Configuration -----------------------------------------------------------

const BASE_URL = 'http://localhost:3000';
const LOGIN_API = BASE_URL + '/api/auth/login';
const CREDENTIALS = { login: 'admin', password: 'admin123' };

const SCREENSHOT_DIR = path.resolve(__dirname, 'audit-screenshots');
const REPORT_JSON    = path.resolve(__dirname, 'audit-report.json');
const REPORT_TXT     = path.resolve(__dirname, 'audit-report.txt');

const PAGE_TIMEOUT = 10000;
const CLICK_DELAY  = 200;
const VIEWPORT     = { width: 1920, height: 1080 };

const SKIP_KEYWORDS = [
  '\u0432\u044b\u0439\u0442\u0438',
  '\u0443\u0434\u0430\u043b\u0438\u0442\u044c',
  '\u043e\u0447\u0438\u0441\u0442\u0438\u0442\u044c',
  '\u0441\u0431\u0440\u043e\u0441\u0438\u0442\u044c',
  'logout', 'delete', 'clear all', 'reset',
  'sign out', 'log out', 'remove all'
];

const ROUTES = [
  '/home', '/dashboard', '/my-dashboard', '/big-screen',
  '/calendar', '/birthdays', '/tasks', '/pre-tenders',
  '/funnel', '/tenders', '/customers', '/pm-calcs',
  '/calculator', '/approvals', '/bonus-approval', '/pm-works',
  '/all-works', '/all-estimates', '/gantt-calcs', '/gantt-works',
  '/tasks-admin', '/kanban', '/finances', '/invoices',
  '/acts', '/buh-registry', '/office-expenses', '/cash',
  '/cash-admin', '/payroll', '/self-employed', '/one-time-pay',
  '/tkp', '/pass-requests', '/tmc-requests', '/warehouse',
  '/my-equipment', '/correspondence', '/contracts', '/seals',
  '/proxies', '/proc-requests', '/personnel', '/hr-requests',
  '/permits', '/permit-applications', '/office-schedule',
  '/workers-schedule', '/hr-rating', '/travel', '/messenger',
  '/meetings', '/alerts', '/telegram', '/mango',
  '/analytics', '/user-requests', '/settings', '/backup',
  '/sync', '/diag', '/to-analytics', '/pm-analytics',
  '/engineer-dashboard', '/object-map', '/mailbox',
  '/mail-settings', '/integrations'
];

// --- Report data structure ---------------------------------------------------

const report = {
  startedAt: null,
  finishedAt: null,
  totalPages: 0,
  totalButtonsClicked: 0,
  totalJsErrors: 0,
  totalHttpErrors: 0,
  totalFailedClicks: 0,
  pages: []
};

// --- Helpers -----------------------------------------------------------------

function sanitize(route) {
  return route.replace(new RegExp('/', 'g'), '_').replace(/^_/, '') || 'root';
}

function ts() {
  return new Date().toISOString();
}

function shouldSkip(text) {
  var lower = (text || '').toLowerCase().trim();
  return SKIP_KEYWORDS.some(function(kw) { return lower.includes(kw); });
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

// --- Main --------------------------------------------------------------------

(async function() {
  report.startedAt = ts();
  console.log('[' + ts() + '] === ASGARD CRM Full-Site Audit ===');

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  var browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });

  var page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // -- Authenticate -----------------------------------------------------------
  console.log('[' + ts() + '] Logging in as ' + CREDENTIALS.login + ' ...');

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

  var authToken = null;
  var authUser  = null;

  try {
    var resp = await page.evaluate(async function(url, creds) {
      var r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds)
      });
      var body = await r.json();
      return { ok: r.ok, status: r.status, body: body };
    }, LOGIN_API, CREDENTIALS);

    if (!resp.ok) {
      console.error('Login failed with status ' + resp.status + ': ' + JSON.stringify(resp.body));
      process.exit(1);
    }

    authToken = resp.body.token
             || resp.body.accessToken
             || resp.body.access_token
             || (resp.body.data && (resp.body.data.token || resp.body.data.accessToken))
             || null;
    authUser  = resp.body.user
             || (resp.body.data && resp.body.data.user)
             || resp.body;

    // Handle PIN verification (2-step auth)
    if (resp.body.status === 'need_pin') {
      var userId = resp.body.user && resp.body.user.id;
      console.log('[' + ts() + '] PIN required for userId=' + userId + '. Verifying...');
      // First step returns a temporary token needed for PIN verification
      var tempToken = resp.body.token || (resp.body.data && resp.body.data.token) || null;
      var pinResp = await page.evaluate(async function(url, pin, token) {
        var r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ pin: pin })
        });
        var body = await r.json();
        return { ok: r.ok, status: r.status, body: body };
      }, BASE_URL + '/api/auth/verify-pin', '1488', tempToken);

      if (!pinResp.ok) {
        console.error('PIN verification failed: ' + JSON.stringify(pinResp.body));
        process.exit(1);
      }
      authToken = pinResp.body.token || (pinResp.body.data && pinResp.body.data.token) || null;
      authUser  = pinResp.body.user || (pinResp.body.data && pinResp.body.data.user) || resp.body.user;
      console.log('[' + ts() + '] PIN verified OK. Token received: ' + (!!authToken));
    } else {
      console.log('[' + ts() + '] Login OK (no PIN). Token received: ' + (!!authToken));
    }
  } catch (err) {
    console.error('Login request error: ' + err.message);
    process.exit(1);
  }

  await page.evaluate(function(token, user) {
    if (token) localStorage.setItem('asgard_token', typeof token === 'string' ? token : JSON.stringify(token));
    if (user)  localStorage.setItem('asgard_user',  typeof user  === 'string' ? user  : JSON.stringify(user));
  }, authToken, authUser);

  console.log('[' + ts() + '] localStorage tokens set. Starting route audit ...');

  // -- Per-route audit loop ---------------------------------------------------

  for (var i = 0; i < ROUTES.length; i++) {
    var route    = ROUTES[i];
    var routeUrl = BASE_URL + '/#' + route;
    var label    = '[' + (i + 1) + '/' + ROUTES.length + '] ' + route;

    var pageReport = {
      route: route,
      url: routeUrl,
      status: 'PASS',
      jsErrors: [],
      pageErrors: [],
      httpErrors: [],
      failedRequests: [],
      buttonsFound: 0,
      buttonsClicked: 0,
      buttonsSkipped: 0,
      failedClicks: [],
      screenshotFile: null
    };

    var consoleErrors = [];
    var pageErrors    = [];
    var httpErrors    = [];
    var failedReqs    = [];

    var onConsole = function(msg) {
      if (msg.type() === 'error') {
        consoleErrors.push({
          text: msg.text(),
          location: msg.location(),
          timestamp: ts()
        });
      }
    };
    var onPageError = function(err) {
      pageErrors.push({
        message: err.message,
        stack: err.stack,
        timestamp: ts()
      });
    };
    var onResponse = function(resp) {
      if (resp.status() >= 400) {
        httpErrors.push({
          url: resp.url(),
          status: resp.status(),
          statusText: resp.statusText(),
          timestamp: ts()
        });
      }
    };
    var onRequestFailed = function(req) {
      failedReqs.push({
        url: req.url(),
        method: req.method(),
        failure: (req.failure() && req.failure().errorText) || 'unknown',
        timestamp: ts()
      });
    };

    page.on('console',       onConsole);
    page.on('pageerror',     onPageError);
    page.on('response',      onResponse);
    page.on('requestfailed', onRequestFailed);

    try {
      console.log(label + '  navigating ...');
      try {
        await page.goto(routeUrl, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT });
      } catch (navErr) {
        console.log(label + '  networkidle0 timed out, waiting 3s fallback ...');
        await sleep(3000);
      }

      await sleep(1500);

      // Screenshot
      var ssFile = sanitize(route) + '.png';
      var ssPath = path.join(SCREENSHOT_DIR, ssFile);
      await page.screenshot({ path: ssPath, fullPage: false });
      pageReport.screenshotFile = ssFile;

      // Discover clickable elements
      var clickables = await page.evaluate(function() {
        var seen    = new Set();
        var results = [];
        var selectors = [
          'button', 'a', '[role=button]', '.btn',
          '[onclick]', 'input[type=button]', 'input[type=submit]'
        ];
        selectors.forEach(function(sel) {
          document.querySelectorAll(sel).forEach(function(el) {
            if (seen.has(el)) return;
            seen.add(el);
            var rect = el.getBoundingClientRect();
            var style = window.getComputedStyle(el);
            var visible = rect.width > 0 && rect.height > 0
                       && style.visibility !== 'hidden'
                       && style.display !== 'none';
            if (!visible) return;
            var text = (el.innerText || el.textContent || '').trim().substring(0, 120);
            var tag  = el.tagName.toLowerCase();
            var cls  = el.className ? String(el.className).substring(0, 200) : '';
            var id   = el.id || '';
            results.push({
              text: text, tag: tag, cls: cls, id: id,
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2
            });
          });
        });
        return results;
      });

      pageReport.buttonsFound = clickables.length;
      console.log(label + '  found ' + clickables.length + ' clickable elements');

      // Click each element
      var maxClicks = Math.min(clickables.length, 100);
      if (clickables.length > 100) {
        console.log(label + '  limiting to 100 clicks (of ' + clickables.length + ')');
      }
      for (var ci = 0; ci < maxClicks; ci++) {
        var btn = clickables[ci];

        if (shouldSkip(btn.text)) {
          pageReport.buttonsSkipped++;
          continue;
        }

        try {
          var clicked = await page.evaluate(function(b) {
            var el = document.elementFromPoint(b.x, b.y);
            if (el) {
              el.click();
              return true;
            }
            return false;
          }, btn);

          if (!clicked) {
            pageReport.failedClicks.push({
              element: { text: btn.text, tag: btn.tag, id: btn.id },
              reason: 'elementFromPoint returned null'
            });
            continue;
          }

          pageReport.buttonsClicked++;
          report.totalButtonsClicked++;

          await sleep(CLICK_DELAY);

          var currentUrl = page.url();
          if (currentUrl.indexOf('#' + route) === -1) {
            try {
              await page.goto(routeUrl, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT });
            } catch (_navBack) {
              await sleep(2000);
            }
            await sleep(500);
          }
        } catch (clickErr) {
          pageReport.failedClicks.push({
            element: { text: btn.text, tag: btn.tag, id: btn.id },
            reason: clickErr.message
          });
        }
      }

      // Close any open modals
      try {
        await page.evaluate(function() {
          document.querySelectorAll('.modal.show .close, .modal.show [data-dismiss=modal], [aria-label=Close]')
            .forEach(function(el) { el.click(); });
        });
      } catch (_modalErr) { /* ignore */ }

    } catch (routeErr) {
      pageReport.status = 'FAIL';
      pageReport.jsErrors.push({
        text: 'Route navigation/audit error: ' + routeErr.message,
        stack: routeErr.stack,
        timestamp: ts()
      });
    }

    page.off('console',       onConsole);
    page.off('pageerror',     onPageError);
    page.off('response',      onResponse);
    page.off('requestfailed', onRequestFailed);

    pageReport.jsErrors       = pageReport.jsErrors.concat(consoleErrors);
    pageReport.pageErrors     = pageReport.pageErrors.concat(pageErrors);
    pageReport.httpErrors     = pageReport.httpErrors.concat(httpErrors);
    pageReport.failedRequests = pageReport.failedRequests.concat(failedReqs);

    if (pageReport.pageErrors.length > 0 || pageReport.failedRequests.length > 0) {
      pageReport.status = 'FAIL';
    } else if (pageReport.jsErrors.length > 0) {
      pageReport.status = 'WARN';
    }

    report.pages.push(pageReport);
    report.totalPages++;
    report.totalJsErrors    += pageReport.jsErrors.length + pageReport.pageErrors.length;
    report.totalHttpErrors  += pageReport.httpErrors.length + pageReport.failedRequests.length;
    report.totalFailedClicks += pageReport.failedClicks.length;

    var statusLabel = pageReport.status === 'PASS' ? 'OK' : pageReport.status;
    console.log(
      label + '  ' + statusLabel +
      '  clicks=' + pageReport.buttonsClicked + '/' + pageReport.buttonsFound +
      ' jsErr=' + pageReport.jsErrors.length +
      ' httpErr=' + pageReport.httpErrors.length +
      ' pageErr=' + pageReport.pageErrors.length +
      ' failedReq=' + pageReport.failedRequests.length
    );
  }

  // -- Finalise and write reports ---------------------------------------------
  report.finishedAt = ts();
  await browser.close();

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf-8');
  console.log('\nJSON report saved to ' + REPORT_JSON);

  // Human-readable TXT report
  var rptLines = [];
  rptLines.push('================================================================================');
  rptLines.push('  ASGARD CRM - Full-Site E2E Audit Report');
  rptLines.push('================================================================================');
  rptLines.push('  Started : ' + report.startedAt);
  rptLines.push('  Finished: ' + report.finishedAt);
  rptLines.push('  Pages   : ' + report.totalPages);
  rptLines.push('  Buttons clicked  : ' + report.totalButtonsClicked);
  rptLines.push('  JS/console errors: ' + report.totalJsErrors);
  rptLines.push('  HTTP errors      : ' + report.totalHttpErrors);
  rptLines.push('  Failed clicks    : ' + report.totalFailedClicks);
  rptLines.push('================================================================================');
  rptLines.push('');

  rptLines.push('--------------------------------------------------------------------------------');
  rptLines.push('  PER-PAGE SUMMARY');
  rptLines.push('--------------------------------------------------------------------------------');
  rptLines.push('  ' + pad('ROUTE', 35) + ' ' + pad('STATUS', 8) + ' ' + pad('CLICKS', 10) + ' ' + pad('JS ERR', 10) + ' ' + pad('HTTP ERR', 10));
  rptLines.push('--------------------------------------------------------------------------------');

  for (var pi = 0; pi < report.pages.length; pi++) {
    var p = report.pages[pi];
    var clicksStr = p.buttonsClicked + '/' + p.buttonsFound;
    var jsErrCount = p.jsErrors.length + p.pageErrors.length;
    var httpErrCount = p.httpErrors.length + p.failedRequests.length;
    rptLines.push(
      '  ' + pad(p.route, 35) + ' ' +
      pad(p.status, 8) + ' ' +
      pad(clicksStr, 10) + ' ' +
      pad(String(jsErrCount), 10) + ' ' +
      pad(String(httpErrCount), 10)
    );
  }
  rptLines.push('');

  rptLines.push('--------------------------------------------------------------------------------');
  rptLines.push('  DETAILED ERRORS');
  rptLines.push('--------------------------------------------------------------------------------');

  for (var di = 0; di < report.pages.length; di++) {
    var dp = report.pages[di];
    var totalErr = dp.jsErrors.length + dp.pageErrors.length + dp.httpErrors.length
                 + dp.failedRequests.length + dp.failedClicks.length;
    if (totalErr === 0) continue;

    rptLines.push('');
    rptLines.push('  >> ' + dp.route);

    if (dp.jsErrors.length > 0) {
      rptLines.push('     [Console Errors]');
      for (var ei = 0; ei < dp.jsErrors.length; ei++) {
        var je = dp.jsErrors[ei];
        rptLines.push('       ' + (ei + 1) + '. ' + je.text);
        if (je.location && je.location.url) {
          rptLines.push('          at ' + je.location.url + ':' + je.location.lineNumber);
        }
      }
    }

    if (dp.pageErrors.length > 0) {
      rptLines.push('     [Uncaught Exceptions]');
      for (var pei = 0; pei < dp.pageErrors.length; pei++) {
        var pe = dp.pageErrors[pei];
        rptLines.push('       ' + (pei + 1) + '. ' + pe.message);
        if (pe.stack) {
          var stackArr = pe.stack.split('\n').slice(0, 4);
          for (var si = 0; si < stackArr.length; si++) {
            rptLines.push('          ' + stackArr[si].trim());
          }
        }
      }
    }

    if (dp.httpErrors.length > 0) {
      rptLines.push('     [HTTP Errors (status >= 400)]');
      for (var hi = 0; hi < dp.httpErrors.length; hi++) {
        var he = dp.httpErrors[hi];
        rptLines.push('       ' + (hi + 1) + '. ' + he.status + ' ' + he.statusText + ' -- ' + he.url);
      }
    }

    if (dp.failedRequests.length > 0) {
      rptLines.push('     [Failed Network Requests]');
      for (var fi = 0; fi < dp.failedRequests.length; fi++) {
        var fe = dp.failedRequests[fi];
        rptLines.push('       ' + (fi + 1) + '. ' + fe.method + ' ' + fe.url + ' -- ' + fe.failure);
      }
    }

    if (dp.failedClicks.length > 0) {
      rptLines.push('     [Failed Clicks]');
      for (var fci = 0; fci < dp.failedClicks.length; fci++) {
        var fc = dp.failedClicks[fci];
        var desc = fc.element ? (fc.element.text || fc.element.tag || 'unknown') : 'unknown';
        rptLines.push('       ' + (fci + 1) + '. ' + desc + ' -- ' + fc.reason);
      }
    }
  }

  rptLines.push('');
  rptLines.push('================================================================================');
  rptLines.push('  END OF REPORT');
  rptLines.push('================================================================================');

  var txtContent = rptLines.join('\n');
  fs.writeFileSync(REPORT_TXT, txtContent, 'utf-8');
  console.log('TXT report saved to ' + REPORT_TXT);

  var passed = report.pages.filter(function(p) { return p.status === 'PASS'; }).length;
  var warned = report.pages.filter(function(p) { return p.status === 'WARN'; }).length;
  var failed = report.pages.filter(function(p) { return p.status === 'FAIL'; }).length;
  console.log('\n============================================================');
  console.log('  AUDIT COMPLETE');
  console.log('  PASS: ' + passed + '   WARN: ' + warned + '   FAIL: ' + failed + '   TOTAL: ' + report.totalPages);
  console.log('============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
})();
