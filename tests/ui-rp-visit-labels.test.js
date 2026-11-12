#!/usr/bin/env node
'use strict';
/**
 * UI-проверка карточки РП: подписи и разрез трудосуток в блоке «График заездов».
 *
 * Без jsdom и без браузера: модуль грузится в vm-песочнице с минимальной
 * заглушкой window/document, затем вызывается тест-хук
 * `__renderVisitScheduleForTest(reportJson)`.
 *
 * Что доказывает:
 *   • в шапке «трудосуток», а не «дн. работ» (последнее читалось как календарь);
 *   • показана цифра из плана (407), а не сумма дней visit_plan;
 *   • окно заезда, в которое не влезаем, видно РП;
 *   • в разметке нет undefined/null.
 *
 * Запуск: node tests/ui-rp-visit-labels.test.js [path-to-report.json]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

function loadReport() {
  const arg = process.argv[2];
  if (arg && fs.existsSync(arg)) return JSON.parse(fs.readFileSync(arg, 'utf8'));
  const local = path.join(ROOT, 'tests', 'fixtures', 'rp-reviews', '2138.json');
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, 'utf8'));
  return null;
}

// Фикстур повторяет форму реального report_json #2138: 675 позиций, ОДИН заезд
// «один непрерывный заезд», 407 трудосуток при 6 бригадах, trip_count до фикса
// был 5 — то есть именно тот случай, когда смета переплачивала за дорогу.
const FALLBACK = {
  mode: 'analysis',
  dv_positions: [],
  visit_plan: {
    mode: 'visits',
    trip_count: 1,
    unconfirmed: false,
    visits: [{
      id: 'v1', label: 'один непрерывный заезд', period_start: '2027-04-01',
      period_end: '2027-04-30', position_ids: [], positions: 146,
      work_days: 150, people_peak: 30, person_hours: 14400
    }],
    totals: { visits: 1, positions: 146, work_days: 150, person_hours: 14400 }
  },
  calc_plan: {
    crews: 6, crew_size: 5, work_days: 407, work_days_source: 'mh_invariant',
    trip_count: 1, work_days_per_trip: 407, headcount_shift: 30,
    visits_work: [{
      id: 'v1', label: 'один непрерывный заезд', work_days: 407,
      person_hours: 27072, share_pct: 100, positions: 146
    }],
    visits_work_total: 407,
    visit_window_check: [{
      id: 'v1', label: 'один непрерывный заезд', required: 411,
      available: 30, ok: false, checked: true,
      message: 'заезд НЕ влезает: нужно 411 сут при окне 30 кал. дней'
    }],
    window_days: 300, fits_window: false,
    total_crew_days: 407, people_total: 30,
    crew: [{ role: 'ИТР (РП)', count: 1 }, { role: 'Слесарь', count: 24 }],
    warnings: []
  }
};

/** Минимальная песочница: модуль рисует строки, DOM ему для этого не нужен. */
function loadModal() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.Promise = Promise;
  sandbox.JSON = JSON;
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };
  sandbox.fetch = () => Promise.reject(new Error('offline'));
  sandbox.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }),
    body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }
  };
  sandbox.API = { getRpReview: async () => ({}), saveRpReview: async () => ({}) };
  // Модуль выходит рано, если нет AsgardUI: подставляем минимальный набор,
  // который он реально берёт из глобалов.
  sandbox.AsgardUI = {
    esc: (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
    toast: () => {},
    showModal: () => {},
    hideModal: () => {},
    replaceModal: () => {}
  };
  sandbox.AsgardRegistryApi = sandbox.API;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'js', 'rp_review_modal.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'rp_review_modal.js' });
  return sandbox;
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const real = loadReport();
const report = real || FALLBACK;
console.log('данные:', real ? 'реальный report_json' : 'фикстур (числа реального #2138)');

let sandbox;
let api;
try {
  sandbox = loadModal();
  api = sandbox.AsgardRpReviewModal;
} catch (e) {
  console.log('FAIL инициализация модуля —', e.message);
  process.exit(1);
}

check('модуль загрузился и отдаёт тест-хук рендера', () => {
  assert.ok(api, 'AsgardRpReviewModal не определён');
  assert.strictEqual(typeof api.__renderVisitScheduleForTest, 'function',
    'нет __renderVisitScheduleForTest');
});

if (typeof (api || {}).__renderVisitScheduleForTest !== 'function') {
  console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
  process.exit(1);
}

const html = api.__renderVisitScheduleForTest(report);

check('шапка графика говорит «трудосуток», а не «дн. работ»', () => {
  assert.ok(/трудосуток/.test(html),
    'нет слова «трудосуток» — РП прочитает срок как календарь кампании');
  assert.ok(!/дн\. работ/.test(html), 'осталось «дн. работ»');
});

check('показана цифра трудосуток из плана (407), а не сумма дней visit_plan', () => {
  assert.ok(/407/.test(html), 'нет 407 — разрез не берётся из calc_plan');
  // 150 — сумма суток visit_plan; она не должна подменять итог.
  assert.ok(!/<b>150<\/b>\s*трудосуток/.test(html),
    'в шапке сумма дней visit_plan вместо трудосуток плана');
});

check('в строке заезда подпись «трудосут.», а не «дн.»', () => {
  assert.ok(/трудосут\./.test(html), 'нет подписи «трудосут.» в строке заезда');
});

check('окно заезда, в которое не влезаем, показано РП', () => {
  assert.ok(/НЕ влезает/.test(html), 'провал окна заезда не показан');
});

check('нет сырых undefined/null в разметке', () => {
  assert.ok(!/undefined/.test(html), 'в разметке есть undefined');
  assert.ok(!/>null</.test(html), 'в разметке есть null');
});

check('сметный work_days не подменён, разрез сходится', () => {
  const plan = report.calc_plan || {};
  assert.strictEqual(Number(plan.work_days), 407, 'work_days изменился — ФОТ поедет');
  const sum = (plan.visits_work || []).reduce((s, v) => s + (Number(v.work_days) || 0), 0);
  assert.strictEqual(sum, 407, `Σ по заездам ${sum} != 407`);
});

// ── Много заездов: появляется «на заезд» ───────────────────────────────────
check('при нескольких заездах в шапке есть «на заезд»', () => {
  const multi = JSON.parse(JSON.stringify(report));
  multi.calc_plan.work_days = 407;
  multi.calc_plan.work_days_per_trip = 136;
  multi.calc_plan.trip_count = 3;
  multi.calc_plan.visits_work = [
    { id: 'v1', label: 'апрель', work_days: 244, share_pct: 60, person_hours: 60000 },
    { id: 'v2', label: 'октябрь', work_days: 122, share_pct: 30, person_hours: 30000 },
    { id: 'v3', label: 'декабрь', work_days: 41, share_pct: 10, person_hours: 10000 }
  ];
  multi.visit_plan = Object.assign({}, multi.visit_plan, {
    trip_count: 3,
    visits: multi.calc_plan.visits_work.map((v) => Object.assign({}, v, { positions: 100 }))
  });
  const h = api.__renderVisitScheduleForTest(multi);
  assert.ok(/на заезд/.test(h), 'нет подписи «на заезд» при 3 выездах');
  assert.ok(/136/.test(h), 'нет цифры на заезд (136)');
  assert.ok(!/undefined/.test(h), 'undefined в многоразовой разметке');
});

check('модель назвала 3 выезда, а перечислила 1 заезд — «на заезд» остаётся', () => {
  // Дефект, найденный проверкой на живом проде: подпись зависела от длины
  // массива visits (1), а не от числа выездов (3), и пропадала.
  const mixed = JSON.parse(JSON.stringify(report));
  mixed.visit_plan = Object.assign({}, mixed.visit_plan, {
    mode: 'visits',
    trip_count: 3,
    visits: [{ id: 'v1', label: 'апрель', positions: 146 }]
  });
  mixed.calc_plan = Object.assign({}, mixed.calc_plan, {
    work_days: 407,
    work_days_per_trip: 136,
    trip_count: 3,
    visits_work: [{ id: 'v1', label: 'апрель', work_days: 407, share_pct: 100 }]
  });
  const h = api.__renderVisitScheduleForTest(mixed);
  assert.ok(/на заезд/.test(h),
    'нет «на заезд»: подпись считается по длине visits, а не по trip_count');
  assert.ok(/136/.test(h), 'нет цифры 136');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
