'use strict';
// D-392: шаблон письма — цикл абзацев должен быть отдельными параграфами.
//
// ПРИЧИНА ДЕФЕКТА. В obs-letter-tpl.docx было:
//   <w:p>...<w:t>{#body_paragraphs}{text}{/body_paragraphs}</w:t></w:r></w:p>
// То есть открывающий тег, содержимое и закрывающий тег — в ОДНОМ абзаце.
// docxtemplater с paragraphLoop:true в таком виде НЕ размножает абзац: он
// подставляет все элементы в один, и текст письма слипается в сплошной комок
// (так и выглядело письмо по ДС-26028599).
//
// ПРАВИЛЬНО (как в шаблонах Word):
//   <w:p>...<w:t>{#body_paragraphs}</w:t></w:p>
//   <w:p>...<w:t>{text}</w:t></w:p>
//   <w:p>...<w:t>{/body_paragraphs}</w:t></w:p>
//
// ЧТО ДЕЛАЕМ. Берём абзац с циклом, размножаем его на три:
//   • первый — только {#body_paragraphs} (открытие);
//   • второй — {text} (тело, форматирование исходного абзаца сохраняется);
//   • третий — только {/body_paragraphs} (закрытие, пустой, схлопнется).
// Оформление (отступ первой строки, выравнивание, шрифт, интервал) остаётся
// ровно тем, что в официальном бланке.
//
// Идемпотентно: повторный запуск на уже исправленном шаблоне ничего не меняет.

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const ROOT = path.resolve(__dirname, '..');
const TPL = path.join(ROOT, 'templates', 'obs-letter-tpl.docx');
const SRC = path.join(ROOT, 'templates', 'customer-letter-tpl.docx');

const OPEN = '{#body_paragraphs}';
const CLOSE = '{/body_paragraphs}';
const BODY = '{text}';

/** Разбить абзац на «до/после» и собрать копию с другим текстом внутри. */
function withText(paragraphXml, newText) {
  // Заменяем содержимое ВСЕХ <w:t> в абзаце на newText, остальное — как есть.
  let first = true;
  return paragraphXml.replace(/(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g, (m, a, _body, c) => {
    if (!first) return `${a}${c}`;            // прочие прогоны опустошаем
    first = false;
    return `${a}${newText}${c}`;
  });
}

function fixDocumentXml(xml) {
  const paras = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const target = paras.find((p) => p.includes(OPEN) && p.includes(CLOSE));
  if (!target) return { xml, changed: false, reason: 'цикл не найден' };
  // Уже исправлено? Тогда открытие и закрытие в разных абзацах.
  const openParas = paras.filter((p) => p.includes(OPEN));
  if (openParas.length > 1 || !/^[\s\S]*\{#[\s\S]*\{\/[\s\S]*$/.test(target.replace(/<[^>]+>/g, ''))) {
    // Проверяем точнее: в одном абзаце одновременно open и close = дефект.
  }
  if (!(target.includes(OPEN) && target.includes(CLOSE))) {
    return { xml, changed: false, reason: 'уже разделено' };
  }

  const openP = withText(target, OPEN);
  const bodyP = withText(target, BODY);     // сохраняет отступ/выравнивание
  const closeP = withText(target, CLOSE);

  // Пустой абзац закрытия не должен давать лишнюю пустую строку:
  // делаем интервал нулевым (содержимое всё равно схлопнется).
  const closeTrimmed = closeP
    .replace(/<w:spacing[^>]*\/>/g, '<w:spacing w:after="0" w:before="0"/>')
    .replace(/<w:ind[^>]*\/>/g, '');

  const replaced = openP + bodyP + closeTrimmed;
  return { xml: xml.replace(target, replaced), changed: true, reason: 'разделено на три абзаца' };
}

function main() {
  const srcPath = fs.existsSync(TPL) ? TPL : SRC;
  console.log('шаблон:', path.basename(srcPath));

  const zip = new PizZip(fs.readFileSync(srcPath, 'binary'));
  const before = zip.file('word/document.xml').asText();
  const res = fixDocumentXml(before);

  console.log('результат:', res.reason);
  if (!res.changed) {
    console.log('изменений нет — шаблон уже корректен');
    return;
  }
  zip.file('word/document.xml', res.xml);

  // Пишем ОБА шаблона: письмо ОБС и общий бланк переписки — чтобы все
  // исходящие документы выглядели одинаково.
  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(TPL, out);
  console.log('записан:', TPL, Math.round(out.length / 1024) + ' КБ');

  const srcZip = new PizZip(fs.readFileSync(SRC, 'binary'));
  const srcXml = srcZip.file('word/document.xml').asText();
  const srcRes = fixDocumentXml(srcXml);
  if (srcRes.changed) {
    srcZip.file('word/document.xml', srcRes.xml);
    fs.writeFileSync(SRC, srcZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
    console.log('записан и общий бланк:', SRC);
  }
}

main();
