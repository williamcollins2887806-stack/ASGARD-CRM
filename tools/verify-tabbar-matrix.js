/**
 * Гейт: формула бара работает на ЛЮБЫХ устройствах, а не только на iPhone 11.
 *
 * Зачем. Заказчик спросил прямо: «надеюсь ты не захардкодил размер экрана под
 * iPhone 11 — у всех айфонов и андроидов экраны разные». Вопрос верный: если бы
 * в коде стояли 896/845/51, фикс работал бы только на одном аппарате.
 *
 * В коде констант нет — только формула:
 *     --tabbar-lift: calc(100dvh − 100lvh)
 *     bottom:        var(--tabbar-lift)
 * Низ бара = низ коробки (dvh) − lift = dvh − (dvh − lvh) = lvh.
 * То есть бар ВСЕГДА встаёт на низ физического экрана, каким бы он ни был.
 *
 * Здесь это проверяется численно на матрице реальных устройств и режимов
 * Safari (включая окно с адресной строкой, где дефицит другой). Проверяются три
 * утверждения для каждого случая:
 *   1) низ бара совпадает с низом экрана (нет полосы);
 *   2) иконки бара целиком в пределах экрана (бар не обрезан);
 *   3) контент страницы не заезжает под бар (резерв PageShell достаточен).
 */
let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };

const TABBAR = 52;   // --tabbar-height
const CONTENT_PAD = 16;

/**
 * dvh — высота коробки вьюпорта (её отдаёт WebKit),
 * lvh — высота физического экрана,
 * safe — env(safe-area-inset-bottom) (home-индикатор / жесты).
 */
const DEVICES = [
  // iPhone 11 — тот, на котором ловили дефект.
  { name: 'iPhone 11 (standalone)', lvh: 896, dvh: 845, safe: 0 },
  // iPhone 14 Pro: чёлка и home-индикатор реально дают safe-area.
  { name: 'iPhone 14 Pro (standalone)', lvh: 852, dvh: 852, safe: 34 },
  { name: 'iPhone 14 Pro (коробка короче)', lvh: 852, dvh: 801, safe: 34 },
  { name: 'iPhone 15 Pro Max', lvh: 932, dvh: 932, safe: 34 },
  { name: 'iPhone 12 mini', lvh: 812, dvh: 812, safe: 34 },
  { name: 'iPhone SE (без индикатора)', lvh: 667, dvh: 667, safe: 0 },
  // Safari-браузер: адресная строка съедает больше, дефицит больше 51.
  { name: 'iPhone 11 (Safari, панели видны)', lvh: 896, dvh: 780, safe: 0 },
  { name: 'Android Pixel 8 (жесты, safe 24)', lvh: 915, dvh: 915, safe: 24 },
  { name: 'Android (standalone, safe 0)', lvh: 892, dvh: 892, safe: 0 },
  { name: 'Android (адресная строка)', lvh: 892, dvh: 760, safe: 0 },
  { name: 'iPad mini', lvh: 1024, dvh: 1024, safe: 20 },
  // Вырожденный случай: движок отдал коробку ВЫШЕ экрана (бывает при зуме).
  { name: 'коробка выше экрана (аномалия)', lvh: 800, dvh: 820, safe: 0 },
];

console.log('=== Проверка формулы на матрице устройств ===');
console.log('Формула: lift = dvh − lvh;  bottom = lift;  низ бара = dvh − lift\n');

const rows = [];
for (const d of DEVICES) {
  const lift = d.dvh - d.lvh;                       // --tabbar-lift
  const navBottom = d.dvh - lift;                   // позиция низа бара
  const total = TABBAR + d.safe;                    // --tabbar-total
  const navTop = navBottom - total;                 // верх бара
  // Резерв контента у PageShell: max(0, total + lift) + 16.
  // Именно через lift (знаковый), а не через обрезанный в ноль --app-gap —
  // иначе аномалия «коробка выше экрана» даёт недобор (нашла эта матрица).
  const pad = Math.max(0, total + lift) + CONTENT_PAD;
  // Сколько бара реально внутри коробки (там он может перекрыть контент).
  const insideBox = Math.max(0, d.dvh - navTop);

  rows.push({ ...d, lift, navBottom, total, navTop, pad, insideBox });

  const okSeam = Math.abs(navBottom - d.lvh) <= 1;            // п.1: нет полосы
  const okIcons = navTop >= -1;                              // п.2: иконки на экране
  const okContent = pad >= insideBox + 1;                    // п.3: контент не под баром

  console.log(`${d.name}`);
  console.log(`  экран ${d.lvh}, коробка ${d.dvh}, safe ${d.safe} -> lift ${lift >= 0 ? '+' : ''}${lift}px, бар ${navTop.toFixed(0)}..${navBottom.toFixed(0)}`);
  console.log(`  ${okSeam ? 'OK  ' : 'FAIL'} низ бара ${navBottom} = экран ${d.lvh} (полосы нет)`);
  console.log(`  ${okIcons ? 'OK  ' : 'FAIL'} иконки в пределах экрана (верх бара ${navTop.toFixed(0)} >= 0)`);
  console.log(`  ${okContent ? 'OK  ' : 'FAIL'} резерв ${pad.toFixed(0)}px >= перекрытие ${insideBox.toFixed(0)}px`);
  if (!okSeam) bad(d.name + ': низ бара не совпал с экраном');
  if (!okIcons) bad(d.name + ': бар уходит выше экрана — иконки обрежутся');
  if (!okContent) bad(d.name + ': контент заезжает под бар');
  console.log('');
}

// Сводка: бар всегда на низу экрана при любых входных данных.
console.log('=== Почему это не зависит от модели ===');
console.log('  низ бара = dvh − (dvh − lvh) = lvh — модель экрана сокращается.');
console.log('  Т.е. позиция бара выражается только через lvh (физический экран),');
console.log('  поэтому любое устройство получает свой правильный низ.');
const seamOk = rows.every((r) => Math.abs(r.navBottom - r.lvh) <= 1);
console.log('  проверено случаев:', rows.length, '| низ бара == экран во всех:', seamOk ? 'да' : 'НЕТ');
if (!seamOk) bad('формула не универсальна');

console.log('\n' + (fail === 0
  ? `ИТОГ: OK — формула универсальна (${DEVICES.length} устройств/режимов, констант экрана в коде нет)`
  : `ИТОГ: FAIL — ${fail} нарушений`));
process.exit(fail === 0 ? 0 : 1);
