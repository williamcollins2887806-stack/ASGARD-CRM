'use strict';
/**
 * V490: починить шаблон письма ОБС — Word отвечал «Файл поврежден».
 *
 * КОРЕНЬ (найдено экспериментом с реальным Word 16.0 через COM, не догадкой):
 * в шапке-таблице вторая ячейка `<w:tc>` пустая — внутри нет ни одного
 * блока (`w:p` / `w:tbl`). По схеме OOXML (CT_Tc) ячейка обязана содержать
 * хотя бы один блочный элемент. LibreOffice это терпит и конвертирует в PDF,
 * поэтому дефект жил незамеченным: PDF собирался, а Word у пользователя
 * писал «обнаружено содержимое, которое не удалось прочитать».
 *
 * Бисекция: из 23 блоков body первые 4 открываются, 5-й (таблица шапки)
 * ломает файл. Подстановка `<w:p/>` в пустую ячейку → файл открывается.
 *
 * Заодно нормализуется порядок детей в anchor печати: `wp:wrapNone` должен
 * идти ПОСЛЕ `wp:effectExtent` (в шаблоне шёл до) — Word строг к порядку.
 *
 * Скрипт идемпотентен. Запуск: node tools/fix_obs_template_word.py.js
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TPL = path.join(__dirname, '..', 'templates', 'obs-letter-tpl.docx');

/** Вставить пустой параграф в ячейки, где нет ни одного блока. */
function fixEmptyTableCells(xml) {
  let fixed = 0;
  const out = xml.replace(/<w:tc>([\s\S]*?)<\/w:tc>/g, (whole, inner) => {
    if (/<w:p\b|<w:tbl\b/.test(inner)) return whole;
    fixed += 1;
    // w:p без свойств допустим; пустой параграф не влияет на вид ячейки.
    return `<w:tc>${inner}<w:p/></w:tc>`;
  });
  return { xml: out, fixed };
}

/** wp:wrap* должен идти после wp:effectExtent (порядок по CT_Anchor). */
function fixAnchorWrapOrder(xml) {
  let fixed = 0;
  const out = xml.replace(
    /(<wp:wrap(?:None|Square|Tight|Through|TopAndBottom)\/>)(<wp:effectExtent\b[^>]*\/>)/g,
    (m, wrap, eff) => { fixed += 1; return eff + wrap; }
  );
  return { xml: out, fixed };
}

function main() {
  if (!fs.existsSync(TPL)) {
    console.error('НЕТ ШАБЛОНА:', TPL);
    process.exit(1);
  }
  const buf = fs.readFileSync(TPL);
  const zip = new PizZip(buf);
  const f = zip.file('word/document.xml');
  if (!f) { console.error('нет word/document.xml'); process.exit(1); }

  let xml = f.asText();
  const before = xml;

  const tc = fixEmptyTableCells(xml);
  xml = tc.xml;
  const wr = fixAnchorWrapOrder(xml);
  xml = wr.xml;

  if (xml === before) {
    console.log('шаблон уже корректен — изменений нет');
    return;
  }
  zip.file('word/document.xml', xml);
  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(TPL, out);

  console.log('исправлено:');
  if (tc.fixed) console.log('  • пустых ячеек w:tc получили w:p :', tc.fixed);
  if (wr.fixed) console.log('  • порядок wrap*/effectExtent в anchor :', wr.fixed);
  console.log('размер:', buf.length, '→', out.length);
}

main();
