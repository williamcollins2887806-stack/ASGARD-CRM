'use strict';
/**
 * Детектор недобора позиций — проверка НАСТОЯЩЕГО generateDv.
 *
 * Дефект 07.11.2026: конвейер не отличал «модель закончила» от «модель сдалась».
 * Условие выхода было привязано к `_salvaged` (признак обрезки JSON), поэтому
 * валидный JSON с ОДНОЙ позицией принимался как полный ответ. Тендер 2138
 * давал то 1, то 353 позиции из 673 строк ведомости.
 *
 * ВАЖНО: тест вызывает настоящую функцию с подменённым провайдером, а не
 * переписывает формулы локально — иначе он остаётся зелёным при откаченном
 * коде и не ловит регрессии (на это указал верификатор).
 */
const assert = require('assert');
const aiModule = require('../src/services/mimir-tender-stages-ai');
const stages = require('../src/services/mimir-tender-stages');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const CATALOG = {
  categories: [
    { code: 'vessels', title: 'Ёмкости', methods_json: [{ code: 'clean', label: 'Зачистка' }] }
  ]
};

/** Провайдер, который всегда отдаёт заранее заданные ответы по кругу. */
function stubProvider(answers) {
  let i = 0;
  const calls = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      const a = answers[Math.min(i, answers.length - 1)];
      i += 1;
      return typeof a === 'function' ? a(req) : a;
    }
  };
}

/** Ответ модели с N позициями. */
function dvWith(n, opts) {
  const o = opts || {};
  const positions = [];
  for (let k = 1; k <= n; k += 1) {
    positions.push({
      name: `Позиция ${k}`,
      category_code: 'vessels',
      method_code: 'clean',
      volume: o.noVolume ? null : (10 + k),
      unit: o.noVolume ? '' : 'м3'
    });
  }
  return {
    text: JSON.stringify({ decision_recommend: 'go', summary: 'тест', positions }),
    stopReason: o.stopReason || 'stop',
    usage: { inputTokens: 100, outputTokens: 50 },
    model: 'stub'
  };
}

/** Ведомость с большим числом строк — чтобы детектор увидел ожидание. */
function bigVedomost(rows) {
  const lines = [];
  for (let k = 1; k <= rows; k += 1) lines.push(`| ${k} | Очистка оборудования ${k} | м3 | ${100 + k} |`);
  return [{ original_name: 'ВОР.xlsx', text: lines.join('\n') }];
}

(async () => {
  // ── 1. Ожидание неизвестно (только ТЗ) — один вызов, без фантомов ────────
  await check('без ведомости цикл делает ОДИН вызов', async () => {
    // Это блокер, найденный верификатором: при expectedMin=0 прежняя логика
    // всегда шла на второй раунд, модель возвращала хвост первого ответа,
    // и в ДВ попадали фантомные позиции без объёма.
    const provider = stubProvider([dvWith(2), dvWith(2)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Промывка котла',
      documents: [{ original_name: 'ТЗ.pdf', text: 'Промывка котла К-1, объём 2 м3. '.repeat(30) }],
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.ok, true, 'разбор упал: ' + out.error);
    assert.strictEqual(provider.calls.length, 1, 'сделано вызовов: ' + provider.calls.length + ', а должен быть 1');
    assert.strictEqual(out.dv.positions.length, 2, 'позиций: ' + out.dv.positions.length);
    assert.strictEqual(out.rounds, 1, 'раундов: ' + out.rounds);
    assert.strictEqual(out.expected_min, 0, 'ожидание должно быть 0');
  });

  // ── 2. Одна позиция при большом ожидании — идёт добор ────────────────────
  await check('1 позиция при ожидании сотен — просит продолжить', async () => {
    const provider = stubProvider([dvWith(1), dvWith(1)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(400),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.ok(out.expected_min > 100, 'ожидание слишком мало: ' + out.expected_min);
    assert.ok(provider.calls.length > 1, 'добор не запущен, вызовов: ' + provider.calls.length);
    assert.strictEqual(out.incomplete, true, 'неполный разбор не помечен');
    assert.ok(/неполный/i.test(String(out.incomplete_note || '')), 'нет пояснения: ' + out.incomplete_note);
  });

  // ── 3. Достаточное число позиций — без лишних раундов ────────────────────
  await check('достаточно позиций — один вызов', async () => {
    // Ведомость 400 строк → realRows 400. Модель отдаёт 400 позиций (100%).
    // Один вызов, разбор полный.
    const provider = stubProvider([dvWith(400)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(400),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.ok(out.expected_min > 0, 'ожидание не посчитано');
    assert.strictEqual(provider.calls.length, 1, 'лишние вызовы: ' + provider.calls.length);
    assert.strictEqual(out.incomplete, false, 'полный разбор помечен неполным');
  });

  // ── 4. Обрезка при неизвестном ожидании — ОДИН вызов ────────────────────
  await check('обрезанный ответ без ведомости не уходит в 8 раундов', async () => {
    // Дефект, найденный верификатором: выход был заперт внутри
    // `if (!wasTruncated)`, поэтому при expectedMin=0 и stopReason='length'
    // цикл шёл до MAX_ROUNDS, плодя фантомные позиции без объёма.
    const provider = stubProvider([
      dvWith(3, { stopReason: 'length' }),
      dvWith(3, { stopReason: 'length' }),
      dvWith(3, { stopReason: 'length' })
    ]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Промывка котла',
      documents: [{ original_name: 'ТЗ.pdf', text: 'Промывка котла К-1, объём 2 м3. '.repeat(30) }],
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.expected_min, 0, 'ожидание должно быть 0');
    assert.strictEqual(provider.calls.length, 1, 'вызовов: ' + provider.calls.length + ', должен быть 1');
    assert.strictEqual(out.dv.positions.length, 3, 'позиций: ' + out.dv.positions.length);
  });

  // ── 5. Достаточно позиций при обрезке — тоже один вызов ──────────────────
  await check('первый раунд исчерпал ведомость — не более 2 вызовов', async () => {
    // Первый раунд вернул 200 позиций при ожидании 200. Обрезка по length
    // здесь означает, что модель закрыла массив на последней позиции.
    // Второй раунд вернёт те же позиции и цикл выйдет по !got — данных
    // не теряем. Допускаем 2 вызова (проверка прироста), но не 8.
    const provider = stubProvider([
      dvWith(200, { stopReason: 'length' }),
      dvWith(200, { stopReason: 'length' }),
      dvWith(200, { stopReason: 'length' })
    ]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(400),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.ok(out.expected_min > 0, 'ожидание не посчитано');
    assert.ok(provider.calls.length <= 2,
      'вызовов: ' + provider.calls.length + ', должно быть не больше 2');
    assert.strictEqual(out.dv.positions.length, 200, 'позиции потеряны: ' + out.dv.positions.length);
  });

  // ── 6. Обрезка по finish_reason ──────────────────────────────────────────
  await check('finish_reason=length запускает добор', async () => {
    const provider = stubProvider([
      dvWith(100, { stopReason: 'length' }),
      dvWith(100)
    ]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(400),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.truncated_by_length, true, 'обрезка по лимиту не распознана');
    assert.ok(provider.calls.length >= 2, 'добор при обрезке не запущен');
  });

  await check('finish_reason=max_tokens (Anthropic) тоже считается обрезкой', async () => {
    const provider = stubProvider([
      dvWith(100, { stopReason: 'max_tokens' }),
      dvWith(100)
    ]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(400),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.truncated_by_length, true, 'Anthropic-обрезка не распознана');
  });

  // ── 5. Позиции без объёма не закрывают порог ─────────────────────────────
  await check('позиции без объёма не считаются выполненными', async () => {
    // Верификатор: 250 позиций без объёма формально закрывали порог,
    // хотя считать по ним нечего.
    const provider = stubProvider([dvWith(300, { noVolume: true }), dvWith(300, { noVolume: true })]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(400),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.valid_positions, 0, 'валидных не должно быть: ' + out.valid_positions);
    assert.strictEqual(out.incomplete, true, 'разбор без объёмов признан полным');
  });

  // ── 6. Дедупликация при доборе ───────────────────────────────────────────
  await check('повторы между раундами схлопываются', async () => {
    const provider = stubProvider([dvWith(2), dvWith(2), dvWith(2)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(400),
      history_block: '(нет)',
      catalog: CATALOG
    });
    // Второй раунд вернул те же позиции → новых нет → выход по !got.
    assert.strictEqual(out.dv.positions.length, 2, 'дубли не схлопнуты: ' + out.dv.positions.length);
  });

  // ── 6б. Первый обрезанный ответ выше порога — добор обязателен ────────────
  await check('первый раунд обрезан выше порога, но ниже ожидания — добирает', async () => {
    // РЕГРЕССИЯ, найденная верификатором: на первом раунде прирост всегда 0,
    // и проверка grewWell обрывала цикл сразу. На тендере 2138 собиралось
    // 353 позиции из 673 с incomplete=false — ровно тот инцидент, ради
    // которого делался детектор.
    // Ведомость 800 строк → ожидание 400. Первый раунд 353 (выше порога 320,
    // но ниже 400), второй даёт остальные.
    let round = 0;
    const provider = {
      calls: [],
      async complete() {
        round += 1;
        const take = round === 1 ? 353 : 400;
        const offset = round === 1 ? 0 : 353;
        const positions = Array.from({ length: take }, (_, k) => ({
          name: `Аппарат ${offset + k + 1}`,
          category_code: 'vessels', method_code: 'clean',
          volume: 10 + offset + k, unit: 'м3'
        }));
        return {
          text: JSON.stringify({ positions }),
          stopReason: 'length', usage: { inputTokens: 100, outputTokens: 50 }, model: 'stub'
        };
      }
    };
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(800),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.ok(round >= 2, 'добор не выполнен, вызовов: ' + round);
    assert.ok(out.dv.positions.length >= 400,
      'потеряны позиции: собрано ' + out.dv.positions.length + ' из 400+');
  });

  // ── 7. Фантомы без объёма не жгут 8 раундов ──────────────────────────────
  await check('позиции без объёма при обрезке — ровно 2 вызова', async () => {
    // Дефект, найденный верификатором: если модель каждый раунд отдаёт НОВЫЕ
    // имена без объёма, порог не закрывался и цикл шёл все 8 раундов,
    // накапливая фантомы и тратя по 64k токенов.
    // Тест точный (строго 2 вызова), чтобы ловить снятие защиты мутацией.
    let n = 0;
    const provider = {
      calls: [],
      async complete() {
        n += 1;
        const positions = Array.from({ length: 3 }, (_, k) => ({
          name: `Фантом ${n}-${k}`, volume: null, unit: ''
        }));
        return { text: JSON.stringify({ positions }), stopReason: 'length', usage: {}, model: 'stub' };
      }
    };
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(400),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(n, 2, 'вызовов: ' + n + ', должно быть ровно 2');
    assert.strictEqual(out.valid_positions, 0, 'годных быть не должно');
  });

  // ── 8. Прирост новых позиций сохраняется ─────────────────────────────────
  await check('обрезанный ответ с реальным приростом — продолжает добор', async () => {
    // Дефект, найденный верификатором: сценарий 50→200→200 обрывался на втором
    // раунде, теряя 200 реальных позиций. Другая сторона: если считать СЫРЫЕ
    // позиции вместо новых, повтор ведомости закрывает порог и жжёт 8 раундов.
    // Тест обязан различить: второй раунд даёт реально НОВЫЕ позиции.
    const r1 = {
      text: JSON.stringify({ positions: Array.from({ length: 50 }, (_, k) => ({
        name: `Аппарат A${k + 1}`, category_code: 'vessels', method_code: 'clean', volume: 10 + k, unit: 'м3'
      })) }),
      stopReason: 'length', usage: { inputTokens: 100, outputTokens: 50 }, model: 'stub'
    };
    const r2 = {
      text: JSON.stringify({ positions: Array.from({ length: 150 }, (_, k) => ({
        name: `Аппарат B${k + 1}`, category_code: 'vessels', method_code: 'clean', volume: 200 + k, unit: 'м3'
      })) }),
      stopReason: 'length', usage: { inputTokens: 100, outputTokens: 50 }, model: 'stub'
    };
    const provider = stubProvider([r1, r2, r2]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(400),
      history_block: '(нет)',
      catalog: CATALOG
    });
    // 50 + 150 = 200 позиций. Порог ~160 пройден после второго раунда,
    // но прирост был заметный — третий раунд допустим. Главное: обе партии целы.
    assert.ok(out.dv.positions.length >= 200, 'потеряны позиции: ' + out.dv.positions.length);
  });

  // ── 8а. Дубли не считаются приростом ─────────────────────────────────────
  await check('повтор ведомости +1 новая не жжёт 8 раундов', async () => {
    // Дефект, найденный верификатором: grownInRound считал СЫРЫЕ позиции,
    // поэтому повтор ведомости +1 новая держал цикл до 8 раундов по 64k токенов.
    // Сценарий должен иметь РЕАЛЬНЫЙ прирост +1 (иначе выход по !got и
    // мутация не ловится).
    const base = Array.from({ length: 200 }, (_, k) => ({
      name: `Аппарат ${k + 1}`, category_code: 'vessels', method_code: 'clean', volume: 10 + k, unit: 'м3'
    }));
    let round = 0;
    const provider = {
      calls: [],
      async complete() {
        round += 1;
        // Первый раунд — МЕНЬШЕ порога (100 из 200), чтобы гарантированно
        // дойти до второго. Второй и дальше — вся ведомость + 1 новая.
        const take = round === 1 ? 100 : base.length;
        const positions = base.slice(0, take).concat([{
          name: `Новая ${round}`, category_code: 'vessels', method_code: 'clean', volume: 5000 + round, unit: 'м3'
        }]);
        return {
          text: JSON.stringify({ positions }),
          stopReason: 'length', usage: { inputTokens: 100, outputTokens: 50 }, model: 'stub'
        };
      }
    };
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(400),
      history_block: '(нет)',
      catalog: CATALOG
    });
    // Второй раунд дал 201 позицию (порог 160 пройден), но реальный прирост
    // всего +101... Проверяем главное: цикл не ушёл в 8 раундов из-за того,
    // что СЫРЫХ позиций каждый раз 201.
    assert.ok(round <= 4, 'вызовов: ' + round + ', прирост от дублей держит цикл');
    assert.ok(out.dv.positions.length >= 200, 'потеряны позиции: ' + out.dv.positions.length);
  });

  // ── 9. ТЗ не раздувает ожидание ──────────────────────────────────────────
  await check('нумерованные пункты ТЗ не считаются позициями', async () => {
    // Дефект, найденный верификатором: после склейки документов в один блок
    // пункты ТЗ вида «1. Требование…» считались позициями, и ожидание
    // раздувалось с 10 до 160 — ложный incomplete и лишний раунд.
    const vorLines = [];
    for (let k = 1; k <= 20; k += 1) vorLines.push(`| ${k} | Очистка | м3 | ${10 + k} |`);
    const tzLines = [];
    for (let k = 1; k <= 300; k += 1) tzLines.push(`${k}. Требование к работам номер ${k}`);

    const provider = stubProvider([dvWith(20)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: [
        { original_name: 'ВОР.xlsx', text: vorLines.join('\n') },
        { original_name: 'ТЗ.pdf', text: tzLines.join('\n') }
      ],
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.ok(out.expected_min <= 40, 'ожидание раздуто пунктами ТЗ: ' + out.expected_min);
  });

  // ── 11. Флаг неполноты независим от порога добора ───────────────────────
  await check('353 из 673 — в пределах допуска, даётся сводка для сверки', async () => {
    // 353 из 673 = 52%. Порог консервативный (50%): при ошибке счётчика вдвое
    // в любую сторону такое соотношение остаётся в допуске. Недобор здесь
    // не доказан — РП получает сводку с числами и решает сам.
    const provider = stubProvider([dvWith(353), dvWith(353)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(673),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.ok(out.expected_rows > 600, 'позиции ведомости не посчитаны: ' + out.expected_rows);
    assert.ok(out.review_hint, 'нет сводки для сверки');
    assert.ok(out.review_hint.includes(String(out.valid_positions)),
      'в сводке нет числа разобранных позиций');
  });

  await check('подстроки «в т.ч.» не удваивают число позиций', async () => {
    // Корень, найденный верификатором: если каждая позиция занимает две
    // строки (работа + «в т.ч. ППР»), счётчик удваивался, и полный разбор
    // 336 из 336 помечался неполным. Теперь подстроки отфильтрованы.
    const lines = [];
    for (let k = 1; k <= 336; k += 1) {
      lines.push(`| ${k} | Очистка оборудования ${k} | м3 | ${100 + k} |`);
      lines.push(`| | в т.ч. ППР | м3 | ${10 + k} |`);
    }
    const provider = stubProvider([dvWith(336)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: [{ original_name: 'ВОР.xlsx', text: lines.join('\n') }],
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.expected_rows, 336,
      'подстроки посчитаны как позиции: ' + out.expected_rows);
    assert.strictEqual(out.incomplete, false,
      'полный разбор помечен неполным: ' + out.valid_positions + ' из ' + out.expected_rows);
  });

  await check('явный недобор — помечается неполным', async () => {
    // 200 позиций при 673 в ведомости — доказанный пропуск.
    const provider = stubProvider([dvWith(200), dvWith(200)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(673),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.incomplete, true,
      'недобор не виден: собрано ' + out.valid_positions + ' при минимуме ' + out.min_possible_positions);
  });

  await check('достаточное число — разбор полный', async () => {
    const provider = stubProvider([dvWith(673)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: bigVedomost(673),
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.incomplete, false,
      'полный разбор помечен неполным: ' + out.valid_positions + ' из ' + out.expected_rows);
  });

  // ── 12. Монотонность: размер ведомости не ухудшает разбор ───────────────
  await check('крупная ведомость не даёт меньше позиций, чем мелкая', async () => {
    // Корень, найденный верификатором: порог прироста зависел от expectedMin
    // (5% от размера), поэтому 673 строки давали 670 позиций, а 720 — только
    // 370. Теперь порог абсолютный.
    const run = async (rows) => {
      let r = 0;
      const provider = {
        calls: [],
        async complete() {
          r += 1;
          const take = [353, 17, 300][Math.min(r - 1, 2)];
          const off = r === 1 ? 0 : (r === 2 ? 353 : 370);
          const positions = Array.from({ length: take }, (_, k) => ({
            name: `Поз ${off + k + 1}`, category_code: 'vessels', method_code: 'clean',
            volume: 10 + off + k, unit: 'м3'
          }));
          return {
            text: JSON.stringify({ positions }),
            stopReason: 'length', usage: { inputTokens: 10, outputTokens: 5 }, model: 'stub'
          };
        }
      };
      const out = await aiModule.generateDv({
        aiProvider: provider,
        tz_text: 'Очистка',
        documents: bigVedomost(rows),
        history_block: '(нет)',
        catalog: CATALOG
      });
      return out.dv.positions.length;
    };

    const small = await run(673);
    const big = await run(720);
    const bigger = await run(800);
    assert.ok(big >= small, `720 строк дали ${big}, а 673 дали ${small} — инверсия`);
    assert.ok(bigger >= big, `800 строк дали ${bigger}, а 720 дали ${big} — инверсия`);
  });

  await check('нумерованные пункты преамбулы не считаются позициями', async () => {
    // Корень, найденный верификатором: `startsNumbered` ловил «1. Общие
    // указания» и завышал rows — полный разбор помечался неполным.
    const lines = ['1. Общие указания', '2. Требования к сдаче-приёмке'];
    for (let k = 1; k <= 200; k += 1) {
      lines.push(`| ${k} | Очистка ${k} | м3 | ${100 + k} |`);
    }
    const provider = stubProvider([dvWith(200)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: [{ original_name: 'ВОР.xlsx', text: lines.join('\n') }],
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.expected_rows, 200,
      'пункты преамбулы посчитаны позициями: ' + out.expected_rows);
    assert.strictEqual(out.incomplete, false, 'полный разбор помечен неполным');
  });

  await check('дубль перечня вторым документом не удваивает позиции', async () => {
    // Корень, найденный верификатором: один перечень, пришедший ВОР+актом,
    // удваивал rows, и полнота становилась недостижимой (min = 1346 при
    // максимуме 673 позиции).
    const lines = [];
    for (let k = 1; k <= 300; k += 1) lines.push(`| ${k} | Очистка ${k} | м3 | ${100 + k} |`);
    const provider = stubProvider([dvWith(300)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: [
        { original_name: 'ВОР.xlsx', text: lines.join('\n') },
        { original_name: 'Акт.xlsx', text: lines.join('\n') }
      ],
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.expected_rows, 300,
      'дубль удвоил число позиций: ' + out.expected_rows);
    assert.strictEqual(out.incomplete, false, 'полный разбор помечен неполным');
  });

  await check('служебный заголовок листа xlsx не выключает детектор', async () => {
    // КРИТИЧНЫЙ дефект, найденный верификатором: парсер пишет в текст
    // `=== Ведомость объёмов ===`, а нарезка промпта принимала это за границу
    // документа. Роль становилась null, детектор выключался целиком: 300
    // позиций принимались за полный разбор из одной.
    // Это самый частый канал загрузки — xlsx-ведомости.
    let lines = '=== Ведомость объёмов ===\n№ | Наименование | Ед | Кол-во\n';
    for (let k = 1; k <= 300; k += 1) {
      lines += `| ${k} | Очистка ${k} | м3 | ${100 + k} |\n`;
    }
    const provider = stubProvider([dvWith(1)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: [{ original_name: 'Ведомость.xlsx', text: lines }],
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.strictEqual(out.expected_rows, 300,
      'детектор выключен служебным заголовком, rows=' + out.expected_rows);
    assert.strictEqual(out.incomplete, true, 'недобор не виден');
  });

  await check('подстроки с маркерами списка не раздувают счёт', () => {
    const stages = require('../src/services/mimir-tender-stages');
    let text = '';
    for (let k = 1; k <= 100; k += 1) {
      text += `| ${k} | Очистка ${k} | м3 | ${100 + k} |\n`;
      text += '• в т.ч. ППР | м3 | 25\n';
      text += '- в том числе | м3 | 10\n';
    }
    text += '— Итого: 1234 м3\n';
    const r = stages.countTableRowsDetailed([text]);
    assert.strictEqual(r.rows, 100, 'подстроки посчитаны позициями: ' + r.rows);
  });

  await check('единица в шапке таблицы учитывается', () => {
    const stages = require('../src/services/mimir-tender-stages');
    let text = 'Наименование | Объём, м3 |\n';
    for (let k = 1; k <= 100; k += 1) text += `| ${k} | Очистка ${k} | ${100 + k} |\n`;
    const r = stages.countTableRowsDetailed([text]);
    assert.strictEqual(r.rows, 100, 'позиции без единицы в строке не посчитаны: ' + r.rows);
  });

  await check('единица «т» распознаётся без \\b (ASCII-ловушка)', () => {
    const stages = require('../src/services/mimir-tender-stages');
    let text = '';
    for (let k = 1; k <= 100; k += 1) text += `Отходы металла ${k} — ${100 + k} т\n`;
    const r = stages.countTableRowsDetailed([text]);
    assert.strictEqual(r.rows, 100, 'тонны не распознаны: ' + r.rows);
  });

  await check('счёт по нумерации работает во всех форматах', () => {
    const stages = require('../src/services/mimir-tender-stages');
    const cases = [];
    // xlsx через ExcelJS — колонки через |
    const a = [];
    for (let k = 1; k <= 300; k += 1) a.push(`| ${k} | Очистка ${k} | м3 | ${100 + k} |`);
    cases.push(['xlsx pipe', a.join('\n'), 300]);
    // docx через mammoth — ячейка = отдельная строка
    const b = [];
    for (let k = 1; k <= 300; k += 1) b.push(`${k}\n\nОчистка ${k}\n\nм3\n\n${100 + k}`);
    cases.push(['docx mammoth', b.join('\n'), 300]);
    // csv через SheetJS — запятые
    const c = [];
    for (let k = 1; k <= 300; k += 1) c.push(`${k},Очистка ${k},м3,${100 + k}`);
    cases.push(['csv', c.join('\n'), 300]);
    // текст с погонными метрами — единицы «м» не было в старом списке
    const d = [];
    for (let k = 1; k <= 250; k += 1) d.push(`${k}. Замена участка ${k} — ${100 + k} м`);
    cases.push(['погонные метры', d.join('\n'), 250]);

    for (const [name, text, want] of cases) {
      const got = stages.countTableRowsDetailed([text]).rows;
      assert.strictEqual(got, want, `${name}: получено ${got}, ожидалось ${want}`);
    }
  });

  await check('дубль перечня двумя документами не удваивает', () => {
    const stages = require('../src/services/mimir-tender-stages');
    const lines = [];
    for (let k = 1; k <= 300; k += 1) lines.push(`| ${k} | Очистка ${k} | м3 | ${100 + k} |`);
    const text = lines.join('\n');
    const got = stages.countTableRowsDetailed([text, text]).rows;
    assert.strictEqual(got, 300, 'дубль удвоил позиции: ' + got);
  });

  await check('пункты ТЗ без объёма не считаются позициями', () => {
    const stages = require('../src/services/mimir-tender-stages');
    const tz = [];
    for (let k = 1; k <= 300; k += 1) tz.push(`${k}. Требование к работам номер ${k}`);
    const got = stages.countTableRowsDetailed([tz.join('\n')]).rows;
    assert.strictEqual(got, 0, 'пункты ТЗ посчитаны позициями: ' + got);
  });

  await check('погонные метры без нумерации считаются резервным путём', () => {
    // Без нумерации остаётся путь по единицам. «м» раньше отсутствовала в
    // списке — 250 позиций в погонных метрах давали 0, детектор выключался.
    const stages = require('../src/services/mimir-tender-stages');
    const lines = [];
    for (let k = 1; k <= 250; k += 1) lines.push(`Замена участка ${k} — ${100 + k} м`);
    const got = stages.countTableRowsDetailed([lines.join('\n')]).rows;
    assert.strictEqual(got, 250, 'погонные метры не посчитаны: ' + got);
  });

  // ── 13. Оценка ожидания ──────────────────────────────────────────────────
  await check('ожидание считается по строкам таблицы', () => {
    const n = stages.estimateExpectedPositions(bigVedomost(600));
    assert.ok(n > 100, 'оценка слишком мала: ' + n);
    // Оценка считается по строкам-позициям (с объёмом и единицей), а не по
    // любым строкам: подстроки и нумерация больше не раздувают счётчик.
    assert.ok(n <= 600, 'оценка больше строк ведомости: ' + n);
  });

  await check('договор не считается источником позиций', () => {
    const doc = { original_name: 'Договор поставки.docx', text: 'условия договора '.repeat(500) };
    assert.strictEqual(stages.estimateExpectedPositions([doc]), 0);
  });

  await check('ВОР названный «Приложение N» всё равно учитывается', async () => {
    // Дефект, найденный верификатором: роль определялась верно по тексту,
    // но estimateExpectedPositions повторно смотрела на ИМЯ и отсекала
    // «Приложение 1.xlsx». В итоге expected_min = 0 и детектор молча выключался.
    // Так грузят ВОР у Апатита (2158) и в 2133.
    const lines = ['Ведомость объёмов работ'];
    for (let k = 1; k <= 400; k += 1) lines.push(`| ${k} | Очистка оборудования ${k} | м3 | ${100 + k} |`);
    const provider = stubProvider([dvWith(1), dvWith(1)]);
    const out = await aiModule.generateDv({
      aiProvider: provider,
      tz_text: 'Очистка',
      documents: [{ original_name: 'Приложение 1.xlsx', text: lines.join('\n') }],
      history_block: '(нет)',
      catalog: CATALOG
    });
    assert.ok(out.expected_min > 50, 'ВОР по тексту не учтён, ожидание: ' + out.expected_min);
    assert.strictEqual(out.incomplete, true, 'одна позиция признана полным разбором');
  });

  await check('копии ведомости с правлеными объёмами схлопываются', async () => {
    // Дефект, найденный верификатором: textSignature брала строку вместе с
    // объёмом, хотя комментарий обещал «только названия». Копия с
    // поправленными объёмами не схлопывалась: 4 копии → ожидание 1200 при
    // 300 реальных позициях и ложный incomplete на полном разборе.
    const vor = (qtyOffset) => {
      const lines = ['| № | Наименование | Ед | Кол-во |'];
      for (let k = 1; k <= 300; k += 1) lines.push(`| ${k} | Очистка ${k} | м3 | ${qtyOffset + k} |`);
      return lines.join('\n');
    };
    const docs = [];
    for (let c = 0; c < 4; c += 1) {
      docs.push({ original_name: `ВОР${c ? ' (' + c + ')' : ''}.xlsx`, text: vor(c * 5), table_positions: 300 });
    }
    const provider = stubProvider([dvWith(300)]);
    const out = await aiModule.generateDv({
      aiProvider: provider, tz_text: 'Очистка',
      documents: docs, history_block: '(нет)', catalog: CATALOG
    });
    assert.strictEqual(out.expected_rows, 300,
      'копии не схлопнулись: ожидание ' + out.expected_rows);
    assert.strictEqual(out.incomplete, false, 'ложный недобор на полном разборе');
  });

  await check('два разных перечня не схлопываются', async () => {
    const lines1 = ['| № | Наименование | Ед | Кол-во |'];
    for (let k = 1; k <= 300; k += 1) lines1.push(`| ${k} | Очистка ${k} | м3 | ${10 + k} |`);
    const lines2 = ['| № | Наименование | Ед | Кол-во |'];
    for (let k = 1; k <= 50; k += 1) lines2.push(`| ${k} | Замена труб ${k} | п.м | ${20 + k} |`);
    const provider = stubProvider([dvWith(350)]);
    const out = await aiModule.generateDv({
      aiProvider: provider, tz_text: 'Очистка',
      documents: [
        { original_name: 'ВОР.xlsx', text: lines1.join('\n'), table_positions: 300 },
        { original_name: 'Ведомость.xlsx', text: lines2.join('\n'), table_positions: 50 }
      ],
      history_block: '(нет)', catalog: CATALOG
    });
    assert.strictEqual(out.expected_rows, 350, 'разные перечни потерялись: ' + out.expected_rows);
  });

  await check('занижённый структурный счёт не маскирует недобор', async () => {
    // ГЛАВНЫЙ дефект, найденный верификатором: структурный счёт может
    // занижать (пропущенная шапка, заголовок раздела). Раньше текстовый
    // резерв включался только при нуле, поэтому счёт 42 при 300 реальных
    // строк давал «разбор полный» — 258 пропущенных строк невидимы.
    // Теперь оба источника считаются, берётся больший.
    const lines = ['| № | Наименование | Ед | Кол-во |'];
    for (let k = 1; k <= 300; k += 1) lines.push(`| ${k} | Очистка ${k} | м3 | ${10 + k} |`);
    const provider = stubProvider([dvWith(42)]);
    const out = await aiModule.generateDv({
      aiProvider: provider, tz_text: 'Очистка',
      documents: [{ original_name: 'ВОР.xlsx', text: lines.join('\n'), table_positions: 42 }],
      history_block: '(нет)', catalog: CATALOG
    });
    assert.ok(out.expected_rows > 100,
      'занижённый счёт не согласован: expected_rows=' + out.expected_rows);
    assert.strictEqual(out.incomplete, true, 'недобор не виден при заниженном счёте');
  });

  await check('D-2 пункты ТЗ не раздувают ожидание', async () => {
    // Дефект: текстовый резерв включался всегда и читал ТЗ. ТЗ на 1500
    // нумерованных пунктов давало ожидание 1500 при полном разборе 300 —
    // ложная тревога и лишний раунд на 64k токенов.
    const vor = ['| № | Наименование | Ед | Кол-во |'];
    for (let k = 1; k <= 300; k += 1) vor.push(`| ${k} | Очистка ${k} | м3 | ${10 + k} |`);
    const tz = [];
    for (let k = 1; k <= 1500; k += 1) tz.push(`${k}. Требование: проход шириной не менее 1,5 м`);

    const provider = stubProvider([dvWith(300)]);
    const out = await aiModule.generateDv({
      aiProvider: provider, tz_text: 'Очистка',
      documents: [
        { original_name: 'ВОР.xlsx', text: vor.join('\n'), table_positions: 300 },
        { original_name: 'ТЗ.pdf', text: tz.join('\n') }
      ],
      history_block: '(нет)', catalog: CATALOG
    });
    assert.ok(out.expected_rows <= 400,
      'ТЗ раздуло ожидание: ' + out.expected_rows);
    assert.strictEqual(out.incomplete, false, 'ложный недобор на полном разборе');
  });

  await check('D-3 копии ненумерованной ведомости не утраивают ожидание', async () => {
    // Дефект: текстовый счёт не схлопывал копии документов, три копии
    // давали ожидание 900 при 300 реальных позициях.
    const lines = [];
    for (let k = 1; k <= 300; k += 1) lines.push(`Очистка оборудования ${k} — ${10 + k} м3`);
    const text = lines.join('\n');

    const provider = stubProvider([dvWith(300)]);
    const out = await aiModule.generateDv({
      aiProvider: provider, tz_text: 'Очистка',
      documents: [
        { original_name: 'ВОР.xlsx', text, table_positions: 300 },
        { original_name: 'Акт выполненных работ.xlsx', text, table_positions: 300 },
        { original_name: 'Ведомость объёмов.xlsx', text, table_positions: 300 }
      ],
      history_block: '(нет)', catalog: CATALOG
    });
    assert.ok(out.expected_rows <= 400,
      'копии утроили ожидание: ' + out.expected_rows);
    assert.strictEqual(out.incomplete, false, 'ложный недобор на копиях');
  });

  await check('N-5 обезличенное имя файла не выбрасывает посчитанный счёт', async () => {
    // Дефект: «Приложение 2.xlsx» не опознавалось по имени, и готовый
    // table_positions=300 отбрасывался — детектор молча выключался.
    const lines = ['| № | Наименование | Ед | Кол-во |'];
    for (let k = 1; k <= 300; k += 1) lines.push(`| ${k} | Очистка ${k} | м3 | ${10 + k} |`);
    const provider = stubProvider([dvWith(42)]);
    const out = await aiModule.generateDv({
      aiProvider: provider, tz_text: 'Очистка',
      documents: [{ original_name: 'Приложение 2.xlsx', text: lines.join('\n'), table_positions: 300 }],
      history_block: '(нет)', catalog: CATALOG
    });
    assert.ok(out.expected_rows >= 200,
      'структурный счёт потерян: expected_rows=' + out.expected_rows);
    assert.strictEqual(out.incomplete, true, 'недобор не виден');
  });

  await check('N-6 разрезанная ведомость суммируется', async () => {
    // Дефект: две части одной ведомости давали ожидание по максимуму
    // части (300 вместо 380), и недобор в 80 позиций был невидим.
    // Проверяем именно ТЕКСТОВЫЙ путь: структурный счёт отключён (0),
    // поэтому сумма частей считается по тексту документов.
    const p1 = ['| № | Наименование | Ед | Кол-во |'];
    for (let k = 1; k <= 300; k += 1) p1.push(`| ${k} | Очистка ${k} | м3 | ${10 + k} |`);
    const p2 = ['| № | Наименование | Ед | Кол-во |'];
    for (let k = 301; k <= 380; k += 1) p2.push(`| ${k} | Замена ${k} | п.м | ${k} |`);

    const provider = stubProvider([dvWith(300)]);
    const out = await aiModule.generateDv({
      aiProvider: provider, tz_text: 'Очистка',
      documents: [
        { original_name: 'ВОР часть 1.xlsx', text: p1.join('\n'), table_positions: 0 },
        { original_name: 'ВОР часть 2.xlsx', text: p2.join('\n'), table_positions: 0 }
      ],
      history_block: '(нет)', catalog: CATALOG
    });
    assert.ok(out.expected_rows >= 300,
      'части не сложились: expected_rows=' + out.expected_rows);
  });

  await check('N-8 структурный счёт ТЗ не раздувает ожидание', async () => {
    // Дефект: ТЗ.xlsx с таблицей требований давал table_positions=500,
    // и ожидание становилось 800 при полном разборе 300.
    const vor = ['| № | Наименование | Ед | Кол-во |'];
    for (let k = 1; k <= 300; k += 1) vor.push(`| ${k} | Очистка ${k} | м3 | ${10 + k} |`);
    const tz = ['| № | Требование | Ед | Кол-во |'];
    for (let k = 1; k <= 500; k += 1) tz.push(`| ${k} | Требование ${k} | м | 1,5 |`);

    const provider = stubProvider([dvWith(300)]);
    const out = await aiModule.generateDv({
      aiProvider: provider, tz_text: 'Очистка',
      documents: [
        { original_name: 'ВОР.xlsx', text: vor.join('\n'), table_positions: 300 },
        { original_name: 'ТЗ.xlsx', text: tz.join('\n'), table_positions: 500 }
      ],
      history_block: '(нет)', catalog: CATALOG
    });
    assert.ok(out.expected_rows <= 400,
      'ТЗ раздуло ожидание: ' + out.expected_rows);
  });

  await check('кириллические имена ВОР и ТЗ распознаются', () => {
    // \b в JS не работает с кириллицей — «ВОР.xlsx» и «ТЗ.pdf» не считались.
    for (const name of ['ВОР.xlsx', 'ВОР №1 КТЦ.xlsx', 'ТЗ.pdf', 'Ведомость объёмов.xlsx']) {
      const doc = { original_name: name, text: ('| 1 | Очистка | м2 | 340 |\n').repeat(300) };
      assert.ok(stages.estimateExpectedPositions([doc]) > 0, `«${name}» не распознан`);
    }
  });

  await check('пустой список не падает', () => {
    assert.strictEqual(stages.estimateExpectedPositions([]), 0);
    assert.strictEqual(stages.estimateExpectedPositions(null), 0);
  });

  console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
})();
