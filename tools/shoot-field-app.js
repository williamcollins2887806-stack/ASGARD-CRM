'use strict';
/**
 * Прогон РЕАЛЬНОГО приложения (dev-сервер :5173) в headless-браузере:
 * вход, затем полевые экраны в ОБЕИХ темах. Скриншоты → _shots/app/.
 * Запуск: node tools/shoot-field-app.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'prototypes', 'field-redesign', '_shots', 'app');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:5173/m';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  const shots = [];
  async function shot(name, url, wait = 1800) {
    try {
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(wait);
      const file = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: file });
      shots.push({ name, url, ok: true });
    } catch (e) {
      shots.push({ name, url, ok: false, error: String(e.message || e) });
    }
  }

  // Светлая тема — через localStorage (initTheme читает при старте)
  async function setTheme(theme) {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.evaluate((t) => localStorage.setItem('asgard_theme', t), theme);
  }

  await setTheme('dark');
  await shot('01-welcome-dark', '/field/welcome');

  // Вход: телефон → код (demo). Если вход недоступен — снимем что есть.
  await page.goto(BASE + '/field-login', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  try {
    const input = page.locator('input[type="tel"], input[inputmode="tel"], input').first();
    await input.fill('9160614809');
    await page.waitForTimeout(600);
    const btn = page.locator('button:has-text("Далее"), button:has-text("Получить"), button:has-text("Продолжить")').first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(2500); }
  } catch { /* вход требует реального SMS — ок, снимем, что отрисовано */ }
  await page.screenshot({ path: path.join(OUT, '02-login-dark.png') });
  shots.push({ name: '02-login-dark', url: '/field-login', ok: true });

  const routes = [
    ['03-home', '/field/home'],
    ['04-money', '/field/money'],
    ['05-timesheet', '/field/timesheet'],
    ['06-profile', '/field/profile'],
    ['07-achievements', '/field/achievements'],
    ['08-leaderboard', '/field/leaderboard'],
    ['09-shop', '/field/shop'],
    ['10-quests', '/field/quests'],
  ];

  for (const [name, url] of routes) {
    await shot(`${name}-dark`, url);
  }

  await setTheme('light');
  for (const [name, url] of routes) {
    await shot(`${name}-light`, url);
  }

  await browser.close();

  console.log('# Прогон реального приложения (:5173)\n');
  console.log('| экран | маршрут | итог |');
  console.log('|---|---|:-:|');
  for (const s of shots) console.log(`| ${s.name} | ${s.url} | ${s.ok ? 'ok' : 'FAIL'} |`);
  if (errors.length) {
    console.log(`\nОшибки консоли (${errors.length}):`);
    for (const e of [...new Set(errors)].slice(0, 12)) console.log(`  - ${e.slice(0, 160)}`);
  }
  const failed = shots.filter((s) => !s.ok);
  console.log(`\nСкриншоты: ${OUT}`);
  console.log(failed.length ? `FAIL: ${failed.length} экранов` : `OK — ${shots.length} скриншотов, ошибок консоли ${errors.length}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
