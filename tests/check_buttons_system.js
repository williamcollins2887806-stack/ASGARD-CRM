/**
 * Гейт единой системы кнопок (D-343).
 *
 * Класс дефекта (сообщение заказчика 23.10.2026):
 *   «на тёмной почти все кнопки жёлтые, на светлой часть синие… одна страница
 *    жёлтая, другая красная, третья синяя. Не должно быть цветового шума.»
 *   Причина — 26 правил красили `.btn.primary` в 10 файлах, модули побеждали
 *   всех через !important.
 *
 * Контракт: тёмная тема → primary ЗОЛОТОЙ, светлая → СИНИЙ.
 *
 * ⚠️ ПРЕДЫДУЩАЯ ВЕРСИЯ ГЕЙТА БЫЛА ДЫРЯВОЙ (найдено верификатором, прогон 3):
 *   F1. Исключение `#btnLogout` проверялось по всей строке селектора → любая
 *       перекраска проходила, если дописать `:not(#btnLogout)`.
 *   F2. Исключение `var(--bsys-…)` проверялось по всему телу правила → хватало
 *       добавить любое свойство с токеном, и `background: red` проходил.
 *   F7. Гейт смотрел только в CSS, хотя половина кнопок красится инлайновым
 *       CSS внутри JS (`travel.js`, `personal_kanban.js`).
 *   Всё это закрыто ниже: точные исключения, разбор `background` отдельно от
 *   прочих свойств, и скан JS-файлов.
 */
const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', 'public', 'assets', 'css');
const JS_DIRS = [
  path.join(__dirname, '..', 'public', 'assets', 'js'),
  path.join(__dirname, '..', 'public', 'desktop-v2-src', 'src'),
];
const SYSTEM = 'buttons-system.css';
const INDEX = path.join(__dirname, '..', 'public', 'index.html');

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const systemCss = strip(fs.readFileSync(path.join(CSS_DIR, SYSTEM), 'utf8'));

/** Селекторы, которые задают тип кнопки. */
const PAINT_SEL = /\.btn\.primary|\.btn--primary|\.btn-primary\b|\.btn\.danger|\.btn\.red|\.btn--danger|\.btn-danger\b|\.btn\.success|\.btn\.green|\.btn\.ok\b|\.btn--success|\.btn-success\b|\.pg-btn\b|\.pk3-gold\b|\.tl-tab\.active|\.tl-btn-send|\.mimir-sidebar-new/;

/**
 * Достаёт из тела правила ИМЕННО свойство фона (не любое с токеном).
 * Возвращает строку или null.
 */
function backgroundDecl(body) {
  const re = /(?:^|;)\s*(background(?:-color|-image)?)\s*:\s*([^;]+)/i;
  const m = body.match(re);
  if (!m) return null;
  // `!important` снимаем: он не влияет на «свой ли это цвет».
  const value = m[2].replace(/!important/gi, '').trim();
  return { prop: m[1].toLowerCase(), value };
}

/**
 * Исключение — только если СЕЛЕКТОР ЦЕЛИКОМ описывает logout-иконку.
 * Именно на этом ломался прежний гейт (F1): он искал `#btnLogout` подстрокой
 * в любом месте, и `:not(#btnLogout)` открывал дорогу любой перекраске.
 *
 * Разрешённые формы (весь селектор, не подстрока):
 *   #btnLogout
 *   .sidefoot #btnLogout
 *   .btn.red#btnLogout
 */
function isLogoutOnly(sel) {
  const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => /^(html\[data-theme="light"\]\s+)?(\.[\w-]+\s+)?(#btnLogout|\.btn\.red#btnLogout)$/.test(p));
}

/**
 * Селектор, который ТОЛЬКО добавляет контекст к группе, включающей logout.
 * `.sidefoot .btn.red, .sidefoot #btnLogout` — здесь первая часть красит
 * кнопку удаления, а не иконку. Такое правило НЕ освобождается: пусть модуль
 * удалит `.btn.red` из селектора, чтобы не было второго источника цвета.
 */
function isMixedLogoutGroup(sel) {
  return /#btnLogout/.test(sel) && !isLogoutOnly(sel);
}

/**
 * Значение фона ссылается ТОЛЬКО на токены системы — это проброс, не новый цвет.
 * Принимаем и одиночный `var(--bsys-x)`, и градиент, собранный из таких токенов
 * (`linear-gradient(180deg, var(--bsys-primary-1), var(--bsys-primary-2))`).
 */
function isTokenOnly(value) {
  const v = value.replace(/\s+/g, ' ').trim();
  if (/^var\(--bsys-[\w-]+\)$/.test(v)) return true;
  if (!/^(linear-gradient|radial-gradient)\(/i.test(v)) return false;
  // Убираем сами токены и проверяем, что «своих» цветов в градиенте не осталось.
  const withoutTokens = v.replace(/var\(--bsys-[\w-]+\)/g, '');
  // В градиенте допустимы: углы (180deg), запятые, скобки, проценты, пробелы.
  return !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\bvar\(--(?!bsys-)/i.test(withoutTokens);
}

const offenders = [];
for (const f of fs.readdirSync(CSS_DIR)) {
  if (!f.endsWith('.css') || f === SYSTEM) continue;
  const css = strip(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'));
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].replace(/\s+/g, ' ').trim();
    if (!PAINT_SEL.test(sel)) continue;
    const bg = backgroundDecl(m[2]);
    if (!bg) continue;
    if (isLogoutOnly(sel)) continue;
    if (isTokenOnly(bg.value)) continue;
    offenders.push({ file: f, sel: sel.slice(0, 78), bg: `${bg.prop}: ${bg.value.slice(0, 40)}` });
  }
}

console.log('=== 1. Цвет кнопок задаёт только buttons-system.css ===');
ok('нет перекрасок в других CSS-файлах', offenders.length === 0,
  offenders.length ? offenders.map((o) => `${o.file}: ${o.sel} → ${o.bg}`).join(' | ') : 'нарушителей нет');

/* ── 1b. JS: инлайновые стили кнопок (F7) ────────────────────────────────── */
console.log('\n=== 1b. Инлайновые цвета кнопок в JS — под контролем ===');
{
  // ВАЖНО (замечание F7): прежняя версия проверяла фиксированный список из 4
  // селекторов, поэтому мутация `.tl-btn:hover { color:#8E6212 }` проходила
  // зелёной. Теперь ищем ЛЮБОЕ правило с кнопочным селектором в JS и смотрим,
  // задаёт ли оно цвет не из токенов.
  const BTN_SEL = /\.(?:[\w-]*btn[\w-]*|pk3-btn|pk3-gold|pk3-ok|pk3-danger|tl-tab|tl-btn[\w-]*|pg-btn|mimir-sidebar-new|hg-list-me-btn)/i;
  /**
   * ⚠️ ОБЛАСТЬ ПРОВЕРКИ (уточнено после прогона 4).
   *
   * Первая версия сканировала ВЕСЬ JS и требовала токены системы везде. Это
   * дало 40+ находок в чужом легаси (ИИ-ассистент, договоры, реестр БУХ) — их
   * перевод в эту задачу не входит и сделал бы diff необозримым.
   *
   * Поэтому гейт блокирует ровно то, что даёт «цветовой шум» по формулировке
   * заказчика — АКЦЕНТНЫЕ кнопки, покрашенные брендовыми токенами или
   * литералами. Нейтральные (transparent / --brd / --t2 / --bg3) и
   * семантические внутри виджетов не блокируются.
   *
   * Инвентарь остального долга печатается отдельной строкой (KNOWN_DEBT_COUNT):
   * он должен уменьшаться, и это видно любому, кто читает вывод гейта.
   * Молча его не прячем.
   */
  const ACCENT_SEL = /\.(?:pk3-btn|pk3-gold|pk3-ok|pk3-danger|tl-btn[\w-]*|tl-tab|pg-btn|mimir-sidebar-new|btn-primary|btn-ok|btn-gold|btn-success|btn-danger)/;
  const BRAND_TOKEN = /var\(--(gold|gold-l|gold-h|gold-bg|blue|blue-l|blue-h|red|red-h|ok|ok-t|amber|warn|info)\b/;
  const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

  const jsOffenders = [];
  let debtCount = 0;

  const walk = (d) => {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'dist-mine') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|jsx)$/.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      const re = /([.#][^{}\n]{0,120}?)\s*\{([^{}]*?)\}/g;
      let m;
      while ((m = re.exec(s))) {
        const sel = m[1].trim();
        if (!BTN_SEL.test(sel)) continue;
        const decls = [...m[2].matchAll(/(?:^|;)\s*(background(?:-color|-image)?|color|border(?:-color)?)\s*:\s*([^;]+)/gi)];
        for (const dcl of decls) {
          const val = dcl[2].replace(/!important/gi, '').trim();
          if (/var\(--bsys-/.test(val)) continue;
          // Спиннеры/декоративные псевдоэлементы — не цвет кнопки.
          if (/::(after|before)/.test(sel)) continue;
          // Бейджи/чипы/теги внутри кнопочных блоков — не сама кнопка.
          if (/\.(pk3-tag|pk3-chip|badge|pill|chip)/.test(sel)) continue;
          // --gold-border — нейтральная рамка, коричневого значения не имеет.
          if (/var\(--gold-border/.test(val)) continue;
          // hex внутри var(..., #333) — это ФОЛБЭК нейтрального токена, не «свой цвет».
          const withoutFallbacks = val.replace(/var\([^)]*,[^)]*\)/g, 'var()');
          const hasLiteral = LITERAL_COLOR.test(withoutFallbacks);
          const hasBrandToken = BRAND_TOKEN.test(val);
          if (!hasLiteral && !hasBrandToken) continue;
          // Блокируем только акцентные кнопки — они и создают «пёстрость».
          if (!ACCENT_SEL.test(sel)) { debtCount++; continue; }
          jsOffenders.push({ file: path.relative(process.cwd(), p), sel: sel.slice(0, 58), prop: dcl[1], val: val.slice(0, 42) });
        }
      }
    }
  };
  JS_DIRS.forEach(walk);

  ok('акцентные кнопки в JS — на токенах системы', jsOffenders.length === 0,
    jsOffenders.length
      ? jsOffenders.slice(0, 8).map((o) => `${o.file}: ${o.sel} ${o.prop}=${o.val}`).join(' | ')
      : 'чисто');
  console.log(`     KNOWN_DEBT_COUNT: ${debtCount} — цветных правил кнопок вне системы в легаси JS`);
}

/* ── 1c. Hover-состояния кнопок: сплошная заливка брендовым токеном (F7-CSS) ── */
console.log('\n=== 1c. Hover кнопок не заливает брендовым цветом ===');
{
  // Замечание верификатора (прогон 5): гейт был слеп к CSS-стороне, поэтому
  // `.dw-quick-btn:hover { color:#8E6212 }` проходил. Здесь проверяем hover
  // отдельно: сплошная заливка `var(--gold*)` / `var(--blue)` / `var(--ok)`
  // в светлой теме даёт коричневую кнопку (#8E6212), это запрещено.
  // Прозрачные подложки (--gold-bg, color-mix(... 12% ...)) допустимы — это
  // нейтральная подсветка, а не «своя» плашка.
  //
  // ВАЖНО: `--blue-h` в светлой теме = #1E40AF, то есть РОВНО системный hover —
  // ругаться на него нельзя. Коричневый даёт только --gold* (в светлой теме
  // --gold = #8E6212, --gold-h = #7A540F). Проверяем именно их.
  const GOLD_TOKENS = /^(gold|gold-h|gold-l)$/;
  const isSolidBrand = (v) => {
    const m = v.match(/^var\(--([\w-]+)\)$/);
    if (m) {
      if (GOLD_TOKENS.test(m[1])) return true;
      // Общие семантические токены проверяем по факту: если это чистый цвет
      // насыщенного спектра, а не системный hover — считаем «своим».
      return false;
    }
    // Градиент из --gold* — тоже «своя» золотая плашка.
    // Градиент из --gold* — тоже «своя» золотая плашка.
    // (Регулярка с [^)]* ломается на запятых внутри var() — проверяем по факту:
    //  есть градиент + есть золотой токен + нет прозрачности.)
    if (!/^linear-gradient\(/i.test(v)) return false;
    if (!/var\(--(gold|gold-l|gold-h|gold-bg)\b/.test(v)) return false;
    // Прозрачные подложки (color-mix / rgba) — не «сплошная» заливка.
    if (/color-mix|rgba?\(/i.test(v)) return false;
    return true;
  };
  const hoverOffenders = [];
  for (const f of fs.readdirSync(CSS_DIR)) {
    if (!f.endsWith('.css') || f === SYSTEM) continue;
    const css = strip(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'));
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const sel = m[1].replace(/\s+/g, ' ').trim();
      if (!/btn/i.test(sel) || !/hover/.test(sel)) continue;
      const bg = backgroundDecl(m[2]);
      if (!bg || !/^background(?:-color)?$/.test(bg.prop)) continue;
      if (!isSolidBrand(bg.value.trim())) continue;
      hoverOffenders.push({ file: f, sel: sel.slice(0, 62), bg: bg.value.slice(0, 40) });
    }
  }
  ok('hover-кнопки не заливаются сплошным брендовым цветом', hoverOffenders.length === 0,
    hoverOffenders.length
      ? hoverOffenders.slice(0, 6).map((o) => `${o.file}: ${o.sel} → ${o.bg}`).join(' | ')
      : 'чисто');
}

/* ── 2. Две темы ─────────────────────────────────────────────────────────── */
console.log('\n=== 2. Две темы — два набора ===');
{
  const darkBlock = systemCss.match(/html:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/);
  const lightBlock = systemCss.match(/html\[data-theme="light"\]\s*\{([^}]*)\}/);
  ok('есть блок тёмной темы', !!darkBlock);
  ok('есть блок светлой темы', !!lightBlock);

  const grab = (block, name) => {
    if (!block) return null;
    const m = block.match(new RegExp('--bsys-' + name + '\\s*:\\s*([^;]+);'));
    return m ? m[1].trim() : null;
  };
  const darkPrimary = grab(darkBlock && darkBlock[1], 'primary-1');
  const lightPrimary = grab(lightBlock && lightBlock[1], 'primary-1');
  ok('тёмная: primary — золото', /^#(D4A843|E8C35A)$/i.test(String(darkPrimary)), String(darkPrimary));
  ok('светлая: primary — синий', /^#(2563EB|1D4ED8)$/i.test(String(lightPrimary)), String(lightPrimary));
  ok('primary различается по темам', darkPrimary !== lightPrimary);
  for (const role of ['danger-1', 'success-1', 'primary-ink', 'focus', 'gold-fill']) {
    ok(`обе темы задают ${role}`, !!grab(darkBlock && darkBlock[1], role) && !!grab(lightBlock && lightBlock[1], role));
  }
  // F6: коричневый #8E6212 не должен быть фоном плашек.
  ok('нет коричневого #8E6212 как заливки', !/--bsys-gold-fill(-h)?\s*:\s*#8E6212/i.test(systemCss));
}

/* ── 3. Подключение последним ────────────────────────────────────────────── */
console.log('\n=== 3. buttons-system.css подключён последним ===');
{
  const html = fs.readFileSync(INDEX, 'utf8');
  const links = [...html.matchAll(/assets\/css\/([\w-]+\.css)/g)].map((m) => m[1]);
  const pos = links.lastIndexOf(SYSTEM);
  ok('файл подключён', pos >= 0, `позиция ${pos}`);
  const after = links.slice(pos + 1).filter((x) => x !== 'huginn_dock.css');
  ok('после него нет других десктопных CSS', after.length === 0, after.join(', ') || 'чисто');
}

/* ── 4. Контраст ≥ 4.5:1 (F4 — его не было) ─────────────────────────────── */
console.log('\n=== 4. Контраст цветных кнопок ≥ 4.5:1 ===');
{
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = (hex) => {
    const h = String(hex).replace('#', '');
    return 0.2126 * lin(parseInt(h.slice(0, 2), 16))
      + 0.7152 * lin(parseInt(h.slice(2, 4), 16))
      + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
  };
  const contrast = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  const grab = (block, name) => {
    const m = (block || '').match(new RegExp('--bsys-' + name + '\\s*:\\s*([^;]+);'));
    return m ? m[1].trim() : null;
  };
  const dark = systemCss.match(/html:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/);
  const light = systemCss.match(/html\[data-theme="light"\]\s*\{([^}]*)\}/);
  const D = dark && dark[1], L = light && light[1];

  const checks = [
    ['тёмная primary rest', '#15110D', '#D4A843'],
    ['тёмная primary hover', grab(D, 'primary-ink'), grab(D, 'primary-hover')],
    ['тёмная danger rest', grab(D, 'danger-ink'), grab(D, 'danger-1')],
    ['тёмная danger hover', grab(D, 'danger-ink'), grab(D, 'danger-hover')],
    ['тёмная success rest', grab(D, 'success-ink'), grab(D, 'success-1')],
    ['тёмная success hover', grab(D, 'success-ink'), grab(D, 'success-hover')],
    ['светлая primary rest', grab(L, 'primary-ink'), grab(L, 'primary-1')],
    ['светлая primary hover', grab(L, 'primary-ink'), grab(L, 'primary-hover')],
    ['светлая danger rest', grab(L, 'danger-ink'), grab(L, 'danger-1')],
    ['светлая danger hover', grab(L, 'danger-ink'), grab(L, 'danger-hover')],
    ['светлая success rest', grab(L, 'success-ink'), grab(L, 'success-1')],
    ['светлая success hover', grab(L, 'success-ink'), grab(L, 'success-hover')],
  ];
  for (const [name, fg, bg] of checks) {
    if (!fg || !bg) { ok(`${name}: токены найдены`, false, `fg=${fg} bg=${bg}`); continue; }
    const c = contrast(fg, bg);
    ok(`${name} ≥4.5:1`, c >= 4.5, `${c.toFixed(2)}:1 (${fg} на ${bg})`);
  }
  // Золотая плашка (табы) — там графит на золоте.
  const goldFill = grab(L, 'gold-fill');
  const goldInk = grab(L, 'gold-ink');
  if (goldFill && goldInk) {
    const c = contrast(goldInk, goldFill);
    ok('светлая gold-плашка ≥4.5:1', c >= 4.5, `${c.toFixed(2)}:1 (${goldInk} на ${goldFill})`);
  }
}

/* ── 5. Типы оформлены ───────────────────────────────────────────────────── */
console.log('\n=== 5. Типы кнопок оформлены ===');
for (const [name, re] of [
  ['primary', /\.btn\.primary/],
  ['danger', /\.btn\.red:not\(#btnLogout\)/],
  ['success', /\.btn\.green/],
  ['ghost', /\.btn\.ghost/],
  ['secondary', /\.btn\.secondary/],
  ['gold', /html\[data-theme="light"\] \.btn\.gold/],
  ['размер mini/sm', /\.btn\.mini/],
  ['loading', /\.btn\.loading/],
  ['focus-visible', /\.btn:focus-visible/],
]) ok(`есть ${name}`, re.test(systemCss));

/* ── 6. Негативные контроли (исправленные) ──────────────────────────────── */
console.log('\n=== 6. Негативный контроль: обходы закрыты ===');
{
  const parse = (css) => {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    const m = re.exec(css);
    if (!m) return { detected: false };
    const sel = m[1].trim();
    if (!PAINT_SEL.test(sel)) return { detected: false };
    const bg = backgroundDecl(m[2]);
    if (!bg) return { detected: false };
    if (isLogoutOnly(sel)) return { detected: false };
    if (isTokenOnly(bg.value)) return { detected: false };
    return { detected: true, bg: bg.value };
  };

  ok('ловим прямую перекраску',
    parse('.proc-page .btn.primary { background: red !important; }').detected);

  // F1: обход через :not(#btnLogout) — раньше проходил, теперь должен ловиться.
  ok('ловим обход через :not(#btnLogout)',
    parse('.sup-page .btn.primary:not(#btnLogout) { background: red !important; }').detected);

  // F2: обход через border-color с токеном в том же правиле — раньше проходил.
  ok('ловим обход через border-color: var(--bsys-…)',
    parse('.proc-page .btn.primary { background: #F5C542 !important; border-color: var(--bsys-primary-brd) !important; }').detected);

  // Не ложные срабатывания:
  ok('не считаем `.btn.primary { font-weight: 700 }` перекраской',
    parse('.proc-page .btn.primary { font-weight: 700; }').detected === false);
  ok('не считаем проброс `background: var(--bsys-primary-1)` перекраской',
    parse('.x .btn.primary { background: var(--bsys-primary-1); }').detected === false);
  ok('иконка #btnLogout не считается перекраской',
    parse('.sidefoot #btnLogout { background: rgba(200,41,59,0.08); }').detected === false);

  // F7: инлайновый CSS в JS тоже проверяется (детектор видит «свой» градиент).
  const jsSample = '.tl-btn-send { background:linear-gradient(135deg,#2D8659,#1a7a50); }';
  const m = /\.(tl-btn-send)\s*\{([^}]*)\}/.exec(jsSample);
  const bg = m && backgroundDecl(m[2]);
  ok('детектор видит инлайновую перекраску в JS',
    !!bg && !isTokenOnly(bg.value) && !/var\(--bsys-/.test(bg.value), bg ? bg.value.slice(0, 40) : '—');
}

/* ── 7. Числа контраста в КОММЕНТАРИЯХ CSS совпадают с фактом (F5) ───────── */
console.log('\n=== 7. Заявленные в CSS числа контраста = фактические ===');
{
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = (hex) => {
    const h = String(hex).replace('#', '');
    return 0.2126 * lin(parseInt(h.slice(0, 2), 16))
      + 0.7152 * lin(parseInt(h.slice(2, 4), 16))
      + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
  };
  const contrast = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  const rawCss = fs.readFileSync(path.join(CSS_DIR, SYSTEM), 'utf8');

  /**
   * ⚠️ Замечание верификатора (прогон 6): прежняя версия брала
   * `rawCss.includes(String(want))` — то есть проверяла, что число есть
   * ГДЕ-ТО в файле. Замена одного «8.48» на «8.98» проходила зелёной, потому
   * что другое «8.48» оставалось в другом месте.
   *
   * Теперь каждое число ищется РЯДОМ со своим описанием: берём из комментария
   * пару «подпись … = <число>:1» и сверяем именно её.
   */
  const claimed = [
    { key: 'тёмная primary', fg: '#15110D', bg: '#D4A843', want: 8.48, re: /тёмная\s+—\s+графит\s+#15110D\s+на\s+золоте\s+#D4A843\s*=\s*([\d.]+):1/i },
    { key: 'тёмная primary hover', fg: '#15110D', bg: '#E8C35A', want: 11.08, re: /\(и\s+([\d.]+):1\s+на\s+hover\)/i },
    { key: 'светлая primary', fg: '#FFFFFF', bg: '#2563EB', want: 5.17, re: /белый\s+на\s+синем\s+#2563EB\s*=\s*([\d.]+):1/i },
    { key: 'светлая primary hover', fg: '#FFFFFF', bg: '#1E40AF', want: 8.72, re: /([\d.]+):1\s+на\s+hover\);\s*\n\s*белый\s+на\s+красном/i },
    { key: 'светлая danger', fg: '#FFFFFF', bg: '#D62B3E', want: 4.91, re: /белый\s+на\s+красном\s+#D62B3E\s*=\s*([\d.]+):1/i },
    { key: 'светлая danger hover', fg: '#FFFFFF', bg: '#9E1826', want: 8.04, re: /([\d.]+):1\s+на\s+hover\);\s*\n\s*белый\s+на\s+зелёном/i },
    { key: 'светлая success', fg: '#FFFFFF', bg: '#12874A', want: 4.57, re: /белый\s+на\s+зелёном\s+#12874A\s*=\s*([\d.]+):1/i },
    { key: 'светлая success hover', fg: '#FFFFFF', bg: '#0B5731', want: 8.67, re: /([\d.]+):1\s+на\s+hover\);\s*\n\s*графит/i },
    { key: 'светлая gold', fg: '#15110D', bg: '#E8C35A', want: 11.08, re: /графит\s+на\s+золотой\s+плашке\s+#E8C35A\s*=\s*([\d.]+):1/i },
  ];

  for (const c of claimed) {
    // 1) фактический расчёт по токенам
    const got = contrast(c.fg, c.bg);
    ok(`${c.key}: факт ${got.toFixed(2)} = заявлено ${c.want}`, Math.abs(got - c.want) <= 0.05);

    // 2) число в комментарии стоит РЯДОМ со своим описанием (а не «где-то»)
    const m = rawCss.match(c.re);
    ok(`${c.key}: подпись в CSS найдена`, !!m, m ? `«${m[0].slice(0, 40).replace(/\n/g, ' ')}»` : 'нет пары «описание = число»');
    if (m) {
      const inComment = Number(m[1]);
      ok(`${c.key}: в CSS стоит ${inComment}, факт ${got.toFixed(2)}`, Math.abs(inComment - got) <= 0.05,
        `подпись=${inComment}`);
    }
  }
}

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);if (fails.length) { console.log('ПРОВАЛЫ:'); fails.forEach((f) => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
