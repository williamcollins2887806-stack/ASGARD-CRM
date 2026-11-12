#!/usr/bin/env node
'use strict';
/**
 * Проверка «на проде»: отрендерить график заездов кодом, который реально
 * задеплоен, и убедиться в подписях и разрезе трудосуток.
 *
 * Запуск на сервере: cd /var/www/asgard-crm && node /tmp/prod-ui-check.js
 */
const vm = require('vm');
const fs = require('fs');

const s = {};
s.window = s;
s.globalThis = s;
s.console = console;
s.setTimeout = setTimeout;
s.clearTimeout = clearTimeout;
s.Promise = Promise;
s.JSON = JSON;
s.localStorage = { getItem: () => null, setItem: () => {} };
s.fetch = () => Promise.reject(new Error('offline'));
s.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {},
  createElement: () => ({ style: {} }),
  body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }
};
s.AsgardUI = {
  esc: (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  toast: () => {}, showModal: () => {}, hideModal: () => {}, replaceModal: () => {}
};
s.AsgardRegistryApi = {};

vm.createContext(s);
vm.runInContext(fs.readFileSync('public/assets/js/rp_review_modal.js', 'utf8'), s, {
  filename: 'rp_review_modal.js'
});
const api = s.AsgardRpReviewModal;
if (!api || typeof api.__renderVisitScheduleForTest !== 'function') {
  console.log('FAIL: тест-хук отсутствует в задеплоенном файле');
  process.exit(1);
}

// Один заезд, 407 трудосуток (как #2138 сегодня) + окно, в которое не влезаем.
const one = api.__renderVisitScheduleForTest({
  visit_plan: { mode: 'visits', trip_count: 1, visits: [{ id: 'v1', label: 'один непрерывный заезд', positions: 146 }], totals: {} },
  calc_plan: {
    work_days: 407, work_days_per_trip: 407,
    visits_work: [{ id: 'v1', label: 'один непрерывный заезд', work_days: 407, share_pct: 100 }],
    visit_window_check: [{ id: 'v1', label: 'один непрерывный заезд', checked: true, ok: false, message: 'заезд НЕ влезает: нужно 411 сут при окне 30 кал. дней' }]
  }
});

const checks = [
  ['подпись «трудосуток»', /трудосуток/.test(one)],
  ['нет «дн. работ»', !/дн\. работ/.test(one)],
  ['цифра плана 407', /407/.test(one)],
  ['«трудосут.» в строке заезда', /трудосут\./.test(one)],
  ['провал окна виден', /НЕ влезает/.test(one)],
  ['нет undefined', !/undefined/.test(one)]
];

// Три заезда: появляется «на заезд» и цифра из плана.
const three = api.__renderVisitScheduleForTest({
  visit_plan: { mode: 'visits', trip_count: 3, visits: [{ id: 'v1', label: 'апрель', positions: 100 }], totals: {} },
  calc_plan: {
    work_days: 407, work_days_per_trip: 136,
    visits_work: [{ id: 'v1', label: 'апрель', work_days: 244, share_pct: 60 }],
    visit_window_check: [{ id: 'v1', label: 'апрель', checked: false, ok: null, message: 'окно заезда не задано' }]
  }
});
checks.push(['при 3 заездах есть «на заезд»', /на заезд/.test(three)]);
checks.push(['доля на заезд = 136 (из плана, не из visit_plan)', three.includes('136')]);

let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) bad += 1;
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
}
console.log('\nитог: ' + (checks.length - bad) + '/' + checks.length + ' PASS');
process.exit(bad ? 1 : 0);
