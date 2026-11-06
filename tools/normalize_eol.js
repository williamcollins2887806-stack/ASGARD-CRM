/**
 * Нормализует переводы строк в файлах оболочки к LF.
 *
 * Зачем: index.html / sw.js лежат в git с LF, а редактор на Windows при
 * сохранении подставляет CRLF. Диф раздувается на весь файл, и проверять
 * деплой становится невозможно — видно 300 изменённых строк вместо двух.
 *
 *   node tools/normalize_eol.js --check
 *   node tools/normalize_eol.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'public/index.html',
  'public/sw.js',
  'public/h/index.html',
  'public/h/sw.js'
];

const check = process.argv.includes('--check');
let changed = 0;

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const raw = fs.readFileSync(abs, 'utf8');
  if (!raw.includes('\r\n')) continue;
  changed += 1;
  if (check) {
    console.log(`CRLF: ${rel}`);
    continue;
  }
  fs.writeFileSync(abs, raw.replace(/\r\n/g, '\n'), 'utf8');
  console.log(`нормализован: ${rel}`);
}

if (check) {
  console.log(changed ? `\nитог: ${changed} файл(ов) с CRLF` : 'итог: все файлы с LF');
  process.exitCode = changed ? 1 : 0;
}
