'use strict';

/**
 * P5 — build BEFORE|AFTER boards for the Huginn redesign.
 * ---------------------------------------------------------------------------
 * Composes, for every screen + surface + theme captured by
 * capture_baseline_before_after.js, a side-by-side image:
 *      LEFT  = BEFORE (было)
 *      RIGHT = AFTER  (стало)
 * and also a labelled Telegram-reference column when a ref exists.
 *
 * Input : tests/reports/huginn-ui/FOR-REVIEW/BEFORE/*.png
 *         tests/reports/huginn-ui/FOR-REVIEW/AFTER/*.png  (optional; missing → placeholder)
 * Output: tests/reports/huginn-ui/FOR-REVIEW/BEFORE-AFTER/<screen>-<surface>-<theme>.png
 *         tests/reports/huginn-ui/FOR-REVIEW/BEFORE-AFTER/INDEX.md
 *
 * Run: node tests/huginn/build_before_after_boards.js
 * Read-only; writes images + index only. Safe to run before AFTER exists (boards
 * then show BEFORE + «AFTER pending») so the baseline can be reviewed immediately.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW');
const BEFORE = path.join(ROOT, 'BEFORE');
const AFTER = path.join(ROOT, 'AFTER');
const OUT = path.join(ROOT, 'BEFORE-AFTER');

const SCREENS = ['list', 'thread', 'settings', 'invite', 'story', 'contacts'];
const SURFACES = ['phone', 'desktop'];
const THEMES = ['dark', 'light'];

function readPng(p) {
  if (!fs.existsSync(p)) return null;
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
}

function imgTag(src, label, cls) {
  return `<div class="pane ${cls}">
    <div class="label">${label}</div>
    ${src ? `<img src="${src}">` : `<div class="missing">нет кадра</div>`}
  </div>`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  const rows = [];
  for (const screen of SCREENS) {
    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        const name = `${screen}-${surface}-${theme}.png`;
        const beforeSrc = readPng(path.join(BEFORE, name));
        const afterSrc = readPng(path.join(AFTER, name));
        if (!beforeSrc && !afterSrc) continue;

        const cols = 2;
        const ctx = await browser.newContext({ viewport: { width: cols * 480, height: 980 } });
        const page = await ctx.newPage();
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
          html,body{margin:0;background:#0b0b0d;color:#e8e8ea;font:600 13px/1.3 'Segoe UI',system-ui,sans-serif}
          .wrap{display:grid;grid-template-columns:repeat(${cols},1fr);gap:0;height:100vh}
          .pane{position:relative;overflow:hidden;background:#141418;border-right:1px solid #2a2a30;display:flex;align-items:center;justify-content:center}
          .pane img{max-width:100%;max-height:100%;object-fit:contain;display:block}
          .label{position:absolute;top:8px;left:8px;z-index:2;background:rgba(0,0,0,.72);padding:5px 10px;border-radius:8px;font-size:12px;letter-spacing:.02em}
          .missing{color:#6a6a72;font-weight:500}
          .cap{position:absolute;bottom:8px;left:8px;right:8px;z-index:2;text-align:center;background:rgba(0,0,0,.6);padding:4px;border-radius:8px;font-size:11px;color:#b9b9c2}
        </style></head><body><div class="wrap">
          ${imgTag(beforeSrc, 'БЫЛО', 'left')}
          ${imgTag(afterSrc, 'СТАЛО', 'right')}
          <div class="cap">${screen} · ${surface} · ${theme}</div>
        </div></body></html>`);
        await page.waitForTimeout(150);
        const outPath = path.join(OUT, name);
        await page.screenshot({ path: outPath, fullPage: false });
        await ctx.close();
        rows.push({ name, screen, surface, theme, after_present: !!afterSrc });
        console.log('board', name, afterSrc ? '' : '(AFTER pending)');
      }
    }
  }

  await browser.close();

  const md = [
    '# Huginn — доски «БЫЛО | СТАЛО»',
    '',
    `Сгенерировано: ${new Date().toISOString()}`,
    '',
    'Слева — **было**, справа — **стало** (либо «нет кадра», если AFTER ещё не снят).',
    'Источник BEFORE: `FOR-REVIEW/BEFORE/`, AFTER: `FOR-REVIEW/AFTER/`.',
    '',
    '| Экран | Поверхность | Тема | Файл | AFTER |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.screen} | ${r.surface} | ${r.theme} | \`${r.name}\` | ${r.after_present ? 'да' : 'нет'} |`),
    '',
    `Всего досок: **${rows.length}**. С AFTER: **${rows.filter((r) => r.after_present).length}**.`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'INDEX.md'), md);
  console.log('\nwrote', rows.length, 'boards + INDEX.md →', OUT);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
