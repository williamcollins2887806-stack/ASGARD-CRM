/**
 * Проверка, что в моих файлах нет мёртвых классов (которых нет в CSS)
 * и что все используемые токены объявлены. Только чтение.
 */
const fs = require('fs');
const path = require('path');

const FILES = [
  'public/mobile-app/src/widgets/DirectorTenderApprovalsWidget.jsx',
  'public/mobile-app/src/pages/director/TenderApprovals.jsx',
  'public/mobile-app/src/pages/director/Applications.jsx',
  'public/mobile-app/src/components/tenders/RegistryDetailSheet.jsx',
  'public/mobile-app/src/components/tenders/DocPreviewSheet.jsx',
  'public/mobile-app/src/components/tenders/EstimateInline.jsx',
  'public/mobile-app/src/pages/More.jsx',
  'public/mobile-app/src/widgets/WidgetShell.jsx',
];

// Классы, которых в системе НЕТ (проверено ранее по CSS).
const DEAD = ['m-card', 'btn mini', 'btn ghost', '"muted"', 'pill mini', '"inp"', 'className="btn"', 'red-500'];

// Собираем все классы, реально определённые в CSS.
const cssDir = 'public/mobile-app/src';
const cssFiles = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.css')) cssFiles.push(p);
  }
};
walk(cssDir);
let allCss = '';
for (const f of cssFiles) allCss += fs.readFileSync(f, 'utf8') + '\n';

// Системные утилиты Tailwind: проект использует их напрямую, объявлений в CSS нет.
const TW_OK = /^(flex|grid|w-|h-|text-|px-|py-|pt-|pb-|pl-|pr-|p-|m-|mt-|mb-|ml-|mr-|gap-|rounded|min-|max-|overflow|truncate|font-|items-|justify-|absolute|relative|fixed|inset|shrink|grow|leading|tracking|whitespace|border|inline-|uppercase|lowercase|capitalize|list-|space-|resize|align-|self-|order-|col-|row-|z-|top-|bottom-|left-|right-|opacity|shadow|transition|duration|ease-|cursor-|select-|pointer-|divide-|ring-|outline|sr-only|not-sr-only|object-|aspect-|basis-|flex-|place-|content-|isolate|mix-blend|filter|backdrop-|table|truncate|antialiased)/;

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

console.log('=== 1. Мёртвые классы ===');
let deadTotal = 0;
for (const f of FILES) {
  if (!fs.existsSync(f)) { bad('файла нет: ' + f); continue; }
  const t = fs.readFileSync(f, 'utf8');
  const hits = [];
  for (const p of DEAD) {
    const c = t.split(p).length - 1;
    if (c) hits.push(`${p}×${c}`);
  }
  if (hits.length) { bad(`${path.basename(f)}: ${hits.join(', ')}`); deadTotal += hits.length; }
}
if (!deadTotal) ok('мёртвых классов нет ни в одном файле');

console.log('\n=== 2. Классы из className есть в CSS или Tailwind ===');
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  const classes = new Set();
  for (const m of t.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\}|\{'([^']+)'\})/g)) {
    const raw = (m[1] || m[2] || m[3] || '');
    raw.split(/\s+/).filter(Boolean).forEach((c) => {
    // Отбрасываем условные выражения, интерполяции и остатки шаблонной строки.
      if (/[${}?():,]/.test(c)) return;
      // Убираем кавычки, если они прилипли к имени класса.
      classes.add(c.replace(/['"]/g, ''));
    });
  }
  const unknown = [...classes].filter((c) => {
    if (TW_OK.test(c)) return false;
    // системные классы проекта объявлены как `.имя` в CSS
    return !new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(allCss);
  });
  if (unknown.length) bad(`${path.basename(f)}: нет в CSS -> ${unknown.join(', ')}`);
}
if (fail === 0 || deadTotal === 0) ok('все className найдены в CSS или Tailwind');

console.log('\n=== 3. Токены var(--…) объявлены ===');
const declared = new Set([...allCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  const used = [...new Set([...t.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
  const missing = used.filter((x) => !declared.has(x));
  if (missing.length) bad(`${path.basename(f)}: необъявленные токены -> ${missing.join(', ')}`);
}
if (fail === 0) ok('все токены объявлены');

console.log('\n=== 4. Порядок слоёв предпросмотра и шторок ===');
const bs = fs.readFileSync('public/mobile-app/src/components/shared/BottomSheet.jsx', 'utf8');
const dp = fs.readFileSync('public/mobile-app/src/components/tenders/DocPreviewSheet.jsx', 'utf8');
const baseZ = Number((bs.match(/BASE_Z\s*=\s*(\d+)/) || [])[1] || 0);
/**
 * Ищем zIndex именно в КОДЕ, а не в комментариях: первая версия гейта поймала
 * число `60` из пояснения «было zIndex: 60» и выдала ложный FAIL.
 */
const dpCode = dp
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const prevZ = Number((dpCode.match(/zIndex:\s*(\d+)/) || [])[1] || 0);
console.log(`  BASE_Z шторок: ${baseZ} | zIndex предпросмотра: ${prevZ}`);
if (prevZ > baseZ) ok('предпросмотр ВЫШЕ шторок (файл виден поверх модалки)');
else bad(`предпросмотр ${prevZ} НЕ выше шторок ${baseZ} — файл будет за модалкой`);
if (/createPortal/.test(dp)) ok('предпросмотр рендерится в портал (как шторки)');
else bad('предпросмотр без портала — может оказаться под другими слоями');

console.log('\n=== 5. Виджет: клик внутри виджета ===');
const w = fs.readFileSync(FILES[0], 'utf8');
const shella = fs.readFileSync(FILES[7], 'utf8');
// WidgetShell не принимает onClick — значит клик должен быть внутри через button
const shellHasClick = /onClick/.test(shella);
if (!shellHasClick) {
  if (/<button[\s\S]{0,200}onClick/.test(w)) ok('клик внутри виджета через <button> (шелл кликом не наделён)');
  else bad('шелл не принимает onClick, и внутри виджета нет button — виджет не нажмётся');
} else {
  ok('WidgetShell принимает onClick');
}

console.log('\n' + (fail === 0
  ? 'ИТОГ: OK — классы, токены, слои и клик в порядке'
  : `ИТОГ: FAIL — ${fail} нарушений`));
process.exit(fail === 0 ? 0 : 1);
