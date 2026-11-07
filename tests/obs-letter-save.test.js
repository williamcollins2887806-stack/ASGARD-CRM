'use strict';

/**
 * tests/obs-letter-save.test.js
 *
 * V473: тесты сборки письма из payload и сохранения одной транзакцией.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ НАБОР. Письмо — основание платежа и уходит внешнему
 * получателю. Ошибка в сумме, номере или дате — брак в документе. Плюс две
 * вещи, которые легко сделать незаметно неправильно:
 *   • предпросмотр обязан НЕ писать в БД и НЕ тратить исходящий номер;
 *   • сохранение обязано быть атомарным: либо письмо, переписка, вложение и
 *     ссылка в счёте целиком, либо ничего.
 */

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-not-used';

const test = require('node:test');
const assert = require('node:assert');

const obs = require('../src/services/obs-letter');

// ─── Mock-БД. Возвращает строку счёта и справочники, считает вызовы. ───────
function makeDb(opts = {}) {
  const calls = [];
  const doc = Object.assign({
    id: 100,
    invoice_number: 'ДС-1',
    invoice_date: '2026-10-20',
    amount_gross: 12000,
    amount_net: 10000,
    vat_amount: 2000,
    vat_rate: 20,
    counterparty_name: 'ООО «Ромашка»',
    comment_text: '',
    work_id: null,
    subcontract_id: null,
    contract_label: null,
    created_by: 3465,
    doc_owner_id: 3465,
    pm_id: null,
    pi_lines: null,
    obs_account_id: null,
  }, opts.doc || {});

  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params: params || [] });
      const s = String(sql);

      if (/FROM doc_registry d/.test(s) && /LEFT JOIN payment_invoices/.test(s)) {
        return { rows: [doc] };
      }
      if (/FROM works WHERE id/.test(s)) {
        return { rows: [] };
      }
      if (/FROM subcontract_agreements/.test(s)) {
        if (opts.subcontract) return { rows: [opts.subcontract] };
        return { rows: [] };
      }
      if (/FROM obs_accounts/.test(s)) {
        if (opts.obsAccount) return { rows: [opts.obsAccount] };
        return { rows: [] };
      }
      if (/FROM settings/.test(s)) {
        return { rows: [{ j: { name: 'ООО «Асгард-Сервис»', name_short: 'ООО «Асгард-Сервис»' } }] };
      }
      if (/FROM users WHERE id/.test(s)) {
        return { rows: [{ id: 3465, name: 'Путков Дмитрий Вадимович', phone: null }] };
      }
      return { rows: [] };
    },
  };
}

// ─── Сборка данных из payload ─────────────────────────────────────────────
test('payload задаёт номер и дату счёта, а не берёт их из БД', async () => {
  const db = makeDb();
  const data = await obs.buildLetterDataFromPayload(db, 100, {
    invoice_number: 'V052717397',
    invoice_date: '2026-11-05',
  });
  assert.strictEqual(data.doc.invoice_number, 'V052717397');
  assert.strictEqual(String(data.doc.invoice_date).slice(0, 10), '2026-11-05');
});

test('payload задаёт сумму; НЕТТО пересчитывается', async () => {
  const db = makeDb();
  const data = await obs.buildLetterDataFromPayload(db, 100, {
    amount_gross: 113980,
    vat_rate: 20,
    vat_amount: 18996.67,
  });
  assert.strictEqual(data.doc.amount_gross, 113980);
  assert.strictEqual(data.doc.vat_amount, 18996.67);
  assert.strictEqual(data.doc.amount_net, 113980 - 18996.67);
});

test('НДС из ставки считается «в том числе», а не сверху', async () => {
  const db = makeDb();
  const data = await obs.buildLetterDataFromPayload(db, 100, {
    amount_gross: 120000, vat_rate: 20,
  });
  // 120 000 × 20 / 120 = 20 000 (не 24 000).
  assert.ok(Math.abs(Number(data.doc.vat_amount) - 20000) < 0.02,
    `ожидали 20000, получили ${data.doc.vat_amount}`);
});

test('перечень из payload главнее распознанных позиций', async () => {
  const db = makeDb({ doc: { pi_lines: JSON.stringify([{ name: 'Из счёта', qty: 1 }]) } });
  const data = await obs.buildLetterDataFromPayload(db, 100, {
    items: ['Услуга А — 2 шт', 'Услуга Б — 1 шт'],
  });
  assert.deepStrictEqual(data.items, ['Услуга А — 2 шт', 'Услуга Б — 1 шт']);
});

test('пустой перечень не затирает позиции счёта', async () => {
  const db = makeDb({ doc: { pi_lines: JSON.stringify([{ name: 'Из счёта', qty: 3, unit: 'шт' }]) } });
  const data = await obs.buildLetterDataFromPayload(db, 100, { items: [] });
  assert.ok(data.items.length === 1);
  assert.ok(/Из счёта/.test(data.items[0]));
});

test('ОБС-счёт из payload попадает в письмо (куда платить)', async () => {
  const db = makeDb({
    obsAccount: { id: 7, name: 'ОБС «АГПЗ»', bank_name: 'ПАО Банк', bank_account: '40702810000000000001' },
  });
  const data = await obs.buildLetterDataFromPayload(db, 100, { obs_account_id: 7 });
  assert.ok(data.obsAccount);
  assert.strictEqual(data.obsAccount.name, 'ОБС «АГПЗ»');

  const paragraphs = obs.buildLetterParagraphs(data, { number: 'АС-2026-11-1', dateText: '07.11.2026 г.' });
  const joined = paragraphs.join('\n');
  assert.ok(/Оплату просим провести с ОБС «АГПЗ»/.test(joined),
    'в тексте письма есть строка «куда платить»');
});

test('без ОБС-счёта строка «куда платить» не появляется', async () => {
  const db = makeDb();
  const data = await obs.buildLetterDataFromPayload(db, 100, {});
  const joined = obs.buildLetterParagraphs(data, {}).join('\n');
  assert.ok(!/Оплату просим провести с/.test(joined));
});

// ─── Предпросмотр не пишет ────────────────────────────────────────────────
test('предпросмотр не делает INSERT/UPDATE и не трогает счётчик номеров', async () => {
  const db = makeDb();
  // buildLetterDataFromPayload — это тот путь, которым идёт preview.
  await obs.buildLetterDataFromPayload(db, 100, {
    invoice_number: 'X', invoice_date: '2026-11-07', amount_gross: 1000,
  });
  const writes = db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql.trim()));
  assert.deepStrictEqual(writes, [], 'preview не должен менять БД');
  const counter = db.calls.filter((c) => /obs_letter_counter|correspondence_outgoing_counters/.test(c.sql));
  assert.deepStrictEqual(counter, [], 'preview не должен расходовать номер');
});

// ─── Текст письма: суммы и реквизиты ──────────────────────────────────────
test('в тексте письма сумма и сумма прописью совпадают с данными', async () => {
  const db = makeDb();
  const data = await obs.buildLetterDataFromPayload(db, 100, {
    invoice_number: 'V052717397', invoice_date: '2026-11-05',
    amount_gross: 113980, vat_rate: 20, vat_amount: 18996.67,
  });
  const joined = obs.buildLetterParagraphs(data, {}).join('\n').replace(/\u00a0/g, ' ');
  assert.ok(/113 980,00/.test(joined), 'сумма с разделителями');
  assert.ok(obs.amountInWords(113980).includes('Сто тринадцать тысяч девятьсот восемьдесят'),
    'сумма прописью');
  assert.ok(/V052717397/.test(joined), 'номер счёта в тексте');
  assert.ok(/05\.11\.2026/.test(joined), 'дата счёта в тексте');
});

test('длинный перечень ужимается одинаково для PDF и Word', async () => {
  const items = Array.from({ length: 41 }, (_, i) => `Позиция ${i + 1}`);
  const sel = obs.selectLetterItems(items, 'ДС-1');
  assert.strictEqual(sel.shown.length, 20);
  assert.strictEqual(sel.rest, 21);
  assert.ok(/ещё 21 позиция/.test(sel.restLine));
});

// ─── Проверка лимита (чистая логика через сервис) ─────────────────────────
test('checkLimit возвращает недостачу, если остатка не хватает', async () => {
  const registry = require('../src/services/obs-letter-registry');
  const db = {
    query: async () => ({
      rows: [{ number: 'КР-433п26', limit_amount: 3000000, spent_amount: 2990000, remaining: 10000, exhausted: false }],
    }),
  };
  const short = await registry.checkLimit(db, 2, 100, 17537);
  assert.ok(short, 'лимита не хватает — должен вернуться объект');
  assert.strictEqual(short.short_by, 7537);
});

test('checkLimit молчит, если остатка достаточно', async () => {
  const registry = require('../src/services/obs-letter-registry');
  const db = {
    query: async () => ({
      rows: [{ number: 'КР-320п26', limit_amount: 1500000, spent_amount: 400000, remaining: 1100000, exhausted: false }],
    }),
  };
  const short = await registry.checkLimit(db, 1, 100, 17537);
  assert.strictEqual(short, null);
});

// ─── D-397: дефекты, найденные верификатором 07.11.2026 ───────────────────
// Каждый пункт здесь — реальный FAIL из отчёта. Тест закрепляет исправление,
// чтобы дефект не вернулся молча.

test('D-397/1: строка «куда платить» попадает в Word (блок post)', async () => {
  // Раньше outro заканчивался на «Просим оплатить», а строка ОБС шла ПОСЛЕ —
  // в Word не попадала вовсе, хотя в PDF была. Инвариант «PDF = Word» рвался
  // на главном реквизите документа.
  const db = makeDb({
    obsAccount: { id: 1, name: 'ОБС «АГПЗ»', bank_name: 'ПАО Банк', bank_account: '40702810000000000001' },
  });
  const data = await obs.buildLetterDataFromPayload(db, 100, { obs_account_id: 1 });
  const blocks = obs.buildLetterBlocks(data, { number: 'АС-1', dateText: '07.11.2026 г.' });

  assert.ok(Array.isArray(blocks.post), 'есть блок post (параграфы после просьбы)');
  const postText = (blocks.post || []).join(' ');
  assert.ok(/Оплату просим провести с ОБС «АГПЗ»/.test(postText),
    'строка «куда платить» лежит в блоке post');

  // Инвариант: плоский текст == сумма блоков (иначе PDF и Word разойдутся).
  const flat = obs.buildLetterParagraphs(data, { number: 'АС-1', dateText: '07.11.2026 г.' });
  const fromBlocks = [
    ...blocks.intro,
    ...blocks.items.map((t) => '— ' + t),
    ...blocks.invoice,
    ...blocks.outro,
    ...blocks.request,
    ...blocks.post,
  ];
  assert.deepStrictEqual(fromBlocks, flat, 'PDF и Word получают один и тот же текст');
});

test('D-397/2: saveObsLetter не открывает вторую транзакцию внутри recreate', () => {
  // Проверяем по исходнику: вложенный db.transaction давал взаимную блокировку
  // на 30 с и «Пересоздать» не работал. Функция обязана принимать готового
  // клиента (internalClient), а recreate — передавать его.
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/services/obs-letter-registry'), 'utf8');

  assert.ok(/opts\.internalClient/.test(src), 'saveObsLetter умеет работать в чужой транзакции');
  assert.ok(/internalClient:\s*client/.test(src), 'recreate передаёт свой клиент');
  // В recreate не должно остаться вызова saveObsLetter без internalClient.
  const recreateBody = src.slice(src.indexOf('async function recreateObsLetter'));
  const call = recreateBody.match(/saveObsLetter\([^)]*\)/s);
  assert.ok(call && /internalClient/.test(call[0]),
    'вызов saveObsLetter из recreate передаёт internalClient');
});

test('D-397/3: контур оплаты не меняется без права', () => {
  // PM/РП/грант могут писать письмо, но переводить счёт на ОБС — только
  // бухгалтерия. Раньше UPDATE ставил payment_source='obs' безусловно.
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/services/obs-letter-registry'), 'utf8');

  assert.ok(/canSetContour/.test(src), 'сервис различает право на контур');
  assert.ok(/CASE WHEN \$6 THEN 'obs' ELSE payment_source END/.test(src),
    'payment_source меняется только при праве (CASE WHEN)');
  // Договор — отдельный флаг $7 (D-397c): контур может перевести и само письмо
  // ОБС, а договор — только бухгалтерия.
  assert.ok(/subcontract_id = CASE WHEN \$7 THEN \$4 ELSE subcontract_id END/.test(src),
    'subcontract_id меняется только при праве на договор ($7)');

  const route = fs.readFileSync(require.resolve('../src/routes/doc-registry'), 'utf8');
  assert.ok(/const canSetContour = req\.user\.role === 'ADMIN' \|\| OBS_ROLES\.includes/.test(route),
    'роут вычисляет право на контур по роли');
});

test('D-397/4: график оплат не ссылается на несуществующие колонки', () => {
  // BLOCKER: `d.obs_letter_number` / `d.obs_account_name` в doc_registry нет —
  // запрос падал 42703, и вкладка «График оплат» отдавала 500 целиком.
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/routes/doc-registry'), 'utf8');
  // Комментарии не считаем: в пояснении к правке эти имена упомянуты намеренно.
  const code = src.split('\n')
    .filter((l) => !l.trim().startsWith('--') && !l.trim().startsWith('//'))
    .join('\n');

  assert.ok(!/d\.obs_letter_number/.test(code), 'нет ссылки на d.obs_letter_number');
  assert.ok(!/d\.obs_account_name/.test(code), 'нет ссылки на d.obs_account_name');
  assert.ok(/ol\.invoice_number AS obs_letter_number/.test(code),
    'номер письма берётся JOIN-ом из строки письма');
  assert.ok(/oa\.name AS obs_account_name/.test(code),
    'название ОБС берётся JOIN-ом из справочника');
});

test('D-397/5: номер ИСХ на фронте печатается без двойного «Исх.»', () => {
  // В базе номер хранится как «Исх. АС-…», плашка добавляла «Исх.» ещё раз.
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../public/assets/js/doc-hub'), 'utf8');

  assert.ok(/function isoNumberText/.test(src), 'есть единая функция стрипа префикса');
  assert.ok(/replace\(\/\^Исх/.test(src), 'префикс «Исх.» снимается регуляркой');
  const usages = (src.match(/isoNumberText\(/g) || []).length;
  assert.ok(usages >= 3, `функция используется во всех местах (найдено ${usages})`);
});

// ─── D-397b: замечания второго прохода верификатора ──────────────────────
// Найдены ВНЕ чек-листа A–H, но реальны: противоречивое состояние контура,
// расхождение PDF/Word в шапке и потеря данных при закрытии модалки.

test('D-397b/1: письмо по ОБС-счёту не оставляет контур «расчётный»', () => {
  // Письмо ОБС существовало при payment_source='regular': расход не попадал
  // в лимит существенности (функция считает только ОБС-счета) — договор
  // «недобирал» использованную сумму.
  const fs = require('fs');
  const route = fs.readFileSync(require.resolve('../src/routes/doc-registry'), 'utf8');
  assert.ok(/forceObsContour/.test(route), 'роут вычисляет необходимость перевода контура');

  const svc = fs.readFileSync(require.resolve('../src/services/obs-letter-registry'), 'utf8');
  assert.ok(/const setObs = canSetContour \|\| opts\.forceObsContour === true/.test(svc),
    'сервис ставит контур при праве ИЛИ при наличии письма ОБС');
});

test('D-397b/2: предпросмотр Word не печатает пустой «Исх. №»', () => {
  // PDF подставлял «б/н», Word — пустоту: один предпросмотр выглядел
  // по-разному в двух форматах.
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/services/obs-letter'), 'utf8');
  const block = src.slice(src.indexOf('async function renderObsLetterDocx'));
  const body = block.slice(0, block.indexOf('\n}'));
  assert.ok(/'б\/н'/.test(body), 'Word получает «б/н», когда номера ещё нет');
});

test('D-397b/3: предпросмотр не сбрасывает флаг несохранённых правок', () => {
  // Раньше doPreview ставил dirty=false при saved=null — закрытие окна
  // после предпросмотра теряло введённые данные без подтверждения.
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../public/assets/js/obs-letter-modal'), 'utf8');
  const preview = src.slice(src.indexOf('async function doPreview'));
  const body = preview.slice(0, preview.indexOf('async function download'));
  // Комментарии выкидываем: в пояснении к правке фраза упомянута намеренно.
  const code = body.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/state\.dirty = false/.test(code),
    'doPreview больше не сбрасывает dirty (это делает только save)');
  assert.ok(/state\.dirty = false/.test(src), 'save по-прежнему сбрасывает dirty');
});

test('D-397c: договор меняет только бухгалтерия (отдельный флаг от контура)', () => {
  // FAIL третьего верификатора 07.11.2026: `subcontract_id` гейтился тем же
  // флагом, что и контур. А контур теперь выставляется и без права (письмо
  // ОБС обязано перевести счёт). В итоге PM с грантом подставлял ЛЮБОЙ
  // договор из payload в обход PATCH /:id/subcontract (только BUH) — и лимит
  // расходовался не по тому основанию.
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/services/obs-letter-registry'), 'utf8');

  assert.ok(/const setSubcontract = canSetContour/.test(src),
    'договор гейтится своим флагом canSetContour, а не setObs');
  assert.ok(/subcontract_id = CASE WHEN \$7 THEN \$4/.test(src),
    'subcontract_id использует $7 (право на договор), а не $6 (контур)');
  assert.ok(/canSetContourEarly/.test(src),
    'выбор договора до INSERT тоже ограничен правом: иначе лимит считается не по тому договору');

  // И контур по-прежнему переводится сам при создании письма ОБС.
  assert.ok(/const setObs = canSetContour \|\| opts\.forceObsContour === true/.test(src),
    'контур переводится при праве или при письме ОБС');
});

test('D-397d: договор валидируется — несуществующий и неактивный отклоняются', async () => {
  // MAJOR верификатора 07.11.2026: `checkLimit` возвращал null, если строки
  // договора нет, — письмо записывалось на несуществующий договор, а лимит
  // не считался вовсе. В отличие от PATCH /:id/subcontract, где проверки есть.
  const registry = require('../src/services/obs-letter-registry');

  // Несуществующий договор.
  const dbMissing = { query: async () => ({ rows: [] }) };
  let threw = null;
  try { await registry.checkLimit(dbMissing, 999, 1, 100); } catch (e) { threw = e; }
  assert.ok(threw, 'отсутствующий договор — исключение, а не тихий null');
  assert.strictEqual(threw.statusCode, 400);
  assert.ok(/не найден/i.test(threw.message));

  // Неактивный договор.
  const dbInactive = {
    query: async () => ({
      rows: [{ number: 'КР-старый', limit_amount: 1000, is_active: false, spent_amount: 0, remaining: 1000, exhausted: false }],
    }),
  };
  threw = null;
  try { await registry.checkLimit(dbInactive, 5, 1, 100); } catch (e) { threw = e; }
  assert.ok(threw, 'деактивированный договор — исключение');
  assert.ok(/деактивирован/i.test(threw.message));

  // Живой договор с достатком — молча пропускает.
  const dbOk = {
    query: async () => ({
      rows: [{ number: 'КР-433п26', limit_amount: 3000000, is_active: true, spent_amount: 0, remaining: 3000000, exhausted: false }],
    }),
  };
  assert.strictEqual(await registry.checkLimit(dbOk, 2, 1, 1000), null);
});

test('D-397e: правки после сохранения не теряются молча', () => {
  // MINOR верификатора 07.11.2026: после save `state.saved` оставался, и
  // последующие правки при закрытии окна исчезали без подтверждения.
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../public/assets/js/obs-letter-modal'), 'utf8');
  const runner = src.slice(src.indexOf('function markDirty'));
  const body = runner.slice(0, runner.indexOf('function collectPayload'));
  assert.ok(/state\.saved = null/.test(body),
    'markDirty сбрасывает saved — новая правка отменяет прошлое сохранение');
});


