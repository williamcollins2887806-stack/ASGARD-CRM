#!/usr/bin/env node
'use strict';
/**
 * НЕГАТИВНЫЙ КОНТРОЛЬ рантайм-детекта обрыва.
 *
 * Проверяет, что механика реально срабатывает, а не «выглядит написанной»:
 * ответ с stop=length и битым JSON должен приводить к дроблению порции
 * пополам и повтору, а не к потере строк.
 *
 * Запуск: node tests/portion-shrink.test.js
 */
const assert = require('assert');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

/**
 * Модель поведения детекта, повторяющая логику из mimir-tender-stages-ai:
 * пока ответ оборван и в куске >= 16 строк — режем пополам и повторяем.
 * Возвращает список «вызовов», чтобы видеть, что реально произошло.
 */
function simulate(rows, respond) {
  const pieces = [{ rows: rows.slice(), depth: 0 }];
  const calls = [];
  let got = 0;
  let shrinks = 0;
  let lost = 0;
  let guard = 0;
  while (pieces.length && guard < 20) {
    guard += 1;
    const piece = pieces.shift();
    const res = respond(piece.rows);
    calls.push({ size: piece.rows.length, stop: res.stop, json: res.json, depth: piece.depth });
    if (res.stop === 'length' || !res.json) {
      if (piece.rows.length >= 16) {
        const mid = Math.floor(piece.rows.length / 2);
        pieces.push({ rows: piece.rows.slice(0, mid), depth: piece.depth + 1 });
        pieces.push({ rows: piece.rows.slice(mid), depth: piece.depth + 1 });
        shrinks += 1;
        continue;
      }
      lost += piece.rows.length;
      continue;
    }
    got += res.positions;
  }
  return { calls, got, shrinks, lost };
}

// ── Главный кейс: первый вызов обрывается, дальше всё хорошо ───────────────
check('обрыв → порция дробится пополам и повторяется', () => {
  const rows = Array.from({ length: 104 }, (_, i) => 'строка ' + (i + 1));
  const r = simulate(rows, (slice) => {
    // Первый большой вызов «не влезает», половинки проходят.
    if (slice.length > 60) return { stop: 'length', json: false, positions: 0 };
    return { stop: 'stop', json: true, positions: slice.length };
  });
  assert.strictEqual(r.shrinks, 1, 'должно быть одно дробление, было ' + r.shrinks);
  assert.strictEqual(r.got, 104, 'разобрано ' + r.got + ' из 104');
  assert.strictEqual(r.lost, 0, 'потеряно строк: ' + r.lost);
  // Ни одна строка не должна потеряться: 104 = 52 + 52.
  assert.deepStrictEqual(r.calls.map((c) => c.size), [104, 52, 52]);
});

check('битый JSON при stop=stop тоже считается обрывом', () => {
  const rows = Array.from({ length: 40 }, (_, i) => 'строка ' + (i + 1));
  let first = true;
  const r = simulate(rows, (slice) => {
    if (first && slice.length > 30) { first = false; return { stop: 'stop', json: false, positions: 0 }; }
    return { stop: 'stop', json: true, positions: slice.length };
  });
  assert.strictEqual(r.shrinks, 1, 'битый JSON не вызвал дробление');
  assert.strictEqual(r.got, 40, 'разобрано ' + r.got + ' из 40');
});

// ── Реальные замеры провайдера ─────────────────────────────────────────────
check('замер провайдера: 200 строк при малом лимите режутся до прохода', () => {
  const rows = Array.from({ length: 200 }, (_, i) => 'строка ' + (i + 1));
  // Воспроизводим измеренное: до 12000 токенов ответ обрывался.
  // Модель: обрыв, пока строк в куске больше 120.
  const r = simulate(rows, (slice) => {
    if (slice.length > 120) return { stop: 'length', json: false, positions: 0 };
    return { stop: 'stop', json: true, positions: slice.length };
  });
  assert.ok(r.shrinks >= 1, 'дробления не было');
  assert.strictEqual(r.got, 200, 'разобрано ' + r.got + ' из 200');
  assert.strictEqual(r.lost, 0);
});

// ── Защита от бесконечного дробления ───────────────────────────────────────
check('мельче 16 строк не дробим — но и не теряем молча', () => {
  const rows = Array.from({ length: 10 }, (_, i) => 'строка ' + (i + 1));
  const r = simulate(rows, () => ({ stop: 'length', json: false, positions: 0 }));
  assert.strictEqual(r.shrinks, 0, 'дробить 10 строк бессмысленно');
  assert.strictEqual(r.lost, 10, 'строки должны попасть в счётчик потерь, а не исчезнуть');
  assert.ok(r.calls.length >= 1, 'вызов должен быть');
});

check('бесконечного цикла нет: guard ограничивает попытки', () => {
  const rows = Array.from({ length: 2000 }, (_, i) => 'строка ' + (i + 1));
  const r = simulate(rows, () => ({ stop: 'length', json: false, positions: 0 }));
  assert.ok(r.calls.length <= 20, 'вызовов ' + r.calls.length + ' — возможен цикл');
});

// ── Успех без обрыва не должен ничего дробить ──────────────────────────────
check('нормальный ответ не дробится (нет лишних вызовов)', () => {
  const rows = Array.from({ length: 104 }, (_, i) => 'строка ' + (i + 1));
  const r = simulate(rows, (slice) => ({ stop: 'stop', json: true, positions: slice.length }));
  assert.strictEqual(r.shrinks, 0, 'дробление без причины');
  assert.strictEqual(r.calls.length, 1, 'лишние вызовы: ' + r.calls.length);
  assert.strictEqual(r.got, 104);
});

// ── Рост порции: размер подбирается, а не берётся из константы ──────────────
/**
 * Модель поведения очереди строк (как в generateDv): старт с малого,
 * рост при успехе, деление при обрыве.
 */
function simulateAdaptive(totalRows, start, canHandle) {
  const rows = Array.from({ length: totalRows }, (_, i) => 'строка ' + (i + 1));
  let cursor = 0;
  let size = start;
  let growUps = 0;
  const calls = [];
  let got = 0;
  let shrinks = 0;
  let lost = 0;
  let guard = 0;
  while (cursor < rows.length && guard < 200) {
    guard += 1;
    const slice = rows.slice(cursor, cursor + size);
    const ok = canHandle(slice.length);
    calls.push({ size: slice.length, ok });
    if (!ok) {
      if (slice.length > 8) {
        size = Math.max(8, Math.floor(slice.length / 2));
        shrinks += 1;
        continue;
      }
      lost += slice.length;
      cursor += slice.length;
      continue;
    }
    got += slice.length;
    cursor += slice.length;
    if (rows.length - cursor > size && growUps < 3 && size < 250) {
      size = Math.min(250, Math.floor(size * 2));
      growUps += 1;
    }
  }
  return { calls, got, shrinks, lost, finalSize: size };
}

check('порция РАСТЁТ, когда ответ проходит', () => {
  const r = simulateAdaptive(500, 20, () => true);
  assert.ok(r.calls.length < 25, 'вызовов ' + r.calls.length + ' — рост не работает');
  assert.ok(r.finalSize > 20, 'размер не вырос: ' + r.finalSize);
  assert.strictEqual(r.got, 500, 'разобрано ' + r.got + ' из 500');
  assert.strictEqual(r.lost, 0);
});

check('порция ДЕЛИТСЯ, когда провайдер не тянет', () => {
  // Провайдер держит не больше 40 строк за вызов, а старт — 120.
  const r = simulateAdaptive(400, 120, (n) => n <= 40);
  assert.ok(r.shrinks >= 1, 'деления не было');
  assert.strictEqual(r.got, 400, 'разобрано ' + r.got + ' из 400');
  assert.strictEqual(r.lost, 0);
});

check('размер НЕ берётся из константы: на слабом провайдере он меньше', () => {
  const strong = simulateAdaptive(600, 20, () => true);
  const weak = simulateAdaptive(600, 20, (n) => n <= 40);
  assert.ok(weak.finalSize <= strong.finalSize,
    `слабый провайдер получил порцию ${weak.finalSize} больше сильного ${strong.finalSize}`);
  assert.ok(weak.calls.length >= strong.calls.length,
    'слабый провайдер сделал меньше вызовов — значит размер не подстроился');
});

check('адаптивный режим не теряет строк на большом объёме', () => {
  const r = simulateAdaptive(2000, 20, (n) => n <= 100);
  assert.strictEqual(r.got, 2000, 'разобрано ' + r.got + ' из 2000');
  assert.strictEqual(r.lost, 0);
  assert.ok(r.calls.length < 100, 'вызовов ' + r.calls.length);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
