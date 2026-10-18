#!/usr/bin/env node
'use strict';
/**
 * Синхронизация сборки мобильного приложения: public/mobile-app/dist -> public/m
 * Только чтение dist + запись в public/m.
 *
 * Логика:
 *   1. удаляем старые хешированные ассеты в public/m/assets (кроме подпапок-исключений);
 *   2. копируем всё из dist поверх (включая manifest.json, phone_mask.js, картинки);
 *   3. сохраняем служебные файлы public/m, которых нет в сборке (index.html.bak и пр.).
 *
 * Запуск: node tools/sync-mobile-dist.js [--check]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'mobile-app', 'dist');
const DST = path.join(ROOT, 'public', 'm');
// эти файлы в public/m не из сборки — не удаляем
const KEEP = new Set(['index.html.bak']);

const check = process.argv.includes('--check');

if (!fs.existsSync(SRC)) { console.error('НЕТ сборки: ' + SRC); process.exit(1); }

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

const srcFiles = listFiles(SRC);
const dstFiles = fs.existsSync(DST) ? listFiles(DST) : [];
const dstSet = new Set(dstFiles);
const srcSet = new Set(srcFiles);

// удалить: старые ассеты (в assets/), которых нет в новой сборке
const toDelete = dstFiles.filter((f) => {
  if (KEEP.has(f.replace(/\\/g, '/'))) return false;
  if (srcSet.has(f)) return false;
  const norm = f.replace(/\\/g, '/');
  // чистим только хешированные бандлы в assets/
  return norm.startsWith('assets/');
});
// скопировать/обновить: всё из dist
const toCopy = srcFiles.filter((f) => {
  const s = path.join(SRC, f);
  const d = path.join(DST, f);
  if (!fs.existsSync(d)) return true;
  return fs.statSync(s).size !== fs.statSync(d).size ||
    fs.readFileSync(s).compare(fs.readFileSync(d)) !== 0;
});

console.log(`источник: ${path.relative(ROOT, SRC)} -> ${path.relative(ROOT, DST)}`);
console.log(`  файлов в сборке: ${srcFiles.length}`);
console.log(`  файлов в public/m: ${dstFiles.length}`);
console.log(`  удалить старых ассетов: ${toDelete.length}`);
console.log(`  скопировать/обновить: ${toCopy.length}`);

if (check) {
  if (toDelete.length) toDelete.slice(0, 10).forEach((f) => console.log('    - ' + f));
  if (toCopy.length) toCopy.slice(0, 15).forEach((f) => console.log('    + ' + f));
  console.log('\n(--check: ничего не менялось)');
  process.exit(toCopy.length || toDelete.length ? 1 : 0);
}

for (const f of toDelete) {
  try { fs.unlinkSync(path.join(DST, f)); console.log('  удалён ' + f); } catch (e) { console.error('  не удалить ' + f + ': ' + e.message); }
}
for (const f of toCopy) {
  const d = path.join(DST, f);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(path.join(SRC, f), d);
}
console.log(`\n✅ синхронизировано: удалено ${toDelete.length}, записано ${toCopy.length}`);
