'use strict';

/**
 * P1.9 review captures: DETAIL ×4 (high-contrast canon strip) + RUNIC-CIRCLE isolate.
 * Wallpaper SVGs keep atmosphere alpha; these shots boost stroke for V1 shape check.
 * Run: node tests/huginn/capture_p19_artifacts.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/PHASE-1');
fs.mkdirSync(ROOT, { recursive: true });

const STROKE = 'rgba(255,255,255,0.85)';
const SW = '1.35';

function runeDefs() {
  const specs = [
    ['r-fehu', 'M0,0 L0,14 M0,0 L7,4 M0,7 L5,10'],
    ['r-uruz', 'M0,0 L0,14 M7,0 L7,10 L0,14 M7,0 L0,2'],
    ['r-ansuz', 'M0,0 L0,14 M0,0 L7,4 M0,7 L5,10'],
    ['r-raidho', 'M0,0 L0,14 M0,0 L6,3 L0,8 M0,8 L7,14'],
    ['r-kaunan', 'M6,0 L0,4 L6,10'],
    ['r-gebo', 'M0,0 L8,14 M8,0 L0,14'],
    ['r-sowilo', 'M6,0 L0,7 L6,14'],
    ['r-tiwaz', 'M4,0 L4,14 M0,0 L4,4 L8,0'],
    ['r-mannaz', 'M0,14 L0,0 L8,14 L8,0'],
    ['r-ehwaz', 'M0,0 L0,14 M0,0 L7,14 M0,14 L7,0'],
  ];
  return specs.map(([id, d]) =>
    `<g id="${id}" fill="none" stroke="${STROKE}" stroke-width="${SW}" stroke-linecap="butt" stroke-linejoin="miter"><path d="${d}"/></g>`
  ).join('\n');
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  // DETAIL ×4: fixed-set strip with tile rhythm gaps, high contrast for canon check
  {
    // viewBox matches rhythm example; ×4 → 960×240
    const detailSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60" viewBox="0 0 240 60">
  <rect width="240" height="60" fill="#0E1621"/>
  <defs>${runeDefs()}</defs>
  <g transform="translate(0,20)">
    <use href="#r-fehu" x="10" y="0"/>
    <use href="#r-uruz" x="24" y="0"/>
    <use href="#r-ansuz" x="50" y="0"/>
    <use href="#r-raidho" x="64" y="0"/>
    <use href="#r-kaunan" x="100" y="0"/>
    <use href="#r-gebo" x="130" y="0"/>
    <use href="#r-sowilo" x="144" y="0"/>
    <use href="#r-tiwaz" x="178" y="0"/>
    <use href="#r-mannaz" x="200" y="0"/>
    <use href="#r-ehwaz" x="222" y="0"/>
  </g>
</svg>`;
    const uri = 'data:image/svg+xml;base64,' + Buffer.from(detailSvg).toString('base64');
    const page = await browser.newPage({ viewport: { width: 960, height: 240 } });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#0E1621;overflow:hidden">
      <img src="${uri}" width="960" height="240" style="display:block"/>
    </body></html>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(ROOT, 'P1-9-RUNIC-DETAIL.png') });
    await page.close();
    console.log('PASS P1-9-RUNIC-DETAIL.png');
  }

  // RUNIC-CIRCLE isolate ×8 (60→480)
  {
    const circleOnly = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 60 60">
  <rect width="60" height="60" fill="#0E1621"/>
  <defs>${runeDefs()}</defs>
  <g fill="none" stroke="${STROKE}" stroke-width="1.2" stroke-linecap="butt" stroke-linejoin="miter">
    <circle cx="30" cy="30" r="28"/>
    <use href="#r-fehu" transform="translate(30,30) rotate(0) translate(0,-20) scale(0.4286) translate(-4,-7)"/>
    <use href="#r-ansuz" transform="translate(30,30) rotate(60) translate(0,-20) scale(0.4286) translate(-4,-7)"/>
    <use href="#r-raidho" transform="translate(30,30) rotate(120) translate(0,-20) scale(0.4286) translate(-4,-7)"/>
    <use href="#r-gebo" transform="translate(30,30) rotate(180) translate(0,-20) scale(0.4286) translate(-4,-7)"/>
    <use href="#r-sowilo" transform="translate(30,30) rotate(240) translate(0,-20) scale(0.4286) translate(-4,-7)"/>
    <use href="#r-mannaz" transform="translate(30,30) rotate(300) translate(0,-20) scale(0.4286) translate(-4,-7)"/>
  </g>
</svg>`;
    const circleUri = 'data:image/svg+xml;base64,' + Buffer.from(circleOnly).toString('base64');
    const page = await browser.newPage({ viewport: { width: 480, height: 480 } });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#0E1621">
      <img src="${circleUri}" width="480" height="480" style="display:block"/>
    </body></html>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(ROOT, 'P1-9-RUNIC-CIRCLE.png') });
    await page.close();
    console.log('PASS P1-9-RUNIC-CIRCLE.png');
  }

  await browser.close();
  console.log('PASS capture_p19_artifacts');
})().catch((e) => { console.error(e); process.exit(1); });
