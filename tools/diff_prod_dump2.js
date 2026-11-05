#!/usr/bin/env node
'use strict';

/**
 * Точная сверка прод-дампа с локальными файлами.
 *
 * Учитывает, что git/Windows хранит CRLF, а прод — LF. Иначе «0 различающихся
 * строк, но другой размер» выглядит как непонятное расхождение.
 *
 * Запуск: node tools/diff_prod_dump2.js tmp/prod-b64.txt
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dumpFile = process.argv[2] || path.join(ROOT, 'tmp', 'prod-b64.txt');
const raw = fs.readFileSync(dumpFile, 'utf8');
const blocks = raw.split(/^###FILE /m).slice(1);

function norm(buf) {
  // Только для сравнения: CRLF → LF. Содержимое не меняем.
  return buf.toString('utf8').replace(/\r\n/g, '\n');
}

let same = 0;
let onlyEol = 0;
const real = [];

for (const block of blocks) {
  const nl = block.indexOf('\n');
  if (nl < 0) continue;
  const rel = block.slice(0, nl).replace(/\r$/, '').trim();
  const b64 = block.slice(nl + 1).split('###END')[0].replace(/\s+/g, '');
  if (!rel || !b64) continue;
  const prodBuf = Buffer.from(b64, 'base64');
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { real.push({ rel, verdict: 'NO_LOCAL' }); continue; }
  const localBuf = fs.readFileSync(abs);

  if (prodBuf.equals(localBuf)) { same += 1; console.log('IDENTICAL   ' + rel); continue; }
  if (norm(prodBuf) === norm(localBuf)) {
    onlyEol += 1;
    console.log('ONLY-EOL    ' + rel + '  (содержимое то же, различие только CRLF/LF)');
    continue;
  }

  // Реальное расхождение: показываем первые 5 отличающихся строк.
  const p = norm(prodBuf).split('\n');
  const l = norm(localBuf).split('\n');
  const samples = [];
  for (let i = 0; i < Math.max(p.length, l.length) && samples.length < 5; i += 1) {
    if (p[i] !== l[i]) samples.push({ n: i + 1, prod: p[i], local: l[i] });
  }
  console.log('CONTENT-DIFF ' + rel + '  (прод ' + p.length + ' стр, локально ' + l.length + ' стр)');
  samples.forEach((s) => {
    console.log('   стр.' + s.n);
    console.log('     прод : ' + (s.prod == null ? '—' : s.prod));
    console.log('     локал: ' + (s.local == null ? '—' : s.local));
  });
  real.push({ rel, verdict: 'CONTENT-DIFF' });
}

console.log('\n=== Итог ===');
console.log('идентичны: ' + same);
console.log('только переводы строк: ' + onlyEol);
console.log('реально отличаются: ' + real.length);
