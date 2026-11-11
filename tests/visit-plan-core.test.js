'use strict';
/**
 * Тесты 3-way merge. Проверяют, что правки РП не теряются при повторном
 * разборе — это была реальная потеря работы на тендерах с 3–5 прогонами.
 */

const path = require('path');
const vpc = require(path.join(__dirname, '..', 'src', 'services', 'visit-plan-core'));

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** Удобный конструктор позиции. */
function pos(id, extra) {
  return Object.assign({ id, name: 'Теплообменник ' + id, period: 'май' }, extra || {});
}

// ── Неприкосновенность правок РП ────────────────────────────────────────────
check('правка РП не перезаписывается разбором', () => {
  const r = vpc.mergeList({
    base: [pos(1, { source: 'rp', period: 'июнь' })],
    incoming: [pos(1, { source: 'analysis', period: 'май' })]
  });
  eq(r.merged[0].period, 'июнь', 'период РП должен остаться');
  eq(r.stats.kept_manual, 1);
});

check('crew_locked защищает состав', () => {
  const r = vpc.mergeList({
    base: [pos(1, { crew_locked: true, people: 8 })],
    incoming: [pos(1, { people: 4 })]
  });
  eq(r.merged[0].people, 8);
});

check('источник rp определяется и в поле origin', () => {
  eq(vpc.isManual({ origin: 'rp' }), true);
  eq(vpc.isManual({ source: 'user' }), true);
  eq(vpc.isManual({ source: 'analysis' }), false);
});

check('конфликт правки РП попадает в отчёт', () => {
  const r = vpc.mergeList({
    base: [pos(1, { source: 'rp', period: 'июнь' })],
    incoming: [pos(1, { period: 'май' })]
  });
  if (!r.conflicts.length) throw new Error('конфликт не зафиксирован');
  eq(r.conflicts[0].diffs[0].kept, 'июнь');
  eq(r.conflicts[0].diffs[0].proposed, 'май');
});

// ── Обновление того, что правил не человек ──────────────────────────────────
check('запись разбора обновляется новым разбором', () => {
  const r = vpc.mergeList({
    base: [pos(1, { source: 'analysis', volume: 100 })],
    incoming: [pos(1, { volume: 150 })]
  });
  eq(r.merged[0].volume, 150);
  eq(r.stats.updated, 1);
});

check('id сохраняется при обновлении', () => {
  const r = vpc.mergeList({
    base: [pos(7, { source: 'analysis' })],
    incoming: [{ name: 'Теплообменник 7', period: 'май', volume: 5 }]
  });
  eq(r.merged[0].id, 7);
});

// ── Потерянные записи ───────────────────────────────────────────────────────
check('запись, которую разбор пропустил, не теряется', () => {
  const r = vpc.mergeList({
    base: [pos(1), pos(2), pos(3)],
    incoming: [pos(1)]
  });
  eq(r.merged.length, 3, 'позиции 2 и 3 должны остаться');
  eq(r.stats.kept_missing, 2);
});

check('новые позиции добавляются', () => {
  const r = vpc.mergeList({
    base: [pos(1)],
    incoming: [pos(1), pos(2), pos(3)]
  });
  eq(r.merged.length, 3);
  eq(r.stats.added, 2);
});

check('повторный прогон не задваивает позиции', () => {
  const r = vpc.mergeList({
    base: [pos(1), pos(2)],
    incoming: [pos(1), pos(2)]
  });
  eq(r.merged.length, 2, 'задвоение!');
  eq(r.stats.added, 0);
});

// ── Разные позиции с одинаковым именем ──────────────────────────────────────
check('одинаковое имя с разным периодом — РАЗНЫЕ позиции', () => {
  const r = vpc.mergeList({
    base: [
      { name: 'Чистка теплообменника', period: 'сентябрь', source_ref: 'a' },
      { name: 'Чистка теплообменника', period: 'декабрь', source_ref: 'b' }
    ],
    incoming: [
      { name: 'Чистка теплообменника', period: 'сентябрь', source_ref: 'a' },
      { name: 'Чистка теплообменника', period: 'декабрь', source_ref: 'b' }
    ]
  });
  eq(r.merged.length, 2, 'периоды схлопнулись — потеря объёма');
});

check('ключ различает период', () => {
  const a = vpc.keyOf({ name: 'Мойка', period: 'май' });
  const b = vpc.keyOf({ name: 'Мойка', period: 'июнь' });
  if (a === b) throw new Error('ключи совпали');
});

check('source_ref главнее имени', () => {
  const a = vpc.keyOf({ name: 'X', period: 'май', source_ref: 'стр.5' });
  eq(a, 'ref:стр.5');
});

// ── Заезды ──────────────────────────────────────────────────────────────────
check('правка заезда РП сохраняется', () => {
  const r = vpc.mergeVisitPlan({
    basePlan: { visits: [{ id: 'v1', label: 'Май', source: 'rp', period_start: '2027-05-10' }] },
    incomingPlan: { visits: [{ id: 'v1', label: 'Май', period_start: '2027-05-01' }] }
  });
  eq(r.plan.visits[0].period_start, '2027-05-10');
});

check('состав позиций заезда объединяется без потерь', () => {
  const r = vpc.mergeVisitPlan({
    basePlan: { visits: [{ id: 'v1', position_ids: [1, 2] }] },
    incomingPlan: { visits: [{ id: 'v1', position_ids: [2, 3] }] }
  });
  const ids = r.plan.visits[0].position_ids.slice().sort();
  eq(JSON.stringify(ids), JSON.stringify([1, 2, 3]));
});

check('новый заезд из разбора добавляется', () => {
  const r = vpc.mergeVisitPlan({
    basePlan: { visits: [{ id: 'v1' }] },
    incomingPlan: { visits: [{ id: 'v1' }, { id: 'v2', label: 'Июнь' }] }
  });
  eq(r.plan.visits.length, 2);
});

// ── Полная склейка ──────────────────────────────────────────────────────────
check('mergeDv сохраняет и позиции, и заезды', () => {
  const r = vpc.mergeDv({
    basePositions: [pos(1, { source: 'rp', period: 'июнь' })],
    incomingPositions: [pos(1, { period: 'май' })],
    basePlan: { visits: [{ id: 'v1', source: 'rp', label: 'Июнь' }] },
    incomingPlan: { visits: [{ id: 'v1', label: 'Май' }] }
  });
  eq(r.positions[0].period, 'июнь');
  eq(r.plan.visits[0].label, 'Июнь');
  if (!r.conflicts.length) throw new Error('конфликты не собраны');
});

// ── Порядок слияния: разбор обновляет, РП защищён ───────────────────────────
check('новый разбор МОЖЕТ изменить режим и число заездов', () => {
  // Дефект (нашёл верификатор): basePlan стоял последним в Object.assign,
  // поэтому mode/trip_count из разбора игнорировались, а визиты приходили
  // из разбора — получалось mode=continuous при 3 визитах.
  const r = vpc.mergeVisitPlan({
    basePlan: { schedule_mode: 'continuous', trip_count: 1, source: 'analysis' },
    incomingPlan: {
      schedule_mode: 'visits', trip_count: 3,
      visits: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }]
    }
  });
  eq(r.plan.schedule_mode, 'visits', 'режим должен обновиться из разбора');
  eq(r.plan.trip_count, 3, 'число заездов должно обновиться');
});

check('правка РП в плане заездов не перезаписывается', () => {
  const r = vpc.mergeVisitPlan({
    basePlan: { schedule_mode: 'continuous', trip_count: 1, source: 'rp' },
    incomingPlan: { schedule_mode: 'visits', trip_count: 3, visits: [{ id: 'v1' }] }
  });
  eq(r.plan.schedule_mode, 'continuous', 'правка РП должна остаться');
  eq(r.plan.trip_count, 1);
});

check('locked-план заездов тоже защищён', () => {
  const r = vpc.mergeVisitPlan({
    basePlan: { schedule_mode: 'visits', trip_count: 2, locked: true },
    incomingPlan: { schedule_mode: 'continuous', trip_count: 1 }
  });
  eq(r.plan.trip_count, 2);
});

check('пустая база — берём разбор как есть', () => {
  const r = vpc.mergeList({ base: [], incoming: [pos(1), pos(2)] });
  eq(r.merged.length, 2);
  eq(r.stats.kept_manual, 0);
});

check('пустой разбор не стирает базу', () => {
  const r = vpc.mergeList({ base: [pos(1), pos(2)], incoming: [] });
  eq(r.merged.length, 2, 'база стёрта!');
});

check('603 позиции склеиваются быстро', () => {
  const base = Array.from({ length: 603 }, (_, i) => pos(i));
  const incoming = Array.from({ length: 603 }, (_, i) => pos(i));
  const t0 = Date.now();
  const r = vpc.mergeList({ base, incoming });
  if (Date.now() - t0 > 500) throw new Error('медленно');
  eq(r.merged.length, 603);
});

check('запись без ключа не роняет склейку', () => {
  const r = vpc.mergeList({ base: [{ foo: 1 }], incoming: [{ bar: 2 }] });
  if (r.merged.length < 2) throw new Error('потеряно: ' + r.merged.length);
});

console.log('\nитог: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
