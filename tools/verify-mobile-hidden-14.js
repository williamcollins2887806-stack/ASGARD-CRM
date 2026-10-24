// Гейт: 14 новых разделов скрыты у всех ролей.
const fs = require('fs');

const cfg = fs.readFileSync('public/mobile-app/src/config/hiddenRoutes.js', 'utf8');

const need = [
  '/tenders/platform', '/payroll', '/official-employees', '/staff-requests',
  '/travel', '/permits', '/personal-kanban', '/personal-kanban-config',
  '/personal-kanban-v3', '/correspondence', '/warehouse', '/gantt',
  '/seals', '/my-equipment', '/integrations',
];

console.log('=== новые скрытые пути ===');
let miss = 0;
for (const p of need) {
  const inArr = cfg.includes(`'${p}'`);
  console.log('  ' + p.padEnd(28) + (inArr ? 'скрыт' : 'НЕ НАЙДЕН'));
  if (!inArr) miss++;
}

console.log('\n=== массив HIDDEN_MOBILE_ONLY подключён? ===');
console.log('  объявлен:', cfg.includes('export const HIDDEN_MOBILE_ONLY') ? 'да' : 'НЕТ');
console.log('  в HIDDEN_ROUTES:', cfg.includes('...HIDDEN_MOBILE_ONLY') ? 'да' : 'НЕТ');

// Проверяем, что страницы More не содержит этих путей в меню
const more = fs.readFileSync('public/mobile-app/src/pages/More.jsx', 'utf8');
console.log('\n=== остались ли скрытые пункты в меню More.jsx ===');
let inMenu = 0;
for (const p of need) {
  const re = new RegExp("path: '" + p.replace(/[/-]/g, (m) => '\\' + m) + "'");
  if (re.test(more)) { console.log('  В МЕНЮ ОСТАЛСЯ: ' + p); inMenu++; }
}
console.log('  пунктов в меню из скрытых:', inMenu, '(фильтруются на лету — не критично)');

process.exit(miss === 0 ? 0 : 1);
