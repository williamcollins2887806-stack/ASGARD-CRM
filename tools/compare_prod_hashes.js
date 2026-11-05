#!/usr/bin/env node
'use strict';

/**
 * Сверка локального рабочего дерева с продом по списку файлов.
 *
 * Зачем: прод обновляется rsync/file-copy, его git отстаёт на сотни коммитов.
 * Поэтому «закоммичено у меня» != «такая же версия на проде». Нужен md5.
 *
 * Читает tmp/prod-hashes.txt (вывод prod-hashes.sh) и сравнивает с локальными
 * файлами. Ничего не меняет.
 *
 * Запуск: node tools/compare_prod_hashes.js [prodHashesFile]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const prodFile = process.argv[2] || path.join(ROOT, 'tmp', 'prod-hashes.txt');

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

const lines = fs.readFileSync(prodFile, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('ssh') && !l.includes('command not found'));

let same = 0;
let localNewer = 0;
let prodMissing = 0;
const report = [];

for (const line of lines) {
  const m = line.match(/^([0-9a-f]{32})\s+(\d+)\s+(.+)$/);
  if (m) {
    const [, prodHash, prodSize, rel] = m;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      report.push({ status: 'NO_LOCAL', rel, prodHash });
      continue;
    }
    const h = md5(abs);
    const sz = fs.statSync(abs).size;
    if (h === prodHash) {
      same += 1;
      report.push({ status: 'SAME', rel });
    } else {
      localNewer += 1;
      report.push({ status: 'DIFF', rel, prodHash, localHash: h, prodSize: Number(prodSize), localSize: sz });
    }
    continue;
  }
  const missing = line.match(/^MISSING\s+-\s+(.+)$/);
  if (missing) {
    const rel = missing[1];
    const abs = path.join(ROOT, rel);
    prodMissing += 1;
    report.push({ status: fs.existsSync(abs) ? 'PROD_MISSING_LOCAL_HAS' : 'PROD_MISSING', rel });
  }
}

console.log('=== Сверка локального дерева с продом ===\n');
const groups = {
  DIFF: 'ОТЛИЧАЕТСЯ (локально новее или иное)',
  NO_LOCAL: 'НЕТ ЛОКАЛЬНО (только на проде)',
  PROD_MISSING_LOCAL_HAS: 'ТОЛЬКО ЛОКАЛЬНО (на проде нет)',
  PROD_MISSING: 'НЕТ НИГДЕ',
  SAME: 'СОВПАДАЕТ'
};

for (const key of ['DIFF', 'NO_LOCAL', 'PROD_MISSING_LOCAL_HAS', 'PROD_MISSING', 'SAME']) {
  const rows = report.filter((r) => r.status === key);
  if (!rows.length) continue;
  console.log('\n' + groups[key] + ' — ' + rows.length);
  rows.forEach((r) => {
    if (key === 'DIFF') {
      console.log('  ' + r.rel);
      console.log('     прод: ' + r.prodHash + ' (' + r.prodSize + ' Б)');
      console.log('     локал: ' + r.localHash + ' (' + r.localSize + ' Б)');
    } else {
      console.log('  ' + r.rel);
    }
  });
}

console.log('\n=== Итог ===');
console.log('совпадает: ' + same);
console.log('отличается: ' + localNewer);
console.log('только на проде: ' + prodMissing);
process.exit(0);
