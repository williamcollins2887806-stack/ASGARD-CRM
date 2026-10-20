#!/usr/bin/env node
'use strict';

/**
 * Гейт D-310: PWA-ассеты мобильного (/m/) должны резолвиться с ЛЮБОГО роута.
 *
 * Дефект (16–20.10.2026): в public/m/index.html и public/mobile-app/index.html
 * манифест был подключён относительным путём `href="manifest.json"`. SPA живёт
 * под basename `/m`, а полевые роуты вложенные (`/m/field/home`,
 * `/m/field/hall/12`). Браузер резолвит относительный href от КАТАЛОГА текущего
 * URL, поэтому запрашивался `/m/field/manifest.json` — 114 ответов 404, у
 * полевых рабочих не устанавливался PWA. Плюс 404 на /m/field/icon-192.png (63),
 * /m/field/favicon.svg (31), /m/field/apple-touch-icon.png (27).
 *
 * Гейт статический (файлы на диске), сеть не нужен.
 *
 * Запуск: node tools/verify_mobile_pwa_assets.js
 * Выход: 0 — чисто, 1 — регресс.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const M_INDEX = path.join(PUBLIC, 'm', 'index.html');
const SRC_INDEX = path.join(PUBLIC, 'mobile-app', 'index.html');

const checks = [];
const failures = [];
function ok(name, extra) { checks.push({ name, pass: true, extra }); }
function fail(name, extra) {
  checks.push({ name, pass: false, extra });
  failures.push(name + (extra ? ' — ' + extra : ''));
}

/** URL страниц, с которых реально открывают мобильный PWA. */
const SPA_URLS = [
  '/m/',
  '/m/field/home',
  '/m/field/hall/12',
  '/m/field/pin-entry',
  '/m/field/timesheet',
];

/** Извлекаем ссылки из <head>, которые браузер резолвит относительно документа. */
function extractHeadLinks(html) {
  const head = html.slice(0, html.indexOf('</head>') + 1 || html.length);
  const out = [];
  const re = /<(?:link|script)\b[^>]*?(?:href|src)\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(head)) !== null) out.push(m[1]);
  return out;
}

function checkAbsoluteHrefs(label, file) {
  if (!fs.existsSync(file)) {
    fail(`${label}: файл найден`, file);
    return;
  }
  const html = fs.readFileSync(file, 'utf8');
  const links = extractHeadLinks(html);
  if (!links.length) {
    fail(`${label}: ссылки в head найдены`, 'ни одной — проверка потеряла предмет');
    return;
  }
  const relative = links.filter((h) => !/^(\/|https?:|data:|#)/.test(h));
  if (relative.length) {
    fail(`${label}: все href/src в head абсолютные`, relative.join(', '));
  } else {
    ok(`${label}: все href/src в head абсолютные`, `${links.length} ссылок`);
  }
}

/** Каждый абсолютный /m/... из head обязан существовать на диске. */
function checkResolvesOnDisk(label, file) {
  if (!fs.existsSync(file)) return;
  const html = fs.readFileSync(file, 'utf8');
  const links = extractHeadLinks(html).filter((h) => h.startsWith('/m/'));
  const missing = [];
  for (const href of links) {
    const clean = href.split('?')[0].split('#')[0];
    const disk = path.join(PUBLIC, clean.replace(/^\/+/, ''));
    if (!fs.existsSync(disk)) missing.push(clean);
  }
  if (missing.length) {
    fail(`${label}: /m/-ассеты существуют на диске`, missing.join(', '));
  } else {
    ok(`${label}: /m/-ассеты существуют на диске`, `${links.length} путей`);
  }
}

/**
 * Главная проверка: симулируем резолв как браузер (new URL) с каждого
 * вложенного роута и убеждаемся, что путь ведёт в существующий файл.
 */
function checkResolveFromSpaRoutes(label, file) {
  if (!fs.existsSync(file)) return;
  const html = fs.readFileSync(file, 'utf8');
  const links = extractHeadLinks(html).filter((h) => !/^(https?:|data:|#)/.test(h));
  const broken = [];
  for (const page of SPA_URLS) {
    for (const href of links) {
      let resolved;
      try {
        resolved = new URL(href, 'https://asgard-crm.ru' + page).pathname;
      } catch (_) { broken.push(`${page} + ${href}: не резолвится`); continue; }
      const disk = path.join(PUBLIC, resolved.replace(/^\/+/, ''));
      if (!fs.existsSync(disk)) broken.push(`${page} → ${resolved} (404)`);
    }
  }
  if (broken.length) {
    fail(`${label}: ссылки резолвятся с вложенных роутов`, broken.slice(0, 6).join('; '));
  } else {
    ok(`${label}: ссылки резолвятся с вложенных роутов`, `${SPA_URLS.length} роутов × ${links.length} ссылок`);
  }
}

/** Иконки манифеста: файл есть, пиксели совпадают с заявленным sizes. */
function checkManifestIcons() {
  const manifestPath = path.join(PUBLIC, 'm', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fail('manifest: файл найден', manifestPath);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    fail('manifest: валидный JSON', e.message);
    return;
  }
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  if (!icons.length) { fail('manifest: иконки объявлены', 'список icons пуст'); return; }

  const problems = [];
  for (const icon of icons) {
    if (!icon.src) { problems.push('иконка без src'); continue; }
    if (!icon.src.startsWith('/')) problems.push(`${icon.src}: относительный путь (сломается на /m/field/*)`);
    const disk = path.join(PUBLIC, icon.src.replace(/^\/+/, ''));
    if (!fs.existsSync(disk)) { problems.push(`${icon.src}: файла нет`); continue; }
    const buf = fs.readFileSync(disk);
    const isPng = buf.slice(1, 4).toString() === 'PNG';
    if (isPng && icon.sizes) {
      const [w, h] = buf.readUInt32BE(16) === undefined ? [0, 0] : [buf.readUInt32BE(16), buf.readUInt32BE(20)];
      const [ew, eh] = String(icon.sizes).split('x').map(Number);
      if (w !== ew || h !== eh) problems.push(`${icon.src}: ${w}x${h}, а заявлено ${icon.sizes}`);
    }
  }
  if (problems.length) {
    fail('manifest: иконки корректны', problems.slice(0, 6).join('; '));
  } else {
    ok('manifest: иконки корректны', `${icons.length} иконок`);
  }

  // start_url и scope должны быть абсолютными и в /m/
  const scopeProblems = [];
  if (!String(manifest.start_url || '').startsWith('/m/')) scopeProblems.push(`start_url=${manifest.start_url}`);
  if (!String(manifest.scope || '').startsWith('/m/')) scopeProblems.push(`scope=${manifest.scope}`);
  if (scopeProblems.length) {
    fail('manifest: start_url и scope в /m/', scopeProblems.join(', '));
  } else {
    ok('manifest: start_url и scope в /m/', `${manifest.start_url} / ${manifest.scope}`);
  }
}

/**
 * Негативный контроль: гейт обязан краснеть на исходном дефекте.
 * Без него любая сломанная регулярка даёт «вечный зелёный».
 */
function checkNegativeControl() {
  const badHtml = '<head><link rel="manifest" href="manifest.json" /></head>';
  const badLinks = extractHeadLinks(badHtml).filter((h) => !/^(\/|https?:|data:|#)/.test(h));
  if (!badLinks.length) {
    fail('негативный контроль: относительный manifest.json детектируется', 'не сработало');
    return;
  }
  // и что он реально ломается на вложенном роуте
  const resolved = new URL(badLinks[0], 'https://asgard-crm.ru/m/field/home').pathname;
  if (resolved !== '/m/field/manifest.json') {
    fail('негативный контроль: резолв от /m/field/home даёт /m/field/manifest.json', resolved);
    return;
  }
  const goodHtml = '<head><link rel="manifest" href="/m/manifest.json" /></head>';
  const goodRel = extractHeadLinks(goodHtml).filter((h) => !/^(\/|https?:|data:|#)/.test(h));
  if (goodRel.length) {
    fail('негативный контроль: абсолютный путь не считается дефектом', goodRel.join(', '));
    return;
  }
  ok('негативный контроль: детектор ловит относительный и не трогает абсолютный', '2/2');
}

console.log('═══ mobile-pwa-assets (D-310) ═══');
checkAbsoluteHrefs('m/index.html', M_INDEX);
checkResolvesOnDisk('m/index.html', M_INDEX);
checkResolveFromSpaRoutes('m/index.html', M_INDEX);
checkAbsoluteHrefs('mobile-app/index.html', SRC_INDEX);
checkResolveFromSpaRoutes('mobile-app/index.html', SRC_INDEX);
checkManifestIcons();
checkNegativeControl();

// Синхронность зеркал: сборка и раздача не должны разъезжаться.
try {
  const a = fs.readFileSync(M_INDEX, 'utf8');
  const b = fs.readFileSync(SRC_INDEX, 'utf8');
  const pick = (html) => extractHeadLinks(html).filter((h) => /manifest|favicon|icon-|apple-touch-icon/.test(h))
    .map((h) => h.split('?')[0]).sort().join('|');
  if (pick(a) === pick(b)) {
    ok('зеркала m/index.html и mobile-app/index.html: PWA-ссылки совпадают', pick(a).slice(0, 80));
  } else {
    fail('зеркала m/index.html и mobile-app/index.html: PWA-ссылки совпадают',
      `m: ${pick(a)} | src: ${pick(b)}`);
  }
} catch (e) {
  fail('зеркала: сравнение выполнено', e.message);
}

for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? '  — ' + c.extra : ''}`);
}
console.log(`\nитог: ${checks.filter((c) => c.pass).length}/${checks.length}`);
if (failures.length) {
  console.log('FAIL:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('MOBILE_PWA_ASSETS_OK');
