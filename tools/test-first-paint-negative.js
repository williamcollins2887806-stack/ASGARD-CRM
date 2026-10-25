/**
 * Негативный контроль к гейту «первого кадра».
 *
 * Доказывает, что `verify-first-paint.js` РЕАЛЬНО ловит дефект: убираем
 * инлайн-стиль из `head` — гейт обязан покраснеть. Иначе его «OK» ничего не значит.
 *
 * Безопасность: правится ТОЛЬКО собранный `public/m/index.html` (это артефакт
 * сборки, он восстанавливается копированием из `dist` — исходник не трогаем).
 * Восстановление — в `finally`, плюс проверка побайтового совпадения.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const BUILT = 'public/m/index.html';
const SRC = 'public/mobile-app/dist/index.html';   // эталон сборки

const origBuilt = fs.readFileSync(BUILT, 'utf8');
const origSrc = fs.readFileSync(SRC, 'utf8');

let caught = false;
let restored = false;

try {
  // Мутация: вырезаем инлайн-стиль из head (имитируем прежнее состояние).
  const headEnd = origBuilt.indexOf('</head>');
  const head = origBuilt.slice(0, headEnd);
  const styleStart = head.indexOf('<style>');
  const styleEnd = head.indexOf('</style>', styleStart);
  if (styleStart < 0 || styleEnd < 0) {
    console.log('НЕ УДАЛОСЬ мутировать: инлайн-стиля в head нет (гейт и так должен падать)');
    process.exit(2);
  }
  const mutated = origBuilt.slice(0, styleStart) + origBuilt.slice(styleEnd + '</style>'.length);
  fs.writeFileSync(BUILT, mutated);

  try {
    const out = execFileSync('node', ['tools/verify-first-paint.js'], { encoding: 'utf8', stdio: 'pipe' });
    console.log('Мутация НЕ поймана (гейт зелёный) — проверка бесполезна:');
    console.log(out.split('\n').filter((l) => /ИТОГ/.test(l)).join('\n'));
  } catch (e) {
    caught = true;
    const out = ((e.stdout || '') + (e.stderr || '')).toString();
    console.log('Мутация поймана, exit code != 0:');
    out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 4)
      .forEach((l) => console.log('  ' + l.trim()));
  }
} finally {
  // Восстанавливаем ИЗ ЭТАЛОНА сборки — так гарантированно верное содержимое.
  fs.writeFileSync(BUILT, origSrc);
  restored = fs.readFileSync(BUILT, 'utf8') === origSrc;
  console.log('\npublic/m/index.html восстановлен из dist:', restored ? 'побайтово' : 'ОТЛИЧАЕТСЯ');
  if (!restored) console.log('  ВНИМАНИЕ: сравнить с резервом нужно вручную');
}

// После восстановления гейт обязан быть зелёным.
if (restored) {
  const after = execFileSync('node', ['tools/verify-first-paint.js'], { encoding: 'utf8', stdio: 'pipe' });
  console.log('после восстановления:', after.trim().split('\n').pop());
}

const okAll = caught && restored;
console.log('\n' + (okAll
  ? 'ИТОГ: негативный контроль ПРОЙДЕН — гейт ловит отсутствие первого кадра, файл цел'
  : `ИТОГ: FAIL — мутация ${caught ? 'поймана' : 'НЕ поймана'}, файл ${restored ? 'цел' : 'испорчен'}`));
process.exit(okAll ? 0 : 1);
