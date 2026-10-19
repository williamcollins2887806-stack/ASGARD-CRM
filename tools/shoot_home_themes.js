'use strict';
/**
 * Рендер главной («Зал Ярла», vanilla v1) в обеих темах.
 * Вход через API (клон :3100), затем localStorage + скриншот.
 *
 * Запуск: node tools/shoot_home_themes.js [--tag before]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'test_pm';
const PASS = process.env.TEST_PASS_A || 'Test123!';
const PIN = process.env.TEST_PIN || '0000';
const tagArg = process.argv.indexOf('--tag');
const TAG = tagArg > 0 ? process.argv[tagArg + 1] : 'shot';
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'home-theme');
fs.mkdirSync(OUT, { recursive: true });

async function apiLogin() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login: ' + JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    if (!res.ok) throw new Error('pin: ' + JSON.stringify(data));
  }
  return { token: data.token, user: data.user || {} };
}

async function main() {
  const { token, user } = await apiLogin();
  console.log('login ok:', user.login, user.role);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('auth_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
    for (const k of ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed']) {
      localStorage.setItem(k, '1');
    }
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1');
    }
  }, [token, user]);

  const shots = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      localStorage.setItem('asgard_theme', t);
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    // гасим возможные оверлеи/сплэши
    await page.evaluate(() => {
      document.querySelectorAll(
        '#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback,#sg-overlay,.ui-modal'
      ).forEach((el) => { el.style.setProperty('display', 'none', 'important'); });
    });
    // ждём, пока виджеты догрузят данные (иначе в кадре «Загрузка...»)
    await page.waitForFunction(
      () => !document.querySelector('.dash-widget-v2 .dw-body')?.textContent.includes('Загрузка'),
      { timeout: 20000 }
    ).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    const file = path.join(OUT, `home-${theme}-${TAG}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const info = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const w = document.querySelector('.dash-widget-v2');
      const main = document.querySelector('.main') || document.querySelector('.asg-main-wrap');
      return {
        theme: document.documentElement.dataset.theme,
        bg0: cs.getPropertyValue('--bg0').trim(),
        bg1: cs.getPropertyValue('--bg1').trim(),
        bg2: cs.getPropertyValue('--bg2').trim(),
        bg3: cs.getPropertyValue('--bg3').trim(),
        t1: cs.getPropertyValue('--t1').trim(),
        mainBg: main ? getComputedStyle(main).backgroundColor : null,
        cardBg: w ? getComputedStyle(w).backgroundColor : null,
        cardShadow: w ? getComputedStyle(w).boxShadow : null,
        widgets: document.querySelectorAll('.dash-widget-v2').length
      };
    });
    shots.push({ theme, file, info });
    console.log(theme, JSON.stringify(info));
  }

  fs.writeFileSync(path.join(OUT, `home-${TAG}.json`), JSON.stringify({ shots, errors }, null, 2));
  await browser.close();
  if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5));
  console.log('OUT', OUT);
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
