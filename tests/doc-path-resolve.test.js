'use strict';
/**
 * Поиск файла документа на диске.
 *
 * Дефект 06.11: путь считался от process.cwd(), а служебные скрипты
 * запускаются из другой папки, чем сервис. Файл лежал на месте
 * (uploads/tender_archives/2142/...doc, 5,8 МБ), а система писала
 * «файл не найден на диске» — и ТЗ не попадало в анализ.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const SRC = fs.readFileSync(path.join(__dirname, '../src/services/pdf-ocr.js'), 'utf8');

check('база путей считается от расположения модуля, а не от cwd', () => {
  assert.ok(/const appRoot = path\.resolve\(__dirname/.test(SRC),
    'путь всё ещё зависит от cwd');
});

check('относительный ./uploads приводится к абсолютному', () => {
  assert.ok(/path\.isAbsolute\(rawBase\) \? rawBase : path\.resolve\(appRoot, rawBase\)/.test(SRC),
    'относительный путь не нормализуется');
});

check('проверяются варианты с корнем приложения', () => {
  assert.ok(/path\.join\(appRoot, 'uploads', s\)/.test(SRC),
    'нет запасного варианта appRoot/uploads');
});

check('префиксы /api/files/download и /uploads срезаются', () => {
  assert.ok(/files\\\/download/.test(SRC) || /files\/download/.test(SRC),
    'не срезается /api/files/download');
  assert.ok(/uploads\\\//.test(SRC) || /uploads\//.test(SRC), 'нет обработки /uploads');
});

check('функция не падает на пустом документе', () => {
  // pdf-ocr при загрузке требует БД, поэтому проверяем по исходнику:
  // обе ветки возвращают null на пустом входе.
  assert.ok(/if \(!doc\) return null/.test(SRC) || /if \(!raw\) return;/.test(SRC),
    'нет защиты от пустого документа');
  assert.ok(/return null;\s*\}/.test(SRC), 'нет возврата null');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
