'use strict';
/** Статус переноса вёрстки: сколько новых классов реально используется. */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'public', 'mobile-app', 'src', 'pages', 'field');

const MARKERS = [
  'fh-promo', 'fh-ready', 'fh-card', 'fh-shift', 'fh-mimir', 'fh-rank', 'fh-brandline',
  'fh-tile', 'fh-qa', 'fh-grid2', 'fh-grid4', 'fh-orb', 'fh-scene', 'fh-hero',
  'fs-hero', 'fs-card', 'fs-head', 'fs-orb', 'fs-row', 'fs-section',
  'IconTile', 'KeyButton', 'from \'@/components/field/ui\'',
];

const rows = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.jsx'))) {
  const s = fs.readFileSync(path.join(DIR, f), 'utf8');
  const found = MARKERS.filter((m) => s.includes(m));
  const inline = (s.match(/style=\{\{/g) || []).length;
  const hex = (s.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
  rows.push({ f, newCls: found.length, markers: found, inline, hex });
}
rows.sort((a, b) => b.newCls - a.newCls || b.inline - a.inline);

console.log('# Перенос вёрстки: новые классы vs старые inline-стили\n');
console.log('| экран | новых маркеров | inline | hex |');
console.log('|---|--:|--:|--:|');
for (const r of rows.slice(0, 22)) console.log(`| ${r.f} | ${r.newCls} | ${r.inline} | ${r.hex} |`);

const migrated = rows.filter((r) => r.newCls >= 5);
console.log(`\nПеренесено (>=5 маркеров): ${migrated.length} — ${migrated.map((r) => r.f).join(', ')}`);
console.log(`Осталось: ${rows.length - migrated.length} экранов`);
console.log(`inline-стилей всего: ${rows.reduce((t, r) => t + r.inline, 0)}`);
