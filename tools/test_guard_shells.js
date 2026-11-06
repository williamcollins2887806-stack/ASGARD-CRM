/**
 * Негативный контроль: сторож оболочек реально ловит подмену /h/ копией /.
 * Если проверка не падает на подделке — она бесполезна.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HUG = path.join(ROOT, 'public/h/index.html');
const backup = fs.readFileSync(HUG, 'utf8');

let caught = false;
try {
  // Подмена: /h/ становится копией основного index.html — ровно дефект 06.11.
  fs.writeFileSync(HUG, fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'), 'utf8');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'guard_shells.js')], { stdio: 'pipe' });
    caught = false;
  } catch (_) {
    caught = true;
  }
} finally {
  fs.writeFileSync(HUG, backup, 'utf8');
}

// Убеждаемся, что файл вернулся целым.
const ok = fs.readFileSync(HUG, 'utf8') === backup;
console.log(`подмена /h/ поймана: ${caught ? 'ДА' : 'НЕТ — сторож бесполезен'}`);
console.log(`/h/ восстановлен: ${ok ? 'ДА' : 'НЕТ'}`);

if (!caught || !ok) process.exitCode = 1;
