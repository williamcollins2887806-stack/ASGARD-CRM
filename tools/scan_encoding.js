#!/usr/bin/env node
'use strict';

/**
 * Скан кодировки файлов, которые собираемся коммитить/деплоить.
 *
 * Класс D-142b: файл остаётся валидным UTF-8 и без U+FFFD, но русский текст
 * превращается в псевдографику («╨Ч╨░╨║╨░╨╖»). Такой файл ломает CSS-классы
 * и тексты в UI, а обычные проверки его пропускают.
 *
 * Запуск: node tools/scan_encoding.js <file...>
 *         node tools/scan_encoding.js --git-changed
 */

const fs = require('fs');
const { execSync } = require('child_process');

function scan(file) {
  const buf = fs.readFileSync(file);
  const t = buf.toString('utf8');
  const res = {
    file,
    size: buf.length,
    fffd: (t.match(/\uFFFD/g) || []).length,
    // Признак двойной перекодировки: псевдографика вплотную к кириллице.
    mojibake: (t.match(/[╨╤╥╧╪][А-Яа-яЁё]/g) || []).length,
    // Латиница-артефакты типа «тАФ» вместо тире.
    dash: (t.match(/тАФ|тАУ|тАЬ|тАЭ/g) || []).length
  };
  return res;
}

let files = process.argv.slice(2);
if (files[0] === '--git-changed') {
  const out = execSync('git status --porcelain', { encoding: 'utf8' });
  files = out.split(/\r?\n/).filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter((f) => /\.(js|jsx|css|html|md|sql|json|py|sh)$/i.test(f))
    .filter((f) => fs.existsSync(f));
}

let bad = 0;
let checked = 0;
for (const f of files) {
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
  checked += 1;
  const r = scan(f);
  const isBad = r.fffd > 0 || r.mojibake > 0 || r.dash > 0;
  if (isBad) {
    bad += 1;
    console.log('БИТЫЙ  ' + f);
    console.log('        U+FFFD: ' + r.fffd + ' | mojibake: ' + r.mojibake + ' | тире-артефакт: ' + r.dash + ' | ' + r.size + ' Б');
  }
}

console.log('\nпроверено: ' + checked + ', битых: ' + bad);
process.exit(bad ? 1 : 0);
