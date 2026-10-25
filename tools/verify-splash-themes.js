/**
 * Гейт стартовых картинок iOS (apple-touch-startup-image).
 *
 * Что проверяем и почему.
 *  1. Для КАЖДОГО размера есть ДВЕ картинки: тёмная и светлая.
 *     Раньше была только тёмная — при светлой теме iOS показывал тёмную
 *     заставку, затем кремовый CSS-сплэш, и переход мигал (жалоба 24.10.2026).
 *  2. Фон картинки совпадает с `--bg-primary` своей темы. Этим цветом браузер
 *     закрашивает canvas ниже коробки вьюпорта; расхождение = видимый «шов».
 *     Замеряем НИЖНИЙ пиксель, потому что он граничит с canvas.
 *  3. В `index.html` светлые версии подключены через
 *     `media="(prefers-color-scheme: light)"`, и у каждого размера ровно
 *     одна пара «тёмная + светлая» (без дублей).
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

const DIR = 'public/assets/img/splash';
const HTML = 'public/mobile-app/index.html';

const DARK_BG = [10, 10, 12];      // #0a0a0c
const LIGHT_BG = [242, 242, 247];  // #F2F2F7

/**
 * Сверяем, что ожидаемые фоны действительно равны `--bg-primary` из CSS —
 * иначе картинки будут «правильными» по гейту, но не по теме.
 */
const css = fs.readFileSync('public/mobile-app/src/index.css', 'utf8');
const primaries = [...css.matchAll(/--bg-primary:\s*#([0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
const hex2rgb = (h2) => [0, 2, 4].map((i) => parseInt(h2.slice(i, i + 2), 16));
const wantDark = hex2rgb('0a0a0c');
const wantLight = hex2rgb('f2f2f7');
console.log('=== 0. Ожидаемые фоны против CSS ===');
console.log('  --bg-primary в CSS:', primaries.join(', '));
if (primaries.includes('0a0a0c')) ok('тёмная #0a0a0c объявлена в CSS');
else bad('тёмная #0a0a0c НЕ найдена в CSS — картинки разойдутся с темой');
if (primaries.includes('f2f2f7')) ok('светлая #F2F2F7 объявлена в CSS');
else bad('светлая #F2F2F7 НЕ найдена в CSS — картинки разойдутся с темой');
console.log('');

const sizes = ['1290x2796', '1179x2556', '1284x2778', '1170x2532', '1125x2436',
  '1242x2688', '828x1792', '750x1334', '2048x2732'];

// ── 1. Наличие пар файлов ─────────────────────────────────────────────────
console.log('=== 1. Пары картинок (тёмная + светлая) ===');
const files = fs.readdirSync(DIR);
for (const s of sizes) {
  const dark = files.includes(`splash-${s}.png`);
  const light = files.includes(`splash-${s}-light.png`);
  if (dark && light) ok(`splash-${s}: обе версии есть`);
  else bad(`splash-${s}: тёмная=${dark}, светлая=${light} — пара неполная`);
}

// ── 2. Цвет фона = --bg-primary темы ──────────────────────────────────────
console.log('\n=== 2. Цвет нижнего пикселя = --bg-primary ===');
for (const s of sizes) {
  for (const [suffix, want, theme] of [['', DARK_BG, 'тёмная'], ['-light', LIGHT_BG, 'светлая']]) {
    const f = path.join(DIR, `splash-${s}${suffix}.png`);
    if (!fs.existsSync(f)) { bad(`${path.basename(f)}: файла нет`); continue; }
    const png = PNG.sync.read(fs.readFileSync(f));
    // Берём пиксель в середине нижней строки.
    const x = Math.floor(png.width / 2);
    const y = png.height - 1;
    const k = (png.width * y + x) << 2;
    const got = [png.data[k], png.data[k + 1], png.data[k + 2]];
    const d = Math.max(...got.map((v, i) => Math.abs(v - want[i])));
    if (d === 0) ok(`${path.basename(f)}: низ rgb(${got.join(',')}) = фон ${theme} темы`);
    else bad(`${path.basename(f)}: низ rgb(${got.join(',')}) вместо rgb(${want.join(',')}) (Δ${d}) — будет шов`);
  }
}

// ── 3. Подключение в index.html ───────────────────────────────────────────
console.log('\n=== 3. Подключение в index.html ===');
const html = fs.readFileSync(HTML, 'utf8');
const total = (html.match(/apple-touch-startup-image/g) || []).length;
const light = (html.match(/splash-[0-9x]+-light\.png/g) || []).length;
console.log(`  всего ссылок: ${total} | из них светлых: ${light}`);
if (total === sizes.length * 2) ok(`подключено ${total} = ${sizes.length} размеров × 2 темы`);
else bad(`ссылок ${total}, ожидалось ${sizes.length * 2}`);

// Светлые обязаны иметь media с prefers-color-scheme: light
const lightLinks = [...html.matchAll(/<link[^>]*splash-[0-9x]+-light\.png[^>]*>/g)].map((m) => m[0]);
const withoutMedia = lightLinks.filter((l) => !/prefers-color-scheme:\s*light/.test(l));
if (!withoutMedia.length) ok('у всех светлых картинок media содержит prefers-color-scheme: light');
else bad(`${withoutMedia.length} светлых без media light — iOS их не выберет`);

// Тёмные НЕ должны иметь media light (иначе конфликт)
const darkLinks = [...html.matchAll(/<link[^>]*splash-[0-9x]+\.png[^>]*>/g)].map((m) => m[0]);
const darkWithLight = darkLinks.filter((l) => /prefers-color-scheme:\s*light/.test(l));
if (!darkWithLight.length) ok('тёмные картинки без media light (выбираются по умолчанию)');
else bad(`${darkWithLight.length} тёмных с media light — конфликт выбора`);

console.log('\n' + (fail === 0
  ? 'ИТОГ: OK — по две картинки на размер, фон совпадает с темой, media настроен'
  : `ИТОГ: FAIL — ${fail} нарушений`));
process.exit(fail === 0 ? 0 : 1);
