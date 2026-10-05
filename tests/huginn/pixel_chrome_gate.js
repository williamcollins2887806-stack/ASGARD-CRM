/**
 * Chrome-only half-vs-half gate for TG|HG SBS closeups.
 * Masks content-delta zones (title/badge/pin copy/msg peek) so material can move.
 * Usage: node tests/huginn/pixel_chrome_gate.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const GATE = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/LIVE-CRM/GATE');

function load(file) {
  return PNG.sync.read(fs.readFileSync(path.join(GATE, file)));
}

function mismatchMasked(png, maskFn) {
  const w = png.width;
  const h = png.height;
  const hw = Math.floor(w / 2);
  let mism = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < hw; x++) {
      if (maskFn && !maskFn(x, y, hw, h)) continue;
      const i = (y * w + x) * 4;
      const j = (y * w + x + hw) * 4;
      const dr = Math.abs(png.data[i] - png.data[j]);
      const dg = Math.abs(png.data[i + 1] - png.data[j + 1]);
      const db = Math.abs(png.data[i + 2] - png.data[j + 2]);
      n++;
      if (Math.max(dr, dg, db) > 8) mism++;
    }
  }
  return n ? +(100 * mism / n).toFixed(2) : null;
}

function full(png) {
  return mismatchMasked(png, null);
}

// Header: compare lower pin frost band + left/right chrome gutters; skip title stack mid-band
function headerChromeMask(x, y, hw, h) {
  const y0 = Math.floor(h * 0.42); // pin + underlap
  if (y >= y0) return true;
  // gutters only in upper (avoid title/subtitle/badge center)
  return x < hw * 0.14 || x > hw * 0.86;
}

// Composer: bar + suggest (lower 62%); skip message peek above
function composerChromeMask(x, y, hw, h) {
  return y >= Math.floor(h * 0.38);
}

// Nav: full half but skip red badge hotspots (high R, low G/B) on either side
function navChromeMask(x, y, hw, h, png) {
  const w = png.width;
  const iL = (y * w + x) * 4;
  const iR = (y * w + x + hw) * 4;
  const redish = (i) => png.data[i] > 160 && png.data[i] > png.data[i + 1] + 40 && png.data[i] > png.data[i + 2] + 40;
  if (redish(iL) || redish(iR)) return false;
  return true;
}

const out = {
  round: 'chrome-gate',
  timestamp: new Date().toISOString(),
  note: 'Masked channel>8 — content deltas excluded where possible',
  files: {},
};

for (const [file, mask] of [
  ['sbs-nav-closeup.png', (x, y, hw, h) => navChromeMask(x, y, hw, h, load('sbs-nav-closeup.png'))],
  ['sbs-header-closeup.png', headerChromeMask],
  ['sbs-composer-closeup.png', composerChromeMask],
]) {
  const png = load(file);
  const fullPct = full(png);
  const chromePct = mismatchMasked(
    png,
    file.startsWith('sbs-nav')
      ? (x, y, hw, h) => navChromeMask(x, y, hw, h, png)
      : mask
  );
  out.files[file] = { full_channel_gt8: fullPct, chrome_masked_gt8: chromePct };
}

fs.writeFileSync(path.join(GATE, 'PIXEL-CHROME-GATE.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.files, null, 2));
