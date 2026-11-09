'use strict';

/**
 * Очистка названий от эмодзи (правило «только русский текст»).
 *
 * ── Зачем ─────────────────────────────────────────────────────────────────
 * Парсеры внешних площадок приносили название вместе с украшением:
 * «🌐 АО "СЕГЕЖСКИЙ ЦБК"». Эмодзи доезжали до карточек, писем и ТКП, где
 * допустим только русский текст. На проде нашлось 2 таких тендера.
 */

const assert = require('assert');
const path = require('path');

const { cleanName, hasEmoji } = require(path.join(__dirname, '..', 'src', 'lib', 'clean-name.js'));

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + ' — ' + e.message); }
}

check('эмодзи в начале названия убирается', () => {
  assert.strictEqual(cleanName('\u{1F310} АО "СЕГЕЖСКИЙ ЦБК"'), 'АО "СЕГЕЖСКИЙ ЦБК"');
});

check('эмодзи в середине и в конце убирается', () => {
  assert.strictEqual(cleanName('Тендер \u{1F525} дня \u{1F680}'), 'Тендер дня');
});

check('невидимые символы убираются', () => {
  // zero-width space и BOM ломают сравнение названий и дедупликацию.
  assert.strictEqual(cleanName('ООО\u200B Ромашка\uFEFF'), 'ООО Ромашка');
});

check('обычное название не меняется', () => {
  assert.strictEqual(cleanName('ООО «АСГАРД-Сервис»'), 'ООО «АСГАРД-Сервис»');
});

check('идемпотентность: повторная чистка не портит', () => {
  const once = cleanName('\u{1F310} ООО "АИМ МЕНЕДЖМЕНТ"');
  assert.strictEqual(cleanName(once), once);
});

check('hasEmoji различает наличие', () => {
  assert.strictEqual(hasEmoji('\u{1F310} АО ЦБК'), true);
  assert.strictEqual(hasEmoji('АО ЦБК'), false);
});

check('пустые значения безопасны', () => {
  assert.strictEqual(cleanName(null), '');
  assert.strictEqual(cleanName(undefined), '');
  assert.strictEqual(cleanName(''), '');
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
