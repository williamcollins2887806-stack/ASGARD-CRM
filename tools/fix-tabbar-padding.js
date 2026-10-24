/**
 * Разовая правка: заменить устаревший резерв под тап-бар во всех экранах.
 *
 * Почему. `--tabbar-total + 16px` резервирует ПОЛНУЮ высоту бара. Но с 23.10.2026
 * бар прижат к ФИЗИЧЕСКОМУ низу, и на iPhone он лежит в основном в зазоре вне
 * документа (`--tabbar-lift` ≈ −51px, `--app-gap` = 51px). Поэтому полный резерв
 * даёт ~51px лишней пустоты, а контент «отстаёт» от бара.
 *
 * Правильная формула — как в PageShell:
 *   calc(max(0px, var(--tabbar-total) + var(--tabbar-lift, 0px)) + 16px)
 *
 * Скрипт идемпотентен: уже исправленные места не трогает. Запуск:
 *   node tools/fix-tabbar-padding.js --check   # только показать
 *   node tools/fix-tabbar-padding.js           # исправить
 */
const fs = require('fs');
const path = require('path');

const SRC = 'public/mobile-app/src';
const CHECK = process.argv.includes('--check');

const OLD = "calc(var(--tabbar-total) + 16px)";
const NEW = "calc(max(0px, var(--tabbar-total) + var(--tabbar-lift, 0px)) + 16px)";

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
};

// CSS-файлы не трогаем: там переменная объявляется, а не резервируется.
const files = walk(SRC).filter((f) => f.endsWith('.jsx'));
let changed = 0;
const hits = [];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes(OLD)) continue;
  const n = src.split(OLD).length - 1;
  hits.push({ f, n });
  if (!CHECK) {
    fs.writeFileSync(f, src.split(OLD).join(NEW));
    changed += n;
  }
}

console.log(CHECK ? '=== найдено устаревших резервов ===' : '=== исправлено ===');
for (const h of hits) console.log(`  ${h.n}  ${path.relative(process.cwd(), h.f)}`);
console.log(`\n  файлов: ${hits.length}, замен: ${CHECK ? hits.reduce((s, h) => s + h.n, 0) : changed}`);

if (CHECK) {
  console.log('\n(--check: файлы не менялись)');
  process.exit(hits.length ? 1 : 0);
}

// Контроль: не осталось ли старой формулы.
const left = [];
for (const f of walk(SRC).filter((x) => x.endsWith('.jsx'))) {
  const src = fs.readFileSync(f, 'utf8');
  if (src.includes(OLD)) left.push(path.relative(process.cwd(), f));
}
console.log(left.length ? 'ОСТАЛОСЬ: ' + left.join(', ') : 'остатков нет');
process.exit(left.length ? 1 : 0);
