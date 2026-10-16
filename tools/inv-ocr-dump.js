'use strict';
// Печатает OCR-текст одного файла (для диагностики расхождений).
// Usage: node tools/inv-ocr-dump.js /tmp/inv-out/inv-01__png-clean.png
const fs = require('fs');
const { ocrImageBuffer, ocrPdfPath } = require('/var/www/asgard-crm/src/services/pdf-ocr');
const f = process.argv[2];
(async () => {
  let text = '';
  if (/\.pdf$/i.test(f)) {
    const r = await ocrPdfPath(f, f, {});
    text = r.text || '';
  } else {
    const mime = /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png';
    const r = await ocrImageBuffer(fs.readFileSync(f), mime, f);
    text = (r && r.text) ? r.text : String(r || '');
  }
  console.log('=== ' + f + ' ===');
  console.log(text);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
