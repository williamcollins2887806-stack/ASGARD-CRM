const { test } = require('@playwright/test');
const { loginByToken } = require('./auth.helper');
const fs = require('fs');
const path = require('path');

const BASE_DIR = 'C:/Users/Nikita-ASGARD/ASGARD-CRM/visual-audit';
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

var MODAL_PAGES = [
  { route: '/tasks', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/tenders', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/pm-works', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/meetings', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/pass-requests', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/correspondence', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/tmc-requests', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/proc-requests', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/hr-requests', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/travel', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/alerts', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/messenger', fabSelector: '.asgard-fab', modalWait: 2000 },
  { route: '/cash', fabSelector: '.asgard-fab', modalWait: 2000 },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function slug(route) {
  return route.replace(/^\//, '').replace(/\//g, '-') || 'root';
}

// Снять actionTimeout для этого файла (конфиг ставит 15s — мало для скриншотов)
test.use({ actionTimeout: 30000 });

// Надёжный скриншот — viewport, 30s таймаут
async function snap(page, filePath) {
  await page.screenshot({ path: filePath, timeout: 30000 });
}

// Установить тему в localStorage перед навигацией
async function setTheme(page, theme) {
  await page.evaluate(function (t) {
    try {
      var state = JSON.parse(localStorage.getItem('asgard_mobile_state') || '{}');
      state.theme = t;
      localStorage.setItem('asgard_mobile_state', JSON.stringify(state));
    } catch (e) {}
  }, theme);
}

// ═══ ТЕСТ 1: ВСЕ СТРАНИЦЫ — СВЕТЛАЯ ТЕМА ═══
test('Visual audit — light theme — all pages', async ({ page }) => {
  test.setTimeout(900000);
  var dir = path.join(BASE_DIR, 'light', 'pages');
  ensureDir(dir);

  await loginByToken(page, { id: 1, role: 'ADMIN', login: 'admin' });
  await setTheme(page, 'light');

  var ok = 0, fail = 0;
  for (var i = 0; i < ALL_ROUTES.length; i++) {
    var route = ALL_ROUTES[i];
    try {
      await page.goto('/#' + route, GO);
      await page.waitForTimeout(2000);
      await snap(page, path.join(dir, slug(route) + '.png'));
      ok++;
      console.log('[LIGHT] ' + route + ' — OK');
    } catch (e) {
      fail++;
      console.log('[LIGHT] ' + route + ' — FAIL: ' + e.message.substring(0, 80));
    }
  }
  console.log('[LIGHT] Done: ' + ok + ' OK, ' + fail + ' FAIL');
});

// ═══ ТЕСТ 2: ВСЕ СТРАНИЦЫ — ТЁМНАЯ ТЕМА ═══
test('Visual audit — dark theme — all pages', async ({ page }) => {
  test.setTimeout(900000);
  var dir = path.join(BASE_DIR, 'dark', 'pages');
  ensureDir(dir);

  await loginByToken(page, { id: 1, role: 'ADMIN', login: 'admin' });
  // loginByToken ставит dark, ничего менять не надо

  var ok = 0, fail = 0;
  for (var i = 0; i < ALL_ROUTES.length; i++) {
    var route = ALL_ROUTES[i];
    try {
      await page.goto('/#' + route, GO);
      await page.waitForTimeout(2000);
      await snap(page, path.join(dir, slug(route) + '.png'));
      ok++;
      console.log('[DARK] ' + route + ' — OK');
    } catch (e) {
      fail++;
      console.log('[DARK] ' + route + ' — FAIL: ' + e.message.substring(0, 80));
    }
  }
  console.log('[DARK] Done: ' + ok + ' OK, ' + fail + ' FAIL');
});

// ═══ ТЕСТ 3: МОДАЛКИ ═══
test('Visual audit — modals', async ({ page }) => {
  test.setTimeout(600000);
  var dir = path.join(BASE_DIR, 'light', 'modals');
  ensureDir(dir);

  await loginByToken(page, { id: 1, role: 'ADMIN', login: 'admin' });
  await setTheme(page, 'light');

  var ok = 0, fail = 0;
  for (var i = 0; i < MODAL_PAGES.length; i++) {
    var mp = MODAL_PAGES[i];
    try {
      await page.goto('/#' + mp.route, GO);
      await page.waitForTimeout(2000);

      var fab = page.locator(mp.fabSelector).first();
      if (await fab.isVisible({ timeout: 3000 })) {
        await fab.click();
        await page.waitForTimeout(mp.modalWait);
        await snap(page, path.join(dir, slug(mp.route) + '-create.png'));
        ok++;
        console.log('[MODAL] ' + mp.route + ' — OK');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } else {
        console.log('[MODAL] ' + mp.route + ' — FAB NOT VISIBLE');
        fail++;
      }
    } catch (e) {
      fail++;
      console.log('[MODAL] ' + mp.route + ' — FAIL: ' + e.message.substring(0, 80));
    }
  }
  console.log('[MODAL] Done: ' + ok + ' OK, ' + fail + ' FAIL');
});

// ═══ ТЕСТ 4: ПРОВЕРКА БАГОВ B1-B5 ═══
test('Visual audit — bug verification B1-B5', async ({ page }) => {
  test.setTimeout(300000);
  var dir = path.join(BASE_DIR, 'bugs');
  ensureDir(dir);

  await loginByToken(page, { id: 1, role: 'ADMIN', login: 'admin' });

  // B1: /my-mail — табы
  console.log('\n═══ B1: /my-mail tabs ═══');
  await page.goto('/#/my-mail', GO);
  await page.waitForTimeout(3000);
  await snap(page, path.join(dir, 'B1-my-mail-full.png'));
  var mailTabs = ['Входящие', 'Отправленные', 'Черновики'];
  for (var t = 0; t < mailTabs.length; t++) {
    try {
      var tab = page.locator('text=' + mailTabs[t]).first();
      var visible = await tab.isVisible({ timeout: 2000 });
      if (visible) {
        var box = await tab.boundingBox();
        console.log('[B1] Tab "' + mailTabs[t] + '": visible=' + visible +
          ', box=' + JSON.stringify(box));
        await tab.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
        await snap(page, path.join(dir, 'B1-my-mail-tab-' + t + '.png'));
        console.log('[B1] Tab "' + mailTabs[t] + '" clicked OK');
      } else {
        console.log('[B1] Tab "' + mailTabs[t] + '" NOT VISIBLE');
      }
    } catch (e) {
      console.log('[B1] Tab "' + mailTabs[t] + '" CLICK FAILED: ' + e.message.substring(0, 80));
      try { await snap(page, path.join(dir, 'B1-my-mail-tab-' + t + '-fail.png')); } catch (e2) {}
    }
  }

  // B2: /profile — кнопки
  console.log('\n═══ B2: /profile buttons ═══');
  await page.goto('/#/profile', GO);
  await page.waitForTimeout(3000);
  await snap(page, path.join(dir, 'B2-profile-full.png'));
  var profileBtns = await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll('button'));
    return btns.map(function (b) {
      var rect = b.getBoundingClientRect();
      return {
        text: (b.innerText || '').substring(0, 30),
        visible: rect.width > 0 && rect.height > 0,
        y: Math.round(rect.y),
        h: Math.round(rect.height),
        inViewport: rect.y < window.innerHeight && rect.bottom > 0,
      };
    });
  });
  console.log('[B2] All buttons: ' + JSON.stringify(profileBtns, null, 2));
  await page.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
  await page.waitForTimeout(500);
  await snap(page, path.join(dir, 'B2-profile-scrolled.png'));

  // B3: /seals — кнопки Передать
  console.log('\n═══ B3: /seals transfer buttons ═══');
  await page.goto('/#/seals', GO);
  await page.waitForTimeout(3000);
  await snap(page, path.join(dir, 'B3-seals-full.png'));
  var transferBtns = await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll('button'));
    return btns.filter(function (b) {
      return b.innerText.includes('Передать');
    }).map(function (b) {
      var rect = b.getBoundingClientRect();
      return {
        text: b.innerText.substring(0, 30),
        visible: rect.width > 0 && rect.height > 0,
        clickable: getComputedStyle(b).pointerEvents !== 'none',
        zIndex: getComputedStyle(b).zIndex,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      };
    });
  });
  console.log('[B3] Transfer buttons: ' + JSON.stringify(transferBtns, null, 2));

  // B4: /cash — FAB
  console.log('\n═══ B4: /cash FAB ═══');
  await page.goto('/#/cash', GO);
  await page.waitForTimeout(3000);
  await snap(page, path.join(dir, 'B4-cash-full.png'));
  var cashFab = await page.evaluate(function () {
    var fab = document.querySelector('.asgard-fab');
    if (!fab) return { found: false };
    var rect = fab.getBoundingClientRect();
    return {
      found: true,
      text: fab.innerText,
      visible: rect.width > 0 && rect.height > 0,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      display: getComputedStyle(fab).display,
      opacity: getComputedStyle(fab).opacity,
    };
  });
  console.log('[B4] FAB: ' + JSON.stringify(cashFab, null, 2));

  // B5: /all-estimates — таб Отклонено
  console.log('\n═══ B5: /all-estimates rejected tab ═══');
  await page.goto('/#/all-estimates', GO);
  await page.waitForTimeout(3000);
  await snap(page, path.join(dir, 'B5-all-estimates-full.png'));
  try {
    var rejectedTab = page.locator('text=Отклонено').first();
    var rVisible = await rejectedTab.isVisible({ timeout: 2000 });
    if (rVisible) {
      var rBox = await rejectedTab.boundingBox();
      console.log('[B5] "Отклонено" tab: visible=' + rVisible + ', box=' + JSON.stringify(rBox));
      await rejectedTab.click({ timeout: 3000 });
      await page.waitForTimeout(1000);
      await snap(page, path.join(dir, 'B5-all-estimates-rejected-clicked.png'));
      console.log('[B5] "Отклонено" clicked OK');
    } else {
      console.log('[B5] "Отклонено" tab NOT VISIBLE');
    }
  } catch (e) {
    console.log('[B5] "Отклонено" CLICK FAILED: ' + e.message.substring(0, 80));
    try { await snap(page, path.join(dir, 'B5-all-estimates-fail.png')); } catch (e2) {}
  }
});

// ═══ ТЕСТ 5: iPhone SE (375px) — ТОП-15 СТРАНИЦ ═══
test('Visual audit — iPhone SE 375px', async ({ browser }) => {
  test.setTimeout(600000);
  var dir = path.join(BASE_DIR, 'se');
  ensureDir(dir);

  var context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  var page = await context.newPage();

  await loginByToken(page, { id: 1, role: 'ADMIN', login: 'admin' });

  var TOP_ROUTES = [
    '/home', '/my-dashboard', '/tasks', '/tenders', '/funnel',
    '/pm-works', '/cash', '/messenger', '/profile', '/my-mail',
    '/all-estimates', '/customers', '/proc-requests', '/seals', '/more'
  ];

  var ok = 0, fail = 0;
  for (var i = 0; i < TOP_ROUTES.length; i++) {
    var route = TOP_ROUTES[i];
    try {
      await page.goto('/#' + route, GO);
      await page.waitForTimeout(2000);
      await snap(page, path.join(dir, slug(route) + '.png'));
      ok++;
      console.log('[SE] ' + route + ' — OK');
    } catch (e) {
      fail++;
      console.log('[SE] ' + route + ' — FAIL');
    }
  }
  console.log('[SE] Done: ' + ok + ' OK, ' + fail + ' FAIL');

  await context.close();
});
