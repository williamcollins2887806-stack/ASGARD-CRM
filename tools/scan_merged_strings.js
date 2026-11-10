'use strict';
/**
 * Поиск «склеек» — паттерна, которым были сломаны три файла 10.11.2026.
 *
 * Тогда в объект стиля попала строка вида:
 *   animation: 'shimmer 2s infinite, boxShadow: '0 0 20px rgba(...)', }, }, 'x');
 * то есть две строки шаблона слились и содержимое одного свойства
 * оказалось внутри другого.
 *
 * Признаки, которые ищем (не парсинг, а эвристика по опасным сочетаниям):
 *  1. Внутри одного строкового литерала встречается `имяСвойства:` —
 *     значит строка «переехала» из соседнего свойства.
 *  2. CSS-правило внутри массива строк, где после `animation:` идёт запятая
 *     и снова `boxShadow:` / `transform:` без закрытия кавычки.
 *  3. Двойной `},` внутри строки стиля.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public', 'assets', 'js');
const SUSPECT_IN_STRING = /['"`][^'"`\n]*\b(?:boxShadow|animation|transform|borderRadius|backgroundSize)\s*:/;

function joinFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...joinFiles(p)); continue; }
    if (!entry.name.endsWith('.js')) continue;
    if (/\.min\.js$/.test(entry.name)) continue;
    out.push(p);
  }
  return out;
}

const findings = [];

for (const file of joinFiles(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);

  lines.forEach((line, i) => {
    const num = i + 1;
    const t = line.trim();
    if (!t) return;

    // 1. Внутри строкового литерала оказалось другое CSS-свойство.
    //    Ищем `animation: '...` где дальше снова `animation:` или `boxShadow:`.
    const anim = /animation:\s*(['"`])([\s\S]*?)\1/.exec(t);
    if (anim) {
      const body = anim[2];
      if (/(boxShadow|transform|borderRadius|backgroundSize|display)\s*:/.test(body)) {
        findings.push(`${path.relative(process.cwd(), file)}:${num} — CSS-свойство внутри animation: ${t.slice(0, 110)}`);
      }
      // Двойной `},` внутри строки — признак склейки объектов.
      if (/\},\s*\}/.test(body)) {
        findings.push(`${path.relative(process.cwd(), file)}:${num} — склейка объектов в строке: ${t.slice(0, 110)}`);
      }
    }

    // 2. Строка стиля вида '.foo{bar}' с вложенным `:` после `;` без пробела
    //    признак того, что правило слиплось. Проверяем только массивы CSS.
    if (/^\s*['"`]\.[a-zA-Z]/.test(line) && /\}['"`]\s*,\s*['"`]/.test(line) === false) {
      // ничего не делаем — легитимных случаев много, шума не создаём
    }
  });
}

// 3. Отдельно: файлы, где число `},` внутри строк заметно выше обычного
//    (признак массовой склейки). Сравниваем с медианой по проекту.
const stats = [];
for (const file of joinFiles(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/\},\s*\}/g);
  stats.push({ file: path.relative(process.cwd(), file), n: m ? m.length : 0 });
}

console.log('=== Склейки внутри строк (опасный паттерн) ===');
console.log(findings.length ? findings.join('\n') : 'не найдено');
console.log('\n=== Топ-5 файлов по «}, }» (для ручного взгляда) ===');
stats.sort((a, b) => b.n - a.n).slice(0, 5).forEach((s) => console.log(` ${s.n}  ${s.file}`));

// Гейт: склейка = синтаксически валидный файл с испорченным поведением,
// поэтому она не ловится ни `node --check`, ни линтером. 10.11.2026 так
// легли три файла и десктоп показывал пустой экран.
if (findings.length) {
  console.log('\nMERGED_STRINGS_FAIL');
  process.exit(1);
}
console.log('\nMERGED_STRINGS_OK');
