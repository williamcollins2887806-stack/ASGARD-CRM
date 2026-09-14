'use strict';

/**
 * Собирает print-ready DOCX-шаблоны доверенностей из эталона (logo+header)
 * и чистого тела с плейсхолдерами docxtemplater.
 *
 * Usage: node tools/build-proxy-templates.js
 */

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const ROOT = path.resolve(__dirname, '..');
const SAMPLE = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Downloads',
  '251113_12 Зиссер Е.О. ТМЦ.docx'
);
const OUT_DIR = path.join(ROOT, 'templates', 'proxies');

const TYPES = [
  'tmc_short',
  'tender',
  'commercial',
  'docs_tmc',
  'representation',
  'vehicle',
  'bank',
  'custom'
];

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function p(text, opts = {}) {
  const align = opts.center ? '<w:jc w:val="center"/>' : opts.both ? '<w:jc w:val="both"/>' : '';
  const bold = opts.bold ? '<w:b/><w:bCs/>' : '';
  const size = opts.size || 28; // 14pt
  const after = opts.after != null ? opts.after : 120;
  const before = opts.before != null ? opts.before : 0;
  const spacing = `<w:spacing w:before="${before}" w:after="${after}" w:line="276" w:lineRule="auto"/>`;
  const ind = opts.indent ? `<w:ind w:firstLine="709"/>` : '';
  return (
    `<w:p>` +
    `<w:pPr>${align}${spacing}${ind}<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>` +
    `<w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`
  );
}

function emptyLine() {
  return p('', { after: 60 });
}

function buildDocumentXml() {
  const body = [
    p('ДОВЕРЕННОСТЬ № {number}', { center: true, bold: true, size: 32, after: 200 }),
    p(
      '{company_full}, (ОГРН {ogrn}, ИНН {inn}, КПП {kpp}, далее – «Общество»), в лице {director_position_genitive} {director_full_genitive}, действующего на основании Устава, уполномочивает:',
      { both: true, indent: true, after: 200 }
    ),
    p(
      '{person_clause}',
      { both: true, indent: true, after: 200 }
    ),
    p(
      'быть Представителем Общества и выполнять в пределах прав, предоставленных настоящей Доверенностью, следующие действия:',
      { both: true, indent: true, after: 160 }
    ),
    p('{powers_text}', { both: true, indent: true, after: 200 }),
    p('{redelegation_clause}', { both: true, indent: true, after: 160 }),
    p(
      'Настоящая Доверенность действительна с {valid_from} по {valid_until}, и может быть отозвана в письменном виде в любое время.',
      { both: true, indent: true, after: 200 }
    ),
    p('Дата подписания – {sign_date}', { after: 80 }),
    p('Место выдачи – {issue_place}', { after: 240 }),
    p('Настоящим заверяю подпись Представителя', { after: 200 }),
    p('______________________________', { after: 40 }),
    p('{fio_short}', { after: 240 }),
    p('От лица Общества', { after: 200 }),
    p('______________________________', { after: 40 }),
    p('(подпись, печать)', { after: 120 }),
    p('{director_position} {company_short} {director_full}', { after: 120 })
  ].join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ` +
    `xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" ` +
    `xmlns:cx1="http://schemas.microsoft.com/office/drawing/2015/9/8/chartex" ` +
    `xmlns:cx2="http://schemas.microsoft.com/office/drawing/2015/10/21/chartex" ` +
    `xmlns:cx3="http://schemas.microsoft.com/office/drawing/2015/10/21/chartex" ` +
    `xmlns:cx4="http://schemas.microsoft.com/office/drawing/2016/5/10/chartex" ` +
    `xmlns:cx5="http://schemas.microsoft.com/office/drawing/2016/5/11/chartex" ` +
    `xmlns:cx6="http://schemas.microsoft.com/office/drawing/2016/5/12/chartex" ` +
    `xmlns:cx7="http://schemas.microsoft.com/office/drawing/2016/5/13/chartex" ` +
    `xmlns:cx8="http://schemas.microsoft.com/office/drawing/2016/5/14/chartex" ` +
    `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
    `xmlns:aink="http://schemas.microsoft.com/office/drawing/2016/ink" ` +
    `xmlns:am3d="http://schemas.microsoft.com/office/drawing/2017/model3d" ` +
    `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ` +
    `xmlns:v="urn:schemas-microsoft-com:vml" ` +
    `xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:w10="urn:schemas-microsoft-com:office:word" ` +
    `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ` +
    `xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ` +
    `xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex" ` +
    `xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid" ` +
    `xmlns:w16="http://schemas.microsoft.com/office/word/2018/wordml" ` +
    `xmlns:w16sdtdh="http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash" ` +
    `xmlns:w16se="http://schemas.microsoft.com/office/word/2015/wordml/symex" ` +
    `xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ` +
    `xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" ` +
    `xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" ` +
    `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ` +
    `mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh">` +
    `<w:body>${body}` +
    `<w:sectPr>` +
    `<w:headerReference w:type="default" r:id="rId11"/>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/>` +
    `<w:cols w:space="708"/>` +
    `<w:docGrid w:linePitch="360"/>` +
    `</w:sectPr></w:body></w:document>`
  );
}

function main() {
  if (!fs.existsSync(SAMPLE)) {
    console.error('Sample DOCX not found:', SAMPLE);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const buf = fs.readFileSync(SAMPLE);
  const zip = new PizZip(buf);
  zip.file('word/document.xml', buildDocumentXml());

  const outBuf = zip.generate({ type: 'nodebuffer' });
  const masterPath = path.join(OUT_DIR, '_master.docx');
  fs.writeFileSync(masterPath, outBuf);
  console.log('Wrote', masterPath, outBuf.length);

  for (const id of TYPES) {
    const pth = path.join(OUT_DIR, id + '.docx');
    fs.writeFileSync(pth, outBuf);
    console.log('Wrote', pth);
  }
  console.log('OK', TYPES.length + 1, 'templates');
}

main();
