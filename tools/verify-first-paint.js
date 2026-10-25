/**
 * Гейт «первого кадра» — против плавающего бага 50/50 (гонка при старте).
 *
 * Диагноз (24.10.2026, подтверждён фактами).
 * Браузер рисует первый кадр раньше, чем загрузится `index-*.css` с бандлом.
 * Если до этого момента фон не задан ИНЛАЙНОМ в `head`, первый кадр БЕЛЫЙ.
 * Дальше цвет приходит из CSS — и получается тот самый плавающий «полоса есть /
 * полосы нет 50 на 50»: зависит от того, успел ли CSS.
 *
 * Проверяем:
 *  1. в `head` есть `<style>` с фоном `html` (не только во внешнем CSS);
 *  2. в `head` есть скрипт темы, срабатывающий ДО загрузки бандла;
 *  3. цвета в инлайне РАВНЫ `--bg-primary` из темы — иначе инлайн и CSS
 *     разойдутся, и на стыке появится вспышка вместо «шва»;
 *  4. в `head` нет `<link rel="stylesheet">` ВЫШЕ инлайн-стилей — иначе браузер
 *     может применить внешний CSS раньше, и смысл инлайна теряется;
 *  5. тело документа не белое по умолчанию (`body { background-color: inherit }`).
 *
 * Негативный контроль: если убрать `<style>` из `head`, гейт обязан упасть.
 */
const fs = require('fs');

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

const HTML = 'public/m/index.html';       // собранный (его отдаёт прод)
const CSS = 'public/mobile-app/src/index.css';
const html = fs.readFileSync(HTML, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');

const headEnd = html.indexOf('</head>');
const head = headEnd > 0 ? html.slice(0, headEnd) : html;

// ── 1. Инлайн-стиль в head ────────────────────────────────────────────────
console.log('=== 1. Фон задан инлайном в head ===');
const styleAt = head.indexOf('<style>');
if (styleAt >= 0) ok('<style> в head есть');
else bad('нет <style> в head — первый кадр будет белым (это и есть гонка)');

const styleBlock = styleAt >= 0 ? head.slice(styleAt, head.indexOf('</style>', styleAt)) : '';
if (/html\s*\{[^}]*background-color\s*:\s*#0a0a0c/i.test(styleBlock)) {
  ok('тёмный фон html задан инлайном');
} else {
  bad('в инлайне нет фона html для тёмной темы');
}
if (/html\s*\{[^}]*background-color\s*:\s*#F2F2F7/i.test(styleBlock)) {
  ok('светлый фон html задан инлайном');
} else {
  bad('в инлайне нет фона html для светлой темы');
}

// ── 2. Скрипт темы до бандла ──────────────────────────────────────────────
console.log('\n=== 2. Скрипт темы срабатывает до бандла ===');
if (/asgard_theme/.test(head)) ok('скрипт читает сохранённую тему в head');
else bad('нет инлайн-скрипта темы — класс .light появится только после бандла');
const scriptAt = head.indexOf('<script>');
const mainAt = html.indexOf('src/main.jsx') >= 0 ? html.indexOf('src/main.jsx') : html.indexOf('assets/index-');
if (scriptAt >= 0 && mainAt > scriptAt) ok('скрипт темы идёт РАНЬШЕ бандла');
else bad('порядок неверен: скрипт темы не раньше бандла');
// Между инлайн-стилем и бандлом не должно быть внешних CSS
const externalCssAt = head.search(/<link[^>]+rel=["']stylesheet["']/);
if (externalCssAt >= 0 && externalCssAt < styleAt) {
  bad('внешний CSS подключён ВЫШЕ инлайн-стиля — он может примениться первым');
} else {
  ok('внешнего CSS выше инлайн-стиля нет');
}

// ── 3. Цвета инлайна == --bg-primary темы ─────────────────────────────────
console.log('\n=== 3. Инлайн совпадает с --bg-primary темы ===');
const primaries = [...css.matchAll(/--bg-primary:\s*#([0-9a-fA-F]{6})/g)]
  .map((m) => m[1].toLowerCase());
console.log('  --bg-primary в теме:', primaries.join(', '));

const inlineColors = [...styleBlock.matchAll(/background-color\s*:\s*#([0-9a-fA-F]{6})/g)]
  .map((m) => m[1].toLowerCase());
console.log('  цвета в инлайне    :', [...new Set(inlineColors)].join(', '));

for (const need of primaries) {
  if (inlineColors.includes(need)) ok(`#${need} есть в инлайне`);
  else bad(`--bg-primary #${need} НЕ найден в инлайне — инлайн и CSS разойдутся`);
}
const extra = [...new Set(inlineColors)].filter((c) => !primaries.includes(c));
if (!extra.length) ok('лишних цветов в инлайне нет');
else bad('в инлайне есть цвета, которых нет в теме: ' + extra.join(', '));

// ── 4. body тоже в цвет темы ──────────────────────────────────────────────
console.log('\n=== 4. body не белый до загрузки бандла ===');
if (/body\s*\{[^}]*background-color\s*:\s*inherit/i.test(styleBlock)) {
  ok('body наследует фон (белой вспышки не будет)');
} else if (/body\s*\{[^}]*background-color\s*:/i.test(styleBlock)) {
  ok('body получает явный фон');
} else {
  bad('у body нет фона — между html и первым рендером React проступит белый');
}

console.log('\n' + (fail === 0
  ? 'ИТОГ: OK — первый кадр окрашен инлайном, гонки нет, цвета совпадают с темой'
  : `ИТОГ: FAIL — ${fail} нарушений`));
process.exit(fail === 0 ? 0 : 1);
