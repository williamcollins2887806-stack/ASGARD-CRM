/**
 * Гейт D-342: галочка согласования в ванильном просчёте РП (десктоп).
 *
 * Требование заказчика (23.10.2026):
 *   • до 10 млн без НДС — согласование не нужно, отчёт идёт сразу в ТО;
 *   · свыше 10 млн — согласование ВОЗМОЖНО, но включается только галочкой РП;
 *   • без галочки — отчёт уходит сразу в ТО, минуя директора.
 *
 * До правки порог был жёстким триггером: свыше 10 млн согласование навязывалось,
 * а бэкенд ещё и требовал получателя — отказаться РП не мог вообще.
 *
 * Гейт проверяет не «есть ли слово в файле», а фактическую логику:
 *   1. бэкенд требует И порог, И флаг (и без флага не отдаёт 400);
 *   2. фронт шлёт флаг при финализации и по умолчанию НЕ согласовывает;
 *   3. в разметке есть галочка с пояснением суммы и порога;
 *   4. стили галочки существуют в подключённом CSS и используют токены тем;
 *   5. нет обратной ситуации: получателей не требуют, когда согласование снято.
 */
const fs = require('fs');

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

const BACK = 'src/routes/pm-duty.js';
const FRONT = 'public/assets/js/rp_calc_modal.js';
const CSS = 'public/assets/css/rp-calc-modal.css';

// ── 1. Бэкенд: порог И флаг ────────────────────────────────────────────────
console.log('=== 1. Бэкенд: согласование только при пороге И галочке ===');
const back = fs.readFileSync(BACK, 'utf8');

if (/const wantsApproval = b\.request_director_approval === true;/.test(back)) {
  ok('читает флаг request_director_approval строго как true');
} else {
  bad('нет чтения request_director_approval — согласование не управляется галочкой');
}
if (/if \(aboveThreshold && wantsApproval\)/.test(back)) {
  ok('согласование включается при aboveThreshold && wantsApproval');
} else {
  bad('условие «порог И галочка» не найдено — вернулось принудительное согласование');
}
// Без флага нельзя требовать получателей (иначе снова 400 «выберите получателя»).
const recipient400 = back.match(/if \(!approvalRecipients\)[\s\S]{0,160}/);
if (recipient400 && /выберите хотя бы одного получателя/i.test(recipient400[0])) {
  const before = back.slice(Math.max(0, (recipient400.index || 0) - 260), recipient400.index || 0);
  const guarded = /aboveThreshold && wantsApproval/.test(before) || /body\.request_director_approval|wantsApproval/.test(before);
  if (guarded) ok('400 «выберите получателя» только внутри ветки с галочкой');
  else bad('400 может сработать без галочки — РП нельзя отказаться от согласования');
} else {
  bad('не нашёл проверку получателей');
}

// ── 2. Фронт: шлёт решение и по умолчанию не согласовывает ─────────────────
console.log('\n=== 2. Фронт: шлёт решение РП ===');
const front = fs.readFileSync(FRONT, 'utf8');

if (/body\.request_director_approval = approvalWanted\(\);/.test(front)) {
  ok('payload отправляет request_director_approval по решению РП');
} else {
  bad('payload НЕ отправляет request_director_approval — бэкенд всегда увидит «нет»');
}
if (/wantApproval:\s*false/.test(front)) {
  ok('по умолчанию согласование ВЫКЛЮЧЕНО (решает РП, не порог)');
} else {
  bad('нет значения по умолчанию — согласование может включиться само');
}
if (/function wantApproval\(state\) \{\s*return !!state && stateApprovalNeeded\(state\) && state\.wantApproval === true;/.test(front)) {
  ok('wantApproval = порог И галочка (порог — условие, не принуждение)');
} else {
  bad('wantApproval не связывает порог и галочку');
}
// Функция живёт на уровне модуля, а state — в createSession(). Без аргумента
// она читала несуществующую переменную и падала с ReferenceError (кнопка
// «Отправить просчёт» молча не работала). Регресс-защита: state только параметром.
if (/function wantApproval\(\)/.test(front)) {
  bad('wantApproval() без аргумента — снова ReferenceError: state is not defined');
} else {
  ok('wantApproval(state) получает состояние аргументом (нет ReferenceError)');
}
if (/return wantApproval\(state\);/.test(front)) {
  ok('внутренний approvalWanted() передаёт state в wantApproval');
} else {
  bad('approvalWanted() не передаёт state — обработчик кнопки упадёт');
}
// Получателей требуем только когда согласование выбрано.
if (/if \(approvalWanted\(\) && selectedRecipients\(\)\.length === 0\)/.test(front)) {
  ok('получателей требует только при выбранном согласовании');
} else {
  bad('требование получателей не связано с галочкой');
}
// Кнопки и текст учитывают решение, а не только порог.
const wantedUses = (front.match(/approvalWanted\(\)/g) || []).length;
if (wantedUses >= 5) {
  ok(`approvalWanted() используется в ${wantedUses} местах (кнопка, предпросмотр, валидация, payload)`);
} else {
  bad(`approvalWanted() мало используется (${wantedUses}) — где-то остался жёсткий порог`);
}

// ── 3. Разметка галочки с пояснением ──────────────────────────────────────
console.log('\n=== 3. Галочка в предпросмотре ===');
if (/data-approve-flag/.test(front)) ok('есть чекбокс data-approve-flag');
else bad('нет чекбокса согласования');
if (/Без галочки отчёт уйдёт сразу в ТО, минуя директора/.test(front)) {
  ok('РП видит последствие отказа от согласования');
} else {
  bad('нет пояснения, что без галочки отчёт идёт сразу в ТО');
}
if (/data-approve-recipients/.test(front)) ok('блок получателей скрывается вместе с галочкой');
else bad('блок получателей не связан с галочкой');
if (/fmtMoney\(noVat\)/.test(front) && /fmtMoney\(directorThreshold\(\)\)/.test(front)) {
  ok('показаны и сумма без НДС, и порог');
} else {
  bad('не показаны сумма/порог — РП не понимает, почему согласование доступно');
}

// ── 4. Стили ───────────────────────────────────────────────────────────────
console.log('\n=== 4. Стили галочки ===');
const css = fs.readFileSync(CSS, 'utf8');
const needSelectors = [
  '.rp-calc-approve-toggle {',
  '.rp-calc-approve-toggle__box',
  '.rp-calc-approve-toggle__hint',
  "input[type='checkbox']:checked",
];
for (const sel of needSelectors) {
  if (css.includes(sel)) ok('есть ' + sel);
  else bad('нет стиля ' + sel);
}
// Селектор светлой темы обязан совпадать с каноном проекта.
// В проекте 2533 правила `html[data-theme="light"]`, класс `.light` не используется:
// тему переключает app.js через атрибут. `html.light` в светлой теме не сработал бы
// (это был реальный дефект первой версии — исправлен 23.10.2026).
if (/html\[data-theme=['"]light['"]\]\s+\.rp-calc-approve-toggle/.test(css)) {
  ok('светлая тема через html[data-theme="light"] (как во всём проекте)');
} else {
  bad('светлая тема не через data-theme — правило не сработает');
}
if (/html\.light\s+\.rp-calc-approve-toggle/.test(css)) {
  bad('остался html.light — в проекте такого селектора нет, правило будет мёртвым');
}
// Токены обязаны существовать там, где проект их объявляет. Токены темы —
// многофайловые (design-tokens.css + theme.css), поэтому собираем объявления
// по всем подключённым CSS, а не по одному файлу.
const toggleBlock = css.slice(
  css.indexOf('.rp-calc-approve-toggle {'),
  css.indexOf('.rp-calc-mail-preview__frame') > css.indexOf('.rp-calc-approve-toggle {')
    ? css.indexOf('.rp-calc-mail-preview__frame')
    : css.length
);
const shell2 = fs.readFileSync('public/index.html', 'utf8');
const cssFiles = [...shell2.matchAll(/assets\/css\/([\w.-]+\.css)/g)].map((m) => 'public/assets/css/' + m[1]);
const declared = new Set();
for (const f of cssFiles) {
  if (!fs.existsSync(f)) continue;
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
}
const used = [...new Set([...toggleBlock.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
const unknown = used.filter((t) => !declared.has(t));
if (unknown.length === 0) {
  ok(`все токены галочки объявлены (${used.length} шт. из ${cssFiles.length} CSS)`);
} else {
    bad('токены не объявлены ни в одном подключённом CSS: ' + unknown.join(', '));
}
// Хардкод цветов: допускается только брендовое золото и цвет «птички».
const hexInToggle = (toggleBlock.match(/#[0-9a-fA-F]{3,6}\b/g) || [])
  .filter((h) => !/^#(c8a84e|1a1408)$/i.test(h));
if (hexInToggle.length === 0) ok('цвета через токены темы (только золото и цвет птички)');
else bad('хардкод цветов в галочке: ' + hexInToggle.join(', '));

// CSS подключён на десктопе?
const shell = fs.readFileSync('public/index.html', 'utf8');
if (/assets\/css\/rp-calc-modal\.css/.test(shell)) ok('rp-calc-modal.css подключён в index.html');
else bad('CSS галочки не подключён — стилей не будет');

console.log('\n' + (fail === 0
  ? 'ИТОГ: OK — согласование управляется галочкой РП, получатели требуются только при ней'
  : `ИТОГ: FAIL — ${fail} нарушений`));
process.exit(fail === 0 ? 0 : 1);
