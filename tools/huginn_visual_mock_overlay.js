#!/usr/bin/env node
'use strict';

/**
 * Huginn visual mock-overlay — annotate CRM capture with TG zone labels.
 * Usage:
 *   node tools/huginn_visual_mock_overlay.js \
 *     --crm VERIFY/PREDEPLOY-VISUAL/crm-list.png \
 *     --out VERIFY/PREDEPLOY-VISUAL/MOCKS/pair-list-diff.png \
 *     --zones header,stories,pinned,nav
 *
 * Zones are drawn as translucent boxes + labels (no TG purple fill).
 * Requires pngjs (already in tree).
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ZONE_PRESETS = {
  header: { x: 0.02, y: 0.01, w: 0.96, h: 0.07, label: 'LIST-HEADER' },
  folders: { x: 0.02, y: 0.08, w: 0.96, h: 0.05, label: 'FOLDERS' },
  tabs: { x: 0.02, y: 0.13, w: 0.96, h: 0.05, label: 'CRM-TABS' },
  bday: { x: 0.02, y: 0.18, w: 0.96, h: 0.08, label: 'BDAY' },
  stories: { x: 0.02, y: 0.22, w: 0.96, h: 0.10, label: 'STORIES' },
  search: { x: 0.02, y: 0.32, w: 0.96, h: 0.05, label: 'SEARCH' },
  pinned: { x: 0.02, y: 0.38, w: 0.96, h: 0.18, label: 'PINNED' },
  rows: { x: 0.02, y: 0.56, w: 0.96, h: 0.28, label: 'ROWS' },
  nav: { x: 0.04, y: 0.88, w: 0.70, h: 0.09, label: 'NAV-64' },
  fab: { x: 0.78, y: 0.88, w: 0.16, h: 0.09, label: 'FAB-64' },
  pinbanner: { x: 0.04, y: 0.08, w: 0.92, h: 0.07, label: 'PIN-BANNER' },
  composer: { x: 0.02, y: 0.86, w: 0.96, h: 0.10, label: 'COMPOSER' },
  ai: { x: 0.04, y: 0.30, w: 0.92, h: 0.55, label: 'AI-SHEET' },
  file: { x: 0.20, y: 0.40, w: 0.60, h: 0.12, label: 'FILE' }
};

function parseArgs(argv) {
  const out = { zones: ['header', 'stories', 'pinned', 'nav', 'fab'], crm: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--crm') out.crm = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--zones') out.zones = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--help') out.help = true;
  }
  return out;
}

function drawRect(png, x0, y0, x1, y1, rgba, fillAlpha) {
  const { width, height, data } = png;
  x0 = Math.max(0, Math.min(width - 1, x0 | 0));
  y0 = Math.max(0, Math.min(height - 1, y0 | 0));
  x1 = Math.max(0, Math.min(width - 1, x1 | 0));
  y1 = Math.max(0, Math.min(height - 1, y1 | 0));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1
        || x === x0 + 1 || x === x1 - 1 || y === y0 + 1 || y === y1 - 1;
      const idx = (width * y + x) << 2;
      if (edge) {
        data[idx] = rgba[0];
        data[idx + 1] = rgba[1];
        data[idx + 2] = rgba[2];
        data[idx + 3] = 255;
      } else if (fillAlpha > 0) {
        const a = fillAlpha / 255;
        data[idx] = Math.round(data[idx] * (1 - a) + rgba[0] * a);
        data[idx + 1] = Math.round(data[idx + 1] * (1 - a) + rgba[1] * a);
        data[idx + 2] = Math.round(data[idx + 2] * (1 - a) + rgba[2] * a);
      }
    }
  }
}

/** Tiny 5x7 bitmap font for labels (A-Z, 0-9, -) */
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
};

function drawText(png, x, y, text, rgba) {
  const scale = Math.max(1, Math.round(png.width / 400));
  let cx = x;
  for (const ch of String(text).toUpperCase()) {
    const g = GLYPHS[ch] || GLYPHS['-'];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] !== '1') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = cx + col * scale + dx;
            const py = y + row * scale + dy;
            if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
            const idx = (png.width * py + px) << 2;
            png.data[idx] = rgba[0];
            png.data[idx + 1] = rgba[1];
            png.data[idx + 2] = rgba[2];
            png.data[idx + 3] = 255;
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

function makePlaceholder(w, h) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (w * y + x) << 2;
      png.data[idx] = 28;
      png.data[idx + 1] = 32;
      png.data[idx + 2] = 42;
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.out) {
    console.log('Usage: node tools/huginn_visual_mock_overlay.js --crm <png> --out <png> [--zones a,b,c]');
    console.log('Zones:', Object.keys(ZONE_PRESETS).join(', '));
    process.exit(args.help ? 0 : 1);
  }
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let png;
  if (args.crm && fs.existsSync(args.crm)) {
    const buf = fs.readFileSync(args.crm);
    png = PNG.sync.read(buf);
  } else {
    console.warn('WARN: --crm missing or not found; writing annotated placeholder');
    png = makePlaceholder(400, 860);
  }

  const accent = [74, 144, 217]; // CRM blue-l, not TG purple
  for (const key of args.zones) {
    const z = ZONE_PRESETS[key];
    if (!z) {
      console.warn('unknown zone', key);
      continue;
    }
    const x0 = Math.round(z.x * png.width);
    const y0 = Math.round(z.y * png.height);
    const x1 = Math.round((z.x + z.w) * png.width);
    const y1 = Math.round((z.y + z.h) * png.height);
    drawRect(png, x0, y0, x1, y1, accent, 36);
    drawText(png, x0 + 6, y0 + 6, z.label, accent);
  }

  fs.writeFileSync(outPath, PNG.sync.write(png));
  console.log('WROTE', outPath, png.width + 'x' + png.height, 'zones=' + args.zones.join(','));
}

main();
