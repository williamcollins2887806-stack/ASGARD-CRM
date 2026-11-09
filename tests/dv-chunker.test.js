'use strict';

/**
 * Тесты нарезки большой ведомости на порции.
 *
 * ── Зачем ──────────────────────────────────────────────────────────────────
 * На ведомости в 673 строки модель отдавала от 1 до 353 позиций: ответ не
 * влезал в лимит токенов и обрывался в случайном месте. Нарезка по
 * естественным границам (цех, раздел) делает каждый ответ коротким, а
 * склейка даёт полный список.
 */

const assert = require('assert');
const path = require('path');

const chunker = require(path.join(__dirname, '..', 'src', 'services', 'dv-chunker.js'));

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

/** Строит текст ведомости. */
function vor(sections, rowsPerSection) {
  const lines = [];
  for (let s = 0; s < sections; s += 1) {
    lines.push('Цех ' + (s + 1));
    for (let k = 1; k <= rowsPerSection; k += 1) {
      lines.push('| ' + k + ' | Очистка оборудования ' + k + ' | м3 | ' + (10 + k) + ' |');
    }
  }
  return lines.join('\n');
}

// ── 1. Малый документ не режется ───────────────────────────────────────────
check('короткий текст — одна порция', () => {
  const t = 'Наименование | Объём\nОчистка | 10\n';
  const chunks = chunker.chunkText(t);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].index, 0);
  assert.ok(chunks[0].text === t, 'текст изменён');
});

check('пустой текст — ноль порций', () => {
  assert.deepStrictEqual(chunker.chunkText(''), []);
  assert.deepStrictEqual(chunker.chunkText(null), []);
  assert.deepStrictEqual(chunker.chunkText('   '), []);
});

// ── 2. Нарезка по разделам ─────────────────────────────────────────────────
check('режет по цехам, сохраняя их как заголовки порций', () => {
  const chunks = chunker.chunkText(vor(3, 80));
  assert.strictEqual(chunks.length, 3, 'порций: ' + chunks.length);
  assert.ok(chunks[0].title.includes('Цех 1'), 'нет заголовка первого цеха');
  assert.ok(chunks[2].title.includes('Цех 3'), 'нет заголовка третьего цеха');
});

check('порции покрывают ВСЕ строки без пропусков', () => {
  // Главная гарантия: ни одна строка не теряется между порциями.
  const text = vor(4, 60);
  const allLines = text.split('\n');
  const chunks = chunker.chunkText(text);
  const covered = new Set();
  for (const c of chunks) {
    for (let n = c.fromLine; n <= c.toLine; n += 1) covered.add(n);
  }
  assert.strictEqual(covered.size, allLines.length,
    'покрыто ' + covered.size + ' из ' + allLines.length + ' строк');
});

check('порции идут подряд, без пересечений', () => {
  const chunks = chunker.chunkText(vor(3, 80));
  for (let i = 1; i < chunks.length; i += 1) {
    assert.strictEqual(chunks[i].fromLine, chunks[i - 1].toLine + 1,
      'разрыв между порциями ' + (i - 1) + ' и ' + i);
  }
});

// ── 3. Огромный раздел режется по строкам ──────────────────────────────────
check('раздел больше лимита режется на части', () => {
  const lines = ['Раздел 1'];
  for (let k = 1; k <= 500; k += 1) lines.push('| ' + k + ' | Работа ' + k + ' | м3 | 10 |');
  const chunks = chunker.chunkText(lines.join('\n'), { maxLines: 100 });
  assert.ok(chunks.length >= 5, 'порций: ' + chunks.length);
  for (const c of chunks) {
    assert.ok(c.toLine - c.fromLine + 1 <= 100, 'порция больше лимита: ' + (c.toLine - c.fromLine + 1));
  }
});

// ── 4. Без заголовков ──────────────────────────────────────────────────────
check('без заголовков режет по числу строк', () => {
  const lines = [];
  for (let k = 1; k <= 400; k += 1) lines.push('| ' + k + ' | Работа ' + k + ' | м3 | 10 |');
  const chunks = chunker.chunkText(lines.join('\n'), { maxLines: 200 });
  assert.strictEqual(chunks.length, 2, 'порций: ' + chunks.length);
});

// ── 5. Распознавание заголовков ────────────────────────────────────────────
check('заголовки разделов распознаются в разных формулировках', () => {
  for (const line of ['Цех 3', '1. Цех 2', 'Раздел 4', 'Отделение А', 'Участок 2', 'Приложение 1']) {
    assert.strictEqual(chunker.isSectionLine(line), true, 'не распознан: ' + line);
  }
});

check('строки данных не считаются заголовками', () => {
  for (const line of [
    '| 1 | Очистка цеха 3 | м3 | 340 |',
    'Эстакада 5 — гидрочистка, 12 м3',
    'Промывка котла К-1, объём 2 м3, 2026 год'
  ]) {
    assert.strictEqual(chunker.isSectionLine(line), false, 'ложно распознан: ' + line);
  }
});

// ── 6. Склейка ─────────────────────────────────────────────────────────────
check('склейка убирает повторы на стыке порций', () => {
  const merged = chunker.mergeChunkPositions([
    [{ name: 'Очистка', volume: 10, unit: 'м3' }, { name: 'Промывка', volume: 5, unit: 'м3' }],
    [{ name: 'Промывка', volume: 5, unit: 'м3' }, { name: 'Замена', volume: 3, unit: 'шт' }]
  ]);
  assert.strictEqual(merged.length, 3, 'позиций после склейки: ' + merged.length);
});

check('склейка сохраняет разные позиции с похожими названиями', () => {
  const merged = chunker.mergeChunkPositions([
    [{ name: 'Очистка', volume: 10, unit: 'м3' }],
    [{ name: 'Очистка', volume: 20, unit: 'м3' }]
  ]);
  assert.strictEqual(merged.length, 2, 'разные объёмы схлопнуты');
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
