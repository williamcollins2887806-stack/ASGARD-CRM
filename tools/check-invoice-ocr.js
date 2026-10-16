'use strict';
/**
 * Проверка OCR/vision на 10 тестовых счетах × 10 искажений.
 * Прогон НА ПРОДЕ (там pdftoppm/convert/python3 и ключи AI).
 * Для каждого файла: OCR → проверка контрольных полей (№ счёта, ИНН, сумма).
 *
 * Usage (на проде): node tools/check-invoice-ocr.js
 */
const fs = require('fs');
const path = require('path');
const { ocrPdfPath, ocrImageBuffer } = require('/var/www/asgard-crm/src/services/pdf-ocr');

const DIR = process.env.INV_DIR || '/tmp/inv-out';
const MANIFEST = '/tmp/inv-src/manifest.json';

function parts(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

(async () => {
  const invs = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).invoices;
  const files = fs.readdirSync(DIR).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).sort();
  const rows = [];

  for (const f of files) {
    const m = f.match(/^inv-(\d+)__(.+)\.(png|jpe?g)$/i);
    if (!m) continue;
    const inv = invs[parseInt(m[1], 10) - 1];
    const variant = m[2];
    const full = path.join(DIR, f);
    let text = ''; let ms = 0; let err = null;
    const t0 = Date.now();
    try {
      if (/\.pdf$/i.test(f)) {
        const r = await ocrPdfPath(full, f, {});
        text = r.text || '';
      } else {
        const buf = fs.readFileSync(full);
        const mime = /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png';
        const r = await ocrImageBuffer(buf, mime, f);
        text = (r && (r.text || r)) || '';
        if (typeof text === 'object') text = text.text || '';
      }
    } catch (e) { err = e.message; }
    ms = Date.now() - t0;

    const T = parts(text);
    const digits = T.replace(/\D/g, '');
    // контрольные поля
    const gotNumber = inv.n.replace(/\s/g, '').length < 3
      ? true
      : T.replace(/\s/g, '').includes(inv.n.replace(/\s/g, '').slice(0, 8));
    const gotInn = digits.includes(inv.inn.replace(/\D/g, '').replace(/^DE/, '')) || T.includes(inv.inn);
    // сумму сравниваем как целую часть (без округления .5 вверх) и как «склеенные» цифры
    const sumInt = String(Math.floor(inv.sum));
    const gotSum = T.replace(/[^\d]/g, '').includes(sumInt.slice(0, 5));
    rows.push({ file: f, variant, chars: T.length, ms, gotNumber, gotInn, gotSum, err, preview: T.slice(0, 120) });
    console.log(`${f.padEnd(38)} | chars=${String(T.length).padStart(5)} | ${ms}ms | №:${gotNumber ? 'Y' : '-'} ИНН:${gotInn ? 'Y' : '-'} сумма:${gotSum ? 'Y' : '-'}${err ? ' ERR:' + err : ''}`);
  }

  // сводка по вариантам
  const byVariant = {};
  for (const r of rows) {
    const v = byVariant[r.variant] || (byVariant[r.variant] = { n: 0, number: 0, inn: 0, sum: 0, chars: 0, ms: 0, err: 0 });
    v.n++; v.number += r.gotNumber ? 1 : 0; v.inn += r.gotInn ? 1 : 0; v.sum += r.gotSum ? 1 : 0;
    v.chars += r.chars; v.ms += r.ms; v.err += r.err ? 1 : 0;
  }
  console.log('\n=== СВОДКА ПО ИСКАЖЕНИЯМ (доля распознанных полей) ===');
  for (const [v, s] of Object.entries(byVariant)) {
    console.log(`${v.padEnd(18)} № ${s.number}/${s.n}  ИНН ${s.inn}/${s.n}  сумма ${s.sum}/${s.n}  ср.chars ${Math.round(s.chars / s.n)}  ср.${Math.round(s.ms / s.n)}ms  err ${s.err}`);
  }
  fs.writeFileSync('/tmp/inv-ocr-report.json', JSON.stringify(rows, null, 2));
  console.log('\nотчёт: /tmp/inv-ocr-report.json');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
