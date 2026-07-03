/**
 * Добавить логотип (image1.png из director-report-tpl) в customer-letter-tpl.
 * Шапка в шаблоне УЖЕ есть (Асгард-Сервис + реквизиты), нужно ТОЛЬКО добавить
 * картинку-логотип в самое начало (перед текстовой шапкой).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const ROOT = path.resolve(__dirname, '..');
const REPORT_TPL = path.join(ROOT, 'templates', 'director-report-tpl.docx');
const LETTER_TPL = path.join(ROOT, 'templates', 'customer-letter-tpl.docx');

// 1. Извлекаем image1.png из отчёта.
const reportZip = new PizZip(fs.readFileSync(REPORT_TPL));
const logoBuf = reportZip.file('word/media/image1.png').asNodeBuffer();
console.log('Логотип извлечён:', logoBuf.length, 'байт');

// 2. Открываем письмо.
const letterZip = new PizZip(fs.readFileSync(LETTER_TPL));

// 3. Кладём картинку.
letterZip.file('word/media/image1.png', logoBuf);

// 4. Обновляем _rels/document.xml.rels — добавляем relationship для image1.
const relsPath = 'word/_rels/document.xml.rels';
let rels = letterZip.file(relsPath);
let relsXml = rels ? rels.asText() : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

if (!relsXml.includes('Target="media/image1.png"')) {
  // Найдём максимальный rId и +1.
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1]));
  const maxId = ids.length ? Math.max(...ids) : 0;
  const newId = maxId + 1;
  const newRel = `<Relationship Id="rId${newId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>`;
  relsXml = relsXml.replace('</Relationships>', newRel + '</Relationships>');
  letterZip.file(relsPath, relsXml);
  console.log(`Добавлен Relationship rId${newId} → media/image1.png`);

  // 5. Обновляем [Content_Types].xml — нужен <Default Extension="png" ...>
  const ctPath = '[Content_Types].xml';
  let ct = letterZip.file(ctPath).asText();
  if (!/Extension="png"/i.test(ct)) {
    ct = ct.replace('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/>');
    letterZip.file(ctPath, ct);
    console.log('Добавлен Default Extension="png" в [Content_Types].xml');
  }

  // 6. Вставляем <w:drawing> с картинкой в начале <w:body>.
  let docXml = letterZip.file('word/document.xml').asText();
  // Размер картинки: 23479 байт PNG. Стандартный размер для логотипа в шапке ~3см × 3см.
  // EMU (English Metric Units): 1 cm = 360000 EMU. → 3см = 1080000 EMU.
  const drawingXml =
    `<w:p>` +
      `<w:pPr><w:jc w:val="center"/><w:spacing w:after="80"/></w:pPr>` +
      `<w:r>` +
        `<w:rPr><w:noProof/></w:rPr>` +
        `<w:drawing>` +
          `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
            `<wp:extent cx="1080000" cy="1080000"/>` +
            `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
            `<wp:docPr id="1" name="Логотип"/>` +
            `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
            `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
              `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
                `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
                  `<pic:nvPicPr><pic:cNvPr id="1" name="Логотип"/><pic:cNvPicPr/></pic:nvPicPr>` +
                  `<pic:blipFill>` +
                    `<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${newId}"/>` +
                    `<a:stretch><a:fillRect/></a:stretch>` +
                  `</pic:blipFill>` +
                  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1080000" cy="1080000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
                `</pic:pic>` +
              `</a:graphicData>` +
            `</a:graphic>` +
          `</wp:inline>` +
        `</w:drawing>` +
      `</w:r>` +
    `</w:p>`;

  const bodyStart = docXml.indexOf('<w:body>');
  const insertPos = bodyStart + '<w:body>'.length;
  docXml = docXml.slice(0, insertPos) + drawingXml + docXml.slice(insertPos);
  letterZip.file('word/document.xml', docXml);
  console.log('Логотип вставлен в начало body');
}

const out = letterZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(LETTER_TPL, out);
console.log('Готово →', LETTER_TPL, '(', out.length, 'байт )');
