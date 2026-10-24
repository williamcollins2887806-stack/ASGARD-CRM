/**
 * Гейт регрессии тем: правка селекторов карточек не должна гасить рамки
 * и цветные акценты на других страницах.
 *
 * Класс дефекта (D-342, найдено верификатором 23.10.2026):
 *   `[class*="-card"]:not(…)` БЕЗ `:where()` даёт специфичность (0,4,0) и
 *   перебивает собственные `border` компонентов (0,1,0) — рамки исчезали на
 *   #/ting, #/travel, #/procurement в ОБЕИХ темах. Обёртка в `:where()`
 *   обнуляет вес, и правило снова становится «мягким», как и задумано.
 *
 * Почему гейт текстовый, а не «посчитать специфичность регуляркой»:
 * первый вариант делил селектор по запятым, а внутри `:where(...)` тоже есть
 * запятые — счёт ломался и гейт краснел на корректном CSS. Такой гейт хуже,
 * чем его отсутствие. Здесь проверяется ровно то, что важно и однозначно:
 * (а) wildcard обёрнут в `:where(`; (б) у него есть `:not`-исключения.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'public', 'assets', 'css', 'app.css');
const LIGHT = path.join(__dirname, '..', 'public', 'assets', 'css', 'light-theme.css');

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const app = strip(fs.readFileSync(APP, 'utf8'));
const light = strip(fs.readFileSync(LIGHT, 'utf8'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

/** Правила, в селекторе которых есть [class*="-card"]. */
function cardRules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (!sel.includes('[class*="-card"]')) continue;
    out.push({ sel, body: m[2].trim() });
  }
  return out;
}

const appRules = cardRules(app);
const lightRules = cardRules(light);
const allRules = [...appRules, ...lightRules];

console.log('=== 1. Правила карточек найдены ===');
ok('в app.css есть правило [class*="-card"]', appRules.length >= 1, `${appRules.length} шт.`);
ok('в app.css есть СВЕТЛОЕ правило карточек', appRules.some((r) => r.sel.includes('data-theme="light"')));

console.log('\n=== 2. Каждый wildcard обёрнут в :where() (обнулённая специфичность) ===');
for (const r of allRules) {
  // Ищем позицию wildcard и проверяем, что он внутри :where( ... )
  const idx = r.sel.indexOf('[class*="-card"]');
  const before = r.sel.slice(0, idx);
  const lastWhere = before.lastIndexOf(':where(');
  const lastClose = before.lastIndexOf(')');
  const insideWhere = lastWhere >= 0 && lastWhere > lastClose;
  ok(`wildcard внутри :where( — ${r.sel.slice(0, 46)}…`, insideWhere);
}

console.log('\n=== 3. Каждый wildcard с :not-исключениями ===');
for (const r of allRules) {
  ok(`есть :not — ${r.sel.slice(0, 46)}…`, /:not\(/.test(r.sel));
}
// Конкретно внутренности карточек должны быть исключены.
ok('исключены классы с продолжением -card-', /:not\(\[class\*="-card-"\]\)/.test(app));
ok('исключены классы с -card_ (BEM-элементы)', /:not\(\[class\*="-card_"\]\)/.test(app));
ok('исключён .pk3-card (у него своё правило)', /:not\(\.pk3-card\)/.test(app));

console.log('\n=== 4. Светлая тема возвращает рамку контейнерам ===');
{
  const lightCardRules = appRules.filter((r) => r.sel.includes('data-theme="light"') && /border\s*:/.test(r.body));
  ok('правило с border есть', lightCardRules.length >= 1, `${lightCardRules.length} шт.`);
  const sel = lightCardRules.map((r) => r.sel).join(' ');
  ok('покрывает .card', /\.card\b/.test(sel));
  ok('покрывает .panel', /\.panel\b/.test(sel));
  ok('возвращает именно видимую рамку', lightCardRules.some((r) => /border\s*:\s*1px solid/.test(r.body)));
}

console.log('\n=== 5. Карточка канбана: явный border + полоса в светлой теме ===');
{
  const m = light.match(/html\[data-theme="light"\]\s*\.pk3-card\s*\{([^}]*)\}/);
  ok('правило .pk3-card в light-theme.css есть', !!m);
  if (m) {
    ok('задан border', /border\s*:/.test(m[1]));
    ok('задана полоса border-left-width (3px)', /border-left-width\s*:\s*3px/.test(m[1]));
  }
  for (const tone of ['green', 'yellow', 'red', 'win', 'lose']) {
    ok(`тон ${tone}`, light.includes(`.pk3-card.pk3-${tone}`));
  }
  ok('внутренности карточки без рамок (pk3-card-top)', light.includes('.pk3-card-top'));
  ok('бейдж без рамки (pk3-badge)', light.includes('.pk3-badge'));
}

console.log('\n=== 6. Негативный контроль: дефектная запись отличается от корректной ===');
{
  // Реально проверяем, что гейт отличил бы «плохо» от «хорошо».
  const good = appRules.every((r) => {
    const idx = r.sel.indexOf('[class*="-card"]');
    const before = r.sel.slice(0, idx);
    return before.lastIndexOf(':where(') > before.lastIndexOf(')');
  });
  ok('текущий CSS проходит критерий «внутри :where»', good);

  const badSel = 'html[data-theme="light"] [class*="-card"]:not([class*="-card-"])';
  const idx = badSel.indexOf('[class*="-card"]');
  const before = badSel.slice(0, idx);
  const badInsideWhere = before.lastIndexOf(':where(') > before.lastIndexOf(')');
  ok('дефектная запись (без :where) НЕ прошла бы гейт', badInsideWhere === false);
}

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
if (fails.length) { console.log('ПРОВАЛЫ:'); fails.forEach((f) => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
