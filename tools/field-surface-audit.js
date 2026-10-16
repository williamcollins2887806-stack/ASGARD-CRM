'use strict';
/**
 * ASGARD Field — surface audit (Phase 1).
 *
 * Сканирует полевой слой и строит машинный реестр поверхностей + нарушения
 * дизайн-дисциплины. Используется и как документ (SURFACES.md), и как гейт
 * (--check → exit 1 при нарушениях, кроме занесённых в baseline-allowlist).
 *
 * Запуск:
 *   node tools/field-surface-audit.js            # печать отчёта
 *   node tools/field-surface-audit.js --json     # JSON
 *   node tools/field-surface-audit.js --check    # exit 1 при новых нарушениях
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'mobile-app', 'src');
const DIRS = [
  path.join(SRC, 'pages', 'field'),
  path.join(SRC, 'components', 'field'),
];
const EXTRA_FILES = [
  path.join(SRC, 'layouts', 'FieldLayout.jsx'),
  path.join(SRC, 'styles', 'field-auth.css'),
];

const CHECK = process.argv.includes('--check');
const AS_JSON = process.argv.includes('--json');

/** Снимок текущего долга (до редизайна). Каждый пункт должен уйти в 0. */
const BASELINE = {
  'pages/field': {
    inlineStyle: 2086,
    hexLiteral: 1381,
    handRolledOverlay: 26,
    inlineStyleTag: 17,
    nativeDialog: 3,
    usesBottomSheet: 4,
  },
};

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(jsx|css)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function rel(p) { return path.relative(SRC, p).replace(/\\/g, '/'); }
function count(re, s) { const m = s.match(re); return m ? m.length : 0; }

function analyze(file) {
  const src = fs.readFileSync(file, 'utf8');
  const isCss = file.endsWith('.css');
  const lines = src.split(/\r?\n/);

  const sheets = [];
  if (!isCss) {
    // переменные/функции, содержащие Sheet/Modal/Overlay и т.п.
    lines.forEach((l, i) => {
      const m = l.match(/\b(?:function|const)\s+([A-Z][A-Za-z0-9_]*(?:Sheet|Modal|Overlay|Dialog|Drawer|Lightbox|Popover|Menu|Banner|Preview)[A-Za-z0-9_]*)/);
      if (m) sheets.push({ name: m[1], line: i + 1 });
    });
  }

  return {
    file: rel(file),
    isCss,
    lines: lines.length,
    inlineStyle: count(/style=\{\{/g, src),
    hexLiteral: count(/#[0-9a-fA-F]{3,8}\b/g, src),
    rgbaLiteral: count(/\brgba?\(/g, src),
    varToken: count(/var\(--/g, src),
    usesBottomSheet: /BottomSheet/.test(src) && !/shared\/BottomSheet/.test(src) ? false : /from '@\/components\/shared\/BottomSheet'/.test(src),
    handRolledOverlay: count(/position:\s*['"]fixed['"]/g, src),
    inlineStyleTag: isCss ? 0 : count(/<style[\s>]/g, src),
    nativeDialog: count(/(?:^|[^.\w])(?:window\.)?(?:alert|confirm)\s*\(/gm, src) - count(/function\s+(?:alert|confirm)\s*\(/g, src),
    backdropFilter: count(/backdrop-filter|backdropFilter/g, src),
    safeArea: count(/safe-area-inset|--safe-/g, src),
    sheets,
  };
}

function main() {
  const files = [...DIRS.flatMap((d) => walk(d)), ...EXTRA_FILES.filter((f) => fs.existsSync(f))];
  const rows = files.map(analyze).sort((a, b) => (b.hexLiteral + b.inlineStyle) - (a.hexLiteral + a.inlineStyle));

  const totals = rows.reduce((t, r) => ({
    files: t.files + 1,
    jsx: t.jsx + (r.isCss ? 0 : 1),
    inlineStyle: t.inlineStyle + r.inlineStyle,
    hexLiteral: t.hexLiteral + r.hexLiteral,
    rgbaLiteral: t.rgbaLiteral + r.rgbaLiteral,
    handRolledOverlay: t.handRolledOverlay + r.handRolledOverlay,
    inlineStyleTag: t.inlineStyleTag + r.inlineStyleTag,
    nativeDialog: t.nativeDialog + r.nativeDialog,
    usesBottomSheet: t.usesBottomSheet + (r.usesBottomSheet ? 1 : 0),
    backdropFilter: t.backdropFilter + r.backdropFilter,
  }), { files: 0, jsx: 0, inlineStyle: 0, hexLiteral: 0, rgbaLiteral: 0, handRolledOverlay: 0, inlineStyleTag: 0, nativeDialog: 0, usesBottomSheet: 0, backdropFilter: 0 });

  const sheetDefs = rows.filter((r) => r.sheets.length)
    .map((r) => ({ file: r.file, sheets: r.sheets }));

  if (AS_JSON) {
    console.log(JSON.stringify({ totals, rows, sheetDefs, baseline: BASELINE }, null, 2));
  } else {
    console.log('# Field surface audit\n');
    console.log('## Totals (field layer)');
    console.log('| metric | value |');
    console.log('|---|--:|');
    for (const [k, v] of Object.entries(totals)) console.log(`| ${k} | ${v} |`);
    console.log('\n## Top-30 offenders (hex + inline)');
    console.log('| file | inline | hex | rgba | handOverlay | styleTag | nativeDlg | BottomSheet |');
    console.log('|---|--:|--:|--:|--:|--:|--:|:-:|');
    for (const r of rows.slice(0, 30)) {
      console.log(`| ${r.file} | ${r.inlineStyle} | ${r.hexLiteral} | ${r.rgbaLiteral} | ${r.handRolledOverlay} | ${r.inlineStyleTag} | ${r.nativeDialog} | ${r.usesBottomSheet ? 'yes' : ''} |`);
    }
    console.log('\n## Overlay-bearing components (detected by name)');
    for (const s of sheetDefs) console.log(`- ${s.file}: ${s.sheets.map((x) => `${x.name}@${x.line}`).join(', ')}`);
  }

  if (CHECK) {
    const b = BASELINE['pages/field'];
    const problems = [];
    if (totals.inlineStyle > b.inlineStyle) problems.push(`inlineStyle ${totals.inlineStyle} > baseline ${b.inlineStyle}`);
    if (totals.hexLiteral > b.hexLiteral) problems.push(`hexLiteral ${totals.hexLiteral} > baseline ${b.hexLiteral}`);
    if (totals.handRolledOverlay > b.handRolledOverlay) problems.push(`handRolledOverlay ${totals.handRolledOverlay} > baseline ${b.handRolledOverlay}`);
    if (totals.nativeDialog > b.nativeDialog) problems.push(`nativeDialog ${totals.nativeDialog} > baseline ${b.nativeDialog}`);
    if (problems.length) { console.error('FAIL:\n - ' + problems.join('\n - ')); process.exit(1); }
    console.log('OK (no regression vs baseline)');
  }
}

main();
