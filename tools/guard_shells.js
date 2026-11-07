#!/usr/bin/env node
'use strict';
/**
 * Сторож оболочек: /h/ (Хугинн) и / (CRM) — РАЗНЫЕ приложения.
 *
 * 06.11.2026 деплой скопировал public/index.html → public/h/index.html,
 * и мобильное приложение Хугинн на проде превратилось в копию основного.
 * Ошибка тихая: сервис отвечает 200, версия сходится, тесты на / проходят.
 *
 * Здесь ловим именно это: у /h/ должны быть свои маркеры (huginn_dock),
 * другой размер и своя точка входа. Плюс проверяем, что /h/ не побайтово
 * равен /.
 *
 *   node tools/guard_shells.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'public/index.html');
const HUG = path.join(ROOT, 'public/h/index.html');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed += 1;
}

for (const f of [MAIN, HUG]) {
  if (!fs.existsSync(f)) {
    console.log(`FAIL  нет файла ${path.relative(ROOT, f)}`);
    failed += 1;
  }
}

if (failed === 0) {
  const main = fs.readFileSync(MAIN, 'utf8');
  const hug = fs.readFileSync(HUG, 'utf8');

  check('/h/ — приложение Хугинн (свой заголовок)', /<title>Хугинн<\/title>/.test(hug));
  check('/ — основная CRM (заголовок АСГАРД CRM)', /<title>АСГАРД CRM<\/title>/.test(main),
    (main.match(/<title>([^<]*)<\/title>/) || [])[1] || 'нет заголовка');
  // Маркер должен реально присутствовать в /, иначе проверка тавтологична:
  // раньше искали tenders-registry|pm-calculations, а их нет НИ В ОДНОМ файле —
  // пункт проходил даже на подмене (верификатор поймал: /h/ = 42940 б, это корень,
  // а проверка PASS). ASGARD_SHELL_VERSION и swUpdateBanner есть только в /.
  const rootOnly = ['ASGARD_SHELL_VERSION', 'swUpdateBanner'].filter((m) => main.includes(m));
  check('/h/ не содержит маркеров оболочки СРМ',
    rootOnly.length > 0 && rootOnly.every((m) => !hug.includes(m)),
    rootOnly.length ? `проверены: ${rootOnly.join(', ')}` : 'НЕТ маркеров-различителей в / — проверка была бы пустой');
  check('/h/ не побайтовая копия /', main !== hug,
    `размеры ${main.length} и ${hug.length}`);
  check('/h/ меньше основного (это мобильная оболочка)', hug.length < main.length,
    `${hug.length} < ${main.length}`);

  // Сторож версии PWA у /h/ свой: var VER.
  const mainVer = (main.match(/ASGARD_SHELL_VERSION = '[0-9.]+'/) || [''])[0];
  const hugVer = (hug.match(/var VER = '[0-9.]+'/) || [''])[0];
  check('/h/ использует сторож var VER', !!hugVer, hugVer || 'не найден');
  check('/ имеет ASGARD_SHELL_VERSION', !!mainVer, mainVer || 'не найден');

  // D-396: сторож /h/ обязан иметь защёлку в sessionStorage. Без неё
  // рассогласование версий (VER ≠ /api/version) даёт вечный цикл перезагрузки,
  // а не баннер: 06.11.2026 клиент перезагрузился 4093 раза за 13 минут.
  // Защёлка на сервере в этом файле, поэтому проверяем её наличие локально —
  // иначе «фикс» уедет на прод только в одном из двух мест.
  check('/h/ имеет защёлку перезагрузки (D-396)', /_hg_shell_reload_/.test(hug),
    /_hg_shell_reload_/.test(hug) ? 'найдена' : 'НЕТ — сторож без ограничителя');
  // Защёлка может быть реализована под разными именами: старая пара
  // alreadyTried/rememberTry или новая triedThisVersion (проверяет, что запись
  // реально сохранилась — на случай приватного режима Safari). Требуем
  // ЛЮБУЮ из реализаций, иначе сторож ложно падает на улучшенной версии.
  const latchOld = /alreadyTried\s*\(/.test(hug) && /rememberTry\s*\(/.test(hug);
  const latchNew = /triedThisVersion\s*\(/.test(hug);

  // ВАЖНО: одних имён НЕДОСТАТОЧНО. Верификатор вырезал тело защёлки, оставив
  // `_hg_shell_reload_` и `alreadyTried(`, — и этот гейт оставался ЗЕЛЁНЫМ.
  // Поэтому три содержательные проверки вместо проверки имён.
  check('/h/ спрашивает защёлку ПЕРЕД перезагрузкой',
    /(triedThisVersion|alreadyTried)\s*\(\s*j\.version\s*\)\s*\)\s*\{\s*showReloadNotice/.test(hug),
    /showReloadNotice/.test(hug) && /(triedThisVersion|alreadyTried)\s*\(\s*j\.version/.test(hug)
      ? 'ветка «уже пробовали» ведёт в баннер'
      : 'НЕТ — проверка защёлки не связана с баннером перед релоадом');
  check('/h/ подтверждает запись защёлки чтением (приватный режим)',
    /return\s+sessionStorage\.getItem\(\s*k\s*\)\s*!==\s*'1'/.test(hug) || /alreadyTried/.test(hug),
    /return\s+sessionStorage\.getItem\(\s*k\s*\)\s*!==\s*'1'/.test(hug)
      ? 'запись верифицируется чтением'
      : 'setItem без проверки — в приватном режиме защёлка не встанет');
  check('/h/ при недоступном хранилище отказывается от перезагрузки (fail-safe)',
    /хранилище недоступно/.test(hug),
    /хранилище недоступно/.test(hug) ? 'fail-safe включён' : 'НЕТ — отказ не предусмотрен');
  check('/h/ не перезагружается без проверки защёлки', latchOld || latchNew,
    `alreadyTried: ${/alreadyTried\s*\(/.test(hug) ? 'есть' : 'нет'}, rememberTry: ${/rememberTry\s*\(/.test(hug) ? 'есть' : 'нет'}, triedThisVersion: ${latchNew ? 'есть' : 'нет'}`);
}

console.log(failed ? `\nИТОГ: FAIL — ${failed} проверок` : '\nИТОГ: OK — оболочки / и /h/ различаются');
process.exitCode = failed ? 1 : 0;
