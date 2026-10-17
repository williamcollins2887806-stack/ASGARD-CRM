const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const ex = require('../src/services/invoice-extract');

const PDFTOTEXT = 'C:\\Users\\Nikita-ASGARD\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftotext.exe';
const dir = path.join(__dirname, 'fixtures', 'real-invoices');

const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
console.log(`Реальных счетов: ${files.length}. Разбор через pdftotext + extractInvoice\n` + '='.repeat(90));

let withInn = 0, withSum = 0, withNum = 0, withBank = 0, empty = 0;
const rows = [];
for (const f of files) {
  const full = path.join(dir, f);
  let text = '';
  try {
    text = execFileSync(PDFTOTEXT, ['-layout', full, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  } catch (e) { text = ''; }
  const r = ex.extractInvoice(text);
  if (r.inn) withInn++;
  if (r.amount_gross != null) withSum++;
  if (r.invoice_number) withNum++;
  if (r.bik || r.rs) withBank++;
  if (!text.trim()) empty++;
  rows.push({ f: f.slice(0, 42), chars: text.length, inn: r.inn || '—', num: (r.invoice_number || '—').slice(0, 16), gross: r.amount_gross != null ? String(r.amount_gross) : '—', vat: r.has_vat === true ? 'да' : r.has_vat === false ? 'нет' : '?', conf: r.confidence, bank: (r.bik || r.rs) ? 'да' : '—' });
}
// Отчёт
for (const r of rows) {
  console.log(`${r.f.padEnd(44)} | ${String(r.chars).padStart(6)}с | ИНН ${(r.inn || '—').padEnd(12)} | № ${r.num.padEnd(16)} | ${r.gross.padStart(12)} | НДС ${r.vat} | банк ${r.bank}`);
}
console.log('='.repeat(90));
console.log(`Итого: ИНН ${withInn}/${files.length}, сумма ${withSum}/${files.length}, номер ${withNum}/${files.length}, банк ${withBank}/${files.length}, пустой текст ${empty}/${files.length}`);
fs.writeFileSync(path.join(__dirname, 'reports', 'real-invoices-parse.json'), JSON.stringify({ generated_at: new Date().toISOString(), total: files.length, withInn, withSum, withNum, withBank, empty, rows }, null, 2));
console.log('Отчёт: tests/reports/real-invoices-parse.json');
