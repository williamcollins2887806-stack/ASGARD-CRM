/**
 * Мутант D-295: отключает сбор info_days в field-manage.js (копия в %TEMP%).
 * Гейт обязан покраснеть (I1/I5), иначе проверка тавтологична.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'routes', 'field-manage.js');
const dst = path.join(__dirname, '..', 'src', 'routes', 'field-manage.mutant.js');

let code = fs.readFileSync(src, 'utf8');
const marker = /const infoByEmp = \{\};(\r?\n\s*)if \(rosterIds\.length\) \{/;
if (!marker.test(code)) {
  console.error('MUTANT: якорь не найден — проверка невозможна');
  process.exit(2);
}
// Ломаем ровно то, что даёт видимость в UI: сбор info-дней отключается.
code = code.replace(marker, 'const infoByEmp = {};$1if (rosterIds.length && false) { /* MUTANT */');
fs.writeFileSync(dst, code, 'utf8');
console.log('MUTANT_PATH=' + dst);
