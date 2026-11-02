#!/usr/bin/env node
/**
 * Dual-theme verifier — Ting Wave 0b (T01–T06).
 * Exit 0 = VERIFIED, 1 = FAIL.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../..');
const report = path.join(root, 'tests/reports/THING-THEME-VERIFY.md');

const checks = [];
function check(id, pass, evidence) {
  checks.push({ id, pass: !!pass, evidence: String(evidence || '') });
}

const tingCss = fs.readFileSync(path.join(root, 'public/assets/css/ting.css'), 'utf8');
const guest = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');
const shotPath = path.join(root, 'tests/ting/verifiers/shot_matrix.js');
const shotSrc = fs.existsSync(shotPath) ? fs.readFileSync(shotPath, 'utf8') : '';
const huginnCss = fs.readFileSync(path.join(root, 'public/assets/css/huginn_dock.css'), 'utf8');

const tokenNames = [
  '--ting-surface',
  '--ting-card-bg',
  '--ting-card-border',
  '--ting-card-shadow',
  '--ting-dock-bg',
  '--ting-chat-bg',
  '--ting-drawer-bg',
  '--ting-preview-bg',
  '--ting-room-bg',
  '--ting-on-media',
  '--ting-glass-hi',
  '--ting-glass-lo'
];

check(
  'T01_guest_theme_sync',
  /localStorage\.getItem\(\s*['"]asgard_theme['"]\s*\)/.test(guest)
    && /setAttribute\(\s*['"]data-theme['"]/.test(guest)
    && /t\s*===\s*['"]light['"]\s*\|\|\s*t\s*===\s*['"]dark['"]/.test(guest),
  'guest bootstrap asgard_theme → data-theme'
);

const ruleBodies = tingCss
  .replace(/:root\s*\{[\s\S]*?\n\}/, '')
  .replace(/html\[data-theme="light"\]\s*\{[\s\S]*?\n\}/, '');
const cinemaLeak = /#0a0c10|#0a0e12|#0b0e14|#E8EEF6/i.test(ruleBodies);
check(
  'T02_no_cinema_hex_outside_tokens',
  !cinemaLeak
    && /--ting-room-bg:\s*#0a0c10/.test(tingCss)
    && /--ting-preview-bg:\s*#0a0e12/.test(tingCss)
    && /--ting-on-media:/.test(tingCss),
  cinemaLeak ? 'cinema hex leaked outside token blocks' : 'cinema hex only in token defs'
);

const allTokens = tokenNames.every((t) => tingCss.includes(t + ':'));
check(
  'T03_tokenized_surfaces',
  allTokens
    && /\.ting-card\s*\{[^}]*background:\s*var\(--ting-card-bg\)/.test(tingCss)
    && /\.ting-dock-inner\s*\{[^}]*background:\s*var\(--ting-dock-bg\)/.test(tingCss)
    && /\.ting-chat\s*\{[^}]*background:\s*var\(--ting-chat-bg\)/.test(tingCss)
    && /html\[data-theme=["']light["']\]\s*\{[\s\S]*--ting-card-bg:/.test(tingCss),
  'card/dock/chat use tokens + light overrides'
);

check(
  'T04_shot_matrix_light_dark',
  !!shotSrc
    && /THEMES\s*=\s*\[[^\]]*'dark'[^\]]*'light'|THEMES\s*=\s*\[[^\]]*'light'[^\]]*'dark'/.test(shotSrc)
    && /data-theme/.test(shotSrc)
    && /asgard_theme/.test(shotSrc),
  'shot_matrix loops dark+light themes'
);

check(
  'T05_field_color_scheme',
  !/color-scheme:\s*dark\b/.test(tingCss)
    && /color-scheme:\s*light\s+dark/.test(tingCss),
  '.ting-field color-scheme light dark'
);

check(
  'T06_huginn_no_1a2030',
  !/#1a2030/i.test(huginnCss)
    && /\.hg-ting-tile-ph\s*\{[\s\S]*?background:\s*[^;]*(--hg-elev|--ting-preview-bg)/.test(huginnCss),
  '.hg-ting-tile-ph uses theme tokens, no #1a2030'
);

const fail = checks.filter((c) => !c.pass);
const md = [
  '# THING-THEME-VERIFY',
  '',
  `at: ${new Date().toISOString()}`,
  `result: ${fail.length ? 'FAIL' : 'VERIFIED'} (${checks.length - fail.length}/${checks.length})`,
  '',
  '| ID | PASS | Evidence |',
  '|----|------|----------|',
  ...checks.map((c) => `| ${c.id} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.evidence.replace(/\|/g, '/')} |`),
  '',
  fail.length ? '## FAILs\n' + fail.map((f) => `- ${f.id}: ${f.evidence}`).join('\n') : '## All PASS'
].join('\n');

fs.writeFileSync(report, md);
console.log(md.split('\n').slice(0, 10).join('\n'));
fail.forEach((f) => console.log('FAIL', f.id, f.evidence));
process.exit(fail.length ? 1 : 0);