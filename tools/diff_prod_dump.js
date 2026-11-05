#!/usr/bin/env node
'use strict';

/**
 * Разобрать дамп прод-файлов (base64) и сравнить с локальными.
 *
 * Зачем: прод обновляется rsync, git на проде отстаёт. Перед деплоем нужно
 * знать, не потеряем ли мы правку, которая есть ТОЛЬКО на проде.
 *
 * Запуск: node tools/diff_prod_dump.js tmp/prod-b64.txt
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dumpFile = process.argv[2] || path.join(ROOT, 'tmp', 'prod-b64.txt');

const raw = fs.readFileSync(dumpFile, 'utf8');
const blocks = raw.split(/^###FILE /m).slice(1);

function badChars(buf) {
  const t = buf.toString('utf8');
  return {
    fffd: (t.match(/\uFFFD/g) || []).length,
    mojibake: /╨|╤|тАФ/.test(t)
  };
}

let diffs = 0;
const out = [];

for (const block of blocks) {
  const nl = block.indexOf('\n');
  if (nl < 0) continue;
  const rel = block.slice(0, nl).replace(/\r$/, '').trim();
  const b64 = block.slice(nl + 1).split('###END')[0].replace(/\s+/g, '');
  if (!rel || !b64) continue;

  let prodBuf;
  try {
    prodBuf = Buffer.from(b64, 'base64');
  } catch (e) {
    out.push({ rel, status: 'DECODE_FAIL', error: e.message });
    continue;
  }

  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    out.push({ rel, status: 'NO_LOCAL', prodSize: prodBuf.length });
    continue;
  }
  const localBuf = fs.readFileSync(abs);
  const prodBad = badChars(prodBuf);
  const localBad = badChars(localBuf);

  if (prodBuf.equals(localBuf)) {
    out.push({ rel, status: 'SAME', size: prodBuf.length });
    continue;
  }

  diffs += 1;
  // Построчный diff для текстовых файлов
  let diffLines = 0;
  const prodLines = prodBuf.toString('utf8').split(/\r?\n/);
  const localLines = localBuf.toString('utf8').split(/\r?\n/);
  const max = Math.max(prodLines.length, localLines.length);
  const samples = [];
  for (let i = 0; i < max; i += 1) {
    if (prodLines[i] !== localLines[i]) {
      diffLines += 1;
      if (samples.length < 6) {
        samples.push({ line: i + 1, prod: prodLines[i], local: localLines[i] });
      }
    }
  }

  out.push({
    rel,
    status: 'DIFF',
    prodSize: prodBuf.length,
    localSize: localBuf.length,
    prodBad,
    localBad,
    diffLines,
    samples
  });
}

console.log('=== Прод vs локально ===\n');
for (const r of out) {
  if (r.status === 'SAME') {
    console.log('SAME       ' + r.rel + ' (' + r.size + ' Б)');
    continue;
  }
  if (r.status === 'NO_LOCAL') {
    console.log('NO_LOCAL   ' + r.rel + ' (только на проде, ' + r.prodSize + ' Б)');
    continue;
  }
  console.log('DIFF       ' + r.rel);
  console.log('           прод ' + r.prodSize + ' Б, локально ' + r.localSize + ' Б, различаются строк: ' + r.diffLines);
  console.log('           битые символы — прод: U+FFFD ' + r.prodBad.fffd + ', mojibake ' + r.prodBad.mojibake
    + ' | локально: U+FFFD ' + r.localBad.fffd + ', mojibake ' + r.localBad.mojibake);
  r.samples.forEach((s) => {
    console.log('           стр.' + s.line);
    console.log('             прод: ' + (s.prod == null ? '—' : s.prod.slice(0, 120)));
    console.log('             локал: ' + (s.local == null ? '—' : s.local.slice(0, 120)));
  });
}

console.log('\nфайлов с отличием: ' + diffs + ' из ' + out.length);
process.exit(0);
