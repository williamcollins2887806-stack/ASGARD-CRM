// Аудит дизайн-системы страниц директора (D-341..D-343).
const fs = require('fs');
const path = require('path');

const files = [
  'public/mobile-app/src/pages/director/TenderApprovals.jsx',
  'public/mobile-app/src/pages/director/Applications.jsx',
  'public/mobile-app/src/components/tenders/RegistryDetailSheet.jsx',
];

const bad = ['m-card', 'btn mini', 'btn ghost', '"muted"', 'pill mini', '"inp"', '"className="btn"'];
const badClasses = ['m-card', 'btn mini', 'btn ghost', '"muted"', 'pill mini', '"inp"', 'className="btn"'];

// ── Собираем РЕАЛЬНЫЕ CSS-токены из стилей приложения ──────────────────────
const CSS_FILES = [
  'public/mobile-app/src/index.css',
  ...fs.readdirSync('public/mobile-app/src/styles', { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.css'))
    .map((e) => 'public/mobile-app/src/styles/' + e.name),
];
const knownTokens = new Set();
for (const f of CSS_FILES) {
  if (!fs.existsSync(f)) continue;
  const css = fs.readFileSync(f, 'utf8');
  for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) knownTokens.add(m[1]);
}
console.log('CSS-токенов известно:', knownTokens.size);

console.log('\n=== несуществующие классы и хардкод-цвета ===');
let total = 0;
const missingTokens = [];
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  let n = 0;
  for (const p of badClasses) n += t.split(p).length - 1;
  const hex = (t.match(/#[0-9a-fA-F]{6}\b/g) || []).length;
  const name = f.split('/').pop();
  console.log('  ' + name.padEnd(24) + 'плохих классов: ' + n + ' | hex: ' + hex);
  total += n + hex;

  // Ссылки на несуществующие токены: var(--foo) где --foo нет в CSS.
  // Ловит класс дефекта «выдуманный токен» (был --danger-soft).
  for (const m of t.matchAll(/var\((--[\w-]+)/g)) {
    if (!knownTokens.has(m[1])) missingTokens.push(name + ' -> ' + m[1]);
  }
}

console.log('\n=== несуществующие CSS-токены ===');
if (!missingTokens.length) {
  console.log('  чисто: все var(--…) объявлены в CSS');
} else {
  for (const x of [...new Set(missingTokens)]) console.log('  ' + x);
  total += missingTokens.length;
}

console.log('\n  ИТОГО нарушений:', total);
process.exit(total === 0 ? 0 : 1);

