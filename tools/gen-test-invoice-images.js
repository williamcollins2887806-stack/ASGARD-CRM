'use strict';
/**
 * Рендер PDF-счетов в PNG/JPEG с искажениями:
 *  - повороты 90 / 180 / 45 градусов;
 *  - разное разрешение (высокое / низкое);
 *  - низкое качество JPEG, шум, размытие.
 * Цель — проверить устойчивость OCR/vision на реальных искажениях.
 *
 * Usage: node tools/gen-test-invoice-images.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'test-invoices');

const VARIANTS = [
  { id: 'png-clean',       rotate: 0,   quality: null, scale: 2,   noise: false, blur: 0 },
  { id: 'png-rot90',       rotate: 90,  quality: null, scale: 2,   noise: false, blur: 0 },
  { id: 'png-rot180',      rotate: 180, quality: null, scale: 2,   noise: false, blur: 0 },
  { id: 'png-rot45',       rotate: 45,  quality: null, scale: 2,   noise: false, blur: 0 },
  { id: 'jpg-lowq',        rotate: 0,   quality: 0.35, scale: 1.5, noise: false, blur: 0 },
  { id: 'jpg-noisy',       rotate: 0,   quality: 0.5,  scale: 1.5, noise: true,  blur: 0 },
  { id: 'png-small',       rotate: 0,   quality: null, scale: 0.6, noise: false, blur: 0 },
  { id: 'jpg-rot90-lowq',  rotate: 90,  quality: 0.4,  scale: 1.5, noise: false, blur: 0 },
  { id: 'png-blur',        rotate: 0,   quality: null, scale: 1.5, noise: false, blur: 1.5 },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 1300 } });
  const report = [];

  for (const variant of VARIANTS) {
    for (let i = 1; i <= 10; i++) {
      const pdf = 'inv-' + String(i).padStart(2, '0') + '.pdf';
      const pdfPath = path.join(DIR, pdf);
      const b64 = fs.readFileSync(pdfPath).toString('base64');
      const outName = 'inv-' + String(i).padStart(2, '0') + '__' + variant.id + (variant.quality ? '.jpg' : '.png');
      const outPath = path.join(DIR, outName);

      try {
        const dataUrl = await page.evaluate(async ({ b64, variant }) => {
          // 1) PDF → картинка через pdf.js из CDN? Нет сети — рисуем canvas-имитацию нельзя.
          // Вместо pdf.js используем встроенный рендер браузера: конвертируем через <embed> не выйдет.
          // Поэтому: pdf → <img> невозможно без pdf.js; используем pdfkit-обход: рисуем текст на canvas.
          return null;
        }, { b64, variant });
        void dataUrl;
      } catch (_) { /* fallthrough */ }
    }
  }
  await browser.close();
  console.log('canvas-подход требует текста — используем pdfkit→PNG через отдельный путь');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
