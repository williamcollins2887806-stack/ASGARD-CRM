/**
 * Перестройка customer-letter-tpl.docx: добавить шапку с реквизитами ООО Асгард-Сервис
 * (как у director-report-tpl). Использует pizzip для in-place XML editing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'templates', 'customer-letter-tpl.docx');
const BAK = SRC + '.bak_' + Date.now();

const content = fs.readFileSync(SRC);
fs.writeFileSync(BAK, content);
console.log('Backup →', BAK);

const zip = new PizZip(content);
let xml = zip.file('word/document.xml').asText();

// Шапка-бланк (5 параграфов, центрированных, мелкий шрифт).
// Стиль аналогичен director-report-tpl: Arial, серый, центр.
const SENDER_HEADER = [
  ['ООО «Асгард-Сервис»', { bold: true, size: 24 }],
  ['105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37', { size: 18 }],
  ['ИНН/КПП: 7736244785 / 770101001', { size: 18 }],
  ['info@asgard-service.com   ·   +7 (499) 322-30-62', { size: 18 }],
  ['', { size: 18 }]  // отступ
].map(([text, opts]) => {
  const sz = opts.size || 22;
  const bold = opts.bold ? '<w:b/>' : '';
  return `<w:p>` +
    `<w:pPr><w:jc w:val="center"/><w:spacing w:after="60"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${bold}<w:sz w:val="${sz}"/><w:color w:val="595959"/></w:rPr>` +
    `<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}).join('');

// Ищем <w:body> и вставляем шапку сразу после него.
const bodyStart = xml.indexOf('<w:body>');
if (bodyStart === -1) {
  console.error('w:body not found');
  process.exit(1);
}
const insertPos = bodyStart + '<w:body>'.length;
const before = xml.slice(0, insertPos);
const after = xml.slice(insertPos);

xml = before + SENDER_HEADER + after;

zip.file('word/document.xml', xml);
const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(SRC, out);
console.log('Готово →', SRC, '(', out.length, 'байт )');
