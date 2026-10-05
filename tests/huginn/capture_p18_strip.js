'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/PHASE-1');
const SVG = fs.readFileSync(path.join(__dirname, '../../public/assets/img/hg-chat-pattern.svg'), 'utf8');
const uri = 'data:image/svg+xml;base64,' + Buffer.from(SVG).toString('base64');
fs.mkdirSync(ROOT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 220 } });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#0E1621">
    <div style="width:720px;height:220px;background-image:url('${uri}');background-size:720px 720px;background-position:0 0;background-repeat:no-repeat"></div>
  </body></html>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(ROOT, 'P1-8-RUNIC-STRIP-detail.png') });
  await browser.close();
  console.log('PASS strip detail');
})().catch((e) => { console.error(e); process.exit(1); });
