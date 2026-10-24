/**
 * ОТКАТ эксперимента с геометрией тап-бара (24.10.2026).
 *
 * Что было не так. Я сдвигал бар формулой `bottom: calc(100dvh − 100lvh)`, считая,
 * что так он встанет на ФИЗИЧЕСКИЙ низ экрана. Ошибка: на iOS `position: fixed`
 * обрезается по layout viewport, поэтому выдвинутый вниз бар просто ОТРЕЗАЛСЯ —
 * «половина тап-бара не видна».
 *
 * Что делает скрипт: возвращает резерв под бар к полной высоте `--tabbar-total`,
 * то есть к состоянию, когда бар стоит на `bottom: 0` и полностью виден.
 *
 * Скрипт идемпотентен. Запуск:
 *   node tools/revert-tabbar-padding.js --check
 *   node tools/revert-tabbar-padding.js
 */
const fs = require('fs');
const path = require('path');

const SRC = 'public/mobile-app/src';
const CHECK = process.argv.includes('--check');

// Обратная замена: было «с учётом зазора», стало «полная высота».
const NEW = "calc(max(0px, var(--tabbar-total) + var(--tabbar-lift, 0px)) + 16px)";
const OLD = "calc(var(--tabbar-total) + 16px)";

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsx')) out.push(p);
  }
  return out;
};

const files = walk(SRC);
let changed = 0;
const hits = [];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes(NEW)) continue;
  const n = src.split(NEW).length - 1;
  hits.push({ f, n });
  if (!CHECK) {
    fs.writeFileSync(f, src.split(NEW).join(OLD));
    changed += n;
  }
}

console.log(CHECK ? '=== найдено для отката ===' : '=== откачено ===');
for (const h of hits) console.log(`  ${h.n}  ${path.relative(process.cwd(), h.f)}`);
console.log(`\n  файлов: ${hits.length}, замен: ${CHECK ? hits.reduce((s, h) => s + h.n, 0) : changed}`);

if (CHECK) {
  console.log('\n(--check: файлы не менялись)');
  process.exit(hits.length ? 1 : 0);
}

const left = [];
for (const f of walk(SRC)) {
  if (fs.readFileSync(f, 'utf8').includes(NEW)) left.push(path.relative(process.cwd(), f));
}
console.log(left.length ? 'ОСТАЛОСЬ: ' + left.join(', ') : 'остатков нет');
process.exit(left.length ? 1 : 0);
