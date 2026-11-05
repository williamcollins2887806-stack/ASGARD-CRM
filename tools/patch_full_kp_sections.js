#!/usr/bin/env node
'use strict';

/**
 * Обернуть заголовки пустых разделов DOCX-шаблона полного КП в условные блоки.
 *
 * Проблема: заголовок «ПОРЯДОК СДАЧИ, ПРИЕМКИ И ОПЛАТЫ» печатается всегда,
 * а текст под ним выводится циклом ({#acceptance_paras}). Пустой acceptance
 * оставлял в клиентском документе заголовок без содержания — ТО видела
 * «много мест не заполнено».
 *
 * Решение: заголовок и цикл попадают под общий {#has_xxx}. Метки
 * docxtemplater должны жить ВНУТРИ w:t — иначе они не обрабатываются
 * и печатаются сырым текстом.
 *
 * Идемпотентно: повторный запуск ничего не добавляет.
 *
 * Запуск: node tools/patch_full_kp_sections.js
 */

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TPL = path.join(__dirname, '..', 'templates', 'full-kp-nika-tpl.docx');

/** Заголовок раздела → имя условного блока + открывающий тег цикла. */
const SECTIONS = [
  { head: 'ПОРЯДОК СДАЧИ, ПРИЕМКИ И ОПЛАТЫ', headAlt: 'ПОРЯДОК ', loop: '{#acceptance_paras}', tag: 'has_acceptance' },
  { head: 'УСЛОВИЯ, ВЛИЯЮЩИЕ НА СРОКИ И СТОИМОСТЬ', loop: '{#risks_paras}', tag: 'has_risks' },
  { head: 'ОБЯЗАННОСТИ ЗАКАЗЧИКА', loop: '{#duties}', tag: 'has_duties' },
  { head: 'ИСПОЛНИТЕЛЬНАЯ ДОКУМЕНТАЦИЯ', headAlt: 'ИСПОЛНИТЕЛЬНАЯ ДОКУМЕНТ', loop: '{#deliverables}', tag: 'has_deliverables' }
];

function decodeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function main() {
  const zip = new PizZip(fs.readFileSync(TPL));
  let xml = zip.file('word/document.xml').asText();

  let applied = 0;
  for (const sec of SECTIONS) {
    const openTag = '<w:t>' + '{#' + sec.tag + '}' + '</w:t>';
    const openTagAttr = '<w:t xml:space="preserve">' + '{#' + sec.tag + '}' + '</w:t>';
    if (xml.indexOf(openTag) >= 0 || xml.indexOf(openTagAttr) >= 0) {
      console.log('уже обёрнут:', sec.tag);
      continue;
    }

    // Найти абзац заголовка (текст может быть разбит на несколько w:t).
    const loopIdx = xml.indexOf(sec.loop);
    if (loopIdx < 0) { console.log('нет цикла:', sec.loop); continue; }

    const segStart = Math.max(0, loopIdx - 8000);
    const seg = xml.slice(segStart, loopIdx);
    let headPos = -1;
    const needles = [sec.head, sec.headAlt].filter(Boolean);
    for (const n of needles) {
      const i = seg.lastIndexOf(n);
      if (i >= 0 && i > headPos) headPos = i;
    }
    if (headPos < 0) { console.log('нет заголовка:', sec.head); continue; }
    const headAbs = segStart + headPos;

    // Начало абзаца заголовка: ближайший <w:p ...> или <w:p> до текста.
    const pStart = Math.max(xml.lastIndexOf('<w:p ', headAbs), xml.lastIndexOf('<w:p>', headAbs));
    if (pStart < 0) { console.log('нет начала абзаца:', sec.head); continue; }

    // Открывающий тег — в первый w:t этого абзаца (в его текст).
    const firstT = xml.indexOf('<w:t', pStart);
    if (firstT < 0) { console.log('нет w:t в заголовке:', sec.head); continue; }
    const firstTEnd = xml.indexOf('</w:t>', firstT);
    if (firstTEnd < 0) continue;
    const firstTOpenEnd = xml.indexOf('>', firstT) + 1;
    xml = xml.slice(0, firstTOpenEnd) + '{#' + sec.tag + '}' + xml.slice(firstTOpenEnd);

    // Закрывающий тег — в последний w:t абзаца, где стоит закрытие цикла.
    const closer = sec.loop.replace('{#', '{/');
    const loopOpenIdx2 = xml.indexOf(sec.loop, pStart);
    const loopCloseIdx = xml.indexOf(closer, loopOpenIdx2);
    if (loopCloseIdx < 0) { console.log('нет закрытия цикла:', sec.loop); continue; }
    const pEnd = xml.indexOf('</w:p>', loopCloseIdx);
    if (pEnd < 0) continue;
    const lastT = xml.lastIndexOf('<w:t', pEnd);
    const lastTEnd = xml.indexOf('</w:t', lastT);
    if (lastT < 0 || lastTEnd < 0) continue;
    xml = xml.slice(0, lastTEnd) + '{/' + sec.tag + '}' + xml.slice(lastTEnd);
    applied += 1;
    console.log('обёрнут:', sec.tag, '←', sec.head.slice(0, 40));
  }

  if (!applied) {
    console.log('нечего менять (всё уже обёрнуто)');
    return;
  }

  // Контроль: каждый тег ровно один раз.
  for (const sec of SECTIONS) {
    const o = (xml.match(new RegExp('\\{#' + sec.tag + '\\}', 'g')) || []).length;
    const c = (xml.match(new RegExp('\\{/' + sec.tag + '\\}', 'g')) || []).length;
    if (o !== c) throw new Error('дисбаланс тегов ' + sec.tag + ': ' + o + '/' + c);
  }

  zip.file('word/document.xml', xml);
  fs.writeFileSync(TPL, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('OK: обёрнуто разделов ' + applied);
}

main();
