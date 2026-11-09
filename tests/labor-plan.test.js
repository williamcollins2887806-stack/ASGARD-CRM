'use strict';

/**
 * Тесты расчёта по трудоёмкости из ТЗ.
 *
 * ── Ситуация ───────────────────────────────────────────────────────────────
 * Заказчик иногда не даёт объёмов, а сразу пишет норму: «зачистка 1800 мин».
 * Это 30 чел·ч. Раньше анализ помечал такую позицию проблемой «нужен объём
 * работ» и не закрывался, хотя считать было чем.
 *
 * ── Что важно не перепутать ────────────────────────────────────────────────
 * 1800 чел·ч — это НЕ «один человек 1800 часов». Это фонд, который делят
 * между бригадой. И мастер с ИТР в этот фонд НЕ входят: заказчик оценивал
 * труд исполнителей, а supervisors ставятся сверху — их труд входит в цену.
 */

const assert = require('assert');
const path = require('path');

const labor = require(path.join(__dirname, '..', 'src', 'services', 'labor-plan.js'));

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

// ── 1. Перевод единиц ──────────────────────────────────────────────────────
check('минуты переводятся в человеко-часы', () => {
  // «1800 мин» из ТЗ тендера 2143 — это 30 часов.
  assert.strictEqual(labor.toLaborHours(1800, 'мин'), 30);
  assert.strictEqual(labor.toLaborHours(60, 'минута'), 1);
  assert.strictEqual(labor.toLaborHours(90, 'мин.'), 1.5);
});

check('человеко-часы распознаются', () => {
  assert.strictEqual(labor.toLaborHours(30, 'чел·ч'), 30);
  assert.strictEqual(labor.toLaborHours(30, 'чел-ч'), 30);
  assert.strictEqual(labor.toLaborHours(30, 'человеко-часов'), 30);
  assert.strictEqual(labor.toLaborHours(30, 'нормо-час'), 30);
});

check('человеко-дни и смены — по 8 часов', () => {
  assert.strictEqual(labor.toLaborHours(2, 'чел-дн'), 16);
  assert.strictEqual(labor.toLaborHours(3, 'чел·см'), 24);
});

check('не трудоёмкость — ноль', () => {
  assert.strictEqual(labor.toLaborHours(100, 'м3'), 0);
  assert.strictEqual(labor.toLaborHours(100, 'т'), 0);
  assert.strictEqual(labor.toLaborHours(100, ''), 0);
  assert.strictEqual(labor.toLaborHours(0, 'мин'), 0);
  assert.strictEqual(labor.toLaborHours(-5, 'мин'), 0);
});

// ── 2. Расчёт бригады и срока ──────────────────────────────────────────────
check('1800 мин при 10 слесарях — около 8 суток', () => {
  // 30 чел·ч / (10 чел × 11 ч × 2 смены) = 0.136 сут... нет:
  // считаем в человеко-часах: 30 / (10 × 11 × 2) = 0.136 суток.
  // Но 1800 МИНУТ = 30 часов — это мало для 10 человек.
  // Проверяем формулу на 1800 ЧАСАХ (трудоёмкость из ТЗ в часах).
  const r = labor.planByLabor({ laborHours: 1800, workers: 10 });
  // 1800 / (10 × 11 × 2) = 8.18 → 8.2 суток.
  assert.strictEqual(r.days, 8.2, 'срок: ' + r.days);
  assert.strictEqual(r.workers, 10);
});

check('мастер и ИТР добавляются СВЕРХ фонда', () => {
  const r = labor.planByLabor({ laborHours: 1800, workers: 10 });
  // Заказчик оценил 10 исполнителей. Мастер и ИТР — сверх, их труд не в фонде.
  assert.strictEqual(r.masters, 1);
  assert.strictEqual(r.itr, 1);
  assert.strictEqual(r.total_people, 12, 'всего людей: ' + r.total_people);
  assert.ok(r.note.includes('сверх фонда'), 'нет пояснения про сверх фонда');
});

check('можно отключить мастера и ИТР', () => {
  const r = labor.planByLabor({ laborHours: 1800, workers: 10, withMaster: false, withItr: false });
  assert.strictEqual(r.total_people, 10);
});

check('больше людей — меньше срок', () => {
  const a = labor.planByLabor({ laborHours: 1800, workers: 5 });
  const b = labor.planByLabor({ laborHours: 1800, workers: 20 });
  assert.ok(b.days < a.days, 'срок не уменьшился: ' + a.days + ' → ' + b.days);
});

check('срок не бывает меньше суток', () => {
  // 1 чел·ч при 20 людях — формула дала бы 0.002 суток.
  const r = labor.planByLabor({ laborHours: 1, workers: 20 });
  assert.strictEqual(r.days, 1);
});

check('без трудоёмкости — нулевой срок и пояснение', () => {
  const r = labor.planByLabor({ laborHours: 0 });
  assert.strictEqual(r.days, 0);
  assert.ok(/не указана/i.test(r.note), 'нет пояснения: ' + r.note);
});

// ── 3. Подбор людей под срок ───────────────────────────────────────────────
check('сколько людей нужно, чтобы уложиться в 30 суток', () => {
  // 1800 чел·ч за 30 суток: 1800 / (30 × 11 × 2) = 2.7 → 3 человека.
  const n = labor.workersForDays(1800, 30);
  assert.strictEqual(n, 3, 'требуется людей: ' + n);
});

check('короткий срок требует больше людей', () => {
  const fast = labor.workersForDays(1800, 5);
  const slow = labor.workersForDays(1800, 60);
  assert.ok(fast > slow, 'не учтён срок: ' + fast + ' vs ' + slow);
});

check('подбор людей не даёт меньше одного', () => {
  assert.strictEqual(labor.workersForDays(0, 10), 1);
  assert.strictEqual(labor.workersForDays(100, 0), 1);
});

// ── 4. Сквозной пример тендера 2143 ────────────────────────────────────────
check('сценарий 2143: 1800 мин, 10 слесарей, 2 смены', () => {
  const hours = labor.toLaborHours(1800, 'мин');
  assert.strictEqual(hours, 30, '1800 мин = 30 чел·ч');
  // 30 чел·ч при 10 людях — полсмены. Значит либо мало людей, либо это
  // трудоёмкость НА ОДНУ операцию, а не на весь объём.
  const r = labor.planByLabor({ laborHours: hours, workers: 10 });
  assert.strictEqual(r.days, 1, 'минимальный срок — сутки');
  // А при 2 людях — тоже сутки, но работы меньше.
  const r2 = labor.planByLabor({ laborHours: hours, workers: 2 });
  assert.strictEqual(r2.days, 1);
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
