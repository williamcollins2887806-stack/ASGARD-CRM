/**
 * Негативный контроль к гейту скрытых разделов.
 *
 * Назначение: доказать, что гейт `verify-hidden-direct.js` РЕАЛЬНО ловит дефект,
 * а не просто печатает «OK». Мутируем конфиг (убираем один скрытый путь) и
 * требуем, чтобы гейт покраснел.
 *
 * ВАЖНО (урок 23.10.2026): первая версия этого скрипта восстанавливала файл
 * ПОСЛЕ проверки, и при падении `execFileSync` записывала исходник обратно, но
 * сам файл оставался мутированным, если процесс прерывался. Оба испытуемых
 * файла (hiddenRoutes.js, index.css) так и пострадали.
 *
 * Теперь защита тройная:
 *  1. восстановление — в `finally`, выполняется при любой ошибке;
 *  2. бэкап пишется НА ДИСК рядом (не только в память) — можно восстановить руками;
 *  3. после восстановления файл сверяется с бэкапом, и при расхождении скрипт
 *     печатает явную инструкцию, а не «успех».
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const F = 'public/mobile-app/src/config/hiddenRoutes.js';
const BAK = 'tests/reports/_hiddenRoutes.bak.js';
const MUTATE_FROM = "'/gantt',                    // Диаграмма Ганта";

// Бэкап на диск — страховка на случай, если процесс убьют.
const orig = fs.readFileSync(F, 'utf8');
fs.writeFileSync(BAK, orig);
console.log('бэкап сохранён:', BAK);

let caught = false;
let restored = false;

try {
  const mutated = orig.replace(MUTATE_FROM, '');
  if (mutated === orig) {
    // Не нашли строку — значит формат комментария поехал. Это тоже дефект теста.
    console.log('НЕ УДАЛОСЬ мутировать: не найдено "' + MUTATE_FROM + '"');
    process.exitCode = 2;
  } else {
    fs.writeFileSync(F, mutated);
    try {
      const out = execFileSync('node', ['tools/verify-hidden-direct.js'], { encoding: 'utf8', stdio: 'pipe' });
      console.log('Мутация НЕ поймана (гейт сказал OK) — гейт бесполезен:');
      console.log(out.split('\n').filter((l) => /ИТОГ/.test(l)).join('\n'));
    } catch (e) {
      caught = true;
      const out = ((e.stdout || '') + (e.stderr || '')).toString();
      console.log('Мутация поймана, exit code != 0:');
      out.split('\n').filter((l) => /FAIL|ИТОГ/.test(l)).slice(0, 3)
        .forEach((l) => console.log('  ' + l.trim()));
    }
  }
} finally {
  // Восстановление — гарантированно, при любом исходе.
  fs.writeFileSync(F, orig);
  restored = fs.readFileSync(F, 'utf8') === orig;
  console.log('файл восстановлен:', restored ? 'побайтово' : 'ОТЛИЧАЕТСЯ — проверь ' + BAK);
}

// Контроль: после восстановления гейт обязан быть зелёным.
if (restored) {
  const after = execFileSync('node', ['tools/verify-hidden-direct.js'], { encoding: 'utf8', stdio: 'pipe' });
  console.log('после восстановления:', after.trim().split('\n').pop());
  fs.unlinkSync(BAK);
}

const ok = caught && restored;
console.log('\n' + (ok
  ? 'ИТОГ: негативный контроль ПРОЙДЕН — гейт ловит дефект, файл цел'
  : 'ИТОГ: FAIL — ' + (!caught ? 'гейт не поймал дефект' : 'файл не восстановился')));
process.exit(ok ? 0 : 1);
