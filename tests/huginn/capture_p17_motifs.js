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
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#0E1621;color:#7D8B99;font:14px/1.3 sans-serif">
    <div style="padding:16px">
      <div style="margin-bottom:12px">P1.7 motifs · tile 240 (×2.2)</div>
      <img src="${uri}" width="528" height="528" style="image-rendering:auto;background:#0E1621"/>
    </div>
  </body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(ROOT, 'P1-7-MOTIFS-dark.png') });
  await browser.close();
  console.log('PASS motif sheet');
})().catch((e) => { console.error(e); process.exit(1); });
