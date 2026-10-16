'use strict';
/** Только 2 финальных направления → _shots/final2/ (полный скролл + верх + контакт) */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = __dirname;
const OUT = path.join(DIR, '..', '_shots', 'final2');
fs.mkdirSync(OUT, { recursive: true });

const IDS = ['f2', 'f6'];
const url = (q) => 'file:///' + path.join(DIR, 'index.html').replace(/\\/g, '/') + (q || '');

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const id of IDS) {
    const page = await browser.newPage({ viewport: { width: 520, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(url('?only=' + id), { waitUntil: 'load' });
    await page.waitForTimeout(1400); // дать анимациям доиграть (sheen/grow)
    const el = page.locator('.phone').first();
    const box = await el.boundingBox();
    await page.setViewportSize({ width: 520, height: Math.ceil(box.height) + 40 });
    await page.waitForTimeout(400);
    await el.screenshot({ path: path.join(OUT, `${id}-full.png`) });
    // верхняя треть (детали: щит, промо, кнопка-клавиша)
    await el.screenshot({ path: path.join(OUT, `${id}-top.png`), clip: { x: 0, y: 0, width: box.width, height: Math.round(box.height * 0.42) } });
    console.log(`${id} ok (h=${Math.round(box.height)})`);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1300, height: 1500 }, deviceScaleFactor: 1.6 });
  await page.goto(url(), { waitUntil: 'load' });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(OUT, '_contact-sheet.png'), fullPage: true });
  console.log('contact sheet ok');
  await page.close();
  await browser.close();
  console.log('DONE →', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
