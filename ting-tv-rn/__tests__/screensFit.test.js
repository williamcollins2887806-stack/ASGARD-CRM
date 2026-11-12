'use strict';

/**
 * D-409: экран входа наезжал сам на себя и не влезал в ТВ; с экрана замера
 * скорости нельзя было выйти пультом.
 *
 * Причина 1: на Android TV 1920x1080 при плотности 2.0 — это 960x540 dp.
 * Карточка фиксированной высоты с полем, подсказкой, кнопкой и двумя блоками
 * не влезала в 540 dp: элементы перекрывали друг друга.
 *
 * Причина 2: «Назад к вводу кода» был <Text onPress>. Пульт по Text не ходит —
 * элемента нет в фокус-цепочке, выйти с экрана было нечем.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('TV: вход и замер скорости влезают и управляются пультом (D-409)', () => {
  const join = read('src/JoinScreen.js');
  const speed = read('src/SpeedScreen.js');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('экран входа прокручивается (страховка при нехватке высоты)', () => {
    assert.ok(/ScrollView/.test(strip(join)), 'нет ScrollView');
    assert.ok(/contentContainerStyle/.test(join), 'ScrollView не настроен');
  });

  it('экран входа считает ширину от экрана', () => {
    assert.ok(/useWindowDimensions/.test(join), 'нет useWindowDimensions');
    assert.ok(/cardWidth/.test(join), 'нет расчёта ширины');
    assert.ok(!/width:\s*1080/.test(strip(join)), 'остался фиксированный width: 1080');
  });

  it('компактный режим ужимает отступы и размеры', () => {
    for (const key of ['cardCompact', 'h1Compact', 'leadCompact', 'inputCompact', 'ctaCompact']) {
      assert.ok(join.includes(key), `нет стиля ${key}`);
    }
  });

  it('подсказка не занимает пол-экрана в компактном режиме', () => {
    assert.ok(/tipInline/.test(join), 'нет строки-подсказки вместо блока');
    assert.ok(/!compact \?/.test(join), 'блок подсказки не скрывается в компактном режиме');
  });

  it('экран замера прокручивается и считает ширину', () => {
    const code = strip(speed);
    assert.ok(/ScrollView/.test(code), 'нет ScrollView');
    assert.ok(/useWindowDimensions/.test(code), 'нет useWindowDimensions');
    assert.ok(!/width:\s*920/.test(code), 'остался фиксированный width: 920');
  });

  it('«Назад» — focusable кнопка, а не Text', () => {
    const code = strip(speed);
    assert.ok(!/<Text[^>]*onPress=\{[^}]*onBack/.test(code), '«Назад» всё ещё Text с onPress');
    const back = code.slice(code.indexOf('backBtn'));
    assert.ok(/Pressable/.test(code.slice(code.indexOf('Назад к вводу кода') - 1200,
      code.indexOf('Назад к вводу кода'))), '«Назад» должен быть Pressable');
    assert.ok(/focusable/.test(code.slice(
      Math.max(0, code.indexOf('onBack && onBack()') - 600),
      code.indexOf('onBack && onBack()'),
    )), '«Назад» должен быть focusable');
    assert.ok(/backFocused/.test(back) || /backBtnFocused/.test(code), 'нет индикации фокуса');
  });
});
