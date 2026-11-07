/**
 * Негативный контроль сторожа оболочек. Три дефекта, все реальные:
 *   1) деплой 06.11 затёр /h/ копией /              → должен ловиться;
 *   2) D-396: сторож /h/ без защёлки (нет логики)    → должен ловиться;
 *   3) D-396: тело защёлки ВЫРЕЗАНО, имена оставлены → должен ловиться
 *      (этот случай верификатор нашёл: старый гейт был зелёным).
 * Если проверка не падает на подделке — она бесполезна.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HUG = path.join(ROOT, 'public/h/index.html');
const GUARD = path.join(__dirname, 'guard_shells.js');
const backup = fs.readFileSync(HUG, 'utf8');

let failures = 0;
function report(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures += 1;
}

function guardFails() {
  try {
    execFileSync(process.execPath, [GUARD], { stdio: 'pipe' });
    return false;
  } catch (_) {
    return true;
  }
}

try {
  // ── 1. Подмена: /h/ становится копией основного index.html — дефект 06.11.
  fs.writeFileSync(HUG, fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'), 'utf8');
  report('подмена /h/ копией / поймана', guardFails());

  // ── 2. Сторож без защёлки: имена убраны целиком.
  const noNames = backup
    .replace(/_hg_shell_reload_/g, '_removed_lock_')
    .replace(/triedThisVersion\s*\(/g, 'removedLatch(')
    .replace(/alreadyTried\s*\(/g, 'removedLatch2(');
  fs.writeFileSync(HUG, noNames, 'utf8');
  report('сторож без защёлки (имён нет) пойман', guardFails());

  // ── 3. Тело защёлки вырезано, но имена оставлены. Ровно эта мутация
  // обходила прежний гейт: он искал подстроки и не смотрел на связь
  // «проверка защёлки → баннер» и на подтверждение записи чтением.
  const gutted = backup
    .replace(/return\s+sessionStorage\.getItem\(\s*k\s*\)\s*!==\s*'1'/,
      'return false /* gutted: запись не подтверждается */')
    .replace(/if\s*\(\s*triedThisVersion\(\s*j\.version\s*\)\s*\)\s*\{\s*showReloadNotice\(\s*j\.version\s*\)\s*;\s*return;\s*\}/,
      'triedThisVersion(j.version); /* gutted: решения нет, сразу релоад */');
  fs.writeFileSync(HUG, gutted, 'utf8');
  const guttedCaught = guardFails();
  fs.writeFileSync(HUG, backup, 'utf8');
  report('вырезанное тело защёлки (имена есть) поймано', guttedCaught);

  // ── 4. Проверка «маркеров СРМ» не должна быть тавтологичной: если из /
  // убрать сами маркеры-различители, пункт обязан покраснеть, а не молча PASS.
  // Проверяем это на копии через env-переменную нельзя, поэтому фиксируем
  // факт наличия маркеров в текущем /.
  const main = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const hasMarkers = ['ASGARD_SHELL_VERSION', 'swUpdateBanner'].some((m) => main.includes(m));
  report('в / есть маркеры-различители (проверка не пустая)', hasMarkers);
} finally {
  fs.writeFileSync(HUG, backup, 'utf8');
}

// Убеждаемся, что файл вернулся целым до байта.
const restored = fs.readFileSync(HUG, 'utf8') === backup;
report('/h/ восстановлен побайтово', restored);

console.log(failures ? `\nИТОГ: FAIL — ${failures}` : '\nИТОГ: OK — все дефекты ловятся');
process.exitCode = failures ? 1 : 0;
