/**
 * Перестройка шаблона templates/director-report-tpl.docx:
 *   - inline loops {#warnings}...{/warnings} → paragraph loops
 *   - подзаголовок: {project_subject_full} → {project_title_short}
 *   - добавляю абзацы метаданных «Кому/От/Дата/Основание» перед таблицей
 *   - страхующий strip пустых «—» полей через nullGetter в _renderDocxTemplate (уже есть)
 *
 * Запуск: node tools/rebuild-director-tpl.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'templates', 'director-report-tpl.docx');
const DST = path.join(ROOT, 'templates', 'director-report-tpl.docx');
const BAK = path.join(ROOT, 'templates', 'director-report-tpl.docx.bak_' + Date.now());

const content = fs.readFileSync(SRC);
fs.writeFileSync(BAK, content);
console.log('Backup →', BAK);

const zip = new PizZip(content);
let xml = zip.file('word/document.xml').asText();
const origLen = xml.length;

/* 1) Подзаголовок: project_subject_full → project_title_short.
 *    Заменяем в плейсхолдере (и в backward-compat dual везде где встречается). */
xml = xml.replace(/\{project_subject_full\}/g, '{project_title_short}');

/* 2) Paragraph loop для warnings/decisions/works_list.
 *    Сейчас loop в одной <w:t> строке внутри одного <w:p>. После paragraphLoop:true
 *    docxtemplater трактует это как inline-loop (склеивание).
 *    Переделываем: разбиваем <w:p> на три параграфа:
 *      <w:p>{#tag}</w:p>
 *      <w:p>... контент ... </w:p>    ← этот параграф будет дублирован для каждого элемента
 *      <w:p>{/tag}</w:p>
 *    Стиль (numPr) сохраняется на среднем параграфе.
 */
function splitLoopParagraph(xml, tag, innerPattern) {
  // Найдём <w:p>…<w:t…>{#tag}<inner>{/tag}</w:t>…</w:p>
  // Универсальный regex который ловит весь параграф вокруг строки <w:t>{#tag}…{/tag}</w:t>.
  // Решение: ищем подстроку «{#tag}» в xml, находим вокруг неё ближайший <w:p и </w:p>.
  const open = `{#${tag}}`;
  const close = `{/${tag}}`;
  const idxStart = xml.indexOf(open);
  if (idxStart === -1) {
    console.warn(`  [splitLoop ${tag}] open marker not found`);
    return xml;
  }
  const idxClose = xml.indexOf(close, idxStart);
  if (idxClose === -1) {
    console.warn(`  [splitLoop ${tag}] close marker not found`);
    return xml;
  }
  // Ищем <w:p ... > перед idxStart
  const pStart = xml.lastIndexOf('<w:p ', idxStart);
  if (pStart === -1) {
    console.warn(`  [splitLoop ${tag}] no <w:p before marker`);
    return xml;
  }
  const pEnd = xml.indexOf('</w:p>', idxClose);
  if (pEnd === -1) {
    console.warn(`  [splitLoop ${tag}] no </w:p> after marker`);
    return xml;
  }
  const fullPara = xml.slice(pStart, pEnd + '</w:p>'.length);

  // Внутри параграфа удаляем {#tag} и {/tag} → останется только inner-контент.
  const innerPara = fullPara
    .replace(open, '')
    .replace(close, '');

  // Открывающий параграф — простой, без стиля (docxtemplater сам уберёт пустые параграфы для loop).
  const openPara  = `<w:p><w:r><w:t xml:space="preserve">${open}</w:t></w:r></w:p>`;
  const closePara = `<w:p><w:r><w:t xml:space="preserve">${close}</w:t></w:r></w:p>`;

  const replacement = openPara + innerPara + closePara;
  return xml.slice(0, pStart) + replacement + xml.slice(pEnd + '</w:p>'.length);
}

xml = splitLoopParagraph(xml, 'warnings', '{title} — {text}');
xml = splitLoopParagraph(xml, 'decisions', '{text}');
xml = splitLoopParagraph(xml, 'works_list', '{title}');

/* 3) Метаданные «Кому/От/Дата/Основание».
 *    Вставляем 4 абзаца ПЕРЕД первой таблицей <w:tbl>, которая идёт после
 *    параграфа с {report_number}.
 *    Используем стиль обычного текста с уменьшенным шрифтом (как в эталоне).
 */
const metaXml = [
  ['Кому:',      '{meta_to}'],
  ['От:',        '{meta_from}'],
  ['Дата:',      '{report_date}'],
  ['Основание:', '{meta_basis}']
].map(([label, val]) =>
  `<w:p>` +
    `<w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${label} </w:t></w:r>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${val}</w:t></w:r>` +
  `</w:p>`
).join('');

// Найти первый <w:tbl ПОСЛЕ {report_number}.
const rnIdx = xml.indexOf('{report_number}');
if (rnIdx === -1) {
  console.warn('[meta] {report_number} not found — пропускаю вставку метаданных');
} else {
  const tblIdx = xml.indexOf('<w:tbl>', rnIdx);
  if (tblIdx === -1) {
    console.warn('[meta] <w:tbl> after {report_number} not found');
  } else {
    xml = xml.slice(0, tblIdx) + metaXml + xml.slice(tblIdx);
    console.log('  + Метаданные вставлены перед таблицей фактов');
  }
}

console.log('XML: было', origLen, 'байт → стало', xml.length, 'байт');

// Сохраняем обратно в zip и записываем файл.
zip.file('word/document.xml', xml);
const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(DST, out);
console.log('Готово →', DST, '(', out.length, 'байт )');
