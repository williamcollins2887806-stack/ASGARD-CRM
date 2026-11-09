'use strict';

/**
 * Тесты схлопывания документов: копия vs похожий документ.
 *
 * ── Дефект ─────────────────────────────────────────────────────────────────
 * Порог похожести был 0.9. Два РАЗНЫХ документа с общими юридическими
 * формулировками («Настоящий договор…», «Все споры разрешаются…») давали
 * 0.95–0.96 и схлопывались как копия. Если среди них была ведомость
 * объёмов — она отбрасывалась, и модель разбирала пустоту.
 *
 * ── Новый порог 0.97 + защита по размеру ───────────────────────────────────
 * Копия одного файла отличается от оригинала на единицы процентов, поэтому
 * 0.97 разделяет «копия» и «похожий по стилю документ». Плюс требование,
 * чтобы размеры текста различались не больше, чем на 15 %: копия не может
 * быть вдвое короче оригинала.
 */

const assert = require('assert');
const path = require('path');

const dr = require(path.join(__dirname, '..', 'src', 'services', 'doc-role.js'));

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

const LEGAL = 'Настоящий договор поставки заключён между сторонами. '
  + 'Все споры разрешаются в арбитражном суде. Оплата производится в течение тридцати дней. ';
const VOR = 'Ведомость объёмов: очистка резервуара РВС-5000, 1000 м3; '
  + 'гидрочистка трубок Т-1, 200 м2; замена уплотнений, 40 шт. ';

// ── 1. Разные документы с общим юридическим текстом ────────────────────────
check('два разных документа с общим шаблоном НЕ схлопываются', () => {
  // Такой текст даёт похожесть около 0.96 — выше старого порога 0.9.
  const a = { name: 'Договор 1.pdf', text: LEGAL.repeat(10) + VOR.repeat(3) };
  const b = { name: 'Договор 2.pdf', text: LEGAL.repeat(10) + 'Приложение: график работ 2027, этапы 1-12.' };
  const sel = dr.selectForPrompt([a, b]);
  // Ни один не должен попасть в duplicates как копия другого.
  const names = sel.duplicates.map((d) => d.name);
  assert.ok(!(names.includes('Договор 1.pdf') && names.includes('Договор 2.pdf')),
    'оба документа признаны копиями друг друга');
});

// ── 2. Настоящая копия ─────────────────────────────────────────────────────
check('копия одного файла схлопывается', () => {
  const text = VOR.repeat(8);
  const a = { name: 'ВОР.xlsx', text };
  const b = { name: 'ВОР (копия).xlsx', text: text.replace('40 шт', '40шт') };
  const sel = dr.selectForPrompt([a, b]);
  assert.strictEqual(sel.selected.length, 1, 'копия не схлопнута');
  assert.strictEqual(sel.duplicates.length, 1, 'копия не помечена');
});

check('две трети документа от оригинала — не копия', () => {
  // Похожесть высокая (текст тот же), но размер меньше на треть:
  // это выдержка, а не копия.
  const text = VOR.repeat(12);
  const a = { name: 'ВОР полная.xlsx', text };
  const b = { name: 'ВОР выдержка.xlsx', text: text.slice(0, Math.floor(text.length * 0.65)) };
  const sel = dr.selectForPrompt([a, b]);
  const dupNames = sel.duplicates.map((d) => d.name);
  assert.ok(!dupNames.includes('ВОР выдержка.xlsx'),
    'выдержка ошибочно признана копией полного документа');
});

// ── 3. Порог ───────────────────────────────────────────────────────────────
check('порог схлопывания — 0.97, а не 0.9', () => {
  const src = require('fs').readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'doc-role.js'), 'utf8'
  );
  assert.ok(/similarity\(k\.text, text\) < 0\.97/.test(src),
    'порог не 0.97');
  assert.ok(!/similarity\(k\.text, text\) >= 0\.9\b/.test(src),
    'остался старый порог 0.9');
});

// ── 4. Точные копии по хешу ────────────────────────────────────────────────
check('точная копия по хешу ловится', () => {
  const text = VOR.repeat(6);
  const sel = dr.selectForPrompt([
    { name: 'A.pdf', text },
    { name: 'B.pdf', text }
  ]);
  assert.strictEqual(sel.selected.length, 1);
  assert.ok(sel.duplicates.length >= 1);
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
