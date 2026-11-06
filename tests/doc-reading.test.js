'use strict';
/**
 * Чтение документов: архивы и офисные форматы.
 *
 * Два дефекта 06.11, из-за которых анализ не видел объёмов:
 *  1) 7-Zip и unrar стоят на Windows, но НЕ в PATH → spawn('7z') падал
 *     с ENOENT, и вложенные .7z внутри zip молча терялись (9 архивов из 14).
 *  2) ExcelJS читает только .xlsx и падает на файлах с картинками
 *     («reading 'anchors'») и на старом OLE .xls («Can't find end of
 *     central directory»). Такие документы загружались с 0 символов.
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

const ARCH = fs.readFileSync(path.join(__dirname, '../src/services/archiveExtractor.js'), 'utf8');
const PARSER = fs.readFileSync(path.join(__dirname, '../src/services/tkp-parser.js'), 'utf8');

// ── Архивы ─────────────────────────────────────────────────────────────────
check('7-Zip ищется по типовым путям установки', () => {
  assert.ok(/TOOL_CANDIDATES/.test(ARCH), 'нет таблицы путей к инструментам');
  assert.ok(/Program Files\\\\7-Zip\\\\7z\.exe/.test(ARCH), 'нет пути к 7z на Windows');
  assert.ok(/WinRAR.*UnRAR\.exe/.test(ARCH), 'нет пути к UnRAR на Windows');
});

check('runCmd использует найденный путь, а не голое имя', () => {
  assert.ok(/const bin = resolveTool\(cmd\)/.test(ARCH), 'spawn идёт по голому имени');
  assert.ok(/spawn\(bin, args/.test(ARCH), 'спавн не по разрешённому пути');
});

check('пути к инструментам кэшируются', () => {
  assert.ok(/_toolCache/.test(ARCH), 'нет кэша — будет искать файлы каждый раз');
});

check('распаковка вложенных архивов включена', () => {
  assert.ok(/recursive/.test(ARCH), 'нет рекурсии по вложенным архивам');
  assert.ok(/'7z'/.test(ARCH), 'нет поддержки 7z');
  assert.ok(/'rar'/.test(ARCH), 'нет поддержки rar');
  assert.ok(/'zip'/.test(ARCH), 'нет поддержки zip');
});

// ── Офисные форматы ────────────────────────────────────────────────────────
check('.xls (OLE) читается через LibreOffice', () => {
  assert.ok(/_xlsViaLibreOffice/.test(PARSER), 'нет функции LibreOffice для .xls');
  assert.ok(/--convert-to/.test(PARSER), 'нет конвертации');
  assert.ok(/csv/.test(PARSER), 'конвертация не в CSV');
});

check('ExcelJS в try: падение на картинках не убивает чтение', () => {
  const m = /if \(ext === '\.xlsx' \|\| ext === '\.xls'\)[\s\S]{0,900}/.exec(PARSER);
  assert.ok(m, 'блок чтения xlsx/xls не найден');
  assert.ok(/try \{[\s\S]*exceljs/.test(m[0]), 'ExcelJS не в try');
});

check('есть запасной путь через SheetJS', () => {
  assert.ok(/require\('xlsx'\)/.test(PARSER), 'нет SheetJS как запасного пути');
  assert.ok(/sheet_to_csv/.test(PARSER), 'SheetJS не превращает лист в текст');
});

check('порядок попыток: ExcelJS → SheetJS → LibreOffice', () => {
  const m = /if \(ext === '\.xlsx' \|\| ext === '\.xls'\)[\s\S]*?return \{ text: '', usedOcr: false \};\s*\}/.exec(PARSER);
  assert.ok(m, 'блок не найден');
  const body = m[0];
  const iExcel = body.indexOf('exceljs');
  const iSheet = body.indexOf("require('xlsx')");
  const iLo = body.indexOf('_xlsViaLibreOffice');
  assert.ok(iExcel >= 0 && iSheet > iExcel && iLo > iSheet,
    `порядок неверный: exceljs@${iExcel}, xlsx@${iSheet}, libreoffice@${iLo}`);
});

check('пустой результат xlsx не считается успехом', () => {
  assert.ok(/trim\(\)\.length >= 20/.test(PARSER),
    'нет порога: пустой текст будет принят как успех');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
