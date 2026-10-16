'use strict';
/**
 * Скриншоты прототипа редизайна → prototypes/field-redesign/_shots/after/
 * Полные страницы снимаются целиком (весь скролл), витринные — по экрану.
 * Запуск: node prototypes/field-redesign/shoot.js [--only=home-full] [--device=iphone|android]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = __dirname;
const OUT = path.join(DIR, '_shots', 'after');
fs.mkdirSync(OUT, { recursive: true });

function arg(n, d) { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; }

const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const DEVICE = arg('device', 'iphone');
const THEMES = ['dark', 'light'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const theme of THEMES) {
    const all = ['home-full', 'home', 'money', 'profile'];
    const screens = ONLY || all;
    for (const screen of screens) {
      const page = await browser.newPage({ viewport: { width: 460, height: 1200 }, deviceScaleFactor: 2 });
      const url = 'file:///' + path.join(DIR, 'index.html').replace(/\\/g, '/')
        + `?theme=${theme}&screen=${screen}&device=${DEVICE}&embed=1`;
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const el = page.locator('.phone').first();
      await el.screenshot({ path: path.join(OUT, `${theme}-${DEVICE}-${screen}.png`) });
      console.log(`${theme}/${DEVICE}/${screen} ok`);
      await page.close();
    }
  }
  await browser.close();
  console.log('DONE →', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
