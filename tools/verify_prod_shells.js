#!/usr/bin/env node
'use strict';
/**
 * Проверка оболочек НА ЖИВОМ ПРОДЕ: / (СРМ) и /h/ (Хугинн) — разные приложения.
 *
 * Зачем отдельный гейт. `tools/guard_shells.js` смотрит ЛОКАЛЬНЫЕ файлы и потому
 * слеп к подмене при выкатке: 06.11.2026 локально всё было верно, а на прод по
 * адресу `/` уехала копия `/h/`. Клиент получал оболочку Хугинна на весь экран,
 * а сторож версии внутри неё крутил перезагрузку: 4093 полные загрузки за
 * 13 минут (360/мин). Ни один pre-deploy гейт такого не видит по построению —
 * сверять надо то, что реально отдаёт сервер.
 *
 *   node tools/verify_prod_shells.js                 # прод по умолчанию
 *   ASGARD_PROD=https://... node tools/verify_prod_shells.js
 *
 * Коды выхода: 0 — все проверки прошли, 1 — есть FAIL.
 */

const PROD = (process.env.ASGARD_PROD || 'https://asgard-crm.ru').replace(/\/+$/, '');

let failed = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed += 1; else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/** Забираем документ в обход кэша: иначе проверяем то, что уже лежит в браузере. */
async function fetchText(pathname) {
  const url = `${PROD}${pathname}${pathname.includes('?') ? '&' : '?'}_probe=${Date.now()}`;
  const res = await fetch(url, {
    cache: 'no-store',
    redirect: 'follow',
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'ASGARD-shell-gate/1.0',
    },
  });
  return { status: res.status, text: await res.text(), url: res.url };
}

function titleOf(html) {
  const m = /<title>([^<]*)<\/title>/i.exec(html || '');
  return m ? m[1].trim() : '';
}

async function main() {
  console.log(`Проверяю оболочки на ${PROD}\n`);

  let root;
  let hug;
  let api;
  try {
    [root, hug, api] = await Promise.all([
      fetchText('/'),
      fetchText('/h/'),
      fetchText('/api/version'),
    ]);
  } catch (e) {
    console.log(`FAIL  прод недоступен: ${e.message}`);
    process.exit(1);
  }

  check('GET / отвечает 200', root.status === 200, `status=${root.status}`);
  check('GET /h/ отвечает 200', hug.status === 200, `status=${hug.status}`);

  const rootTitle = titleOf(root.text);
  const hugTitle = titleOf(hug.text);

  // Главный дефект 06.11: по `/` отдавалась оболочка Хугинна.
  check('/ — это СРМ (title «АСГАРД CRM»)', /АСГАРД\s*CRM/i.test(rootTitle), `title="${rootTitle}"`);
  check('/h/ — это Хугинн (title «Хугинн»)', /^Хугинн$/i.test(hugTitle), `title="${hugTitle}"`);

  // Тот же дефект с другой стороны: корень не должен нести маркеры /h/.
  check('/ не является оболочкой Хугинна',
    !/\/h\/app\.js/.test(root.text) && !/\/h\/manifest\.webmanifest/.test(root.text),
    `/h/app.js: ${/\/h\/app\.js/.test(root.text) ? 'есть' : 'нет'}, манифест /h/: ${/\/h\/manifest\.webmanifest/.test(root.text) ? 'есть' : 'нет'}`);

  // И наоборот: /h/ не должен подтягивать навигацию СРМ.
  check('/h/ не содержит навигацию СРМ',
    !/tenders-registry|pm-calculations/.test(hug.text),
    `/h/ размер ${hug.text.length} б`);

  check('/ и /h/ не побайтово равны', root.text !== hug.text,
    `${root.text.length} б и ${hug.text.length} б`);

  // Версии: обе оболочки объявляют версию, и она равна тому, что отдаёт API.
  const serverVer = (() => {
    try { return JSON.parse(api.text).version || ''; } catch (_) { return ''; }
  })();
  check('GET /api/version отдаёт версию', !!serverVer, serverVer || api.text.slice(0, 60));

  const rootVer = (/ASGARD_SHELL_VERSION\s*=\s*'([0-9.]+)'/.exec(root.text) || [])[1] || '';
  const hugVer = (/var VER = '([0-9.]+)'/.exec(hug.text) || [])[1] || '';
  check('/ объявляет ASGARD_SHELL_VERSION', !!rootVer, rootVer || 'не найден');
  check('/h/ объявляет сторож var VER', !!hugVer, hugVer || 'не найден');

  if (serverVer) {
    // Рассогласование здесь = вечная перезагрузка у клиента (D-396).
    check('/ совпадает с /api/version', rootVer === serverVer, `/="${rootVer}" api="${serverVer}"`);
    check('/h/ совпадает с /api/version', hugVer === serverVer, `VER="${hugVer}" api="${serverVer}"`);
  }

  // D-396/D-396: защёлка от повторной перезагрузки должна быть на проде.
  // Без неё рассогласование версий снова превратится в цикл, а не в баннер.
  // Проверяем не только имя ключа, но и то, что решение «перезагружаться или
  // нет» принимается ДО релоада: иначе мутация с вырезанным телом проходит.
  const hasLockKey = /_hg_shell_reload_/.test(hug.text);
  const latchBeforeReload = /(triedThisVersion|alreadyTried)\s*\(\s*j\.version\s*\)\s*\)\s*\{\s*showReloadNotice/.test(hug.text);
  const failSafe = /хранилище недоступно/.test(hug.text);
  check('/h/ содержит защёлку перезагрузки (D-396)', hasLockKey,
    hasLockKey ? 'найдена' : 'НЕТ — сторож без ограничителя');
  check('/h/ решает «релоад или баннер» ДО перезагрузки', latchBeforeReload,
    latchBeforeReload ? 'ветка ведёт в баннер' : 'НЕТ — решение не найдено, возможен цикл');
  check('/h/ отказывается от релоада при недоступном хранилище', failSafe,
    failSafe ? 'fail-safe выкачен' : 'НЕТ — приватный режим снова даст цикл');

  console.log(`\nИТОГ: ${failed ? 'FAIL' : 'OK'} — ${passed} PASS / ${failed} FAIL`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.log(`FAIL  ${e && e.message}`);
  process.exit(1);
});
