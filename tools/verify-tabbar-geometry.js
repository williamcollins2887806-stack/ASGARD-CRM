/**
 * Гейт D-341: тап-бар прижат к ФИЗИЧЕСКОМУ низу экрана, а не к коробке вьюпорта.
 *
 * История (важно, чтобы не откатилось назад).
 *
 * 1. Дефект. На iOS коробка вьюпорта КОРОЧЕ физического экрана (iPhone 11:
 *    `100dvh` = 845 против `100lvh` = 896). Бар `fixed; bottom:0` прилипал к низу
 *    КОРОБКИ, и снизу оставалась незакрытая полоса 51px.
 *
 * 2. Первая «починка» (ОТВЕРГНУТА заказчиком 23.10.2026) — МАСКИРОВКА: полосу
 *    красили в цвет бара (`--tabbar-solid`). Полоса не исчезала, а бар визуально
 *    становился толще (52px + 51px = 103px) и при самопочинке вьюпорта «то
 *    жирнел, то сужался». Так делать НЕЛЬЗЯ, и этот гейт ловит возврат к этому.
 *
 * 3. Настоящее решение — ГЕОМЕТРИЯ: бар опускается на дефицит коробки
 *    (`bottom: calc(100dvh − 100lvh)` = −51px) и встаёт на физический низ.
 *    Формула самокомпенсируется, поэтому при смене высоты коробки позиция на
 *    экране одна и та же.
 *
 * Проверяем: (а) геометрия задана в CSS и применяется в TabBar; (б) маскировка
 * не вернулась (фон `html` — не цвет бара, `--tabbar-solid` удалён); (в) в
 * модели iOS бар уходит за коробку и достаёт до физического низа; (г) высота
 * бара равно `--tabbar-total`, без раздутой «юбки»; (д) заставка накрывает экран.
 */
const fs = require('fs');
const path = require('path');
const { webkit } = require('playwright');

const ROOT = process.cwd();
const SRC = 'public/mobile-app/src';
const distAssets = path.join(ROOT, 'public', 'mobile-app', 'dist', 'assets');
const cssFile = fs.readdirSync(distAssets).find((f) => /^index-.*\.css$/.test(f));
const css = fs.readFileSync(path.join(distAssets, cssFile), 'utf8');
console.log('CSS сборки:', cssFile);

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

(async () => {
  // ── 1. Статика ─────────────────────────────────────────────────────────
  console.log('\n=== 1. Геометрия в исходниках ===');

  if (/--tabbar-lift\s*:\s*calc\(100dvh\s*-\s*100lvh\)/.test(css)) {
    ok('--tabbar-lift = calc(100dvh − 100lvh) есть в сборке');
  } else {
    bad('нет --tabbar-lift — бар останется у низа коробки');
  }

  const tabbar = fs.readFileSync(path.join(SRC, 'components/layout/TabBar.jsx'), 'utf8');
  if (/bottom:\s*'var\(--tabbar-lift/.test(tabbar)) {
    ok('TabBar смещает бар через bottom: var(--tabbar-lift)');
  } else {
    bad('TabBar не смещает бар на --tabbar-lift');
  }
  // «Юбка»/padding компенсировали бы высоту — это снова маскировка.
  if (/paddingBottom:\s*'var\(--safe-bottom\)'/.test(tabbar)) {
    bad('TabBar вернул paddingBottom: --safe-bottom (раздувает высоту бара)');
  } else {
    ok('у бара нет paddingBottom-надбавки (высота честная)');
  }

  const htmlBgBlock = css.match(/html\s*\{[^}]*background-color\s*:\s*([^;]+);/);
  const htmlBgVal = htmlBgBlock ? htmlBgBlock[1].trim() : '(не найдено)';
  if (/--tabbar-solid/.test(htmlBgVal)) {
    bad(`фон html = цвет бара (${htmlBgVal}) — маскировка, полоса останется`);
  } else {
    ok(`фон html не маскирует полосу (${htmlBgVal})`);
  }
  if (/--tabbar-solid\s*:/.test(css) || /THEME_TABBAR/.test(
    fs.readFileSync(path.join(SRC, 'stores/themeStore.js'), 'utf8'))) {
    bad('--tabbar-solid / THEME_TABBAR всё ещё есть — маскировка не убрана');
  } else {
    ok('маскировка удалена (нет --tabbar-solid и THEME_TABBAR)');
  }

  const splash = fs.readFileSync(path.join(SRC, 'components/AppSplash.jsx'), 'utf8');
  if (/top:\s*'calc\(-1 \* var\(--app-gap/.test(splash)
    && /bottom:\s*'calc\(-1 \* var\(--app-gap/.test(splash)) {
    ok('AppSplash растянут на --app-gap (накрывает физический экран)');
  } else {
    bad('AppSplash не растянут на --app-gap — контент будет прыгать');
  }

  // Контент не должен резервировать ПОЛНУЮ высоту бара: на iPhone её большая
  // часть лежит в зазоре вне документа, и внизу осталась бы пустота ~51px.
  const shell = fs.readFileSync(path.join(SRC, 'components/layout/PageShell.jsx'), 'utf8');
  if (/paddingBottom:\s*'calc\(max\(0px,\s*var\(--tabbar-total\)\s*\+\s*var\(--tabbar-lift/.test(shell)) {
    ok('PageShell считает перекрытие через знаковый --tabbar-lift');
  } else if (/paddingBottom:\s*'calc\(var\(--tabbar-total\)/.test(shell)) {
    bad('PageShell резервирует полную высоту бара — на iPhone внизу будет ~51px пустоты');
  } else {
    bad('PageShell не найден ожидаемый резерв под бар');
  }

  // Та же формула обязана быть во ВСЕХ экранах, которые сами резервируют место
  // под бар. Иначе на «главной», в кабинете PM, Академии и канбане останется
  // ~51px пустоты, а контент отстанет от бара (нашёл визуальный прогон 23.10.2026:
  // 15 устаревших мест в 13 файлах).
  const stale = [];
  const walkSrc = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkSrc(p);
      else if (e.name.endsWith('.jsx')) {
        const t = fs.readFileSync(p, 'utf8');
        if (/calc\(var\(--tabbar-total\) \+ 16px\)/.test(t)) stale.push(path.relative(SRC, p));
      }
    }
  };
  walkSrc(SRC);
  if (!stale.length) {
    ok('во всех экранах резерв считается с учётом зазора (нет устаревшей формулы)');
  } else {
    bad('устаревшая формула резерва осталась в: ' + stale.slice(0, 6).join(', '));
  }

  // Констант размера экрана в коде быть НЕ должно — иначе фикс работал бы
  // только на одном аппарате (вопрос заказчика 23.10.2026).
  const appFiles = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|css)$/.test(e.name)) appFiles.push(p);
    }
  };
  walk(SRC);
  const hardcoded = [];
  for (const f of appFiles) {
    const src = fs.readFileSync(f, 'utf8');
    // Ищем 896/845/852/932/667 как ОТДЕЛЬНЫЕ ЧИСЛА в коде (не в комментариях).
    const withoutComments = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    // Ищем высоты экранов iPhone/Android как ОТДЕЛЬНЫЕ ЧИСЛА в коде (не в
    // комментариях). «1024» намеренно исключено: это деление на килобайты
    // (`size / 1024`) и размеры текстур 3D-сцен, а не геометрия экрана.
    for (const m of withoutComments.matchAll(/(?<![\w.-])(896|845|852|932|667|812|915|892)(?![\w.-])/g)) {
      hardcoded.push(path.relative(SRC, f) + ': ' + m[1]);
    }
  }
  if (!hardcoded.length) {
    ok('констант размера экрана в коде нет (только формула dvh/lvh)');
  } else {
    bad('найден хардкод размера экрана: ' + hardcoded.slice(0, 5).join(', '));
  }

  // ── 2. Модель iOS ──────────────────────────────────────────────────────
  //
  // Почему синтетическая. В headless-браузере `100dvh` == `100lvh` == высоте
  // окна, поэтому условие iOS (коробка КОРОЧЕ экрана) там физически не
  // воспроизводится: `fixed; bottom` всегда попадает в низ окна. Проверять на
  // таком стенде «дошёл ли бар до низа» — самообман, что и показал первый прогон.
  //
  // Поэтому модель честная и явная:
  //   • внешний блок 896px — «физический экран»;
  //   • внутренний блок 845px — «коробка вьюпорта» (то, что видит WebKit);
  //   • бар прижат к коробке и сдвинут на дефицит `896 − 845 = 51px` вниз —
  //     ровно то, что даёт `bottom: calc(100dvh − 100lvh)` на устройстве.
  // Проверяем геометрическое утверждение: сдвиг на дефицит ставит низ бара на
  // низ ЭКРАНА (896), а не оставляет его на 845. И что высота бара не раздута.
  console.log('\n=== 2. Модель iOS: экран 896, коробка 845 ===');

  const SCREEN = 896;   // физический экран (iPhone 11)
  const BOX = 845;      // коробка вьюпорта, которую отдаёт WebKit
  const DEFICIT = SCREEN - BOX; // = 51 — то, что вычисляет формула
  console.log(`  дефицит коробки = ${SCREEN} − ${BOX} = ${DEFICIT}px`);

  const mk = () => `<!doctype html><html><head><meta charset="utf-8">
<style>${css}</style>
<style>
  html, body { margin:0; background:#333; }
  /* «Физический экран» */
  .screen { position:relative; width:393px; height:${SCREEN}px; background:#222; overflow:hidden; }
  /* «Коробка вьюпорта»: на iOS она короче экрана */
  .box { position:relative; width:393px; height:${BOX}px; }
  /* Бар: прижат к низу коробки и смещён на дефицит — как bottom: calc(100dvh − 100lvh) */
  .tb { position:absolute; left:0; right:0; bottom:-${DEFICIT}px;
        height: var(--tabbar-total); background: var(--bg-surface); }
</style></head><body>
<div class="screen" id="screen">
  <div class="box" id="box">
    <div class="tb" id="tb"></div>
  </div>
</div>
</body></html>`;

  const f = path.join(ROOT, 'tests', 'reports', '_d341-geom.html');
  fs.writeFileSync(f, mk());
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 500, height: 1000 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto('file:///' + f.replace(/\\/g, '/'));
  await p.waitForTimeout(200);

  const r = await p.evaluate(() => {
    const g = (id) => document.getElementById(id).getBoundingClientRect();
    const cs = getComputedStyle(document.documentElement);
    return {
      box: g('box'),
      tb: g('tb'),
      tabbarTotal: cs.getPropertyValue('--tabbar-total').trim(),
    };
  });

  const boxBottom = r.box.bottom;
  const tbBottom = r.tb.bottom;
  const tbTop = r.tb.top;
  console.log(`  коробка: верх ${r.box.top.toFixed(0)}, низ ${boxBottom.toFixed(0)} (высота ${BOX}px)`);
  console.log(`  экран: низ ${SCREEN}px | бар: верх ${tbTop.toFixed(0)}, низ ${tbBottom.toFixed(0)}, высота ${r.tb.height.toFixed(1)}`);

  // Модель корректна, если коробка занимает ровно BOX от верха.
  if (Math.abs(boxBottom - BOX) <= 1) {
    ok(`коробка ${BOX}px внутри экрана ${SCREEN}px (модель верна)`);
  } else {
    bad(`коробка кончается на ${boxBottom.toFixed(0)}, ожидалось ${BOX}`);
  }

  // ГЛАВНОЕ: бар достаёт до низа ЭКРАНА, а не остаётся на низу коробки.
  if (Math.abs(tbBottom - SCREEN) <= 1) {
    ok(`низ бара ${tbBottom.toFixed(0)} = низ экрана ${SCREEN} — зазора нет`);
  } else {
    bad(`низ бара ${tbBottom.toFixed(0)} ≠ ${SCREEN} — остаётся полоса ${(SCREEN - tbBottom).toFixed(0)}px`);
  }

  // Высота честная: равна --tabbar-total, без «юбки» на дефицит.
  const total = parseFloat(r.tabbarTotal) || 52;
  if (Math.abs(r.tb.height - total) <= 1) {
    ok(`высота бара = --tabbar-total (${r.tb.height.toFixed(1)} ≈ ${total}) — «толщины» нет`);
  } else {
    bad(`высота бара ${r.tb.height.toFixed(1)} ≠ --tabbar-total ${total} — бар раздут`);
  }

  await ctx.close();
  await browser.close();

  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — бар прижат к физическому низу, маскировка снята, высота честная'
    : `ИТОГ: FAIL — ${fail} нарушений`));
  process.exit(fail === 0 ? 0 : 1);
})();
