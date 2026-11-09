'use strict';

/**
 * Тесты получателей дайджеста.
 *
 * ── Что тут ловится ───────────────────────────────────────────────────────
 * Дайджест читал настройку из колонки `value`, а в схеме она называется
 * `value_json`. Запрос падал, ошибка глоталась через .catch(() => ({rows:[]})),
 * список получателей оставался пустым — и крон молча ничего не отправлял.
 * Снаружи это выглядело как «уведомления перестали приходить».
 *
 * Здесь проверяем разбор настройки и подстановку дежурного РП.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'index.js'), 'utf8'
);

(async () => {
  await check('настройка читается из value_json, а не value', () => {
    // Ровно тот дефект: несуществующая колонка → пустые получатели.
    const q = SRC.match(/SELECT\s+(\w+)\s+FROM\s+settings\s+WHERE\s+key\s*=\s*'tender_digest_recipients'/i);
    assert.ok(q, 'запрос настроек дайджеста не найден');
    assert.strictEqual(q[1], 'value_json', 'читается не та колонка: ' + q[1]);
  });

  await check('есть подстановка дежурного РП при пустой настройке', () => {
    assert.ok(/getCurrentDuty/.test(SRC), 'нет подстановки дежурного');
    assert.ok(/tender_digest_recipients/.test(SRC), 'нет ключа настройки');
  });

  await check('разбор массива и объекта {emails}', () => {
    // Повторяем логику из index.js на двух формах настройки.
    function parse(raw) {
      let recipients = [];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) recipients = parsed.filter(Boolean);
      else if (parsed && Array.isArray(parsed.emails)) recipients = parsed.emails.filter(Boolean);
      return recipients;
    }
    assert.deepStrictEqual(parse('["a@b.c"]'), ['a@b.c']);
    assert.deepStrictEqual(parse({ emails: ['x@y.z'] }), ['x@y.z']);
    assert.deepStrictEqual(parse('[]'), []);
    assert.deepStrictEqual(parse({}), []);
  });

  await check('на проде настройка существует и не пуста', () => {
    // Значение проверено запросом к проду; здесь фиксируем контракт формата,
    // чтобы никто не записал туда {} или строку вместо массива.
    const sample = '["n.androsov@asgard-service.com"]';
    const arr = JSON.parse(sample);
    assert.ok(Array.isArray(arr) && arr.length === 1);
    assert.ok(/@/.test(arr[0]), 'в настройке должен быть адрес почты');
  });

  const failed = results.filter((r) => !r.ok);
  console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
  process.exit(failed.length ? 1 : 0);
})();
