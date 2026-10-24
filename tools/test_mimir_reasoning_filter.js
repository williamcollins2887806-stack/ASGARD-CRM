#!/usr/bin/env node
/**
 * test_mimir_reasoning_filter.js — D-310: поток рассуждений не должен рваться.
 *
 * Дефект (замечен 22.10.2026): фильтр русского языка решал по ОДНОМУ чанку.
 * Модель шлёт по 1–3 слова, и чанк без кириллицы («12 м²», «ГОСТ», «1 234 567»)
 * отбрасывался — живой поток в модалке шёл с дырами.
 *
 * Проверяем фактическое поведение функции из продакшн-модуля, а не копию:
 *   R1 русская речь с числами/аббревиатурами проходит целиком (0 пропусков);
 *   R2 чисто английский поток скрывается (директор не видит английский);
 *   R3 смешанный чанк «английский хвост» после русской речи — скрывается;
 *   R4 пустые чанки не выводятся;
 *   R5 чистая пунктуация/цифры выводятся (это часть сметы).
 *
 * Usage: node tools/test_mimir_reasoning_filter.js
 */
'use strict';

const path = require('path');
const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };

// Достаём приватную функцию из модуля через rewire-подобный приём: модуль не
// экспортирует её, поэтому читаем исходник и исполняем ТОЛЬКО функцию (без
// побочных эффектов загрузки всего сервиса и его зависимостей).
const fs = require('fs');
const SRC = path.join(__dirname, '..', 'src', 'services', 'mimir-auto-estimate.js');
const source = fs.readFileSync(SRC, 'utf8');
const start = source.indexOf('function _isRussianReasoning(');
if (start < 0) {
  console.error(C.red + 'В mimir-auto-estimate.js нет _isRussianReasoning — проверка невозможна.' + C.off);
  process.exit(1);
}
const endMarker = '\n}\n';
const end = source.indexOf(endMarker, start);
if (end < 0) {
  console.error(C.red + 'Не найден конец функции _isRussianReasoning.' + C.off);
  process.exit(1);
}
const fnSrc = source.slice(start, end + 2);
// eslint-disable-next-line no-new-func
const isRu = new Function(fnSrc + '\nreturn _isRussianReasoning;')();

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + detail + C.off : ''}`);
}

// R1: реальная русская речь с числами и аббревиатурами — ни одного пропуска.
const RUS = ['Проверяю ', 'ТЗ и ', 'спецификацию: ', 'объём ', '12 м² ', 'кровли, ',
  'ГОСТ ', '21.1101-2013. ', 'Сумма ', '1 234 567 ', 'рублей ', 'без НДС.'];
let win = '';
const shown = RUS.map((c) => {
  const ok = isRu(c, win);
  win += c;
  return { c, ok };
});
const missed = shown.filter((s) => !s.ok);
check('R1 русский поток с числами и ГОСТ проходит целиком (0 пропусков)',
  missed.length === 0,
  missed.length ? 'пропущено: ' + JSON.stringify(missed.map((m) => m.c)) : `${shown.length}/${shown.length} чанков показано`);

// R2: чисто английская речь скрывается.
const ENG = ['Let me ', 'analyze ', 'the ', 'specification ', 'carefully ', 'and then build the estimate'];
let winEn = '';
const engShown = ENG.filter((c) => {
  const ok = isRu(c, winEn);
  winEn += c;
  return ok;
});
check('R2 английский поток скрыт (не протекает в UI)', engShown.length === 0,
  engShown.length ? 'протекло: ' + JSON.stringify(engShown) : `${ENG.length}/${ENG.length} скрыто`);

// R3: английский хвост после русской речи — скрывается.
const tail = ' now thinking in English about budget and tokens';
check('R3 длинный английский хвост после русского скрыт',
  isRu(tail, 'Проверяю смету и объёмы по ГОСТ ') === false, JSON.stringify(tail));

// R6: после англоязычного отрывка русская речь возвращается сразу (не «глохнет»).
const afterEn = ['Уточняю ', 'логистику. ', 'Добавляю ', '5 %.'];
let winMix = '';
const enChunk = 'Let me analyze the specification carefully and then build the estimate for the whole scope of works';
const enShown = isRu(enChunk, winMix);
winMix += enChunk;
const resumed = afterEn.map((c) => {
  const ok = isRu(c, winMix);
  winMix += c;
  return { c, ok };
});
const lost = resumed.filter((r) => !r.ok);
check('R6 после английского отрывка русская речь не глохнет',
  enShown === false && lost.length === 0,
  lost.length ? 'потеряно: ' + JSON.stringify(lost.map((l) => l.c)) : `${resumed.length}/${resumed.length} русских чанков показано`);

// R4: пустые чанки не выводятся.
check('R4 пустой чанк не выводится',
  isRu('', '') === false && isRu('   ', 'текст') === false, 'оба варианта false');

// R5: цифры и пунктуация — часть сметы, показываем.
check('R5 цифры/пунктуация показываются (это часть расчёта)',
  isRu('1 234 567 ', 'Сумма ') === true && isRu(' — ', 'итого ') === true,
  'числа и тире проходят');

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length) {
  console.log(C.red + `ИТОГ: FAIL — ${failed.length} из ${results.length}` + C.off);
  process.exit(1);
}
console.log(C.green + `ИТОГ: OK — ${results.length}/${results.length} проверок (реальная функция из src/services/mimir-auto-estimate.js)` + C.off);
process.exit(0);
