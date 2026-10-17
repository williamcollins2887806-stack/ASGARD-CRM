const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const PDFTOTEXT = 'C:\\Users\\Nikita-ASGARD\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftotext.exe';
const dir = path.join(__dirname, 'fixtures', 'real-invoices');
(async () => {
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
    console.log('Нет ключа vision — показываю только, какие файлы без текстового слоя (им нужен OCR):');
  }
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  const scans = [];
  for (const f of files) {
    let text = '';
    try { text = execFileSync(PDFTOTEXT, ['-layout', path.join(dir, f), '-'], { encoding: 'utf8', maxBuffer: 32e6, timeout: 30000 }); } catch (_) {}
    if (text.trim().length < 50) scans.push({ f, chars: text.trim().length });
  }
  console.log(`Файлов без текстового слоя (сканы/картинки): ${scans.length}/${files.length}`);
  scans.forEach((s) => console.log(`  · ${s.f} (${s.chars} симв.)`));
  process.exit(0);
})();
