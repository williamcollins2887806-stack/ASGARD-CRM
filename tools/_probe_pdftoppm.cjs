require('dotenv').config();
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const ocr = require('../src/services/pdf-ocr');
console.log('OCR_MODEL=', ocr.OCR_MODEL);
// resolveBin не экспортируется — проверяем косвенно через рендер страниц
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'tests', 'fixtures', 'real-invoices');
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
(async () => {
  // Найти файл с пустым текстовым слоем (скан)
  const { execFileSync } = require('child_process');
  const PDFTOTEXT = 'C:\\Users\\Nikita-ASGARD\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftotext.exe';
  const scans = [];
  for (const f of files) {
    let t = '';
    try { t = execFileSync(PDFTOTEXT, ['-layout', path.join(dir, f), '-'], { encoding: 'utf8', maxBuffer: 32e6, timeout: 20000 }); } catch (_) {}
    if (t.trim().length < 50) scans.push(f);
  }
  console.log('сканов:', scans.length, scans.map(s=>s.slice(0,28)));
  // Проверяем, что pdftoppm вообще нашёлся и рендерит — через внутренний вызов ocrPdfPath
  // не хочется тратить деньги, поэтому дергаем ocrPdfPath с фейковым path? Нет.
  // Вместо этого — env-override и прямой spawn, чтобы доказать, что автопоиск даёт рабочий путь.
  const p = path.join(dir, scans[0]);
  console.log('тест-скан:', scans[0]);
  // Пробуем ENV override на неверный путь → автопоиск должен всё равно найти.
  process.env.PDFTOPPM_BIN = 'C:\\nope\\pdftoppm.exe';
  const t0 = Date.now();
  try {
    // _pdfToPages не экспортирован; используем ocrPdfPath с maxPages и перехватом
    // через monkey-patch aiProvider.complete, чтобы не ходить в сеть.
    const aiProvider = require('../src/services/ai-provider');
    const orig = aiProvider.complete;
    let calls = 0;
    aiProvider.complete = async () => { calls++; return { text: '[ПУСТАЯ СТРАНИЦА]' }; };
    const res = await ocr.ocrPdfPath(p, scans[0], { maxPages: 1, dpi: 60, concurrency: 1, batchSize: 1 });
    aiProvider.complete = orig;
    console.log('ocrPdfPath OK: pages=' + res.diagnostics.pages + ' vision_calls=' + calls + ' ms=' + (Date.now() - t0));
    console.log('diagnostics:', JSON.stringify(res.diagnostics));
  } catch (e) {
    console.log('ocrPdfPath FAILED:', e.message);
  }
})().catch((e) => console.log('ERR', e.message));
