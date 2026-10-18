'use strict';
/** Замена старого шрифта Cinzel на системный (наследуется) во всех полевых экранах. */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'public', 'mobile-app', 'src', 'pages', 'field');
const APPLY = process.argv.includes('--apply');

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.jsx'));
let total = 0;
for (const f of files) {
  const p = path.join(DIR, f);
  let s = fs.readFileSync(p, 'utf8');
  const before = (s.match(/Cinzel/g) || []).length;
  if (!before) continue;
  // все варианты записи font-family с Cinzel → inherit (системный стек из index.css)
  s = s.replace(/fontFamily:\s*["'`]Cinzel[^"'`]*["'`]/g, 'fontFamily: "inherit"');
  s = s.replace(/font-family:\s*["']?Cinzel[^;"'}]*["']?/g, 'font-family:inherit');
  s = s.replace(/["'`]Cinzel[^"'`]*["'`]/g, '"inherit"');
  s = s.replace(/\bCinzel\b/g, 'inherit');
  const after = (s.match(/Cinzel/g) || []).length;
  if (APPLY) fs.writeFileSync(p, s, 'utf8');
  console.log(`${f}: Cinzel ${before} → ${after}`);
  total += before;
}
console.log(`\nвсего вхождений Cinzel: ${total}${APPLY ? ' — ЗАМЕНЕНО' : ' (dry-run, добавь --apply)'}`);
