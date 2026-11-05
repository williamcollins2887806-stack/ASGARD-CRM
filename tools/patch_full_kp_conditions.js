#!/usr/bin/env node
'use strict';

/**
 * Убрать пустые метки в блоке «Условия» DOCX-шаблона полного КП.
 *
 * В шаблоне «Условия и комментарии» — таблица, где в левой ячейке стоит
 * статичная метка («Мобилизация и срок», «Ресурсы Заказчика»), а в правой —
 * плейсхолдер ({cond_mobilization}). Когда значения нет, docxtemplater
 * выводит пустоту, но метка остаётся — клиент видит заголовок без ответа
 * («много мест не заполнено»).
 *
 * Решение: обернуть СТРОКУ таблицы целиком в {#has_cond_xxx}. Метки живут
 * внутри w:t (иначе docxtemplater их не обрабатывает).
 *
 * Идемпотентно.
 *
 * Запуск: node tools/patch_full_kp_conditions.js
 */

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TPL = path.join(__dirname, '..', 'templates', 'full-kp-nika-tpl.docx');

/** Метка в левой ячейке → плейсхолдер значения → имя условного блока. */
const ROWS = [
  { label: 'Мобилизация и срок', ph: '{cond_mobilization}', tag: 'has_cond_mobilization' },
  { label: 'Ресурсы Заказчика', ph: '{cond_customer_resources}', tag: 'has_cond_customer_resources' }
];

function main() {
  const zip = new PizZip(fs.readFileSync(TPL));
  let xml = zip.file('word/document.xml').asText();
  let applied = 0;

  for (const row of ROWS) {
    if (xml.indexOf('{#' + row.tag + '}') >= 0) {
      console.log('уже обёрнут:', row.tag);
      continue;
    }
    const phIdx = xml.indexOf(row.ph);
    if (phIdx < 0) { console.log('нет плейсхолдера:', row.ph); continue; }

    // Границы строки таблицы, в которой стоит плейсхолдер.
    const trStart = xml.lastIndexOf('<w:tr', phIdx);
    const trEnd = xml.indexOf('</w:tr>', phIdx);
    if (trStart < 0 || trEnd < 0) { console.log('нет строки таблицы:', row.label); continue; }
    if (xml.slice(phIdx, trEnd).indexOf('<w:tr') >= 0) {
      console.log('плейсхолдер не в своей строке:', row.label);
      continue;
    }

    // Метки ставим в первый и последний w:t строки. ВАЖНО: в строке есть
    // <w:trPr> с тегами свойств — первый '<w:t' после trStart легко попадает
    // в него (w:trPr), и docxtemplater тег не видит. Ищем именно '<w:t>'
    // или '<w:t '.
    const tOpenRe = /<w:t(?:\s|>)/g;
    tOpenRe.lastIndex = trStart;
    let m = tOpenRe.exec(xml);
    if (!m) { console.log('нет w:t в строке:', row.label); continue; }
    const firstTEnd = xml.indexOf('>', m.index) + 1;
    let out = xml.slice(0, firstTEnd) + '{#' + row.tag + '}' + xml.slice(firstTEnd);

    const trEnd2 = out.indexOf('</w:tr>', firstTEnd);
    const before = out.slice(0, trEnd2);
    const allT = [...before.matchAll(/<w:t(?:\s|>)/g)];
    if (!allT.length) { console.log('нет w:t в строке (2):', row.label); continue; }
    const lastTIdx = allT[allT.length - 1].index;
    const lastTClose = out.indexOf('</w:t', lastTIdx);
    if (lastTClose < 0) continue;
    out = out.slice(0, lastTClose) + '{/' + row.tag + '}' + out.slice(lastTClose);

    xml = out;
    applied += 1;
    console.log('обёрнут:', row.tag, '←', row.label);
  }

  if (!applied) { console.log('нечего менять'); return; }

  for (const row of ROWS) {
    const o = (xml.match(new RegExp('\\{#' + row.tag + '\\}', 'g')) || []).length;
    const c = (xml.match(new RegExp('\\{/' + row.tag + '\\}', 'g')) || []).length;
    if (o !== c) throw new Error('дисбаланс ' + row.tag + ': ' + o + '/' + c);
  }

  zip.file('word/document.xml', xml);
  fs.writeFileSync(TPL, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('OK: обёрнуто строк ' + applied);
}

main();
