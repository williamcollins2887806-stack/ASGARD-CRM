/**
 * Аудит D-220, часть 2: ищем все конструкции вида `/uploads/...` (статика!),
 * в которые подставляется имя/расширение, полученное от клиента.
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const hits = [];
for (const f of walk(SRC)) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/['"`]\/uploads\//.test(line) && !/uploads\/\$\{/.test(line)) return;
    hits.push({ rel, line: i + 1, code: line.trim().slice(0, 130) });
  });
}
hits.forEach((h) => console.log(`${h.rel}:${h.line}\n   ${h.code}`));
console.log('\nвсего мест, формирующих URL под /uploads/:', hits.length);
