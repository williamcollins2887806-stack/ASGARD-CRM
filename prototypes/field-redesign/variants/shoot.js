'use strict';
/** Скриншоты 8 вариаций главной → prototypes/field-redesign/_shots/variants/ */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = path.join(__dirname, '..');
const OUT = path.join(DIR, '_shots', 'variants');
fs.mkdirSync(OUT, { recursive: true });

const SKINS = ['v1', 'v2', 'v3', 'v5', 'v6', 'v7', 'v8', 'v9'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const skin of SKINS) {
    const page = await browser.newPage({ viewport: { width: 460, height: 1000 }, deviceScaleFactor: 2 });
    const url = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/') + `?only=${skin}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const el = page.locator('.phone').first();
    await el.screenshot({ path: path.join(OUT, `${skin}.png`) });
    console.log(`${skin} ok`);
    await page.close();
  }
  // контактный лист: все 8 в одном кадре
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 1.5 });
  await page.goto('file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '_contact-sheet.png'), fullPage: true });
  console.log('contact sheet ok');
  await page.close();
  await browser.close();
  console.log('DONE →', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
