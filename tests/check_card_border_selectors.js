/**
 * Гейт: селектор карточек не должен цеплять их внутренние элементы.
 *
 * Класс дефекта (23.10.2026, D-342): в app.css стояло `[class*="-card"]`.
 * Подстрока `-card` есть и у внутренних элементов карточки — `pk3-card-top`,
 * `pk3-card-id`, `kpi-card__label`, `stat-card__value`. В светлой теме они
 * получали серые рамки (на скриншоте — две рамки вокруг «ПКП #55»), а у
 * контейнеров шорткат `border` перетирал цветную полосу слева.
 *
 * ВАЖНО (урок первого прогона): сначала гейт проверял ПЕРЕПИСАННУЮ в нём же
 * логику селектора, а не ту, что лежит в CSS. При мутации файла такая проверка
 * оставалась зелёной — она доказывала работу моей копии, а не файла. Теперь
 * селектор берётся ИЗ app.css; логика не дублируется.
 */
const fs = require('fs');
const path = require('path');

const APP_CSS = path.join(__dirname, '..', 'public', 'assets', 'css', 'app.css');
const LIGHT_CSS = path.join(__dirname, '..', 'public', 'assets', 'css', 'light-theme.css');

const cssNoComments = (file) => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const appCss = cssNoComments(APP_CSS);
const lightCss = cssNoComments(LIGHT_CSS);

/* ── Извлекаем реальные селекторы контейнеров из app.css ────────────────── */
function extractWildcardSelectors(css) {
  const out = [];
  const re = /\[class\*="-card"\]([^\s,{]*)/g;
  let m;
  while ((m = re.exec(css))) {
    const tail = m[1] || '';
    const excludes = [...tail.matchAll(/:not\(\[class\*="([^"]+)"\]\)/g)].map((x) => x[1]);
    const excludeClass = [...tail.matchAll(/:not\(\.([\w-]+)\)/g)].map((x) => x[1]);
    out.push({ tail, excludes, excludeClass });
  }
  return out;
}

/** Матчит ли класс хотя бы один из РЕАЛЬНЫХ CSS-селекторов. */
function matchesCssContainerRule(cls, selectors) {
  return selectors.some((sel) => {
    if (!cls.includes('-card')) return false;
    for (const ex of sel.excludes) if (cls.includes(ex)) return false;
    for (const ex of sel.excludeClass) if (cls === ex) return false;
    return true;
  });
}

const selectors = extractWildcardSelectors(appCss);

const INNER = [
  'pk3-card-top', 'pk3-card-id', 'pk3-card-title', 'pk3-card-customer',
  'pk3-card-meta', 'pk3-card-progress', 'pk3-card-finance',
  'kpi-card__label', 'kpi-card__value', 'stat-card__value', 'stat-card__label',
  'help-card-title', 'task-card-top', 'cash-card-header', 'er-card__value',
];
const OUTER = [
  'tender-card', 'kpi-card', 'stat-card', 'cash-card', 'pre-tender-card',
  'proc-inv-card', 'wh2-card', 'help-card', 'task-card', 'approval-card',
];

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('=== 0. Селекторы взяты из app.css ===');
ok('найдены wildcard-селекторы карточек', selectors.length >= 2, `найдено ${selectors.length}`);
selectors.forEach((s, i) => {
  console.log(`     #${i + 1} исключения: ${[...s.excludes, ...s.excludeClass].join(', ') || 'НЕТ'}`);
});

console.log('\n=== 1. Внутренние элементы НЕ матчатся реальным CSS-правилом ===');
for (const c of INNER) ok(c, matchesCssContainerRule(c, selectors) === false);

console.log('\n=== 2. Контейнеры матчатся реальным CSS-правилом ===');
for (const c of OUTER) ok(c, matchesCssContainerRule(c, selectors) === true);

console.log('\n=== 3. Негативный контроль: дефектный селектор ловится ===');
{
  // «Голый» [class*="-card"] без :not — ровно то, что было до правки.
  const legacy = [{ tail: '', excludes: [], excludeClass: [] }];
  const leaked = INNER.filter((c) => matchesCssContainerRule(c, legacy)).length;
  ok('старый селектор пропускает все внутренние', leaked === INNER.length, `${leaked}/${INNER.length}`);
  ok('гейт покраснел бы на старом селекторе', INNER.some((c) => matchesCssContainerRule(c, legacy)));
}

console.log('\n=== 4. Ни один wildcard не остался «голым» ===');
{
  const bare = selectors.filter((s) => s.excludes.length === 0 && s.excludeClass.length === 0);
  ok('все [class*="-card"] имеют :not-исключения', bare.length === 0, `голых: ${bare.length}`);
  ok('есть исключение .pk3-card (у него своё правило в light-theme)',
    selectors.some((s) => s.excludeClass.includes('pk3-card')));
}

console.log('\n=== 5. У карточки канбана в светлой теме явная рамка + полоса ===');
{
  ok('правило .pk3-card в светлой теме есть', /html\[data-theme="light"\]\s*\.pk3-card\s*\{/.test(lightCss));
  ok('полоса border-left-width задана',
    /html\[data-theme="light"\]\s*\.pk3-card\s*\{[\s\S]{0,240}border-left-width:\s*3px/.test(lightCss));
  for (const tone of ['green', 'yellow', 'red', 'win', 'lose']) {
    ok(`тон ${tone}: цвет полосы задан`, lightCss.includes(`.pk3-card.pk3-${tone}`));
  }
  ok('внутренности без рамок (pk3-card-top)', lightCss.includes('.pk3-card-top'));
}

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
if (fails.length) { console.log('ПРОВАЛЫ:'); fails.forEach((f) => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
