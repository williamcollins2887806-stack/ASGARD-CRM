#!/usr/bin/env node
'use strict';
/**
 * mimir-stages.test.js — unit-тесты этапов Мимира (без БД).
 *
 * Покрывает то, на чём легче всего сломаться:
 *   • переходы (вперёд/назад/запрещённые);
 *   • preflight (нет ТЗ, нет объёмов, всё есть);
 *   • ДВ: неизвестный метод → needs_classification, а не выдуманный код;
 *   • технология: нельзя завершить без tech_equip;
 *   • план: параллельные группы считаются максимумом, не суммой;
 *   • окно дат.
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'unit-test-no-connection';
const assert = require('assert');
const st = require('../src/services/mimir-tender-stages');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// ── Переходы ────────────────────────────────────────────────────────────────
check('переход вперёд разрешён', () => {
  assert.strictEqual(st.canTransition('intake', 'read'), true);
  assert.strictEqual(st.canTransition('dv', 'tech'), true);
  assert.strictEqual(st.canTransition('tech', 'decision'), true);
});

check('переход назад на пройденный этап разрешён', () => {
  assert.strictEqual(st.canTransition('tech', 'dv'), true);
  assert.strictEqual(st.canTransition('calc_smeta', 'calc_plan'), true);
});

check('из done в просчёт — только отдельным запуском', () => {
  assert.strictEqual(st.canTransition('done', 'calc_plan'), true);
  assert.strictEqual(st.canTransition('done', 'dv'), false);
});

check('анализ и просчёт — разные конвейеры: из анализа в план не попасть', () => {
  assert.strictEqual(st.canTransition('decision', 'calc_plan'), false);
  assert.strictEqual(st.canTransition('calc_plan', 'decision'), false);
});

check('анализ закрывается решением, а не сметой', () => {
  assert.strictEqual(st.canTransition('decision', 'done'), true);
  assert.strictEqual(st.canTransition('decision', 'calc_smeta'), false);
});

check('переход через этап вперёд запрещён', () => {
  assert.strictEqual(st.canTransition('read', 'decision'), false);
  assert.strictEqual(st.canTransition('read', 'tech'), false);
});

check('intake → dv разрешён (анализ сразу даёт ведомость)', () => {
  assert.strictEqual(st.canTransition('intake', 'dv'), true);
  assert.strictEqual(st.canTransition('intake', 'clarify'), true);
});

check('вопросы для звонка: без объёма и метода — конкретные вопросы', () => {
  const q = st.callQuestionsFromDv({
    positions: [{ name: 'Промывка котла', volume: null, unit: 'м³', needs_classification: false }]
  }, {});
  assert.ok(q.length >= 3);
  assert.ok(q.some((x) => /объ[её]м/i.test(x)), q.join(' | '));
  assert.ok(q.some((x) => /загрязнен/i.test(x)), q.join(' | '));
});

check('вопросы для звонка: всегда про допуск и воду', () => {
  const q = st.callQuestionsFromDv({ positions: [] }, { start_date: '2026-01-01', end_date: '2026-01-02' });
  assert.ok(q.some((x) => /наряд-допуск/i.test(x)));
  assert.ok(q.some((x) => /воду|электроэнерг/i.test(x)));
});

check('контакт из ТЗ: телефон, имя, окно звонка', () => {
  const c = st.extractContact('Контактное лицо: Главный инженер Петров Пётр, тел +7 (900) 123-45-67, звонить с 9 до 18');
  assert.ok(/\+7/.test(c.phone));
  assert.ok(/Петров/.test(c.name));
  assert.ok(/звонить/i.test(c.window));
});

check('контакт из ТЗ: нет телефона — честный null', () => {
  const c = st.extractContact('Работы по ТЗ, исполнитель определяется');
  assert.strictEqual(c.phone, null);
});

check('из nogo выхода нет', () => {
  assert.strictEqual(st.canTransition('nogo', 'dv'), false);
  assert.strictEqual(st.canTransition('nogo', 'calc_plan'), false);
});

check('неизвестный этап отвергается', () => {
  assert.strictEqual(st.canTransition('intake', 'foobar'), false);
  assert.strictEqual(st.isStage('foobar'), false);
});

// ── Preflight ───────────────────────────────────────────────────────────────
check('preflight: нет ТЗ и документов — блокирующий пробел', () => {
  const r = st.preflight({});
  assert.ok(r.gaps.some((g) => g.id === 'tz' && g.blocking));
  assert.strictEqual(r.ok, false);
});

check('preflight: ТЗ есть, объёмов нет — блокирующий пробел volume', () => {
  const r = st.preflight({ tz_text: 'Промывка котла', inputs: {} });
  assert.ok(r.gaps.some((g) => g.id === 'volume' && g.blocking));
});

check('preflight: объём есть — можно считать', () => {
  const r = st.preflight({
    tz_text: 'Промывка котла',
    inputs: { circuit_m3: 2, cycles: 2 },
    start_date: '2026-11-10', end_date: '2026-11-20',
    contact: 'Иван'
  });
  assert.strictEqual(r.blocking, 0);
  assert.strictEqual(r.ok, true);
});

check('preflight: скан без текста — неблокирующий пробел', () => {
  const r = st.preflight({
    tz_text: 'Работы по ТЗ',
    documents: [{ original_name: 'scan.pdf', text: '' }],
    inputs: { surface_m2: 10 }
  });
  assert.ok(r.gaps.some((g) => g.id === 'docs_text' && !g.blocking));
});

check('waiveGap: обязательный пробел нельзя пропустить', () => {
  const s = st.resolveGap({}, 'volume', {});
  const withGap = st.normalizeState({ gaps: [{ id: 'volume', label: 'Объём', blocking: true }] });
  assert.throws(() => st.waiveGap(withGap, 'volume'), /обязательный/);
});

check('waiveGap: необязательный можно пропустить', () => {
  const s = st.normalizeState({ gaps: [{ id: 'schedule', label: 'Сроки', blocking: false }] });
  const out = st.waiveGap(s, 'schedule');
  assert.strictEqual(out.gaps[0].waived, true);
});

// ── ДВ ──────────────────────────────────────────────────────────────────────
const catalog = {
  categories: [
    { code: 'boilers', methods_json: [{ code: 'chem' }, { code: 'mech' }] },
    { code: 'repair_weld', methods_json: [{ code: 'weld' }] }
  ]
};

check('ДВ: корректная позиция проходит', () => {
  const r = st.normalizeDv({
    positions: [{
      name: 'Промывка котла', category_code: 'boilers', method_code: 'chem',
      volume: 2, unit: 'м³', tech_equip: 'кислота + CIP'
    }]
  }, catalog);
  assert.strictEqual(r.positions.length, 1);
  assert.strictEqual(r.positions[0].needs_classification, false);
  assert.strictEqual(r.blocked, 0);
});

check('ДВ: неизвестный метод → needs_classification, код не выдуман', () => {
  const r = st.normalizeDv({
    positions: [{ name: 'Сварка', category_code: 'repair_weld', method_code: 'laser', volume: 10, unit: 'м' }]
  }, catalog);
  const p = r.positions[0];
  assert.strictEqual(p.method_code, 'laser');
  assert.strictEqual(p.needs_classification, true);
  assert.ok(p.problems.join(' ').includes('laser'));
});

check('ДВ: сварка без метода не превращается в мойку', () => {
  const r = st.normalizeDv({
    positions: [{ name: 'Сварка шва', category_code: 'repair_weld', volume: 12, unit: 'м' }]
  }, catalog);
  assert.strictEqual(r.positions[0].method_code, null);
  assert.strictEqual(r.positions[0].needs_classification, true);
});

check('ДВ: объём 0 → проблема', () => {
  const r = st.normalizeDv({
    positions: [{ name: 'X', category_code: 'boilers', method_code: 'chem', volume: 0, unit: 'м³' }]
  }, catalog);
  assert.ok(r.positions[0].problems.includes('объём не указан'));
});

check('ДВ: аппараты привязываются к позиции', () => {
  const r = st.normalizeDv({
    positions: [{ id: 'p1', name: 'Промывка', category_code: 'boilers', method_code: 'chem', volume: 2, unit: 'м³' }],
    objects: [{ position_id: 'p1', tag: 'К-1', type: 'котёл' }, { position_id: 'p1', tag: 'К-2' }]
  }, catalog);
  assert.strictEqual(r.positions[0].objects.length, 2);
});

check('ДВ: правка РП снимает блокировку и ставит tech_status=rp', () => {
  let s = st.normalizeDv({
    positions: [{ id: 'p1', name: 'Сварка', category_code: null, method_code: null, volume: 5, unit: 'м' }]
  }, catalog);
  s = st.applyPositionPatch({ positions: s.positions }, 'p1', {
    category_code: 'repair_weld', method_code: 'weld', tech_equip: 'инвертор 250А, электроды УОНИ'
  });
  assert.strictEqual(s.positions[0].needs_classification, false);
  assert.strictEqual(s.positions[0].tech_status, 'rp');
});

// ── Технология ──────────────────────────────────────────────────────────────
check('технология: без tech_equip завершить нельзя', () => {
  const r = st.canFinishTech({
    positions: [{ id: 'p1', name: 'X', category_code: 'boilers', volume: 1, unit: 'м³', tech_equip: null }]
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.blocked.length, 1);
});

check('технология: пустой список позиций — не готово', () => {
  assert.strictEqual(st.canFinishTech({ positions: [] }).ok, false);
});

check('технология: всё заполнено — готово', () => {
  const r = st.canFinishTech({
    positions: [{ id: 'p1', name: 'X', category_code: 'boilers', volume: 1, unit: 'м³', tech_equip: 'CIP' }]
  });
  assert.strictEqual(r.ok, true);
});

// ── План просчёта ───────────────────────────────────────────────────────────
check('план: параллельные группы считаются максимумом', () => {
  const p = st.normalizeCalcPlan({
    positions: [
      { id: 'a', people: 4, days: 2, parallel_group: '1', source: 'norm' },
      { id: 'b', people: 4, days: 3, parallel_group: '1', source: 'norm' },
      { id: 'c', people: 2, days: 1, parallel_group: '2', source: 'expert', explain: 'по практике' }
    ]
  });
  // группа 1 → max(2,3)=3, группа 2 → 1, итого 4 (а не 2+3+1=6)
  assert.strictEqual(p.work_days, 4);
  assert.strictEqual(p.groups.length, 2);
});

check('план: разные группы суммируются', () => {
  const p = st.normalizeCalcPlan({
    positions: [
      { people: 3, days: 2, parallel_group: '1', source: 'norm' },
      { people: 3, days: 2, parallel_group: '2', source: 'norm' }
    ]
  });
  assert.strictEqual(p.work_days, 4);
});

check('план: эксперт без обоснования — проблема', () => {
  const p = st.normalizeCalcPlan({
    positions: [{ people: 2, days: 1, source: 'expert' }]
  });
  assert.ok(p.positions[0].problems.some((x) => /обоснован/.test(x)));
  assert.ok(p.warnings.some((w) => /экспертная/.test(w)));
});

check('план: без людей или срока — проблема', () => {
  const p = st.normalizeCalcPlan({ positions: [{ days: 2, source: 'norm' }, { people: 3, source: 'norm' }] });
  assert.strictEqual(p.blocked, 2);
});

check('plan: man_hours считается по людям, суткам, сменам и часам', () => {
  const p = st.normalizeCalcPlan({
    positions: [{ people: 3, days: 2, shifts: 2, shift_hours: 12, source: 'norm' }]
  });
  assert.strictEqual(p.man_hours, 3 * 2 * 2 * 12);
});

// ── Окно дат ────────────────────────────────────────────────────────────────
check('окно дат: влезает', () => {
  const r = st.checkDateWindow({ work_days: 3, road_days: 1 }, 20);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.required, 4);
});

check('окно дат: не влезает — сообщение с числами', () => {
  const r = st.checkDateWindow({ work_days: 25, road_days: 2 }, 20);
  assert.strictEqual(r.ok, false);
  assert.ok(/НЕ влезает/.test(r.message), r.message);
});

check('окно дат: не задано — не блокируем', () => {
  const r = st.checkDateWindow({ work_days: 5 }, null);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.checked, false);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
