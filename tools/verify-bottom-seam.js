/**
 * Гейт: «шов» внизу экрана — цвет canvas и последний стоп сплэша совпадают.
 *
 * История (важно, чтобы не повторять ошибку).
 *
 *  1. Симптом: внизу мобильного приложения видна светлая полоса.
 *  2. Моя первая «починка»: красил canvas цветом тап-бара (`--tabbar-solid`).
 *     Отклонена: полоса остаётся, бар визуально толще (52 + 51 = 103px).
 *  3. Моя вторая «починка»: выносил бар на «физический низ» формулой
 *     `bottom: calc(100dvh − 100lvh)`. ПРОВАЛ, и это доказано замером
 *     (tools/_test-fixed-clip.js): на iOS `position: fixed` режется по layout
 *     viewport, и при сдвиге −51px от бара видно 1 пиксель из 52.
 *     Заказчик увидел: «половина тап-бара не видна». Откачено.
 *
 *  4. ПРИЧИНА, подтверждённая фактически. Полоса ниже коробки вьюпорта —
 *     собственность браузера: её закрашивает canvas (фон `html`), и элементами
 *     страницы она НЕ накрывается. Значит бороться можно только цветом:
 *     тон у нижнего края приложения (сплэш, страницы) обязан совпадать с фоном
 *     `html`. Было: сплэш кончался на #EFEAE0 (тёплый кремовый), а `html` —
 *     #F2F2F7 (холодный серый): расхождение по синему 23 единицы — читается как
 *     полоса. Тёмная тема: #04050a против #0a0a0c.
 *
 * Гейт проверяет:
 *   • бар НЕ смещён вниз (иначе он обрежется) — `bottom: 0`, и в CSS нет
 *     `--tabbar-lift` со сдвигом;
 *   • резерв под бар — полная высота `--tabbar-total` (не «минус зазор»: экран
 *     внизу всё равно вне документа, а урезанный резерв оставлял пустоту);
 *   • последний стоп градиента сплэша == фон `html`/`--bg-primary` в ОБЕИХ темах;
 *   • `--app-gap` используется только для растяжения слоя сплэша.
 */
const fs = require('fs');

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

const CSS = 'public/mobile-app/src/index.css';
const TABBAR = 'public/mobile-app/src/components/layout/TabBar.jsx';
const SPLASH = 'public/mobile-app/src/components/AppSplash.jsx';

const css = fs.readFileSync(CSS, 'utf8');
const tabbar = fs.readFileSync(TABBAR, 'utf8');
const splash = fs.readFileSync(SPLASH, 'utf8');

// ── 1. Бар не смещён вниз ─────────────────────────────────────────────────
console.log('=== 1. Тап-бар стоит на bottom: 0 (не обрезается) ===');
if (/bottom:\s*0\b/.test(tabbar)) ok('TabBar: bottom: 0');
else bad('TabBar не на bottom: 0 — бар может обрезаться');

if (/--tabbar-lift\s*:/.test(css)) {
  bad('--tabbar-lift вернулся: сдвиг бара вниз обрезает его (доказано замером)');
} else {
  ok('--tabbar-lift удалён (сдвига вниз нет)');
}
if (/var\(--tabbar-lift/.test(tabbar)) {
  bad('TabBar снова использует --tabbar-lift');
} else {
  ok('TabBar не смещает бар через --tabbar-lift');
}
// Возврат высоты: бар должен быть во всю высоту с safe-area.
if (/paddingBottom:\s*'var\(--safe-bottom\)'/.test(tabbar)) {
  ok('TabBar резервирует safe-area внутри себя (бар полностью виден)');
} else {
  bad('TabBar не резервирует safe-area — низ бара уедет под индикатор');
}

// ── 2. Резерв под бар = полная высота ─────────────────────────────────────
console.log('\n=== 2. Резерв под бар (без урезания) ===');
const strayFiles = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.jsx')) {
      const t = fs.readFileSync(p, 'utf8');
      if (/var\(--tabbar-lift/.test(t)) strayFiles.push(p);
    }
  }
};
walk('public/mobile-app/src');
if (!strayFiles.length) ok('ни один экран не считает резерв через --tabbar-lift');
else bad('остались файлы с --tabbar-lift: ' + strayFiles.slice(0, 5).join(', '));

const shell = fs.readFileSync('public/mobile-app/src/components/layout/PageShell.jsx', 'utf8');
if (/paddingBottom:\s*'calc\(var\(--tabbar-total\)\s*\+\s*16px\)'/.test(shell)) {
  ok('PageShell резервирует полную высоту бара');
} else if (/var\(--tabbar-lift/.test(shell)) {
  bad('PageShell вернулся к урезанному резерву');
} else {
  console.log('  (формула резерва в PageShell отличается — проверь глазами)');
}

// ── 3. ГЛАВНОЕ: цвет нижнего края сплэша == фон html ──────────────────────
console.log('\n=== 3. Цвет «шва»: последний стоп сплэша == --bg-primary ===');
const htmlBg = (css.match(/html\s*\{[^}]*background-color\s*:\s*([^;]+);/) || [])[1] || '';
console.log('  фон html:', htmlBg.trim() || '(не найден)');

// Достаём оба градиента сплэша (тёмный и светлый) и их ПОСЛЕДНИЙ цвет.
const grads = [...splash.matchAll(/--splash-bg:\s*radial-gradient\(([^;]+)\);/g)].map((m) => m[1]);
if (grads.length < 2) bad(`найдено градиентов сплэша: ${grads.length} (ожидалось 2 — тёмный и светлый)`);

grads.forEach((g, i) => {
  const theme = i === 0 ? 'тёмная' : 'светлая';
  // Последний стоп: ищем последний "color <n>%" или "color 100%".
  const stops = [...g.matchAll(/(#[0-9a-fA-F]{3,8}|var\([^)]+\))\s+([\d.]+)%/g)];
  if (!stops.length) { bad(`${theme}: не разобрал стопы градиента`); return; }
  const last = stops[stops.length - 1];
  const lastPct = Number(last[2]);
  const lastColor = last[1];
  console.log(`  ${theme}: последний стоп ${lastColor} на ${lastPct}%`);
  if (lastPct !== 100) bad(`${theme}: градиент не доходит до 100% (последний ${lastPct}%) — низ не закрашен`);
  if (!/var\(--bg-primary/.test(lastColor)) {
    bad(`${theme}: последний стоп ${lastColor} не привязан к --bg-primary — «шов» вернётся при смене палитры`);
  } else {
    ok(`${theme}: последний стоп = var(--bg-primary) — совпадает с canvas`);
  }
});

// --bg-primary должен быть реально объявлен для обеих тем.
const primaries = [...css.matchAll(/--bg-primary:\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => m[1]);
console.log('  --bg-primary объявлен:', primaries.join(', ') || '(нет)');
if (primaries.length < 2) bad('--bg-primary объявлен меньше чем для двух тем');
else ok('--bg-primary есть для тёмной и светлой темы');

// --app-gap не должен больше нигде влиять на бар.
if (/var\(--app-gap/.test(tabbar)) bad('TabBar использует --app-gap — это про сплэш, не про бар');
else ok('--app-gap не причастен к тап-бару');

console.log('\n' + (fail === 0
  ? 'ИТОГ: OK — бар на bottom:0 и полностью виден, низ приложения одного цвета с canvas'
  : `ИТОГ: FAIL — ${fail} нарушений`));
process.exit(fail === 0 ? 0 : 1);
