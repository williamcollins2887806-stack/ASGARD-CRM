#!/usr/bin/env node
'use strict';

/**
 * Смета живёт в ДВУХ копиях: серверной (`src/services/asgard-smeta.js`) и браузерной
 * (`public/assets/js/asgard_smeta.js`). Они обязаны совпадать по логике — расхождение
 * даёт разные `totals` в модалке и в письме/Excel.
 *
 * Источник истины — серверная копия. Этот скрипт пересобирает браузерную:
 *   node tools/build_smeta_mirror.js          # перезаписать
 *   node tools/build_smeta_mirror.js --check   # только проверить (exit 1 при расхождении)
 *
 * Проверку синхронности дублирует тест `tests/asgard-smeta-share.test.js`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'services', 'asgard-smeta.js');
const DST = path.join(ROOT, 'public', 'assets', 'js', 'asgard_smeta.js');

const OPEN = '(function (root) {\n';
const CLOSE = "})(typeof window !== 'undefined' ? window : globalThis);\n";

function buildMirror() {
  const src = fs.readFileSync(SRC, 'utf8');
  if (!src.includes('module.exports = {')) {
    throw new Error('src/services/asgard-smeta.js: не найден module.exports — структура файла изменилась');
  }
  const body = src.replace('module.exports = {', 'root.AsgardSmeta = {');
  if (!body.includes('root.AsgardSmeta = {')) {
    throw new Error('не удалось заменить module.exports на root.AsgardSmeta');
  }
  return OPEN + body.trimEnd() + '\n' + CLOSE;
}

/**
 * Переводы строк НЕ должны решать судьбу гейта (D-179).
 *
 * На Windows `core.autocrlf=true` отдаёт файлы в рабочее дерево с CRLF, а модуль,
 * сгенерированный в памяти, содержит LF. Побайтовое сравнение ловило это как
 * «копии разошлись», хотя логика идентична. Поэтому:
 *  - сравнение содержимого — по канонизированным LF;
 *  - на диск пишем в том же стиле, что уже у файла (не ломаем прод-паритет).
 */
function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n');
}

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const expected = buildMirror();
  const current = fs.existsSync(DST) ? fs.readFileSync(DST, 'utf8') : '';
  if (checkOnly) {
    if (normalizeEol(current) !== normalizeEol(expected)) {
      console.error('FAIL: public/assets/js/asgard_smeta.js разошёлся с src/services/asgard-smeta.js');
      console.error('Запустите: node tools/build_smeta_mirror.js');
      process.exit(1);
    }
    console.log('OK: копии сметы синхронны');
    return;
  }
  const eol = detectEol(current) === '\r\n' ? '\r\n' : detectEol(fs.readFileSync(SRC, 'utf8'));
  // Сначала канонизируем в LF (в buildMirror тело может прийти с CRLF из рабочего дерева),
  // и только потом переводим в целевой стиль — иначе получаем двойной `\r\r\n`.
  const lf = normalizeEol(expected);
  const out = eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
  fs.writeFileSync(DST, out, 'utf8');
  console.log('written', path.relative(ROOT, DST), out.length, 'bytes (eol=' +
    (eol === '\r\n' ? 'CRLF' : 'LF') + ')');
}

if (require.main === module) {
  main();
}

module.exports = { buildMirror, normalizeEol, detectEol, SRC, DST };
