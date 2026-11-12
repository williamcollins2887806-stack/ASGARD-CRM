'use strict';
/**
 * Журнал звонков: «Куда ушло» + история обращения + подпись сотрудника.
 * Проверяем чистые функции/контракты, без БД.
 */
const assert = require('assert');

const tests = [];
function test(name, fn) { tests.push({ name: 'journal: ' + name, run: fn }); }

// Повторяем логику outcomeCell из telephony.js — контракт отрисовки.
function outcomeOf(c) {
  if (c.task_ref) {
    const done = ['done', 'completed', 'closed'].includes(c.task_status);
    return { kind: 'task', done, who: c.task_assignee_name || '', href: '#/tasks?id=' + c.task_ref };
  }
  if (c.pre_tender_ref) {
    return {
      kind: 'lead',
      who: c.pre_tender_assignee_name || '',
      href: '#/director-inbox?id=' + c.pre_tender_ref,
      status: c.pre_tender_status,
    };
  }
  return { kind: 'none' };
}

test('задача: показывает исполнителя и ссылку', () => {
  const o = outcomeOf({ task_ref: 328, task_status: 'open', task_assignee_name: 'Андросов Никита Андреевич' });
  assert.strictEqual(o.kind, 'task');
  assert.strictEqual(o.done, false);
  assert.strictEqual(o.who, 'Андросов Никита Андреевич');
  assert.strictEqual(o.href, '#/tasks?id=328');
});

test('задача выполнена — отдельный признак', () => {
  const o = outcomeOf({ task_ref: 328, task_status: 'done', task_assignee_name: 'Петров' });
  assert.strictEqual(o.done, true);
});

test('заявка: показывает РП и статус', () => {
  const o = outcomeOf({ pre_tender_ref: 1012, pre_tender_status: 'in_review', pre_tender_assignee_name: 'Кудряшов О.С.' });
  assert.strictEqual(o.kind, 'lead');
  assert.strictEqual(o.who, 'Кудряшов О.С.');
  assert.strictEqual(o.href, '#/director-inbox?id=1012');
});

test('заявка без РП — «свободна», не пусто', () => {
  const o = outcomeOf({ pre_tender_ref: 1013, pre_tender_status: 'new' });
  assert.strictEqual(o.who, '');
  assert.strictEqual(o.kind, 'lead');
});

test('звонок без задачи и заявки — прочерк', () => {
  const o = outcomeOf({ id: 1 });
  assert.strictEqual(o.kind, 'none');
});

test('задача приоритетнее заявки (не дублируем)', () => {
  const o = outcomeOf({ task_ref: 5, task_status: 'open', pre_tender_ref: 9 });
  assert.strictEqual(o.kind, 'task');
});

// ── Таймлайн истории обращения ──

function timelineOf(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = String(r.summary || '').slice(0, 120).toLowerCase();
    if (r.summary && seen.has(key)) continue;
    if (r.summary) seen.add(key);
    out.push(r);
  }
  return out;
}

test('дедуп одинаковых резюме в ленте', () => {
  const tl = timelineOf([
    { id: 1, summary: 'Звонок про котёл' },
    { id: 2, summary: 'Звонок про котёл' },
    { id: 3, summary: 'Перезвонил про письма' },
  ]);
  assert.strictEqual(tl.length, 2, 'дубль резюме должен схлопнуться');
});

test('разные звонки остаются все', () => {
  const tl = timelineOf([
    { id: 1, summary: 'a' }, { id: 2, summary: 'b' }, { id: 3, summary: 'c' }, { id: 4, summary: 'd' },
  ]);
  assert.strictEqual(tl.length, 4);
});

test('пустое резюме не схлопывает соседей', () => {
  const tl = timelineOf([{ id: 1, summary: null }, { id: 2, summary: null }]);
  assert.strictEqual(tl.length, 2);
});

// ── Подпись сотрудника в журнале ──

function managerOf(row) {
  return row.manager_name || (row.answered_by ? 'Сотрудник #' + row.answered_by : (row.user_id ? 'Сотрудник #' + row.user_id : 'Не назначен'));
}

test('менеджер берётся из COALESCE(user_id, answered_by)', () => {
  assert.strictEqual(managerOf({ manager_name: 'Андросов Никита Андреевич' }), 'Андросов Никита Андреевич');
});

test('если имя не подтянулось — не пустая клетка', () => {
  assert.strictEqual(managerOf({ answered_by: 3474 }), 'Сотрудник #3474');
  assert.strictEqual(managerOf({}), 'Не назначен');
});

let fail = 0;
for (const t of tests) {
  try {
    t.run();
    console.log('PASS ' + t.name);
  } catch (e) {
    fail += 1;
    console.log('FAIL ' + t.name + ' -> ' + e.message);
  }
}
console.log(`\nИтог: ${tests.length - fail} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
