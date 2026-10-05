'use strict';

/**
 * P1.9 wallpaper: 3×3 preview + Δ dark/light 10–12 + seamMax=0 + #runes sanity.
 * Run: node tests/huginn/verify_p1_wallpaper.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/PHASE-1');
const IMG = path.join(__dirname, '../../public/assets/img');
fs.mkdirSync(ROOT, { recursive: true });

function fail(m) { console.error('FAIL', m); process.exitCode = 1; }
function ok(m) { console.log('PASS', m); }

function sanitySvg(label, svg) {
  if (/<text[\s>]/i.test(svg)) fail(label + ' contains <text>');
  else ok(label + ' no <text>');

  const runesMatch = svg.match(/<g\s+id="runes"[^>]*>([\s\S]*?)<\/g>\s*<\/svg>/);
  // Prefer innermost: count <path> inside id="runes" block (first open to matching — use crude scan)
  const idx = svg.indexOf('id="runes"');
  if (idx < 0) {
    fail(label + ' missing #runes group');
    return;
  }
  // Count path tags after id="runes" until end of file (defs+uses live in #runes)
  const after = svg.slice(idx);
  const paths = after.match(/<path\b/g) || [];
  if (paths.length > 12) fail(label + ' #runes has ' + paths.length + ' <path> (max 12)');
  else ok(label + ' #runes path count=' + paths.length + ' (≤12)');

  // Canon fixed-set ids present
  for (const id of ['r-fehu', 'r-uruz', 'r-ansuz', 'r-raidho', 'r-kaunan', 'r-gebo', 'r-sowilo', 'r-tiwaz', 'r-mannaz', 'r-ehwaz', 'runic-circle']) {
    if (!svg.includes('id="' + id + '"')) fail(label + ' missing #' + id);
  }
}

(async () => {
  const darkSvg = fs.readFileSync(path.join(IMG, 'hg-chat-pattern.svg'), 'utf8');
  const lightSvg = fs.readFileSync(path.join(IMG, 'hg-chat-pattern-light.svg'), 'utf8');
  sanitySvg('dark', darkSvg);
  sanitySvg('light', lightSvg);

  const darkUri = 'data:image/svg+xml;base64,' + Buffer.from(darkSvg).toString('base64');
  const lightUri = 'data:image/svg+xml;base64,' + Buffer.from(lightSvg).toString('base64');

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const report = { dark: null, light: null, sanity: { noText: true, maxPathsInRunes: 12 } };

  for (const theme of ['dark', 'light']) {
    const uri = theme === 'dark' ? darkUri : lightUri;
    const fill = theme === 'dark' ? '#0E1621' : '#E6EBEE';
    const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div id="tile" style="width:720px;height:720px;background-color:${fill};background-image:url('${uri}');background-repeat:repeat;background-size:240px 240px"></div>
    </body></html>`);
    await page.waitForTimeout(100);
    const out = path.join(ROOT, 'P1-9-PATTERN-3x3-' + theme + '.png');
    await page.locator('#tile').screenshot({ path: out });

    const samples = await page.evaluate(async () => {
      const el = document.getElementById('tile');
      const c = document.createElement('canvas');
      c.width = 720; c.height = 720;
      const ctx = c.getContext('2d');
      const bg = getComputedStyle(el).backgroundImage;
      const url = bg.slice(5, -2);
      const img = new Image();
      img.src = url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      ctx.fillStyle = getComputedStyle(el).backgroundColor;
      ctx.fillRect(0, 0, 720, 720);
      for (let y = 0; y < 720; y += 240) {
        for (let x = 0; x < 720; x += 240) ctx.drawImage(img, x, y, 240, 240);
      }
      const at = (x, y) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const fillPt = at(10, 10);
      let maxD = 0; let linePt = fillPt;
      for (let y = 0; y < 240; y += 2) {
        for (let x = 0; x < 240; x += 2) {
          const p = at(x, y);
          const d = Math.max(Math.abs(p[0] - fillPt[0]), Math.abs(p[1] - fillPt[1]), Math.abs(p[2] - fillPt[2]));
          if (d > maxD) { maxD = d; linePt = p; }
        }
      }
      let seamMax = 0;
      for (let y = 0; y < 240; y += 4) {
        const a = at(239, y);
        const b = at(240, y);
        const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
        if (d > seamMax) seamMax = d;
      }
      for (let x = 0; x < 240; x += 4) {
        const a = at(x, 239);
        const b = at(x, 240);
        const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
        if (d > seamMax) seamMax = d;
      }
      return { fillPt, linePt, maxD, seamMax };
    });

    report[theme] = samples;
    console.log('P1_PATTERN_' + theme, JSON.stringify(samples));
    if (samples.maxD < 10) fail(theme + ' pattern Δ too low: ' + samples.maxD);
    if (samples.maxD > 12) fail(theme + ' pattern Δ too high (noise): ' + samples.maxD);
    if (samples.seamMax > 0) fail(theme + ' visible seam Δ=' + samples.seamMax);
    else ok(theme + ' 3x3 seamless + Δ=' + samples.maxD);
    await page.close();
  }

  fs.writeFileSync(path.join(ROOT, 'P1-9-PATTERN-VERIFY.json'), JSON.stringify(report, null, 2));
  await browser.close();
  if (process.exitCode) process.exit(1);
  ok('P1.9 pattern verify green');
})().catch((e) => { console.error(e); process.exit(1); });
