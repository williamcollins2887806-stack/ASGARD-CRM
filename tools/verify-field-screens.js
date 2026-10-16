'use strict';
/**
 * Рантайм-гейт: обходит ВСЕ полевые экраны под авторизацией и падает, если
 * хоть один показал ErrorBoundary («Что-то пошло не так»), дал JS-ошибку
 * или белый экран. Это защита класса «в коде остался ReferenceError».
 *
 * Запуск: node tools/verify-field-screens.js [--base=http://127.0.0.1:5173] [--theme=dark|light|both]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function arg(n, d) { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; }
const BASE = arg('base', 'http://127.0.0.1:5173');
const THEME = arg('theme', 'both');
const WORKER_EMP = Number(arg('emp', '14'));
const WORKER_PIN = arg('pin', '1488');

const SCREENS = [
  ['home', '/m/field/home'], ['shift', '/m/field/shift'], ['timesheet', '/m/field/timesheet'],
  ['money', '/m/field/money'], ['earnings', '/m/field/earnings'], ['earnings-monthly', '/m/field/earnings/monthly'],
  ['funds', '/m/field/funds'], ['my-works', '/m/field/my-works'], ['crew', '/m/field/crew'],
  ['crew-stages', '/m/field/crew-stages'], ['logistics', '/m/field/logistics'], ['report', '/m/field/report'],
  ['incidents', '/m/field/incidents'], ['photos', '/m/field/photos'], ['packing', '/m/field/packing'],
  ['assembly', '/m/field/assembly'], ['receiving', '/m/field/receiving'], ['stages', '/m/field/stages'],
  ['diary', '/m/field/diary'], ['readiness', '/m/field/readiness'], ['journey', '/m/field/journey'],
  ['profile', '/m/field/profile'], ['achievements', '/m/field/achievements'], ['leaderboard', '/m/field/leaderboard'],
  ['seasonal', '/m/field/seasonal'], ['quests', '/m/field/quests'], ['shop', '/m/field/shop'],
  ['inventory', '/m/field/inventory'], ['academy', '/m/field/academy'], ['academy-library', '/m/field/academy/library'],
  ['wheel', '/m/field/wheel'], ['pipeline', '/m/field/pipeline'], ['chemlab', '/m/field/chemlab'],
  ['welcome', '/m/field/welcome'], ['login', '/m/field-login'],
];

(async () => {
  const r = await fetch(`${BASE}/api/field/auth/pin-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: WORKER_EMP, pin: WORKER_PIN }),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.token) { console.error('FAIL: не удалось авторизоваться:', JSON.stringify(d).slice(0, 160)); process.exit(2); }

  const themes = THEME === 'both' ? ['dark', 'light'] : [THEME];
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const theme of themes) {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    });
    await ctx.addInitScript(({ t, th }) => {
      localStorage.setItem('field_token', t);
      localStorage.setItem('asgard_theme', th);
      localStorage.setItem('field_has_pin', '1');
      localStorage.setItem('field_redesign_2026_seen', '1');
      // Без этой эпохи applyAuthEpoch() стирает токен → редирект на PIN.
      // Именно поэтому «прямой заход на роут» раньше выглядел как «вкладка не грузится».
      localStorage.setItem('field_auth_epoch', '6');
    }, { t: d.token, th: theme });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
    page.on('console', (m) => { if (m.type() === 'error' && !/404|service worker|manifest|client-errors/i.test(m.text())) errs.push('C:' + m.text().slice(0, 140)); });

    for (const [name, url] of SCREENS) {
      const before = errs.length;
      try {
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        // Ждём реального контента: полевые экраны тянут данные с бэкенда,
        // 2с недостаточно (были ложные BLANK). Ждём до 12с, поллим текст.
        await page.waitForFunction(
          () => document.body.innerText.trim().length > 60
            || document.body.innerText.includes('Что-то пошло не так'),
          { timeout: 12000 },
        ).catch(() => {});
        await page.waitForTimeout(400);
        const st = await page.evaluate(() => ({
          crash: document.body.innerText.includes('Что-то пошло не так'),
          blank: document.body.innerText.trim().length < 12,
          txt: document.body.innerText.trim().slice(0, 46).replace(/\n+/g, ' '),
        }));
        const newErrs = errs.slice(before);
        const ok = !st.crash && !st.blank;
        results.push({ theme, name, url, ok, crash: st.crash, blank: st.blank, errs: newErrs, txt: st.txt });
        const mark = ok ? 'ok  ' : 'FAIL';
        console.log(`[${theme}] ${mark} ${name.padEnd(16)} ${st.crash ? 'CRASH' : st.blank ? 'BLANK' : ''}${newErrs.length ? ' | ' + newErrs[0] : ''}`);
      } catch (e) {
        results.push({ theme, name, url, ok: false, error: String(e.message).slice(0, 120) });
        console.log(`[${theme}] FAIL ${name.padEnd(16)} ${String(e.message).slice(0, 80)}`);
      }
    }
    await ctx.close();
  }
  await browser.close();

  const bad = results.filter((x) => !x.ok);
  console.log(`\nвсего экранов: ${results.length}, проблем: ${bad.length}`);
  if (bad.length) {
    console.error('FAIL:');
    for (const b of bad) console.error(`  [${b.theme}] ${b.name} ${b.crash ? '(CRASH)' : b.blank ? '(BLANK)' : ''} ${b.error || (b.errs && b.errs[0]) || ''}`);
    process.exit(1);
  }
  console.log('OK — все полевые экраны грузятся без краша в обеих темах');
})().catch((e) => { console.error(e); process.exit(1); });
