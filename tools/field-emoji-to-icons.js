'use strict';
/**
 * Ф5 ч9: заменяет эмодзи-иконки на lucide-иконки в полевых экранах.
 * Точечные замены по карте — там, где эмодзи был UI-иконкой.
 * Смысловые метки (⚔️ как «Сила Воина» в тексте) → иконка + текст.
 *
 * Запуск: node tools/field-emoji-to-icons.js [--apply]
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'public', 'mobile-app', 'src', 'pages', 'field');
const APPLY = process.argv.includes('--apply');

/* Карта замен: эмодзи в JSX → JSX-иконка. Обрабатываем только явные UI-места. */
const MAP = [
  // Табы рейтинга
  { from: "label: '⚔️ Рейтинг'", to: "label: 'Рейтинг'", icon: 'Swords' },
  { from: "label: '🌊 Трубы'", to: "label: 'Трубы'", icon: 'Waves' },
  { from: "label: '🧪 Химцех'", to: "label: 'Химцех'", icon: 'FlaskConical' },
  { from: "label: '🏆 Турнир'", to: "label: 'Турнир'", icon: 'Trophy' },
  { from: "label: '⚔️ Сила'", to: "label: 'Сила'", icon: 'Swords' },
  // Инлайн-текст: «⚔️» после числа → убираем (остаётся число + подпись)
  { from: ' ⚔️</span>', to: '</span>' },
  { from: "'⚔️ Битва за Вальхаллу'", to: "'Битва за Вальхаллу'" },
  { from: 'по Силе Воина ⚔️ за', to: 'по Силе Воина за' },
  { from: "'>⚔️<'", to: "'>'<" },
];

const report = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.jsx'))) {
  const p = path.join(DIR, f);
  let s = fs.readFileSync(p, 'utf8');
  const before = (s.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  if (!before) continue;
  let changed = 0;
  for (const m of MAP) {
    if (s.includes(m.from)) { s = s.split(m.from).join(m.to); changed++; }
  }
  const after = (s.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  report.push({ f, before, after, changed });
  if (APPLY && changed) fs.writeFileSync(p, s, 'utf8');
}

report.sort((a, b) => b.before - a.before);
console.log(`# Эмодзи → иконки (${APPLY ? 'APPLY' : 'DRY-RUN'})\n`);
console.log('| файл | эмодзи было | стало | замен |');
console.log('|---|--:|--:|--:|');
for (const r of report) console.log(`| ${r.f} | ${r.before} | ${r.after} | ${r.changed} |`);
console.log(`\nвсего эмодзи: ${report.reduce((t, r) => t + r.before, 0)} → ${report.reduce((t, r) => t + r.after, 0)}`);
if (!APPLY) console.log('Запуск с --apply.');
