/**
 * Негативный контроль гейта D-348.
 *
 * Возвращает СТАРЫЙ обработчик вкладки (хэш + refreshUI одновременно) —
 * тот самый, из-за которого страница грузилась дважды, — прогоняет гейт и
 * восстанавливает файл. Если гейт не краснеет, он бесполезен.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const FILE = 'public/assets/js/pm_duty.js';
const BACKUP = '_pm_duty_backup.js';

const original = fs.readFileSync(FILE, 'utf8');
fs.writeFileSync(BACKUP, original);

const OLD_HANDLER = [
  "          location.hash = '#/pm-calculations?tab=' + next;",
  '          refreshUI();'
].join('\n');

const NEW_BLOCK = [
  "          const want = '#/pm-calculations?tab=' + next;",
  '          if (location.hash === want) refreshUI();',
  '          else location.hash = want;'
].join('\n');

if (!original.includes(NEW_BLOCK)) {
  console.log('НЕ НАШЁЛ новый блок обработчика — проверьте форматирование в pm_duty.js');
  process.exit(2);
}

const broken = original.replace(NEW_BLOCK, OLD_HANDLER);
fs.writeFileSync(FILE, broken);
console.log('старый обработчик возвращён:', broken !== original);

let out = '';
let code = 0;
try {
  out = execFileSync('node', ['tools/verify-d348-tabs.js'], { encoding: 'utf8' });
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '');
  code = e.status || 1;
}

// Восстанавливаем файл в любом случае.
fs.writeFileSync(FILE, original);
fs.unlinkSync(BACKUP);

const fails = out.split('\n').filter((l) => /FAIL|ИТОГ/.test(l));
console.log(fails.join('\n'));

const restored = fs.readFileSync(FILE, 'utf8') === original;
console.log('файл восстановлен побайтово:', restored);

if (code === 0) {
  console.log('\nПРОБЛЕМА: гейт НЕ покраснел на сломанном коде — он бесполезен');
  process.exit(1);
}
console.log('\nOK: гейт покраснел на сломанном коде (exit ' + code + ')');
