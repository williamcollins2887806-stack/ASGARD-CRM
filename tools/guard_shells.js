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
  check('/h/ не содержит навигацию основной CRM', !/pm-calculations|tenders-registry/.test(hug));
  check('/h/ не побайтовая копия /', main !== hug,
    `размеры ${main.length} и ${hug.length}`);
  check('/h/ меньше основного (это мобильная оболочка)', hug.length < main.length,
    `${hug.length} < ${main.length}`);

  // Сторож версии PWA у /h/ свой: var VER.
  const mainVer = (main.match(/ASGARD_SHELL_VERSION = '[0-9.]+'/) || [''])[0];
  const hugVer = (hug.match(/var VER = '[0-9.]+'/) || [''])[0];
  check('/h/ использует сторож var VER', !!hugVer, hugVer || 'не найден');
  check('/ имеет ASGARD_SHELL_VERSION', !!mainVer, mainVer || 'не найден');
}

console.log(failed ? `\nИТОГ: FAIL — ${failed} проверок` : '\nИТОГ: OK — оболочки / и /h/ различаются');
process.exitCode = failed ? 1 : 0;
