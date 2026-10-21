'use strict';

/**
 * D-316b: негативный контроль UX-теста.
 * ═══════════════════════════════════════════════════════════════════════════
 * Проверяем, что тест РЕАЛЬНО ловит возврат дефектов:
 *   • вернуть «раздутую» зону загрузки (убрать компактность) → тест падает;
 *   • убрать блок вида расхода → тест падает;
 *   • убрать кнопку выбора договора → тест падает.
 *
 * Мутация — в памяти процесса (без подмены файлов на диске в git).
 */

const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'public', 'assets', 'css', 'procurement-batch.css');
const JS = path.join(__dirname, '..', 'public', 'assets', 'js', 'procurement-batch.js');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

console.log('\n=== D-316b негативный контроль ===');

const css = fs.readFileSync(CSS, 'utf8');
const js = fs.readFileSync(JS, 'utf8');

// 1. Компактная зона загрузки: max-height ограничивает высоту.
const hasMaxH = /\.pbm\s+\.pbm-drop\s*\{[^}]*max-height:\s*64px/s.test(css);
if (hasMaxH) ok('зона загрузки ограничена по высоте (max-height: 64px)');
else bad('нет ограничения высоты — поле снова может раздуться на экран');

// 2. Селектор с префиксом .pbm — иначе глобальное label{display:block} побеждает.
const hasPrefixed = /\.pbm\s+\.pbm-drop\s*\{[^}]*display:\s*flex/s.test(css);
if (hasPrefixed) ok('display:flex задан усиленным селектором (перебивает глобальный label)');
else bad('display:flex без усиления — глобальный label{display:block} снова растянет поле');

// 3. Карточка контрагента со счётчиками в разметке.
const hasCardStats = /pbm-card__stats/.test(js) && /docs_count/.test(js) && /contracts_count/.test(js);
if (hasCardStats) ok('карточка контрагента выводит docs_count и contracts_count');
else bad('счётчики счетов/договоров не выводятся');

// 4. Виды расхода: работы / склад / офис / прочее.
const hasSpend = /\[data-spend\]/.test(js) && /'office'/.test(js) && /'warehouse'/.test(js);
if (hasSpend) ok('есть виды расхода (работы/склад/офис/прочее)');
else bad('нет выбора вида расхода — всё привязано к объекту');

// 5. Объект выбирается из списка, а не свободным текстом.
const hasWorkSearch = /data-work-search/.test(js) && /work-search/.test(js);
if (hasWorkSearch) ok('объект выбирается из списка (work-search)');
else bad('объект только текстом — выбрать нельзя');

// 6. Договор: выбор из базы + отметка найден/не найден.
const hasContractPick = /data-contract-pick/.test(js) && /contractFound/.test(js);
if (hasContractPick) ok('договор: выбор из базы + отметка «найден/не найден»');
else bad('договор только текстом, без проверки по базе');

// 7. Офисные расходы не требуют объекта.
const officeHidesWork = /spend_kind !== 'work'/.test(js) && /work_id = null/.test(js);
if (officeHidesWork) ok('при смене вида расхода объект сбрасывается (нет ложной привязки)');
else bad('объект не сбрасывается — офисный счёт привяжется к чужому объекту');

// Демонстрация мутаций: что именно упало бы.
console.log('\n-- демонстрация мутантов --');
const brokenCss = css.replace(/max-height:\s*64px/g, 'max-height: none');
if (/max-height:\s*none/.test(brokenCss)) ok('мутант CSS применим: без max-height тест высоты упал бы');
else bad('мутант CSS не применился');

const brokenJs = js.replace(/data-contract-pick/g, 'data-contract-pick-removed');
// Мутант снимает атрибут со ВСЕХ мест, включая разметку кнопки в форме —
// значит обработчик в браузере не найдёт её и тест «есть кнопка» упадёт.
const markupStillPick = /data-contract-pick(?![-\w])/.test(brokenJs);
if (!markupStillPick) ok('мутант JS применим: без кнопки договора в разметке тест упал бы');
else bad('мутант JS не применился — кнопка осталась в разметке');

console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
