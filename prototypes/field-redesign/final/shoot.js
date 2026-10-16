'use strict';
/** Скриншоты 4 финальных вариаций (1:1 главная) → _shots/final/ */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = __dirname;
const OUT = path.join(DIR, '..', '_shots', 'final');
fs.mkdirSync(OUT, { recursive: true });

const IDS = ['f2', 'f3', 'f5', 'f6'];

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const id of IDS) {
    const page = await browser.newPage({ viewport: { width: 520, height: 900 }, deviceScaleFactor: 2 });
    const url = 'file:///' + path.join(DIR, 'index.html').replace(/\\/g, '/') + `?only=${id}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const el = page.locator('.phone').first();
    // высота не известна заранее — снимаем элемент целиком
    const box = await el.boundingBox();
    await page.setViewportSize({ width: 520, height: Math.ceil(box.height) + 40 });
    await page.waitForTimeout(300);
    await el.screenshot({ path: path.join(OUT, `${id}.png`) });
    console.log(`${id} ok (h=${Math.round(box.height)})`);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1780, height: 900 }, deviceScaleFactor: 1.3 });
  await page.goto('file:///' + path.join(DIR, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const sheetH = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 1780, height: Math.ceil(sheetH) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '_contact-sheet.png'), fullPage: true });
  console.log('contact sheet ok (h=' + Math.round(sheetH) + ')');
  await page.close();
  await browser.close();
  console.log('DONE →', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
