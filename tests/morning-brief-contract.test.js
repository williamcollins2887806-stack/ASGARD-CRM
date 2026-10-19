'use strict';
/**
 * Гейт контракта GET /api/tenders/morning-brief (D-249).
 *
 * Поднимает модуль роутов с фейковым `fastify`/`db`, отдаёт заранее посчитанные
 * строки и проверяет то, на чём брифинг врал:
 *   1) date = сегодняшняя дата по Москве (а не UTC-«вчера»);
 *   2) в ready_no_submit нет reject-вердиктов и просроченных;
 *   3) просроченные без отчёта попадают в overdue_report, а не выпадают;
 *   4) waiting_report = today + soon (совместимость), без просрочки;
 *   5) пустой customer_name не превращается в «—» (склейка title);
 *   6) show=false, когда показывать нечего.
 *
 * Запуск: node tests/morning-brief-contract.test.js
 */
const assert = require('assert');
const path = require('path');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + ' — ' + e.message); }
}

/** Минимальный двойник fastify: запоминает хендлеры по методу+пути. */
function makeApp() {
  const handlers = {};
  const app = {
    db: null,
    requireRoles: () => (_req, _reply, done) => done && done(),
    get(p, opts, h) { handlers['GET ' + p] = h; },
    post(p, opts, h) { handlers['POST ' + p] = h; },
    patch(p, opts, h) { handlers['PATCH ' + p] = h; },
    put(p, opts, h) { handlers['PUT ' + p] = h; },
    delete(p, opts, h) { handlers['DELETE ' + p] = h; }
  };
  return { app, handlers };
}

/**
 * Фейковый db: отвечает по «отпечатку» запроса. Порядок вызовов в роуте
 * фиксирован (openReport → ready → missed → needAssign), но привязываемся к тексту
 * SQL, чтобы тест не поехал от перестановки. Наборы строк переключаются через
 * `db.sets` — роут захватывает `fastify.db` на регистрации, поэтому один экземпляр.
 */
function makeDb() {
  const db = {
    sets: {},
    calls: [],
    async query(sql, params) {
      const sets = db.sets;
      db.calls.push({ sql, params });
      if (/pm_duty_roster/.test(sql)) return { rows: [sets.duty || null].filter(Boolean) };
      if (/personal_kanban_cards/.test(sql)) return { rows: sets.kanban || [] };
      if (/FROM tenders t[\s\S]*ORDER BY t\.docs_deadline ASC\s+LIMIT 60/.test(sql)) return { rows: sets.open || [] };
      if (/r\.is_final = true[\s\S]*t\.docs_deadline < /.test(sql)) return { rows: sets.missed || [] };
      if (/r\.is_final = true/.test(sql)) return { rows: sets.ready || [] };
      if (/r\.analysis_finalized_at IS NOT NULL/.test(sql)) return { rows: sets.needAssign || [] };
      if (/t\.calculator_user_id = \$1/.test(sql)) return { rows: sets.myCalcs || [] };
      if (/docs_deadline::date >= \$1::date/.test(sql)) return { rows: sets.dutyAnalysis || [] };
      return { rows: [] };
    }
  };
  return db;
}

const db = makeDb();
const { app, handlers } = makeApp();
app.db = db;
require(path.join(__dirname, '..', 'src', 'routes', 'tenders-registry.js'))(app);
const handler = handlers['GET /morning-brief'];
assert.ok(handler, 'роут GET /morning-brief не зарегистрирован');

async function run(sets, user) {
  db.sets = sets;
  db.calls.length = 0;
  return handler({ user, log: { error() {}, warn() {} } });
}

const TODAY_MSK = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

(async () => {
  // ── 1. Дата и рабочий payload ТО ───────────────────────────────────────────
  const res = await run({
    open: [
      { id: 2082, customer_name: 'ООО "СОРОВСКНЕФТЬ"', docs_deadline: '2026-10-15', days_left: -4 },
      { id: 2094, customer_name: 'ООО "ОК РУСАЛ АНОДНАЯ ФАБРИКА"', docs_deadline: '2026-10-19', days_left: 0 },
      { id: 2092, customer_name: 'ООО "ТРАНС НАФТА ГАЗДОБЫЧА"', docs_deadline: '2026-10-22', days_left: 3 }
    ],
    ready: [{ id: 853, customer_name: 'АО "МИХАЙЛОВСКИЙ ГОК"', docs_deadline: null, days_left: null }],
    missed: [],
    needAssign: [],
    myCalcs: [],
    dutyAnalysis: []
  }, { id: 1, role: 'ADMIN', name: 'Admin' });

  check('date = сегодня по Москве', () => assert.strictEqual(res.date, TODAY_MSK));
  check('weekday — строка на русском', () => assert.ok(/^[а-я]+$/.test(res.weekday), res.weekday));
  check('просроченный попал в overdue_report', () =>
    assert.deepStrictEqual(res.to.overdue_report.map((r) => r.id), [2082]));
  check('сегодняшний попал в today_report', () =>
    assert.deepStrictEqual(res.to.today_report.map((r) => r.id), [2094]));
  check('будущий попал в soon_report', () =>
    assert.deepStrictEqual(res.to.soon_report.map((r) => r.id), [2092]));
  check('waiting_report = today + soon, без просрочки', () =>
    assert.deepStrictEqual(res.to.waiting_report.map((r) => r.id), [2094, 2092]));
  check('новые ключи присутствуют', () => {
    for (const k of ['overdue_report', 'today_report', 'soon_report', 'missed_submit']) {
      assert.ok(Array.isArray(res.to[k]), 'нет массива ' + k);
    }
  });
  check('counts сходятся с массивами', () => {
    assert.strictEqual(res.counts.overdue, res.to.overdue_report.length);
    assert.strictEqual(res.counts.today, res.to.today_report.length);
    assert.strictEqual(res.counts.soon, res.to.soon_report.length);
    assert.strictEqual(res.counts.ready, res.to.ready_no_submit.length);
  });
  check('show=true при наличии задач', () => assert.strictEqual(res.show, true));

  // ── 2. SQL реально фильтрует reject и просрочку ────────────────────────────
  const readySql = app.db.calls.map((c) => c.sql).find((s) => /LIMIT 30/.test(s) && /r\.is_final = true/.test(s) && !/t\.docs_deadline < /.test(s));
  check('ready: не reject', () => assert.ok(/COALESCE\(r\.decision, 'submit'\) <> 'reject'/.test(readySql), 'нет условия reject'));
  check('ready: не просрочено', () => assert.ok(/t\.docs_deadline IS NULL OR t\.docs_deadline >=/.test(readySql), 'нет условия срока'));

  const openSql = app.db.calls.map((c) => c.sql).find((s) => /LIMIT 60/.test(s));
  check('open: окно включает прошедшие даты', () => {
    assert.ok(/BETWEEN[\s\S]*- 30[\s\S]*\+ 5/.test(openSql), 'нет окна -30..+5');
    assert.ok(!/docs_deadline::date >= CURRENT_DATE/.test(openSql), 'остался старый фильтр >= CURRENT_DATE');
  });
  check('open: не берёт дату из CURRENT_DATE (UTC)', () => {
    assert.ok(!/CURRENT_DATE/.test(openSql), 'CURRENT_DATE ещё используется');
    assert.ok(/AT TIME ZONE 'Europe\/Moscow'/.test(openSql), 'нет привязки к Москве');
  });

  // ── 3. Пустой заказчик подменяется названием тендера ────────────────────────
  check('COALESCE customer_name → tender_title', () => {
    assert.ok(/COALESCE\(NULLIF\(BTRIM\(t\.customer_name\)/.test(openSql), 'нет fallback на title');
  });

  // ── 4. Пустой брифинг не показывается ──────────────────────────────────────
  const empty = await run({ open: [], ready: [], missed: [], needAssign: [], myCalcs: [], dutyAnalysis: [] },
    { id: 2, role: 'ADMIN' });
  check('show=false, когда показывать нечего', () => assert.strictEqual(empty.show, false));

  // ── 5. РП: дежурная очередь не включает чужие сроки ────────────────────────
  const pmRes = await run({
    open: [], ready: [], missed: [], needAssign: [], myCalcs: [],
    duty: { pm_user_id: 7, period_start: '2026-10-19', period_end: '2026-10-25', pm_name: 'Тест' },
    dutyAnalysis: [{ id: 2094, days_left: 0 }],
    kanban: []
  }, { id: 7, role: 'PM' });
  check('РП-дежурный видит очередь', () => {
    assert.strictEqual(pmRes.pm.is_duty, true);
    assert.deepStrictEqual(pmRes.pm.duty_analysis.map((r) => r.id), [2094]);
  });
  check('у РП нет блока to', () => assert.strictEqual(pmRes.to, null));

  console.log('\n' + (failures ? 'FAIL: ' + failures : 'OK: все проверки пройдены'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAIL', e); process.exit(1); });
