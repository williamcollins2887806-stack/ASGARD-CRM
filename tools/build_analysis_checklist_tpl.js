#!/usr/bin/env node
/**
 * build_analysis_checklist_tpl.js — собирает templates/analysis-checklist.docx (D-203).
 *
 * Почему сборщик, а не бинарник «руками»: шаблон должен воспроизводиться из кода
 * и попадать в git текстом, как остальные build-скрипты проекта.
 *
 * Урок D-191: в docProps НЕ кладём dc:title/dc:subject. Иначе метаданные утекают
 * в PDF-предпросмотр и в чужой документ попадает имя чужого проекта.
 * Здесь docProps отсутствует вовсе — предпросмотр не подхватит ничего лишнего.
 *
 * Плейсхолдеры (docxtemplater, paragraphLoop + linebreaks):
 *   {tender_title} {customer_name} {created_at} {author_name}
 *   {#questions}{num}. {text} / Ответ: {answer}{/questions}
 *   {#free}{text} / Ответ: {answer}{/free}
 *
 * Использование: node tools/build_analysis_checklist_tpl.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'templates', 'analysis-checklist.docx');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Параграф с прямым форматированием (styles.xml не нужен). */
function p(text, opts) {
  opts = opts || {};
  const rpr = [];
  if (opts.bold) rpr.push('<w:b/>');
  if (opts.italic) rpr.push('<w:i/>');
  if (opts.size) rpr.push('<w:sz w:val="' + opts.size + '"/>');
  if (opts.color) rpr.push('<w:color w:val="' + opts.color + '"/>');
  const rprXml = rpr.length ? '<w:rPr>' + rpr.join('') + '</w:rPr>' : '';
  const ppr = [];
  if (opts.align) ppr.push('<w:jc w:val="' + opts.align + '"/>');
  if (opts.spacing) ppr.push('<w:spacing w:before="' + opts.spacing[0] + '" w:after="' + opts.spacing[1] + '"/>');
  const pprXml = ppr.length ? '<w:pPr>' + ppr.join('') + '</w:pPr>' : '';
  return '<w:p>' + pprXml +
    '<w:r>' + rprXml + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:p>';
}

function documentXml() {
  const body = [
    p('ЧЕК-ЛИСТ АНАЛИЗА ТЕНДЕРА', { bold: true, size: 32, align: 'center' }),
    p('Звонок по тендеру: базовые вопросы и ответы заказчика', { italic: true, size: 20, align: 'center', color: '666666' }),
    p(''),
    p('Тендер: {tender_title}', { size: 22 }),
    p('Заказчик: {customer_name}', { size: 22 }),
    p('Аналитик: {author_name}', { size: 22 }),
    p('Дата заполнения: {created_at}', { size: 22 }),
    p(''),
    p('Порядок работы: прочитать ТЗ → изучить компанию → выписать вопросы → позвонить клиенту → заполнить ответы.',
      { italic: true, size: 18, color: '666666' }),
    p(''),
    p('ЗВОНОК ПО ТЕНДЕРУ', { bold: true, size: 26, spacing: [200, 100] }),
    // Цикл по базовым вопросам: номер, вопрос, ответ.
    // Маркеры цикла — отдельными абзацами (docxtemplater paragraphLoop).
    p('{#questions}'),
    p('{num}. {text}', { bold: true, size: 22 }),
    p('Ответ: {answer}', { size: 22 }),
    p('{/questions}'),
    p(''),
    p('СВОИ ВОПРОСЫ', { bold: true, size: 26, spacing: [200, 100] }),
    p('{#free}'),
    p('{text}', { bold: true, size: 22 }),
    p('Ответ: {answer}', { size: 22 }),
    p('{/free}'),
    p(''),
    p('Документ сформирован автоматически: Asgard CRM · чек-лист анализа.', { italic: true, size: 16, color: '888888' })
  ].join('');

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' + body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>' +
    '</w:sectPr>' +
    '</w:body></w:document>';
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

function main() {
  let PizZip;
  try {
    PizZip = require('pizzip');
  } catch (e) {
    console.error('Не найден pizzip. Запустите npm install.');
    process.exit(1);
  }
  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/document.xml', documentXml());
  const buf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log('OK ' + path.relative(ROOT, OUT) + ' (' + buf.length + ' байт)');
}

main();
