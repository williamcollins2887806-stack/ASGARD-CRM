'use strict';
/**
 * Чтение старых офисных форматов: .doc (OLE2) и .xls.
 *
 * Дефект 06.11:
 *  • .doc вообще не был в SUPPORTED_TEXT, поэтому парсер сразу возвращал
 *    "unsupported" и документ сохранялся с 0 символов. ТЗ Ангарского завода
 *    полимеров (5,8 МБ) не читалось — а в нём объёмы: 51 м², 87,1 м², 76 шт.
 *  • LibreOffice на сервере умеет и .doc, и .xls, но parser его не звал.
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

const PARSER = fs.readFileSync(path.join(__dirname, '../src/services/tkp-parser.js'), 'utf8');

check('.doc есть в списке поддерживаемых форматов', () => {
  const m = /const SUPPORTED_TEXT\s*=\s*new Set\(\[([^\]]+)\]\)/.exec(PARSER);
  assert.ok(m, 'список не найден');
  assert.ok(/'\.doc'/.test(m[1]), '.doc отсутствует — документ уйдёт в unsupported');
});

check('есть отдельная ветка чтения .doc', () => {
  assert.ok(/if \(ext === '\.doc'\) \{/.test(PARSER), 'нет ветки .doc');
});

check('.doc читается через LibreOffice', () => {
  assert.ok(/_docViaLibreOffice/.test(PARSER), 'нет функции LibreOffice для .doc');
  const m = /function _docViaLibreOffice[\s\S]{0,1400}/.exec(PARSER);
  assert.ok(m, 'функция не найдена');
  assert.ok(/txt:Text/.test(m[0]), 'нет конвертации в txt');
  assert.ok(/docx/.test(m[0]), 'нет запасного пути через docx');
  assert.ok(/MAX_TEXT_CHARS/.test(m[0]), 'нет ограничения длины');
});

check('.xls читается через LibreOffice (CSV)', () => {
  assert.ok(/_xlsViaLibreOffice/.test(PARSER), 'нет функции для .xls');
  const m = /function _xlsViaLibreOffice[\s\S]{0,1200}/.exec(PARSER);
  assert.ok(m && /csv/.test(m[0]), 'конвертация не в CSV');
});

check('порог 20 символов: пустой результат не считается успехом', () => {
  const m = /function _docViaLibreOffice[\s\S]{0,1600}/.exec(PARSER);
  assert.ok(/length >= 20/.test(m[0]), 'пустой текст может быть принят за успех');
});

check('поиск binaries включает Linux и Windows', () => {
  const m = /function _docViaLibreOffice[\s\S]{0,800}/.exec(PARSER);
  assert.ok(/soffice/.test(m[0]), 'нет soffice');
  assert.ok(/LibreOffice/.test(m[0]), 'нет пути Windows');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
