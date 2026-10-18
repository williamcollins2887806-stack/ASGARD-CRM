/**
 * Синхронизация сборки мобильного приложения dist → public/m.
 * public/m раздаётся сервером (/m/) и коммитится в git; dist в .gitignore.
 * Копируем только артефакты сборки (assets + index.html), служебные файлы
 * (manifest.json, phone_mask.js, иконки) не трогаем.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'public/mobile-app/dist');
const DST = path.resolve(__dirname, '..', 'public/m');

if (!fs.existsSync(SRC)) { console.error('Нет dist — сначала npm run build'); process.exit(1); }

// 1. assets: очистить и скопировать заново (хэши меняются → старьё копить нельзя)
const srcAssets = path.join(SRC, 'assets');
const dstAssets = path.join(DST, 'assets');
if (fs.existsSync(dstAssets)) fs.rmSync(dstAssets, { recursive: true, force: true });
fs.mkdirSync(dstAssets, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(srcAssets)) {
  fs.cpSync(path.join(srcAssets, f), path.join(dstAssets, f), { recursive: true });
  n++;
}
console.log(`assets: скопировано ${n} элементов (рекурсивно)`);

// 2. index.html — с бэкапом предыдущего
const dstIndex = path.join(DST, 'index.html');
if (fs.existsSync(dstIndex)) fs.copyFileSync(dstIndex, path.join(DST, 'index.html.bak'));
fs.copyFileSync(path.join(SRC, 'index.html'), dstIndex);
console.log('index.html: обновлён (старый → index.html.bak)');

// 3. иконки/манифест, если их нет в public/m — добрать из dist
for (const f of ['manifest.json', 'favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'asgard-logo.png', 'asgard-emblem.png', 'icons.svg']) {
  const s = path.join(SRC, f), d = path.join(DST, f);
  if (fs.existsSync(s) && !fs.existsSync(d)) { fs.copyFileSync(s, d); console.log(`добавлен ${f}`); }
}
console.log('\n✅ public/m обновлён');
