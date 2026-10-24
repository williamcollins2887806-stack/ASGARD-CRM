/**
 * Гейт: на страницах мобильного приложения не должно быть вызовов методов,
 * которых нет в API хуков/утилит. Класс дефекта, найденный 23.10.2026 (D-341):
 * `haptic.selection()` и `haptic.impact('medium')` — таких методов в
 * useHaptic нет; из-за optional chaining ошибка не падала, но вибрации
 * на табах и при решении директора не было вообще.
 *
 * Проверяются все реальные методы useHaptic и несуществующие «популярные» имена,
 * которые легко придумать по аналогии.
 */
const fs = require('fs');
const path = require('path');

const SRC = 'public/mobile-app/src';

// Реальные методы хука — читаются из файла, а не хардкодятся.
const hapticSrc = fs.readFileSync(path.join(SRC, 'hooks/useHaptic.js'), 'utf8');
const realMethods = [...hapticSrc.matchAll(/const (\w+) = useCallback/g)].map((m) => m[1]);
console.log('реальные методы useHaptic:', realMethods.join(', '));

// Имена, которых в API нет (частые выдумки по аналогии с другими библиотеками).
const HALLUCINATED = ['selection', 'selectionChanged', 'impact', 'notify', 'warning', 'tap', 'click'];

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(p);
  }
  return out;
};

const files = walk(SRC);
let bad = 0;
const hits = [];

for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of HALLUCINATED) {
    // Ищем haptic.selection(...) или haptic?.selection(...) — вызов, не упоминание.
    const re = new RegExp('haptic\\??\\.' + m + '\\???\\s*\\(', 'g');
    const n = (t.match(re) || []).length;
    if (n) {
      hits.push({ f: path.relative(SRC, f), m, n });
      bad += n;
    }
  }
  // Общий случай: любой haptic.<метод>( где метод не из реальных
  const anyRe = /haptic\??\.(\w+)\??\s*\(/g;
  let match;
  while ((match = anyRe.exec(t)) !== null) {
    const name = match[1];
    if (!realMethods.includes(name) && !HALLUCINATED.includes(name)) {
      hits.push({ f: path.relative(SRC, f), m: name, n: 1 });
      bad++;
    }
  }
}

console.log('\n=== файлов проверено:', files.length, '===');
if (!hits.length) {
  console.log('  чисто: все вызовы haptic.* существуют в API');
} else {
  console.log('  НАЙДЕНЫ вызовы несуществующих методов:');
  for (const h of hits) console.log('    ' + h.f + ' -> haptic.' + h.m + '()');
}

console.log('\n' + (bad === 0 ? 'ИТОГ: OK' : 'ИТОГ: FAIL — ' + bad + ' вызовов'));
process.exit(bad === 0 ? 0 : 1);
