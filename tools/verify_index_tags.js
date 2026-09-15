#!/usr/bin/env node
/**
 * verify_index_tags.js — гейт целостности подключений в public/index.html.
 *
 * Зачем: 14.09.2026 прод потерял <script>/<link> для billing.js/css и nd-permits.js/css
 * (файлы на месте, тегов нет) → `ReferenceError: AsgardBillingPage is not defined`.
 * Причина: теги инжектились прямо на проде скриптом, а любой деплой локального
 * index.html их стирал. См. tests/reports/_DIFF-LEDGER.md D-145.
 *
 * Что проверяет:
 *   1. BROKEN      — тег ссылается на файл, которого нет на диске.
 *   2. DUPLICATE   — один и тот же assets/(js|css) подключён более одного раза.
 *   3. MISSING     — глобал Asgard* используется в app.js, но файл, который его
 *                    определяет, не подключён тегом → рантайм упадёт ReferenceError.
 *   4. REQUIRED    — модули, потеря которых уже случался (regression guard).
 *   5. WARN        — используемый Asgard*-глобал, для которого не найден определитель
 *                    в public/assets/js (может быть встроен иначе — на решение человека).
 *
 * Использование:
 *   node tools/verify_index_tags.js            # по рабочему дереву
 *   node tools/verify_index_tags.js <index.html>  # по конкретному файлу (например из снапшота)
 *
 * Код возврата: 0 — чисто, 1 — есть BROKEN/DUPLICATE/MISSING/REQUIRED.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const JS_DIR = path.join(PUBLIC, 'assets', 'js');
const CSS_DIR = path.join(PUBLIC, 'assets', 'css');
const INDEX_PATH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PUBLIC, 'index.html');

/**
 * Модули, потеря тегов у которых уже приводила к инциденту на проде.
 * Держим явным списком: общий MISSING-анализ ловит их не всегда
 * (grep по app.js не видит, например, warehouse-map.js).
 */
const REQUIRED_MODULES = [
  // Инцидент D-145 (14.09.2026): теги жили только на проде и стёрлись деплоем.
  'assets/js/billing.js',
  'assets/css/billing.css',
  'assets/js/nd-permits.js',
  'assets/css/nd-permits.css',
  'assets/js/doc-hub.js',
  'assets/css/doc-hub.css',
  'assets/js/warehouse-map.js',
  'assets/js/warehouse-v2-asm.js',
  'assets/js/warehouse-v2.js',
  // Второй эшелон — модули, найденные гейтом при восстановлении (14.09.2026).
  // Все файлы существовали, но тегов не было ни локально, ни на проде.
  'assets/js/money_fmt.js',
  'assets/js/client-error-log.js',
  'assets/js/tender_period_filter.js',
  'assets/css/tender-period-filter.css',
  'assets/js/mimir_quick_wizard.js',
  'assets/js/work_norms_ui.js',
  'assets/js/hub_funnel_tab.js',
  'assets/js/morning_brief.js',
  'assets/js/tkp-full-form.js',
  'assets/js/ru_masks.js',
  'assets/js/ppe-sizes.js',
  'assets/js/brigade-cart.js',
  'assets/js/site_crew.js',
  'assets/js/preview_calc_report.js',
];

/**
 * Использования-«призраки»: имя похоже на глобал, но определителя нет и быть не должно.
 * Каждая запись обязана иметь причину — иначе это не allowlist, а заметание дыры.
 */
const WARN_ALLOWLIST = {
  AsgardEmployeePicker: 'только в комментарии-мосте (components/cr-employee-picker.js), не вызов',
  AsgardReadinessDirector: 'только в шапке-комментарии readiness.js, не вызов',
  AsgardReadinessPage: 'только в шапке-комментарии readiness.js, не вызов',
  AsgardLayout: 'guarded: window.AsgardLayout ? ... : null, layout передаётся снаружи',
  AsgardMobileUI: 'mobile-only, guarded: window.AsgardMobileUI && AsgardMobileUI.mToast',
  AsgardPassRequests: 'guarded, с fallback на location.hash; определитель — AsgardPassRequestsPage',
  AsgardTmcRequests: 'guarded, с fallback на location.hash; определитель — AsgardTmcRequestsPage',
};

/**
 * Файлы, которые лежат на диске и НЕ подключены ни одним HTML public/.
 * Каждая запись обязана иметь причину.
 *
 * Зачем этот гейт существует (D-156, 15.09.2026): `assets/css/brigade-cart.css`
 * лежал и локально, и на проде байт-в-байт, но `<link>` на него пропал из
 * index.html при инциденте 08–10.09 → корзина бригады осталась без стилей,
 * кнопки «+» рендерились 12×23 px серыми квадратами. Все предыдущие проверки
 * смотрели только на теги, которые ЕСТЬ, поэтому «файл есть, тега нет» не ловилось.
 */
const CSS_ALLOWLIST = {};
const JS_ALLOWLIST = {
  'assets/js/calculator.js':
    'legacy vanilla-калькулятор (IIFE без глобала), вытеснен calculator_v2.js; тега нет ни в одном HTML',
};

/** Файлы, чьи обращения к Asgard* считаем «контрактом загрузки». */
function walkJs(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

/**
 * Все HTML-страницы public/ — index.html плюс автономные (conductor-estimate.html,
 * awaiting-customer.html и т.п.). Сборки v2/m и исходники в обход: у них свои бандлы.
 *
 * Служебные файлы (`_preview-*.html`, `*.bak`, `*.old`, `*.before*`) тоже в обход:
 * это реликты чужих сессий (прод-мусор), и их ссылки маскируют пропажу тега
 * в настоящей оболочке — ровно так `_preview-checkbox-verify.html` прятал потерю
 * `cr-checkbox.css` (D-156).
 */
const HTML_SKIP_RE = /^_|\.(bak|old|before|orig|pre-[\w-]*)/i;
function walkHtml(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (['node_modules', 'desktop-v2-src', 'mobile-app', 'prototypes'].includes(e.name)) continue;
      walkHtml(path.join(dir, e.name), acc);
    } else if (e.name.endsWith('.html') && !HTML_SKIP_RE.test(e.name)) {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

const COLORS = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' };
const red = (s) => `${COLORS.red}${s}${COLORS.off}`;
const green = (s) => `${COLORS.green}${s}${COLORS.off}`;
const yellow = (s) => `${COLORS.yellow}${s}${COLORS.off}`;

if (!fs.existsSync(INDEX_PATH)) {
  console.error(red(`index.html не найден: ${INDEX_PATH}`));
  process.exit(1);
}

// ── 1. Разбор index.html: все локальные подключения assets/js|css ───────────────
const html = fs.readFileSync(INDEX_PATH, 'utf8');
const refs = [];
const tagRe = /<(script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
let m;
while ((m = tagRe.exec(html)) !== null) {
  const url = m[2];
  if (!/^assets\/(js|css)\//.test(url)) continue; // только локальные ассеты
  const clean = url.split('?')[0].split('#')[0];
  refs.push({
    tag: m[1].toLowerCase(),
    url,
    clean,
    line: html.slice(0, m.index).split('\n').length,
  });
}

const loaded = new Map(); // clean -> [refs]
for (const r of refs) {
  if (!loaded.has(r.clean)) loaded.set(r.clean, []);
  loaded.get(r.clean).push(r);
}

// ── 2. BROKEN / DUPLICATE ──────────────────────────────────────────────────────
const broken = [];
for (const [clean, list] of loaded) {
  if (!fs.existsSync(path.join(PUBLIC, clean))) broken.push({ clean, lines: list.map((r) => r.line) });
}

const duplicates = [];
for (const [clean, list] of loaded) {
  if (list.length > 1) duplicates.push({ clean, lines: list.map((r) => r.line) });
}

// ── 3. Разбор public/assets/js: определители и использования Asgard*-глобалов ──
const jsFiles = fs.existsSync(JS_DIR) ? walkJs(JS_DIR) : [];
const definers = new Map(); // глобал -> Set('assets/js/...')
const users = new Map();    // глобал -> Set('assets/js/...')

const defRe = /(?:window\.|globalThis\.|global\.|root\.|var\s+|const\s+|let\s+)(Asgard[A-Za-z0-9_$]*)\s*=/g;
// \b + запрет на "/" сразу после имени: отсекает строковые литералы вида 'AsgardCRM/1.0'
// и подстроки вроде _ensureAsgardEstimate.
const useRe = /\bAsgard[A-Za-z0-9_$]*(?![/\w$])/g;

for (const abs of jsFiles) {
  const rel = 'assets/js/' + path.relative(JS_DIR, abs).split(path.sep).join('/');
  const src = fs.readFileSync(abs, 'utf8');

  const definedHere = new Set();
  defRe.lastIndex = 0;
  let d;
  while ((d = defRe.exec(src)) !== null) {
    definedHere.add(d[1]);
    if (!definers.has(d[1])) definers.set(d[1], new Set());
    definers.get(d[1]).add(rel);
  }

  useRe.lastIndex = 0;
  let u;
  while ((u = useRe.exec(src)) !== null) {
    const name = u[0];
    if (definedHere.has(name)) continue; // внутренняя ссылка самого определителя
    if (!users.has(name)) users.set(name, new Set());
    users.get(name).add(rel);
  }
}

// ── 4. Использование из ПОДКЛЮЧЁННОГО файла требует подключённого определителя ──
// Логика: если файл, который ссылается на AsgardX, реально загружен в страницу,
// то AsgardX обязан быть определён до момента вызова — иначе ReferenceError.
const missing = [];
const warnNoDefiner = [];
for (const name of [...users.keys()].sort()) {
  const usingLoaded = [...users.get(name)].filter((rel) => loaded.has(rel));
  if (usingLoaded.length === 0) continue; // ссылается только неподключённый код — не влияет

  const defs = definers.get(name);
  if (!defs || defs.size === 0) {
    warnNoDefiner.push({ name, from: usingLoaded.sort().join(', ') });
    continue;
  }
  if (![...defs].some((rel) => loaded.has(rel))) {
    missing.push({ name, definers: [...defs].sort().join(', '), from: usingLoaded.sort().join(', ') });
  }
}

// ── 4b. Прочие PascalCase-глобалы (не Asgard*): те же правила ──────────────────
// Так был найден TenderPeriodFilter (tender_period_filter.js): модуль есть,
// тега нет, а registry_api.js / registry_tab.js / tenders.js на него ссылаются.
const genDefiners = new Map(); // глобал -> Set('assets/js/...')
const genUsers = new Map();
const genDefRe = /(?:window\.|globalThis\.|global\.|root\.)([A-Z][A-Za-z0-9_$]{4,})\s*=/g;
const genUseRe = /\b([A-Z][A-Za-z0-9_$]{4,})\b(?![/\w$])/g;

for (const abs of jsFiles) {
  const rel = 'assets/js/' + path.relative(JS_DIR, abs).split(path.sep).join('/');
  const src = fs.readFileSync(abs, 'utf8');

  const definedHere = new Set();
  genDefRe.lastIndex = 0;
  let g;
  while ((g = genDefRe.exec(src)) !== null) {
    if (g[1].startsWith('Asgard')) continue; // уже покрыто выше
    definedHere.add(g[1]);
    if (!genDefiners.has(g[1])) genDefiners.set(g[1], new Set());
    genDefiners.get(g[1]).add(rel);
  }

  genUseRe.lastIndex = 0;
  let gu;
  while ((gu = genUseRe.exec(src)) !== null) {
    const name = gu[1];
    if (definedHere.has(name) || name.startsWith('Asgard')) continue;
    if (!genUsers.has(name)) genUsers.set(name, new Set());
    genUsers.get(name).add(rel);
  }
}

const missingGeneric = [];
for (const name of [...genDefiners.keys()].sort()) {
  const defs = genDefiners.get(name);
  if ([...defs].some((rel) => loaded.has(rel))) continue; // определитель подключён
  const usingLoaded = [...(genUsers.get(name) || [])].filter((rel) => loaded.has(rel));
  if (usingLoaded.length === 0) continue;
  missingGeneric.push({ name, definers: [...defs].sort().join(', '), from: usingLoaded.sort().join(', ') });
}

// ── 4c. REQUIRED regression guard ─────────────────────────────────────────────
const requiredMissing = REQUIRED_MODULES.filter((rel) => !loaded.has(rel));

// ── 4d. «Файл есть — тега нет»: каждый assets/css/*.css обязан быть подключён ──
// Файл может быть подключён и из автономной страницы (conductor-estimate.html,
// awaiting-customer.html), поэтому смотрим все HTML public/, а не только index.html.
// Сам index.html из обхода исключаем ВСЕГДА (в т.ч. когда проверяем прод-копию):
// иначе ссылки локального index.html замаскируют пропажу тега в проверяемом файле.
const INDEX_IN_PUBLIC = path.resolve(path.join(PUBLIC, 'index.html'));
const otherHtmlRefs = new Set();
for (const abs of walkHtml(PUBLIC)) {
  const resolved = path.resolve(abs);
  if (resolved === INDEX_PATH || resolved === INDEX_IN_PUBLIC) continue;
  const src = fs.readFileSync(abs, 'utf8');
  const re = /(?:src|href)\s*=\s*["']([^"']+?\.(?:js|css))(?:\?[^"']*)?["']/gi;
  let r;
  while ((r = re.exec(src)) !== null) otherHtmlRefs.add(r[1].replace(/^\//, ''));
}

const cssOnDisk = fs.existsSync(CSS_DIR)
  ? fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css')).map((f) => 'assets/css/' + f)
  : [];
const cssUnlinked = cssOnDisk.filter(
  (rel) => !loaded.has(rel) && !otherHtmlRefs.has(rel) && !CSS_ALLOWLIST[rel],
);
const cssAllowlisted = cssOnDisk.filter(
  (rel) => !loaded.has(rel) && !otherHtmlRefs.has(rel) && CSS_ALLOWLIST[rel],
);
const cssStaleAllowlist = Object.keys(CSS_ALLOWLIST).filter(
  (rel) => loaded.has(rel) || otherHtmlRefs.has(rel),
);

// ── 4e. То же для assets/js/**.js (тот же класс дефекта, что D-156) ────────────
// Локальные JS тянутся только тегами: динамических подгрузок с локальными путями нет,
// внешние библиотеки грузятся с CDN и под это правило не попадают.
const jsOnDisk = jsFiles.map(
  (abs) => 'assets/js/' + path.relative(JS_DIR, abs).split(path.sep).join('/'),
);
const jsUnlinked = jsOnDisk.filter(
  (rel) => !loaded.has(rel) && !otherHtmlRefs.has(rel) && !JS_ALLOWLIST[rel],
);
const jsAllowlisted = jsOnDisk.filter(
  (rel) => !loaded.has(rel) && !otherHtmlRefs.has(rel) && JS_ALLOWLIST[rel],
);
const jsStaleAllowlist = Object.keys(JS_ALLOWLIST).filter(
  (rel) => loaded.has(rel) || otherHtmlRefs.has(rel),
);

// ── 6. Отчёт ──────────────────────────────────────────────────────────────────
console.log(`index.html: ${INDEX_PATH}`);
console.log(`подключений assets/(js|css): ${refs.length}, уникальных: ${loaded.size}`);
console.log('');

let failed = false;

if (broken.length) {
  failed = true;
  console.log(red(`BROKEN (${broken.length}): тег ссылается на отсутствующий файл`));
  for (const b of broken) console.log(`  ${b.clean}  <-- строки ${b.lines.join(', ')}`);
  console.log('');
}

if (duplicates.length) {
  failed = true;
  console.log(red(`DUPLICATE (${duplicates.length}): подключено более одного раза`));
  for (const d of duplicates) console.log(`  ${d.clean}  <-- строки ${d.lines.join(', ')}`);
  console.log('');
}

if (missing.length) {
  failed = true;
  console.log(red(`MISSING (${missing.length}): глобал используется подключённым файлом, определяющий файл не подключён`));
  for (const x of missing) console.log(`  ${x.name}\n      определён в: ${x.definers}\n      используется: ${x.from}`);
  console.log('');
}

if (missingGeneric.length) {
  failed = true;
  console.log(red(`MISSING-G (${missingGeneric.length}): прочий глобал используется подключённым файлом, определяющий файл не подключён`));
  for (const x of missingGeneric) console.log(`  ${x.name}\n      определён в: ${x.definers}\n      используется: ${x.from}`);
  console.log('');
}

if (requiredMissing.length) {
  failed = true;
  console.log(red(`REQUIRED (${requiredMissing.length}): модуль из regression-guard не подключён`));
  for (const r of requiredMissing) console.log(`  ${r}`);
  console.log('');
}

if (cssUnlinked.length) {
  failed = true;
  console.log(red(`CSS-UNLINKED (${cssUnlinked.length}): файл есть на диске, но не подключён ни одним HTML`));
  for (const r of cssUnlinked) console.log(`  ${r}  <-- ни <link> в index.html, ни ссылка из автономной страницы`);
  console.log(`  ${COLORS.dim}либо подключить, либо внести в CSS_ALLOWLIST с причиной${COLORS.off}`);
  console.log('');
}

if (jsUnlinked.length) {
  failed = true;
  console.log(red(`JS-UNLINKED (${jsUnlinked.length}): файл есть на диске, но не подключён ни одним HTML`));
  for (const r of jsUnlinked) console.log(`  ${r}  <-- ни <script> в index.html, ни ссылка из автономной страницы`);
  console.log(`  ${COLORS.dim}либо подключить, либо внести в JS_ALLOWLIST с причиной${COLORS.off}`);
  console.log('');
}

const unknownWarn = warnNoDefiner.filter((w) => !WARN_ALLOWLIST[w.name]);
const knownWarn = warnNoDefiner.filter((w) => WARN_ALLOWLIST[w.name]);

if (knownWarn.length) {
  console.log(`${COLORS.dim}NOTE (${knownWarn.length}): известные «призраки» — комментарии/строки/guarded, определитель не нужен${COLORS.off}`);
  for (const w of knownWarn) console.log(`  ${w.name} — ${WARN_ALLOWLIST[w.name]}`);
  console.log('');
}

if (unknownWarn.length) {
  failed = true;
  console.log(red(`WARN (${unknownWarn.length}): глобал используется, определителя нет и он не в allowlist`));
  for (const w of unknownWarn) console.log(`  ${w.name}  <- используется в ${w.from}`);
  console.log(`  ${COLORS.dim}либо починить, либо внести в WARN_ALLOWLIST с причиной${COLORS.off}`);
  console.log('');
}

const allowlisted = [...cssAllowlisted, ...jsAllowlisted];
if (allowlisted.length) {
  console.log(`${COLORS.dim}NOTE (${allowlisted.length}): файлы без подключения, внесены в allowlist с причиной${COLORS.off}`);
  for (const r of cssAllowlisted) console.log(`  ${r} — ${CSS_ALLOWLIST[r]}`);
  for (const r of jsAllowlisted) console.log(`  ${r} — ${JS_ALLOWLIST[r]}`);
  console.log('');
}

const staleAllowlist = [...cssStaleAllowlist.map((r) => ['CSS_ALLOWLIST', r]), ...jsStaleAllowlist.map((r) => ['JS_ALLOWLIST', r])];
if (staleAllowlist.length) {
  failed = true;
  console.log(red(`STALE-ALLOWLIST (${staleAllowlist.length}): запись устарела — файл уже подключён, убери из allowlist`));
  for (const [list, r] of staleAllowlist) console.log(`  ${list}: ${r}`);
  console.log('');
}

if (failed) {
  console.log(red('ИТОГ: FAIL'));
  process.exit(1);
}

console.log(
  green(
    `ИТОГ: OK — 0 MISSING, 0 MISSING-G, 0 DUPLICATE, 0 BROKEN, 0 REQUIRED-пропусков, ` +
      `0 CSS-UNLINKED из ${cssOnDisk.length}, 0 JS-UNLINKED из ${jsOnDisk.length}, ` +
      `0 необъяснённых WARN, 0 устаревших allowlist (глобалов проверено: ${users.size})`,
  ),
);
process.exit(0);
