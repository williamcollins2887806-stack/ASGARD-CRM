#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '_design', 'menu-icons-r1');
const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'inventory.json'), 'utf8'));

const slugIcon = {};
const mod = fs.readFileSync(path.join(__dirname, 'build_menu_icons_gallery_r1.js'), 'utf8');
const m = mod.match(/const SLUG_ICON = \{([\s\S]*?)\};/);
if (m) {
  const block = m[1];
  for (const line of block.split('\n')) {
    const mm = line.match(/^\s*['"]?([^'":]+)['"]?\s*:\s*'([^']+)'/);
    if (mm) slugIcon[mm[1].trim()] = mm[2].trim();
  }
}

const byGroup = {};
for (const e of inv) {
  if (e.kind === 'right') continue;
  const g = e.group;
  if (!byGroup[g]) byGroup[g] = [];
  byGroup[g].push({ slug: e.slug, label: e.label, icon: slugIcon[e.slug] });
}

const rows = [];
let pass = 0;
let redo = 0;

function add(slug, label, verdict, reason) {
  rows.push({ slug, label, verdict, reason });
  if (verdict === 'PASS') pass++;
  else redo++;
}

for (const e of inv) {
  const file = path.join(ROOT, 'new', e.file);
  let svg = '';
  try {
    svg = fs.readFileSync(file, 'utf8');
  } catch {
    add(e.slug, e.label, 'REDO', 'нет файла new/');
    continue;
  }
  if (svg.includes('<circle cx="12" cy="12" r="8"')) {
    add(e.slug, e.label, 'REDO', 'fallback-круг (иконка не загрузилась)');
    continue;
  }
  if (!/fill="currentColor"/.test(svg) && !/fill:currentColor/.test(svg)) {
    add(e.slug, e.label, 'REDO', 'нет solid fill currentColor');
    continue;
  }
  if (e.kind !== 'right' && e.kind !== 'group') {
    const peers = (byGroup[e.group] || []).filter((p) => p.slug !== e.slug && p.icon === slugIcon[e.slug]);
    if (peers.length) {
      add(e.slug, e.label, 'REDO', `дублирует glyph ${slugIcon[e.slug]} с ${peers.map((p) => p.label).join(', ')}`);
      continue;
    }
  }
  add(e.slug, e.label, 'PASS', 'solid, уникален в группе, файл ok');
}

const lines = [
  '# Verifier report — Menu icons R1',
  '',
  `Date: ${new Date().toISOString()}`,
  '',
  `Summary: **PASS ${pass}** / **REDO ${redo}** / total ${inv.length}`,
  '',
  '| Slug | Label | Verdict | Reason |',
  '|------|-------|---------|--------|',
];

for (const r of rows) {
  lines.push(`| \`${r.slug}\` | ${r.label} | **${r.verdict}** | ${r.reason} |`);
}

lines.push('', '## REDO list (для раунда 2)', '');
for (const r of rows.filter((x) => x.verdict === 'REDO')) {
  lines.push(`- \`${r.slug}\` — ${r.label}: ${r.reason}`);
}

fs.writeFileSync(path.join(ROOT, 'verifier-report.md'), lines.join('\n'), 'utf8');
console.log(`Verifier: PASS ${pass}, REDO ${redo} → ${path.join(ROOT, 'verifier-report.md')}`);
