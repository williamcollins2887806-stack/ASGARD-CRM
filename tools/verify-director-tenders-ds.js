// Финальный аудит: несуществующие классы и хардкод-цвета на странице согласования тендеров.
const fs = require('fs');

const files = {
  'TenderApprovals': 'public/mobile-app/src/pages/director/TenderApprovals.jsx',
  'widgets/index': 'public/mobile-app/src/widgets/index.js',
  'More': 'public/mobile-app/src/pages/More.jsx',
};

const bad = [
  'm-card', 'btn mini', 'btn ghost', '"muted"', 'pill mini', '"inp"',
  'className="btn"', 'border-red-500',
];

for (const [name, f] of Object.entries(files)) {
  const t = fs.readFileSync(f, 'utf8');
  console.log('\n=== ' + name + ' (' + t.split('\n').length + ' строк) ===');
  let total = 0;
  for (const p of bad) {
    const n = t.split(p).length - 1;
    if (n) { console.log('  ПЛОХО ' + p + ' -> ' + n); total += n; }
  }
  console.log(total === 0 ? '  чисто: несуществующих классов нет' : '  осталось: ' + total);
}

// Хардкод-цвета на странице
const t = fs.readFileSync(files.TenderApprovals, 'utf8');
const hex = (t.match(/#[0-9a-fA-F]{6}\b/g) || []);
console.log('\nхардкод hex-цветов на странице:', hex.length, hex.slice(0, 8).join(' '));

// Используемые классы дизайн-системы
console.log('\n=== используются классы системы ===');
['card-glass', 'status-badge', 'input-field', 'filter-pill', 'spring-tap', 'c-primary', 'c-secondary', 'c-tertiary'].forEach((c) => {
  const n = t.split(c).length - 1;
  console.log('  .' + c.padEnd(14) + (n ? 'да (' + n + ')' : 'нет'));
});

// Табы
const tabs = (t.match(/label: '([^']+)'/g) || []);
console.log('\nтабы:', tabs.join(', '));
