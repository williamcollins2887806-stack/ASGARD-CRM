require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ex = require('../src/services/invoice-extract');
const ocr = require('../src/services/pdf-ocr');

const PDFTOTEXT = 'C:\\Users\\Nikita-ASGARD\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftotext.exe';
const dir = path.join(__dirname, 'fixtures', 'real-invoices');

(async () => {
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  const results = [];
  for (const f of files) {
    const full = path.join(dir, f);
    let text = '';
    try { text = execFileSync(PDFTOTEXT, ['-layout', full, '-'], { encoding: 'utf8', maxBuffer: 32e6, timeout: 30000 }); } catch (_) {}
    let source = 'text';
    if (text.trim().length < 50) {
      // Скан — гоним vision-OCR (реальный ИИ со зрением).
      source = 'ocr';
      try {
        const res = await ocr.ocrPdfPath(full, f, { maxPages: 2 });
        text = (res && res.text) || '';
      } catch (e) { text = ''; results.push({ f, source, error: e.message.slice(0, 100), chars: 0, inn: null, gross: null }); continue; }
    }
    const r = ex.extractInvoice(text);
    results.push({ f: f.slice(0, 40), source, chars: text.trim().length, inn: r.inn, num: r.invoice_number, gross: r.amount_gross, has_vat: r.has_vat, conf: r.confidence });
  }
  console.log('\n' + '='.repeat(100));
  for (const r of results) {
    if (r.error) { console.log(`${r.f.padEnd(42)} | OCR ОШИБКА: ${r.error}`); continue; }
    console.log(`${r.f.padEnd(42)} | ${r.source.padEnd(5)} | ${String(r.chars).padStart(6)}с | ИНН ${(r.inn || '—').padEnd(12)} | ${String(r.gross ?? '—').padStart(12)}`);
  }
  const textFiles = results.filter((r) => r.source === 'text');
  const ocrFiles = results.filter((r) => r.source === 'ocr');
  console.log('='.repeat(100));
  console.log(`Текстовых: ${textFiles.length} (ИНН ${textFiles.filter((r) => r.inn).length}, сумма ${textFiles.filter((r) => r.gross != null).length})`);
  console.log(`Сканов (OCR): ${ocrFiles.length} (ИНН ${ocrFiles.filter((r) => r.inn).length}, сумма ${ocrFiles.filter((r) => r.gross != null).length})`);
  fs.writeFileSync(path.join(__dirname, 'reports', 'real-invoices-ocr.json'), JSON.stringify(results, null, 2));
})();
