'use strict';
/**
 * Контракт авто-маски телефона (public/assets/js/phone_mask.js).
 *
 * Инцидент 12.10.2026: на странице «Дружина» в поиск (#prs_q, placeholder
 * «Поиск по ФИО, телефону…») нельзя было ввести ФИО — только цифры.
 * Причина: looksLikePhone() опознавала телефон по placeholder, поэтому
 * маска ловила ЛЮБОЕ поле с подсказкой со словом «телефон», а format()
 * оставляет только цифры — буквы стирались.
 *
 * Тест фиксирует:
 *   A. Поле-телефон маскируется как раньше (по id/name/type/inputmode).
 *   B. Поле, у которого слово «телефон» есть ТОЛЬКО в placeholder, не маскируется.
 *   C. «telegram» / «telemost» / «hotel» не опознаются как tel.
 *   D. Три копии маски совпадают.
 *   E. Буквы в угаданном поле не переформатируются, а цифры — маскируются.
 *
 * Usage: node tests/ui/phone-mask.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const MASK_REL = 'public/assets/js/phone_mask.js';
const MASK_SRC = fs.readFileSync(path.join(ROOT, MASK_REL), 'utf8');

let passed = 0;
let failed = 0;
function test(id, name, fn) {
  try { fn(); passed++; console.log(`  \u2713 ${id} ${name}`); }
  catch (e) { failed++; console.error(`  \u2717 ${id} ${name}: ${e.message}`); }
}

/** Загружаем модуль в изолированный контекст (без document/window). */
function loadMask() {
  const ctx = { console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(MASK_SRC, ctx, { filename: MASK_REL });
  assert.ok(ctx.AsgardPhoneMask, 'модуль не выставил window.AsgardPhoneMask');
  return ctx.AsgardPhoneMask;
}

/** Заглушка input с рабочими слушателями — чтобы реально прогнать ввод. */
function fakeInput(attrs = {}) {
  const a = { ...attrs };
  const listeners = {};
  const el = {
    tagName: 'INPUT',
    type: a.type || 'text',
    value: a.value || '',
    selectionStart: 0,
    className: a.class || '',
    getAttribute: (n) => (n in a ? a[n] : null),
    setAttribute: (n, v) => { a[n] = v; },
    removeAttribute: (n) => { delete a[n]; },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    setSelectionRange: () => {},
    fire(ev) { (listeners[ev] || []).forEach((fn) => fn({ target: el })); },
  };
  el.selectionStart = el.value.length;
  return el;
}

/** Привязываем поле и «печатаем» текст, как это делает браузер. */
function typeInto(el, api, text) {
  api.attach(el);
  el.value = text;
  el.selectionStart = el.value.length;
  el.fire('input');
  return el.value;
}

console.log('phone-mask');

/* ── A. Настоящий телефон маскируется ─────────────────────────────────── */
test('A1', 'format(): 8…/916…/+7(… все дают один канон', () => {
  const api = loadMask();
  assert.strictEqual(api.format('89160614809'), '+7 (916) 061-48-09');
  assert.strictEqual(api.format('+7(916)061-48-09'), '+7 (916) 061-48-09');
  assert.strictEqual(api.format('9160614809'), '+7 (916) 061-48-09');
  assert.strictEqual(api.e164('89160614809'), '+79160614809');
});

test('A2', 'поля с явным телефонным признаком привязываются', () => {
  const api = loadMask();
  for (const attrs of [{ id: 'phone' }, { name: 'contact_phone' }, { type: 'tel' }, { inputmode: 'tel' }]) {
    const el = fakeInput(attrs);
    api.attach(el);
    assert.ok(el.phoneMaskBound, `не привязан: ${JSON.stringify(attrs)}`);
  }
});

test('A3', 'в type=tel цифры вводятся и маскируются', () => {
  const api = loadMask();
  const el = fakeInput({ type: 'tel' });
  assert.strictEqual(typeInto(el, api, '89160614809'), '+7 (916) 061-48-09');
});

/* ── B. Регрессия 12.10.2026: placeholder не признак телефона ─────────── */
test('B1', 'Дружина #prs_q не маскируется, ФИО вводится', () => {
  const api = loadMask();
  const el = fakeInput({ id: 'prs_q', placeholder: 'Поиск по ФИО, телефону…', class: 'input' });
  api.attach(el);
  assert.ok(!el.phoneMaskBound, 'поиск Дружины снова попал под маску');
  assert.strictEqual(typeInto(el, api, 'Иванов'), 'Иванов', 'буквы стёрты');
});

test('B2', 'поиск получателя НПД (#payee_search) не маскируется', () => {
  const api = loadMask();
  const el = fakeInput({ id: 'payee_search', placeholder: 'Поиск по ФИО или телефону...' });
  api.attach(el);
  assert.ok(!el.phoneMaskBound, 'payee_search попал под маску');
  assert.strictEqual(typeInto(el, api, 'Петров'), 'Петров');
});

test('B3', 'контакты в настройках (#d_contacts) не маскируются', () => {
  const api = loadMask();
  const el = fakeInput({ id: 'd_contacts', placeholder: 'email • телефон' });
  api.attach(el);
  assert.ok(!el.phoneMaskBound, 'd_contacts попал под маску');
  assert.strictEqual(typeInto(el, api, 'ivanov@asgard.ru'), 'ivanov@asgard.ru');
});

/* ── C. «telegram» / «telemost» / «hotel» — не телефон ────────────────── */
test('C1', 'id=telegram / cu_telegram / sc-telegram не маскируются', () => {
  const api = loadMask();
  for (const id of ['telegram', 'cu_telegram', 'eu_telegram', 'sc-telegram']) {
    const el = fakeInput({ id, placeholder: '@username' });
    api.attach(el);
    assert.ok(!el.phoneMaskBound, `${id} попал под маску`);
    assert.strictEqual(typeInto(el, api, '@asgard'), '@asgard', `${id}: текст стёрт`);
  }
});

test('C2', 'ссылка конференции (#ev_conference) не маскируется', () => {
  const api = loadMask();
  const el = fakeInput({ id: 'ev_conference', placeholder: 'https://telemost… / zoom…' });
  api.attach(el);
  assert.ok(!el.phoneMaskBound, 'ev_conference попал под маску');
  assert.strictEqual(typeInto(el, api, 'https://telemost.ru/j/1'), 'https://telemost.ru/j/1');
});

test('C3', 'адрес отеля (#ti_hotel_addr) не маскируется', () => {
  const api = loadMask();
  const el = fakeInput({ id: 'ti_hotel_addr', placeholder: 'г. Москва, ул. Тверская 1, оф. 101' });
  api.attach(el);
  assert.ok(!el.phoneMaskBound, 'ti_hotel_addr попал под маску');
  assert.strictEqual(typeInto(el, api, 'Москва'), 'Москва');
});

test('C4', 'data-phone-mask=off уважается', () => {
  const api = loadMask();
  const el = fakeInput({ id: 'phone', 'data-phone-mask': 'off' });
  api.attach(el);
  assert.ok(!el.phoneMaskBound, 'off проигнорирован');
});

/* ── D. Копии маски обязаны совпадать ─────────────────────────────────── */
test('D1', 'копии маски совпадают (assets / m / mobile-app)', () => {
  const copies = [
    'public/assets/js/phone_mask.js',
    'public/m/phone_mask.js',
    'public/mobile-app/public/phone_mask.js',
  ];
  const bodies = copies.map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  for (let i = 1; i < bodies.length; i++) {
    assert.strictEqual(bodies[i], bodies[0],
      `${copies[i]} разошёлся с ${copies[0]} — прогони node public/mobile-app/tools/sync-phone-mask.mjs`);
  }
});

test('D2', 'нет устаревших копий phone_mask.js где-либо под public/', () => {
  // Раньше проверялись только три известных пути, и старая копия
  // (напр. в игнорируемом git каталоге сборки public/mobile-app/dist/)
  // расхождение проходило молча. Ищем любую копию модуля под public/.
  const canonical = fs.readFileSync(path.join(ROOT, MASK_REL), 'utf8');
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'phone_mask.js') found.push(p);
    }
  };
  walk(path.join(ROOT, 'public'));
  assert.ok(found.length > 0, 'не найдено ни одной копии phone_mask.js');
  const stale = found.filter((p) => fs.readFileSync(p, 'utf8') !== canonical);
  assert.deepStrictEqual(stale.map((p) => path.relative(ROOT, p).replace(/\\/g, '/')), [],
    'устаревшая копия маски (в ней старая логика с placeholder) — прогони sync-phone-mask.mjs или пересобери мобильное приложение');
});

/* ── E. Страховка от переформатирования свободного текста ─────────────── */
test('E1', 'в угаданное поле буквы не переформатируются, цифры — маскируются', () => {
  const api = loadMask();
  // id похож на телефон (угадано), но пользователь печатает текст
  const el = fakeInput({ id: 'some_phone_note' });
  api.attach(el);
  assert.ok(el.phoneMaskBound, 'угаданное поле должно быть привязано');
  assert.strictEqual(typeInto(el, api, 'Иванов'), 'Иванов', 'буквы стёрты в угаданном поле');
  assert.strictEqual(typeInto(el, api, '89160614809'), '+7 (916) 061-48-09', 'цифры не замаскированы');
});

test('E2', 'attach проставляет inputmode, но сила признака не подменяется', () => {
  const api = loadMask();
  const el = fakeInput({ id: 'some_phone_note' });
  api.attach(el);
  // attach добавил inputmode=tel — при повторной проверке поле выглядело бы «явным»
  assert.strictEqual(el.getAttribute('inputmode'), 'tel', 'inputmode не проставлен');
  assert.strictEqual(typeInto(el, api, 'Петров'), 'Петров',
    'после attach поле перестало защищать текст — сила признака не зафиксирована');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
