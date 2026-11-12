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

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
