'use strict';
/**
 * Правка подписей итогов в шаблоне КП `templates/full-kp-nika-tpl.docx`.
 *
 * Два дефекта в одном месте:
 *
 * 1. Подписи стояли капсом («ИТОГО БЕЗ НДС», «ИТОГО С НДС») — выбивались из
 *    остальной вёрстки документа.
 * 2. Не было двоеточия после подписи. В таблице это читается как «Итого с НДС
 *    [сумма]» без связки; гейт `tests/tkp-vat-consistency.test.js` закрепляет
 *    формат «Итого с НДС: <сумма>» и падал именно на этом, хотя суммы в
 *    документе были верные.
 *
 * Правка идёт по точному тегу `<w:t>…</w:t>`, поэтому:
 *  - теги и оформление (жирность, цвет, размер) не затрагиваются;
 *  - повторный запуск ничего не меняет (после замены тег другой).
 *
 * Запуск: node tools/fix_kp_totals_labels.js
 */
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const TPL = path.join(__dirname, '..', 'templates', 'full-kp-nika-tpl.docx');

// [что ищем в w:t, что должно остаться после правки]
const LABELS = [
  ['Итого без НДС', 'Итого без НДС:'],
  ['Итого с НДС', 'Итого с НДС:'],
  // Легаси-капс: мог остаться в копиях шаблона.
  ['ИТОГО БЕЗ НДС', 'Итого без НДС:'],
  ['ИТОГО С НДС', 'Итого с НДС:']
];

const zip = new AdmZip(TPL);
const entry = zip.getEntry('word/document.xml');
if (!entry) {
  console.error('FAIL: в шаблоне нет word/document.xml');
  process.exit(1);
}

let xml = entry.getData().toString('utf8');
const applied = [];

LABELS.forEach(([from, to]) => {
  const needle = '<w:t>' + from + '</w:t>';
  if (!xml.includes(needle)) return;
  const count = xml.split(needle).length - 1;
  xml = xml.split(needle).join('<w:t>' + to + '</w:t>');
  applied.push('"' + from + '" → "' + to + '" (×' + count + ')');
});

if (!applied.length) {
  console.log('OK: подписи уже в нужном виде, правка не требуется');
  process.exit(0);
}

zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
fs.writeFileSync(TPL, zip.toBuffer());
console.log('OK: шаблон обновлён');
applied.forEach((line) => console.log('  ' + line));
