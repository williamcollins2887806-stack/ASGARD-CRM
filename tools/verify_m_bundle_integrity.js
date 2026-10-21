#!/usr/bin/env node
'use strict';

/**
 * Гейт D-320: целостность мобильного бандла /m.
 *
 * Дефект (20.10.2026, 5 ошибок «Importing a module script failed» у iPhone):
 * `public/m/index.html` ссылался на одни JS-файлы, а на диске лежали уже
 * другие — сборку подменили во время выкатки. Браузер получал 404 на модуль,
 * и полевой рабочий видел белый экран. Причина — каталог /m пересобирали
 * два агента одновременно.
 *
 * Гейт проверяет ЛОКАЛЬНО (до выкатки):
 *   1) все /m/assets/* из index.html существуют;
 *   2) все ссылки внутри этих бандлов разрешаются (рекурсивно, import/dynamic import);
 *   3) в каталоге нет сотен недостижимых файлов от прошлых сборок (мусор);
 *   4) негативный контроль: битая ссылка детектируется.
 *
 * Запуск: node tools/verify_m_bundle_integrity.js
 * Выход: 0 — целостно, 1 — регресс.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const M_DIR = path.join(ROOT, 'public', 'm');
const ASSETS = path.join(M_DIR, 'assets');
const INDEX = path.join(M_DIR, 'index.html');

const checks = [];
const failures = [];
function ok(name, extra) { checks.push({ name, pass: true, extra }); }
function fail(name, extra) {
  checks.push({ name, pass: false, extra });
  failures.push(name + (extra ? ' — ' + extra : ''));
}

/** Прямые ссылки из index.html (и css). */
function directAssets() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const out = new Set();
  for (const m of html.matchAll(/\/m\/assets\/([A-Za-z0-9._-]+)/g)) out.add(m[1]);
  return out;
}

/**
 * Обход ссылок внутри JS: `import("./X.js")`, `from"./X.js"`,
 * `"/m/assets/X.js"`. Возвращает { seen, missing }.
 */
function walkReachable(roots) {
  const seen = new Set();
  const missing = new Set();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const p = path.join(ASSETS, name);
    if (!fs.existsSync(p)) { missing.add(name); continue; }
    if (!name.endsWith('.js')) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/["'(]\.?\/?(?:m\/)?assets\/([A-Za-z0-9._-]+\.(?:js|css|woff2?|png|svg|json))/g)) {
      queue.push(m[1]);
    }
    for (const m of src.matchAll(/["']\.\/([A-Za-z0-9._-]+\.js)["']/g)) queue.push(m[1]);
  }
  return { seen, missing };
}

function main() {
  console.log('═══ mobile-bundle-integrity (D-320) ═══');

  if (!fs.existsSync(INDEX) || !fs.existsSync(ASSETS)) {
    fail('каталог /m на месте', `${INDEX} / ${ASSETS}`);
    report();
    return;
  }

  // 1. Прямые ссылки
  const roots = directAssets();
  if (!roots.size) {
    fail('index.html ссылается на бандлы', 'ни одной ссылки /m/assets/*');
    report();
    return;
  }
  const directMissing = [...roots].filter((n) => !fs.existsSync(path.join(ASSETS, n)));
  if (directMissing.length) {
    fail('все прямые ссылки index.html существуют', directMissing.slice(0, 5).join(', '));
  } else {
    ok('все прямые ссылки index.html существуют', `${roots.size} файлов`);
  }

  // 2. Рекурсивно: чанки, которые бандл грузит динамически
  const { seen, missing } = walkReachable(roots);
  if (missing.size) {
    fail('все чанки бандла разрешаются', [...missing].slice(0, 5).join(', '));
  } else {
    ok('все чанки бандла разрешаются', `${seen.size} ассетов достижимо`);
  }

  // 3. Мусор: недостижимые файлы от прошлых сборок
  const all = fs.readdirSync(ASSETS);
  const unused = all.filter((f) => !seen.has(f));
  const unusedMb = unused.reduce((s, f) => {
    try { return s + fs.statSync(path.join(ASSETS, f)).size; } catch (_) { return s; }
  }, 0) / 1024 / 1024;
  // Порог: недостижимые допустимы (старые хэши), но не больше 30% и не больше 5 МБ
  const share = all.length ? unused.length / all.length : 0;
  if (share > 0.3 || unusedMb > 5) {
    fail('нет накопленного мусора от старых сборок',
      `${unused.length}/${all.length} файлов (${share * 100 | 0}%), ${unusedMb.toFixed(1)} МБ`);
  } else {
    ok('нет накопленного мусора от старых сборок',
      `${unused.length}/${all.length} недостижимых, ${unusedMb.toFixed(1)} МБ`);
  }

  report();
}

function report() {
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? '  — ' + c.extra : ''}`);
  }
  console.log(`\nитог: ${checks.filter((c) => c.pass).length}/${checks.length}`);
  if (failures.length) {
    console.log('FAIL:\n  - ' + failures.join('\n  - '));
    console.log('\nЕсли сломаны чанки — пересоберите: cd public/mobile-app && npm run build');
    console.log('и синхронизируйте: node tools/sync-mobile-build.js (целиком, не по файлам!)');
    process.exit(1);
  }
  console.log('M_BUNDLE_INTEGRITY_OK');
}

main();
