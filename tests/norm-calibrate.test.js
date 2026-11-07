'use strict';
/**
 * Калибровка справочника по результатам просчёта.
 *
 * Вопрос РП 07.11.2026: «обучается ли справочник после просчёта».
 * До этого — нет: журнал норм не пополнялся с июля (10 записей),
 * опыт — 2 строки.
 */
const assert = require('assert');
const { calibrateNormsFromCalc, MAX_SHIFT_PCT } = require('../src/services/norm-calibrate');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// ── Мок БД и работы норм ────────────────────────────────────────────────────
function makeDb() {
  return { query: async () => ({ rows: [] }) };
}

/** Подменяем модуль work-norms на управляемый мок. */
function stubWorkNorms(over) {
  const path = require.resolve('../src/services/work-norms');
  const orig = require.cache[path];
  const mock = Object.assign({
    loadCatalog: async () => ({ categories: [] }),
    previewCalc: async () => ({ ok: true, results: { work_days: 10 } }),
    applyNormPatchFromSmetaEdit: async () => ({ ok: true, message: 'калибровано' })
  }, over || {});
  require.cache[path] = { id: path, filename: path, loaded: true, exports: mock };
  return () => { if (orig) require.cache[path] = orig; else delete require.cache[path]; };
}

function stubNormInputs(over) {
  const path = require.resolve('../src/services/norm-inputs');
  const orig = require.cache[path];
  const mock = Object.assign({ inputsForPosition: () => ({ tubes: 100 }) }, over || {});
  require.cache[path] = { id: path, filename: path, loaded: true, exports: mock };
  return () => { if (orig) require.cache[path] = orig; else delete require.cache[path]; };
}

(async () => {
  // ── 1. Норма двигается при заметном расхождении ───────────────────────────
  await check('норма калибруется, когда факт расходится с расчётом', async () => {
    const calls = [];
    const restoreW = stubWorkNorms({
      previewCalc: async () => ({ ok: true, results: { work_days: 10 } }),
      applyNormPatchFromSmetaEdit: async (db, body) => { calls.push(body); return { ok: true, message: 'ок' }; }
    });
    const restoreN = stubNormInputs();
    try {
      const res = await calibrateNormsFromCalc(makeDb(), {
        positions: [{
          id: 'p1', category_code: 'tubes', method_code: 'gdo',
          volume: 100, unit: 'труб', days: 15,
          norm: { code: 'tubes_min_per_tube' }, volume_source: 'vor'
        }],
        calcPositions: [{ position_id: 'p1', people: 5, days: 15 }],
        tenderId: 2131
      });
      assert.strictEqual(res.updated, 1, 'норма не калибрована');
      assert.strictEqual(calls.length, 1, 'applyNormPatch не вызван');
      assert.ok(/2131/.test(calls[0].comment), 'в комментарии нет тендера: ' + calls[0].comment);
    } finally { restoreW(); restoreN(); }
  });

  // ── 2. Малые расхождения не трогаем ───────────────────────────────────────
  await check('расхождение меньше 5 % — норма не двигается', async () => {
    const calls = [];
    const restoreW = stubWorkNorms({
      previewCalc: async () => ({ ok: true, results: { work_days: 10 } }),
      applyNormPatchFromSmetaEdit: async (db, b) => { calls.push(b); return {}; }
    });
    const restoreN = stubNormInputs();
    try {
      const res = await calibrateNormsFromCalc(makeDb(), {
        positions: [{
          id: 'p1', category_code: 'tubes', method_code: 'gdo',
          volume: 100, unit: 'труб', days: 10.3,
          norm: { code: 'x' }, volume_source: 'vor'
        }],
        tenderId: 1
      });
      assert.strictEqual(res.updated, 0, 'норма сдвинута на шуме');
      assert.strictEqual(calls.length, 0);
    } finally { restoreW(); restoreN(); }
  });

  // ── 3. Паспортные объёмы не калибруют ─────────────────────────────────────
  await check('паспортный объём не калибрует — это не факт', async () => {
    const calls = [];
    const restoreW = stubWorkNorms({
      applyNormPatchFromSmetaEdit: async (db, b) => { calls.push(b); return {}; }
    });
    const restoreN = stubNormInputs();
    try {
      const res = await calibrateNormsFromCalc(makeDb(), {
        positions: [{
          id: 'p1', category_code: 'tubes', method_code: 'gdo',
          volume: 100, unit: 'труб', days: 50,
          norm: { code: 'x' }, volume_source: 'passport'
        }],
        tenderId: 1
      });
      assert.strictEqual(res.updated, 0, 'калибровка по паспортному объёму');
      assert.ok(res.details[0].skipped === 'passport_volume', JSON.stringify(res.details[0]));
    } finally { restoreW(); restoreN(); }
  });

  // ── 4. Без нормы калибровать нечего ───────────────────────────────────────
  await check('позиция без нормы пропускается', async () => {
    const restoreW = stubWorkNorms();
    const restoreN = stubNormInputs();
    try {
      const res = await calibrateNormsFromCalc(makeDb(), {
        positions: [{ id: 'p1', category_code: 'tubes', volume: 100, days: 10 }],
        tenderId: 1
      });
      assert.strictEqual(res.updated, 0);
      assert.strictEqual(res.skipped, 1);
    } finally { restoreW(); restoreN(); }
  });

  // ── 5. Ограничение сдвига ─────────────────────────────────────────────────
  await check('сдвиг нормы ограничен 30 %', async () => {
    assert.strictEqual(MAX_SHIFT_PCT, 30);
    const calls = [];
    const restoreW = stubWorkNorms({
      previewCalc: async () => ({ ok: true, results: { work_days: 10 } }),
      applyNormPatchFromSmetaEdit: async (db, b) => { calls.push(b); return {}; }
    });
    const restoreN = stubNormInputs();
    try {
      // Факт 100 сут против расчёта 10 — это +900 %, должно урезаться до +30 %.
      const res = await calibrateNormsFromCalc(makeDb(), {
        positions: [{
          id: 'p1', category_code: 'tubes', method_code: 'gdo',
          volume: 100, unit: 'труб', days: 100,
          norm: { code: 'x' }, volume_source: 'vor'
        }],
        tenderId: 1
      });
      assert.strictEqual(res.updated, 1);
      const applied = res.details[0].applied_pct;
      assert.strictEqual(applied, 30, 'сдвиг не ограничен: ' + applied);
      // work_days должен быть 13 (10 * 1.30), а не 100.
      assert.ok(Math.abs(calls[0].work_days - 13) < 0.01, 'work_days ' + calls[0].work_days);
    } finally { restoreW(); restoreN(); }
  });

  // ── 6. Без объёма — не калибруем ──────────────────────────────────────────
  await check('позиция без объёма пропускается', async () => {
    const restoreW = stubWorkNorms();
    const restoreN = stubNormInputs();
    try {
      const res = await calibrateNormsFromCalc(makeDb(), {
        positions: [{
          id: 'p1', category_code: 'tubes', volume: null, days: 10,
          norm: { code: 'x' }, volume_source: 'tz'
        }],
        tenderId: 1
      });
      assert.strictEqual(res.updated, 0);
      assert.ok(res.details.some((d) => d.skipped === 'no_volume_or_category'));
    } finally { restoreW(); restoreN(); }
  });

  // ── 7. Пустой вход ────────────────────────────────────────────────────────
  await check('пустой вход не падает', async () => {
    const restoreW = stubWorkNorms();
    const restoreN = stubNormInputs();
    try {
      const res = await calibrateNormsFromCalc(makeDb(), {});
      assert.strictEqual(res.updated, 0);
      assert.strictEqual(res.skipped, 0);
      const res2 = await calibrateNormsFromCalc(makeDb(), null);
      assert.strictEqual(res2.updated, 0);
    } finally { restoreW(); restoreN(); }
  });

  // ── 8. Сутки берутся из плана ─────────────────────────────────────────────
  await check('сутки читаются из плана, а не из позиции ДВ', async () => {
    // Дефект 07.11: pos.days всегда undefined, сутки лежат в calc.positions.
    // Из-за этого калибровка пропускала все 154 позиции тендера 2131.
    const calls = [];
    const restoreW = stubWorkNorms({
      previewCalc: async () => ({ ok: true, results: { work_days: 10 } }),
      applyNormPatchFromSmetaEdit: async (db, b) => { calls.push(b); return {}; }
    });
    const restoreN = stubNormInputs();
    try {
      const res = await calibrateNormsFromCalc(makeDb(), {
        positions: [{
          id: 'p1', category_code: 'tubes', method_code: 'gdo',
          volume: 100, unit: 'труб', norm: { code: 'x' }, volume_source: 'vor'
          // days НЕТ — как в реальной позиции ДВ
        }],
        calcPositions: [{ position_id: 'p1', people: 5, days: 15 }],
        tenderId: 2131
      });
      assert.strictEqual(res.updated, 1, 'сутки не взяты из плана: ' + JSON.stringify(res));
    } finally { restoreW(); restoreN(); }
  });

  // ── 9. Мелкие позиции не калибруют ────────────────────────────────────────
  await check('позиция со сроком меньше 2 суток не калибрует', async () => {
    // План округляет до целых: 0.4 сут → 1. Это даёт +150 % фиктивно.
    const calls = [];
    const restoreW = stubWorkNorms({
      previewCalc: async () => ({ ok: true, results: { work_days: 0.4 } }),
      applyNormPatchFromSmetaEdit: async (db, b) => { calls.push(b); return {}; }
    });
    const restoreN = stubNormInputs();
    try {
      const res = await calibrateNormsFromCalc(makeDb(), {
        positions: [{
          id: 'p1', category_code: 'tubes', method_code: 'gdo',
          volume: 10, unit: 'труб', days: 1,
          norm: { code: 'x' }, volume_source: 'vor'
        }],
        tenderId: 1
      });
      assert.strictEqual(res.updated, 0, 'норма сдвинута на округлении');
      assert.ok(res.details.some((d) => d.skipped === 'too_small_for_calibration'), JSON.stringify(res.details));
    } finally { restoreW(); restoreN(); }
  });

  console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
})();
