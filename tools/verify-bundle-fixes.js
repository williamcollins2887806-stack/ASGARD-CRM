/**
 * Финальная проверка логики клавиатурного фикса прямо в бандле:
 * ищем формулу overlap и присвоение marginBottom рядом.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(process.cwd(), 'public', 'm', 'assets');
const f = fs.readdirSync(dir).find((x) => /^index-.*\.js$/.test(x));
const t = fs.readFileSync(path.join(dir, f), 'utf8');

// 1. Формула overlap: innerHeight - (vv.height + vv.offsetTop)
const formula = /innerHeight-\([a-zA-Z_$]+\.height\+[a-zA-Z_$]+\.offsetTop\)/.exec(t);
console.log('формула overlap:', formula ? 'НАЙДЕНА → ' + formula[0] : 'НЕ найдена');

// 2. Порог 60 перед обнулением
const thr = /overlap>60|>60\?/.test(t) || />60\?Math/.test(t);
console.log('порог 60 (отсечь не-клавиатуру):', thr ? 'есть' : 'НЕТ');

// 3. marginBottom присваивается из вычисленного значения
const mbIdx = t.indexOf('marginBottom:');
let mbAround = '';
if (mbIdx > 0) mbAround = t.slice(mbIdx - 160, mbIdx + 80);
console.log('marginBottom рядом с вычислением:', /marginBottom:/.test(t) ? 'есть' : 'НЕТ');
if (mbAround) console.log('  контекст:', JSON.stringify(mbAround.slice(-140)));

// 4. Старые проблемные вещи
console.log('\n=== старые проблемы убраны? ===');
console.log('bottom: var(--vv-bottom) в барах:', /bottom:[^,}]*vv-bottom/.test(t) ? 'ЕСТЬ (плохо)' : 'убран');
console.log('autoFocus остался:', /autoFocus/.test(t) ? 'ЕСТЬ' : 'убран');
console.log('--splash-bg (сцены заставки):', t.includes('--splash-bg') ? 'есть' : 'НЕТ');
console.log('html background в CSS:', (() => {
  const cf = fs.readdirSync(dir).find((x) => /^index-.*\.css$/.test(x));
  return /html\{[^}]*background-color/.test(fs.readFileSync(path.join(dir, cf), 'utf8'));
})());
