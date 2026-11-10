'use strict';
/**
 * ТКП должно собираться из ПРОСЧЁТА и содержать работы для заказчика,
 * а не расценки по ролям и не выдуманные демо-позиции.
 *
 * ── История (10.11.2026) ───────────────────────────────────────────────────
 * Карточка 3093 в канбане: документ заполнился сметой — ИТР 15 000, Мастер
 * 12 000, Рабочий 9 750 за смену. Корни:
 *   1) `from-card` вообще не читал `report_json`, а брал
 *      `tkp_quick_sessions.estimate_draft` с фильтром `author_id = текущий
 *      пользователь` — у дежурного РП такой сессии нет;
 *   2) `buildClientItems` из mimir-tkp-quick пропускал роли персонала;
 *   3) при пустой смете подставлялись демо-строки (28 500 / 14 500 / 370 500)
 *      и через автосейв попадали в документ;
 *   4) блоки рендерились раньше `kp_variant === 'full'`, поэтому выбор
 *      «полное КП» не действовал.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TKP = fs.readFileSync(path.join(ROOT, 'src/routes/tkp.js'), 'utf8');
const QUICK = fs.readFileSync(path.join(ROOT, 'src/services/mimir-tkp-quick.js'), 'utf8');
const KANBAN = fs.readFileSync(path.join(ROOT, 'public/assets/js/personal_kanban.js'), 'utf8');
const BOARD = fs.readFileSync(path.join(ROOT, 'public/desktop-v2-src/src/pages/PersonalKanban/BoardV3.jsx'), 'utf8');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ ok: false }); console.log('FAIL ' + name + ' — ' + e.message); }
}

check('from-card читает report_json закрытого просчёта', () => {
  const fromCard = TKP.slice(TKP.indexOf("fastify.post('/from-card"), TKP.indexOf('// 4) RBAC') + 2000);
  assert.ok(/tender_rp_reviews/.test(fromCard), 'from-card не запрашивает просчёт');
  assert.ok(/readPricing/.test(fromCard), 'from-card не использует канонную цену из просчёта');
  assert.ok(/buildItemizedClientItems|buildClientItems/.test(fromCard), 'позиции не строятся кодом ТКП');
});

check('просчёт имеет приоритет над черновиком Quick-сметы', () => {
  const fromCard = TKP.slice(TKP.indexOf("fastify.post('/from-card"), TKP.indexOf('// 4) RBAC') + 2000);
  // Ищем реальные запросы, а не упоминания в комментариях.
  const reviewPos = fromCard.indexOf('FROM tender_rp_reviews');
  const quickPos = fromCard.indexOf('FROM tkp_quick_sessions');
  assert.ok(reviewPos >= 0, 'from-card не запрашивает tender_rp_reviews');
  assert.ok(quickPos > reviewPos,
    `быстрый черновик (${quickPos}) проверяется раньше закрытого просчёта (${reviewPos})`);
  assert.ok(/if \(!smetaPrefill\)/.test(fromCard), 'нет фолбэка — при пустом просчёте ТКП останется без позиций');
});

check('из поиска сессии убран фильтр по автору', () => {
  const fromCard = TKP.slice(TKP.indexOf("fastify.post('/from-card"), TKP.indexOf('// 4) RBAC') + 2000);
  // Просчёт мог сделать другой РП (дежурный) — фильтр по автору скрывал его.
  const quickPart = fromCard.slice(fromCard.indexOf('tkp_quick_sessions'));
  assert.ok(!/WHERE author_id = \$1[\s\S]{0,120}estimate_draft/.test(quickPart),
    'остался фильтр author_id у сессии Quick — сессия дежурного РП не найдётся');
});

check('роли персонала не попадают в клиентскую таблицу', () => {
  // Поведенческая проверка, а не поиск подстрок в исходнике (верификатор
  // 10.11.2026: тест находил «ИТР» в тексте регекспа и потому пропускал
  // реальную утечку — \b не работает с кириллицей).
  // Модуль требует DB_PASSWORD на загрузке, поэтому подставляем заглушку:
  // для этой проверки БД не нужна.
  if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'test-stub';
  const quick = require('../src/services/mimir-tkp-quick');
  const draft = {
    items: [
      { name: 'ИТР', qty: 10, price: 15000 },
      { name: 'ИТР (10 см.)', qty: 10, price: 15000 },
      { name: 'Мастер / бригадир (10 см.)', qty: 10, price: 12000 },
      { name: 'Рабочий', qty: 10, price: 9750 },
      { name: 'Слесарь (10 см.)', qty: 10, price: 9750 },
      { name: 'Наблюдающий', qty: 10, price: 5500 },
      { name: 'Химик (10 см.)', qty: 10, price: 10000 },
      { name: 'ПТО / приёмка (10 см.)', qty: 10, price: 10000 },
      { name: 'СИЗ + спецодежда', qty: 9, price: 15000 },
      { name: 'Оборудование (амортизация)', qty: 1, price: 100000 },
      { name: 'Аренда техники', qty: 1, price: 50000 },
      { name: 'Накладные (10%)', qty: 1, price: 90000 },
      { name: 'Непредвиденные (5%)', qty: 1, price: 45000 },
      { name: 'Пайковые', qty: 100, price: 1000 },
      { name: 'Проживание', qty: 60, price: 1250 },
      { name: 'Гидроструйная чистка АВО', qty: 2770, price: 500, unit: 'м²' }
    ],
    totals: { price_no_vat: 5000000, markup_multiplier: 1.75 }
  };
  const out = quick.buildClientItems(draft);
  const names = out.map((x) => x.name);
  const forbidden = ['ИТР', 'Мастер', 'Рабочий', 'Слесарь', 'Химик', 'ПТО', 'Наблюдающ',
    'СИЗ', 'амортизац', 'Аренда техники', 'Накладные', 'Непредвиденные', 'Пайковые', 'Проживание'];
  const leaked = names.filter((n) => forbidden.some((f) => new RegExp(f, 'i').test(String(n))));
  assert.deepStrictEqual(leaked, [], 'в клиентскую таблицу утекло: ' + leaked.join(' | '));
  assert.ok(names.some((n) => /Гидроструйная чистка/.test(n)), 'работы потерялись: ' + names.join(' | '));
  const sum = out.reduce((s, i) => s + (Number(i.total) || 0), 0);
  assert.ok(Math.abs(sum - 5000000) < 2, 'Σ строк не равна цене КП: ' + sum);
});

check('демо-позиции удалены из vanilla-канбана', () => {
  assert.ok(KANBAN.indexOf('28500') === -1, 'демо-строки остались в personal_kanban.js');
});

check('демо-позиции удалены из React-канбана', () => {
  assert.ok(BOARD.indexOf('28500') === -1, 'демо-строки остались в BoardV3.jsx');
});

check('выбор «полное КП» приоритетнее блоков', () => {
  const idxFull = TKP.indexOf("blocks.length > 0 && tkp.kp_variant === 'full'");
  assert.ok(idxFull >= 0, 'нет ветки, где kp_variant === full проверяется до блоков');
});

check('from-card отдаёт tkp_id и blocks', () => {
  const tail = TKP.slice(TKP.indexOf('[TKP from-card] failed') - 200);
  assert.ok(/tkp_id: newTkp\.id/.test(tail), 'нет tkp_id в ответе');
  assert.ok(/blocks,/.test(tail) || /blocks:/.test(tail), 'нет blocks в ответе');
});

denyNds20();
function denyNds20() {
  check('НДС в контуре ТКП — 22%, не 20%', () => {
    const fromCard = TKP.slice(TKP.indexOf("fastify.post('/from-card"), TKP.indexOf('// 4) RBAC') + 2000);
    assert.ok(!/vat_pct\) \|\| 20/.test(fromCard), 'остался дефолт НДС 20 в from-card');
    assert.ok(/22/.test(fromCard), 'в from-card нет ставки 22');
  });
}

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
