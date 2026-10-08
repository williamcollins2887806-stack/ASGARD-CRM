#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', '_design', 'menu-icons-r2');
const entries = JSON.parse(fs.readFileSync(path.join(OUT, 'inventory.json'), 'utf8'));
const accentMap = JSON.parse(fs.readFileSync(path.join(OUT, 'accent-map.json'), 'utf8'));
const gallery = fs.readFileSync(path.join(OUT, 'gallery.html'), 'utf8');

const FORBIDDEN = ['#FF6B35', '#00B4D8', '#7C5CFC', '#2D9F6F'];
const ALLOWED = new Set(['#2E7BC0', '#B8841A', '#A82030']);

let pass = 0, redo = 0;
const rows = [];
function add(slug, label, v, reason) {
  rows.push({ slug, label, v, reason });
  if (v === 'PASS') pass++; else redo++;
}

if (gallery.includes('data-tip') && gallery.includes('::after')) add('_tip', 'tooltips', 'PASS', 'hover tips');
else add('_tip', 'tooltips', 'REDO', 'no hover tips');

if (!/class="lbl">/.test(gallery) && !/>Мимир</.test(gallery) && !/>Хугинн</.test(gallery)) {
  add('_labels', 'no permanent rail labels', 'PASS', 'ok');
} else add('_labels', 'labels', 'REDO', 'permanent labels found');

if (gallery.includes('class="shell"') && gallery.includes('class="left"') && gallery.includes('class="right"')) {
  add('_shell', 'CRM shell', 'PASS', 'full shell');
} else add('_shell', 'shell', 'REDO', 'missing shell');

// right rail unity: all 4 mono + same ico-btn class
const rightCount = (gallery.match(/aria-label="Huginn"[\s\S]*?<\/aside>/) || [''])[0];
if (rightCount && (rightCount.match(/ico-btn/g) || []).length >= 4) add('_right', 'right rail', 'PASS', '4 ico-btn');
else add('_right', 'right rail', 'REDO', 'not unified');

for (const e of entries) {
  const svg = fs.readFileSync(path.join(OUT, 'new', e.file), 'utf8');
  if (FORBIDDEN.some((c) => svg.includes(c))) { add(e.slug, e.label, 'REDO', 'foreign color'); continue; }
  if (!svg.includes('feDropShadow')) { add(e.slug, e.label, 'REDO', 'no shadow'); continue; }
  if (/scale\(/.test(svg)) { add(e.slug, e.label, 'REDO', 'scale()'); continue; }
  if (!svg.includes('<path')) { add(e.slug, e.label, 'REDO', 'no path'); continue; }
  if (e.kind === 'right' && accentMap[e.slug]) { add(e.slug, e.label, 'REDO', 'right must be mono'); continue; }
  const plate = svg.match(/rx="12" fill="(#[0-9A-Fa-f]{6})"/);
  const expected = accentMap[e.slug];
  if (expected) {
    if (!plate || !ALLOWED.has(plate[1])) { add(e.slug, e.label, 'REDO', 'bad accent plate'); continue; }
  } else if (plate && ALLOWED.has(plate[1])) {
    add(e.slug, e.label, 'REDO', 'unexpected accent'); continue;
  }
  add(e.slug, e.label, 'PASS', 'custom soft ok');
}

const lines = [`# Verifier R2.3`, '', `PASS ${pass} / REDO ${redo}`, '', '## REDO'];
const redos = rows.filter((x) => x.v === 'REDO');
if (!redos.length) lines.push('_none_');
else redos.forEach((r) => lines.push(`- ${r.slug}: ${r.reason}`));
fs.writeFileSync(path.join(OUT, 'verifier-report-r2.md'), lines.join('\n'), 'utf8');
console.log(`Auto verifier R2.3: PASS ${pass}, REDO ${redo}`);
if (redo) process.exit(1);
