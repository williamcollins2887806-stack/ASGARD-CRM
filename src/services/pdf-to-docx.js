'use strict';

/**
 * src/services/pdf-to-docx.js
 *
 * D-383: конвертация PDF-счёта в редактируемый Word (DOCX).
 *
 * ЗАЧЕМ. Заказчик 27.10.2026: «нужно не только в PDF, но и в Word».
 * PDF нельзя поправить: бухгалтерии нужно иногда изменить формулировку
 * или вставить счёт в свой документ. Плюс в Word удобнее искать по тексту.
 *
 * ПОЧЕМУ НЕ LIBREOFFICE. Проверено на проде (LibreOffice 24.2.7): он
 * отказывается открывать PDF в headless-режиме — `Error: source file could
 * not be loaded` даже с `--infilter=draw_pdf_import`. Без графической среды
 * PDF-импорт у него не работает. Пакета `docx` в зависимостях также нет.
 *
 * РЕШЕНИЕ. Собираем DOCX вручную: DOCX — это ZIP с XML внутри. Нужны всего
 * четыре части (`[Content_Types].xml`, `_rels/.rels`, `word/document.xml`,
 * `word/_rels/document.xml.rels`). Текст берём из PDF через `pdftotext`,
 * раскладываем по абзацам. Такой файл открывается в Word, LibreOffice и
 * Google Docs без предупреждений.
 *
 * ЧЕСТНОЕ ОГРАНИЧЕНИЕ: получается ТЕКСТОВЫЙ документ, а не побайтовая
 * копия вёрстки. Таблицы превращаются в строки текста, картинки не
 * переносятся. Для «поправить формулировку» и «вставить в письмо» этого
 * достаточно; если нужна точная копия с вёрсткой — это уже OCR-сервис.
 * Ограничение отдаём в ответе заголовком, чтобы фронт мог предупредить.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

/** Экранирование XML: без этого «&» в названии контрагента ломает файл. */
function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Управляющие символы недопустимы в XML 1.0 — иначе Word скажет «файл повреждён».
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Текст из PDF: pdftotext с сохранением разбиения на строки. */
function extractPdfText(pdfPath) {
  const txt = execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return String(txt || '').replace(/\r\n/g, '\n');
}

/**
 * Абзацы документа. Пустые строки сохраняем как отбивку (иначе счёт
 * слипается в сплошной текст), но больше двух подряд не держим.
 */
function toParagraphs(text) {
  const raw = String(text || '').split('\n');
  const out = [];
  let blanks = 0;
  for (const line of raw) {
    const t = line.replace(/\s+$/g, '');
    if (!t.trim()) {
      blanks++;
      if (blanks <= 1) out.push('');
      continue;
    }
    blanks = 0;
    out.push(t);
  }
  return out.length ? out : ['(документ без текстового слоя)'];
}

/** Параграф Word. Моно-шрифт для табличных строк сохраняет выравнивание счёта. */
function paraXml(text) {
  if (!text) return '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr></w:p>';
  const isTableish = /\s{3,}/.test(text);
  const rPr = isTableish
    ? '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr>'
    : '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="22"/></w:rPr>';
  return `<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>`
    + `<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r></w:p>`;
}

/** Минимальный набор частей DOCX. */
function buildDocxParts(title, paragraphs) {
  const body = paragraphs.map(paraXml).join('');

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEsc(title)}</dc:title>
  <dc:creator>ASGARD CRM</dc:creator>
</cp:coreProperties>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1134"/></w:sectPr>
  </w:body>
</w:document>`;

  return [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'docProps/core.xml', data: Buffer.from(core, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ];
}

/**
 * ZIP без внешних зависимостей.
 * DOCX — обычный ZIP; Word принимает и «store» (без сжатия), но файл
 * получается в 3–4 раза больше. Используем deflate из встроенного zlib.
 */
function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();

  const crc32 = (buf) => {
    let c = 0 ^ -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xFF];
    return (c ^ -1) >>> 0;
  };

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const compressed = zlib.deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const useStore = compressed.length >= f.data.length;
    const payload = useStore ? f.data : compressed;
    const method = useStore ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);        // signature
    local.writeUInt16LE(20, 4);                // version needed
    local.writeUInt16LE(0x0800, 6);            // flags: UTF-8 имена
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);                // time
    local.writeUInt16LE(0, 12);                // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, payload);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);                  // version made by
    cen.writeUInt16LE(20, 6);                  // version needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(payload.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);

    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }

  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([Buffer.concat(chunks), cenBuf, end]);
}

/**
 * PDF → DOCX. Возвращает Buffer готового файла.
 *
 * @param {string} pdfPath — абсолютный путь к PDF
 * @param {string} [title] — заголовок документа (номер счёта)
 * @returns {Buffer}
 */
function pdfToDocxBuffer(pdfPath, title) {
  if (!fs.existsSync(pdfPath)) throw new Error('PDF не найден');
  const text = extractPdfText(pdfPath);
  const paragraphs = toParagraphs(text);
  const files = buildDocxParts(title || path.basename(pdfPath), paragraphs);
  return zipStore(files);
}

module.exports = { pdfToDocxBuffer, extractPdfText, toParagraphs, zipStore };
