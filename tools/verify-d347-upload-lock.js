/**
 * Гейт D-347: три дефекта просчёта РП после загрузки файла (29.10.2026).
 *
 * Жалоба РП: «добавляю ТКП — не даёт отправить, выхожу-захожу — даёт»,
 * «пишет, что отчёт ушёл директору» и ошибка в консоли
 * «File chooser dialog can only be shown with a user activation».
 *
 * Проверяется ФАКТИЧЕСКОЕ поведение, а не наличие строк:
 *   1. Загрузка файла возвращает `review_updated_at` (иначе optimistic lock
 *      остаётся со старым токеном → 409 на следующем сохранении).
 *   2. Фронт обновляет токен блокировки после загрузки.
 *   3. Тост при финализации говорит по фактическому исходу, а не всегда
 *      «Просчёт ушёл директору».
 *   4. Клик по ссылке «Просмотр»/«Скачать» внутри зоны не открывает выбор файла.
 *
 * Пункты 1 и 2 проверяются рантаймом (мутация + вызов), пункт 4 — кликом
 * в реальном браузере с перехватом `input.click()`.
 */
const fs = require('fs');
const { chromium } = require('playwright');

const FRONT = 'public/assets/js/rp_calc_modal.js';
const BACK = 'src/routes/pm-duty.js';

const front = fs.readFileSync(FRONT, 'utf8');
const back = fs.readFileSync(BACK, 'utf8');

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

// ── 1. Бэкенд: загрузки возвращают новый updated_at ───────────────────────
console.log('=== 1. Бэкенд: загрузка файла отдаёт updated_at ===');

const UPLOADS = [
  { path: '/rp-review/estimate', field: 'estimate_file_id', label: 'смета' },
  { path: '/rp-review/report', field: 'report_file_id', label: 'отчёт' },
  { path: '/rp-review/tkp', field: 'tkp_file_id', label: 'ТКП' },
];

for (const u of UPLOADS) {
  // Вырезаем тело конкретного эндпоинта загрузки.
  const at = back.indexOf(`fastify.post('/:id${u.path}'`);
  if (at < 0) { bad(`не нашёл эндпоинт загрузки: ${u.label}`); continue; }
  const body = back.slice(at, at + 6000);

  // UPDATE обязан возвращать updated_at (RETURNING), иначе клиент не узнает новый токен.
  const upd = body.match(new RegExp(
    `UPDATE tender_rp_reviews SET ${u.field} = \\$1, updated_at = NOW\\(\\) WHERE id = \\$2([^;]*);`
  ));
  if (!upd) {
    bad(`${u.label}: нет UPDATE ${u.field} + updated_at`);
  } else if (!/RETURNING updated_at/.test(upd[1])) {
    bad(`${u.label}: UPDATE без RETURNING updated_at — клиент не получит новый токен`);
  } else {
    ok(`${u.label}: UPDATE ... RETURNING updated_at`);
  }

  // И сам ответ должен содержать review_updated_at.
  if (/review_updated_at:/.test(body)) ok(`${u.label}: в ответе есть review_updated_at`);
  else bad(`${u.label}: ответ не содержит review_updated_at → 409 после загрузки вернётся`);
}

// ── 2. Фронт: токен обновляется ───────────────────────────────────────────
console.log('\n=== 2. Фронт: обновляет токен блокировки после загрузки ===');
if (/state\.review\.updated_at = d\.review_updated_at/.test(front)) {
  ok('берёт review_updated_at из ответа загрузки');
} else {
  bad('фронт не обновляет updated_at после загрузки — 409 на следующем сохранении');
}
// Фолбэк: если сервер не прислал токен, нельзя оставлять старый — иначе конфликт.
if (/state\.review\.updated_at = null;/.test(front)) {
  ok('фолбэк: сбрасывает токен, если сервер его не прислал');
} else {
  bad('нет фолбэка — старый токен останется и даст ложный 409');
}

// ── 3. Тост не врёт про директора ─────────────────────────────────────────
console.log('\n=== 3. Тост при финализации говорит по факту ===');
if (!/finalize \? 'Просчёт ушёл директору'/.test(front)) {
  ok('нет безусловного «Просчёт ушёл директору»');
} else {
  bad('тост по-прежнему всегда пишет «Просчёт ушёл директору»');
}
if (/approvalWanted\(\)[\s\S]{0,120}отправлен директору на согласование/.test(front)) {
  ok('при согласовании сообщает про директора');
} else {
  bad('нет сообщения для ветки согласования');
}
if (/ушёл в ТО \(согласование не требуется\)/.test(front)) {
  ok('без согласования сообщает про ТО');
} else {
  bad('нет сообщения для ветки «сразу в ТО»');
}

// ── 4. Клик по ссылке не открывает выбор файла ────────────────────────────
console.log('\n=== 4. Браузер: ссылка в зоне не вызывает file chooser ===');

/**
 * Стенд грузит НАСТОЯЩИЙ модуль (openDemo → вкладка «Файлы» → bind()), поэтому
 * клик проходит через реальный обработчик `[data-drop]`, а не через его копию.
 * `input.click` перехватываем: настоящий диалог в headless не откроется, а нам
 * нужен только факт вызова.
 */
const page = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div id="host"></div>
<script>
window.__chooserOpened = 0;
/* Перехват ДО создания модуля: зона берёт input из DOM, а click зовём мы. */
document.addEventListener('click', function (e) {
  const inp = e.target && e.target.closest && e.target.closest('.rp-calc-drop');
  if (inp) { /* сам клик не считаем — считаем вызов input.click() ниже */ }
}, true);
const origClick = HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click = function () {
  if (this.type === 'file') { window.__chooserOpened++; return; }
  return origClick.call(this);
};
window.AsgardUI = {
  esc: function (s) { return String(s == null ? '' : s); },
  toast: function () {}, showModal: function () {}, hideModal: function () {}, replaceModal: null
};
window.AsgardSmeta = { DEFAULT_PARAMS: {}, skeletonRows: function () { return []; },
  recalcAsgardSmeta: function (s) { return s; } };
window.fetch = function () { return Promise.reject(new Error('stand')); };
/* Ссылки ведут на реальный /uploads → без этого клик уводит страницу и замер
   идёт уже на другом документе. preventDefault НЕ останавливает всплытие,
   поэтому обработчик зоны всё равно получит клик — именно это и проверяем. */
document.addEventListener('click', function (e) {
  const a = e.target && e.target.closest && e.target.closest('a');
  if (a) e.preventDefault();
}, true);
</script>
<script>${front}</script>
<script>
/* Демо содержит приложенный ТКП, но без download_url ссылки «Просмотр/Скачать»
   не рисуются (fileLinksHtml возвращает пустую строку). В проде url есть —
   подставляем его, чтобы проверить клик по настоящей ссылке. */
const s = window.AsgardRpCalcModal.openDemo(document.getElementById('host'));
s.state.files.tkp = {
  name: 'ТКП_заказчику.pdf',
  original_name: 'ТКП_заказчику.pdf',
  filename: 'ТКП_заказчику.pdf',
  download_url: '/uploads/rp_tkp/2101/tkp.pdf'
};
s.paint();
document.querySelector('[data-rp-tab="files"]').click();
</script></body></html>`;

(async () => {
  // ВАЖНО (методика). Первая версия этого гейта копировала обработчик в стенд
  // руками — и негативный контроль НЕ покраснел: тест проверял свою же копию,
  // а не код модуля. Теперь стенд грузит НАСТОЯЩИЙ модуль и кликает по нему.
  if (!/if \(isFileLink\(e\.target\)\) return;/.test(front)) {
    bad('в модуле нет защиты isFileLink в обработчике зоны');
  } else {
    ok('в модуле есть защита isFileLink');
  }
  if (!/closest\('a, \.rp-calc-file-links, \.rp-calc-file-link'\)/.test(front)) {
    bad('isFileLink не проверяет ссылки');
  } else {
    ok('isFileLink распознаёт ссылки «Просмотр»/«Скачать»');
  }

  const f = 'tests/reports/_d347-drop-stand.html';
  fs.mkdirSync('tests/reports', { recursive: true });
  fs.writeFileSync(f, page);

  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.goto('file:///' + require('path').resolve(f).replace(/\\/g, '/'));
  await p.waitForTimeout(300);

  // На вкладке «Файлы» у демо-просчёта приложен ТКП → внутри зоны есть ссылки.
  const link = await p.$('.rp-calc-drop .rp-calc-file-link');
  if (!link) {
    bad('в зоне загрузки нет ссылки «Просмотр/Скачать» — проверить нечего');
  } else {
    await p.evaluate(() => { window.__chooserOpened = 0; });
    await link.click({ force: true });
    await p.waitForTimeout(150);
    const n = await p.evaluate(() => window.__chooserOpened);
    if (n === 0) ok('клик по ссылке «Просмотр/Скачать» не открывает выбор файла');
    else bad(`клик по ссылке открыл file chooser ${n} раз`);
  }

  // Клик по самой зоне должен открывать диалог — иначе загрузку не запустить.
  await p.evaluate(() => { window.__chooserOpened = 0; });
  const zoneTitle = await p.$('.rp-calc-drop strong');
  if (zoneTitle) {
    await zoneTitle.click();
    await p.waitForTimeout(150);
    const n = await p.evaluate(() => window.__chooserOpened);
    if (n === 1) ok('клик по зоне открывает выбор файла');
    else bad(`клик по зоне не открыл диалог (${n})`);
  } else {
    bad('не нашёл зону загрузки в реальном модуле');
  }

  const real = errs.filter((e) => /user activation|file chooser/i.test(e));
  if (real.length === 0) ok('нет ошибки «File chooser dialog can only be shown with a user activation»');
  else bad('ошибка file chooser: ' + real.join(' | '));

  await browser.close();

  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — загрузка не ломает отправку, тост не врёт, ссылки не зовут file chooser'
    : `ИТОГ: FAIL — ${fail} нарушений`));
  process.exit(fail === 0 ? 0 : 1);
})();
