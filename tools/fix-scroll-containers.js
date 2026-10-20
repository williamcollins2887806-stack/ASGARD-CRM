'use strict';
/**
 * fix-scroll-containers.js — добавляет прокрутку контентным экранам PM/Academy,
 * у которых корень объявлен как `minHeight: '100vh'` без overflow.
 *
 * Почему важно: body имеет overflow:hidden (index.css), поэтому экран выше
 * вьюпорта без собственного скролл-контейнера обрезается — до низа не добраться.
 * Центрированные заглушки (loading/error) равны вьюпорту и не трогаются.
 *
 * Запуск: node tools/fix-scroll-containers.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public', 'mobile-app', 'src');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.jsx$/.test(e.name)) files.push(p);
  }
})(ROOT);

let changed = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  let touched = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!/minHeight:\s*'100vh'/.test(l)) continue;
    if (/display:\s*'flex'[^}]*alignItems:\s*'center'/.test(l)) continue; // заглушка
    if (/overflowY/.test(l)) continue;                                     // уже прокручивается
    if (!/paddingBottom/.test(l)) continue;                                // не контентный экран
    // 1) ограничиваем высоту вьюпортом и включаем прокрутку
    // 2) нижний отступ — с учётом тап-бара (сейчас он у PM-экранов нулевой)
    lines[i] = l
      .replace(/maxHeight:\s*'[^']*',\s*/, '')
      .replace("minHeight: '100vh'", "minHeight: '100vh', maxHeight: '100dvh', overflowY: 'auto'")
      .replace(/paddingBottom:\s*['"]?\d+['"]?/, "paddingBottom: 'calc(var(--tabbar-total) + 16px)'");
    // Класс scroll-container даёт iOS-инерцию и единый стиль скролла.
    if (!/className=/.test(lines[i])) lines[i] = lines[i].replace('<div ', '<div className="scroll-container" ');
    touched = true;
  }
  if (touched) { fs.writeFileSync(f, lines.join('\n'), 'utf8'); changed++; console.log('  ' + f.replace(/\\/g, '/').split('/src/')[1]); }
}
console.log('\nфайлов изменено: ' + changed);
