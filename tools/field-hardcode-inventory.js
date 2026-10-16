'use strict';
/** Инвентарь полевых экранов: кто на токенах, кто на хардкод-цветах (Фаза 5). */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'public', 'mobile-app', 'src', 'pages', 'field');

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.jsx'));
const rows = [];
for (const f of files) {
  const s = fs.readFileSync(path.join(DIR, f), 'utf8');
  const hex = (s.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
  const rgb = (s.match(/rgba?\(/g) || []).length;
  const inline = (s.match(/style=\{\{/g) || []).length;
  const tok = (s.match(/var\(--/g) || []).length;
  rows.push({ f, hex, rgb, inline, tok, score: hex + rgb });
}

const dirty = rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
const clean = rows.filter((r) => r.score === 0);

console.log('# Полевые экраны: хардкод-цвета vs токены\n');
console.log('| файл | hex | rgba | inline | var(--) |');
console.log('|---|--:|--:|--:|--:|');
for (const r of dirty) console.log(`| ${r.f} | ${r.hex} | ${r.rgb} | ${r.inline} | ${r.tok} |`);
console.log('');
console.log(`Всего .jsx: ${files.length}`);
console.log(`С хардкодом: ${dirty.length}`);
console.log(`На токенах (0 хардкода): ${clean.length}${clean.length ? ' — ' + clean.map((c) => c.f).join(', ') : ''}`);
console.log(`Суммарно hex+rgba: ${dirty.reduce((t, r) => t + r.score, 0)}`);
console.log(`Суммарно inline-стилей: ${rows.reduce((t, r) => t + r.inline, 0)}`);
