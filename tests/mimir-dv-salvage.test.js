'use strict';
/** Проверка спасения частичного JSON-ответа модели. */
const assert = require('assert');
const s = require('../src/services/mimir-tender-stages-ai');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

check('полный JSON парсится обычным путём', () => {
  const r = s.safeJson('{"decision_recommend":"go","positions":[{"name":"A"}]}');
  assert.strictEqual(r._salvaged, undefined);
  assert.strictEqual(r.positions.length, 1);
});

check('обрезанный JSON: спасаются целые позиции', () => {
  const partial = '{"decision_recommend":"go","positions":[' +
    '{"name":"Позиция 1","volume":2,"unit":"м³"},' +
    '{"name":"Позиция 2","volume":5,"unit":"м²"},' +
    '{"name":"Оборванная","volume":';
  const r = s.safeJson(partial);
  assert.ok(r, 'должен вернуть хоть что-то');
  assert.strictEqual(r._salvaged, true);
  assert.strictEqual(r.positions.length, 2);
  assert.strictEqual(r.decision_recommend, 'go');
});

check('обрезанный JSON без позиций — null', () => {
  assert.strictEqual(s.safeJson('{"decision_recommend":"go","positions":['), null);
});

check('текст без JSON — null', () => {
  assert.strictEqual(s.safeJson('просто текст'), null);
});

check('JSON в ```json блоке', () => {
  const r = s.safeJson('```json\n{"positions":[{"name":"X"}]}\n```');
  assert.strictEqual(r.positions.length, 1);
});

check('спасение не ломается на кавычках внутри строк', () => {
  const partial = '{"positions":[{"name":"Котёл \\"К-1\\"","volume":2},{"name":"второй"';
  const r = s.safeJson(partial);
  assert.ok(r && r.positions.length === 1);
  assert.ok(r.positions[0].name.includes('К-1'));
});

check('обрезанный JSON: суть и риски не теряются', () => {
  // Модель пишет summary/risks ДО positions, поэтому при обрыве они в тексте
  // уже есть. Раньше спасатель их выбрасывал — карточка была пустой
  // при живых позициях (прод 06.11).
  const partial = '{"decision_recommend":"go",' +
    '"summary":"Два бункера по 875 м³, снимаем отбойным молотком.",' +
    '"volume_summary":"1750 м³",' +
    '"feasibility":"conditional",' +
    '"feasibility_note":"нужен наряд-допуск",' +
    '"risks":"Работа внутри аппарата",' +
    '"positions":[{"name":"Бункер 1","volume":875,"unit":"м³"},{"name":"обор'; 
  const r = s.safeJson(partial);
  assert.ok(r && r._salvaged, 'должен быть спасён');
  assert.ok(String(r.summary).includes('875'), 'суть потеряна: ' + r.summary);
  assert.strictEqual(r.volume_summary, '1750 м³');
  assert.strictEqual(r.feasibility, 'conditional');
  assert.strictEqual(r.feasibility_note, 'нужен наряд-допуск');
  assert.ok(String(r.risks).includes('внутри'), 'риски потеряны');
  assert.strictEqual(r.positions.length, 1);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
