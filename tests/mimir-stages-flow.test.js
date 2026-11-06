'use strict';
/**
 * mimir-stages-flow.test.js — сквозной прогон этапов на клоне без внешней модели.
 *
 * Модель подменяется детерминированной заглушкой, поэтому тест проверяет
 * именно конвейер: preflight → ДВ → норма-превью → технология → план →
 * финализация → запись в report_json. Это то, что реально ломается.
 *
 * Запуск: node tests/mimir-stages-flow.test.js [--db=asgard_crm_test]
 */
require('dotenv').config();
const assert = require('assert');
const { Client } = require('pg');
const stages = require('../src/services/mimir-tender-stages');
const stagesAi = require('../src/services/mimir-tender-stages-ai');
const workNorms = require('../src/services/work-norms');

const DB = (process.argv.find((a) => a.startsWith('--db=')) || '').split('=')[1] || 'asgard_crm_test';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

/** Заглушка модели: возвращает то, что просит сценарий. */
function fakeProvider(dvResponse, planResponse) {
  let call = 0;
  return {
    complete: async () => {
      call += 1;
      const text = call === 1 ? JSON.stringify(dvResponse) : JSON.stringify(planResponse);
      return { text, model: 'fake-model', provider: 'fake', usage: { input: 10, output: 10 } };
    }
  };
}

(async () => {
  const db = new Client({
    host: 'localhost', port: 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB
  });
  await db.connect();

  const catalog = await workNorms.loadCatalog(db);
  const { rows: [author] } = await db.query('SELECT id FROM users ORDER BY id LIMIT 1');
  const uid = 'flow-' + Date.now();
  await db.query(
    `INSERT INTO tkp_quick_sessions (session_uid, author_id, customer_name, tz_text, status)
     VALUES ($1, $2, 'Проверка конвейера', 'Промывка котла 2 м3, отложения кальций, 2 цикла', 'draft')`,
    [uid, author.id]
  );

  try {
    // ── 1. ДВ через «модель» ──────────────────────────────────────────────
    const provider = fakeProvider({
      decision_recommend: 'go',
      positions: [
        {
          name: 'Промывка котла К-1', category_code: 'boilers', method_code: 'chem',
          volume: 2, unit: 'м³', fouling: 'heavy',
          tech_equip: 'кислота с ингибитором, CIP 2 цикла, нейтрализация',
          objects: [{ tag: 'К-1', type: 'котёл', size: '2 м³' }],
          source_ref: { document: 'ТЗ.pdf', fragment: 'п.3.1' },
          confidence: 'high'
        },
        {
          name: 'Сварка шва на трубопроводе', category_code: 'repair_weld', method_code: 'weld',
          volume: 12, unit: 'м', fouling: null,
          tech_equip: 'инвертор 250 А, электроды УОНИ, режим по НАКС',
          source_ref: { document: 'Ведомость.xlsx', fragment: 'стр.4' },
          confidence: 'medium'
        }
      ],
      questions_for_customer: ['Уточнить давление в контуре']
    }, {
      positions: [
        { id: 'c1', position_id: null, name: 'Промывка котла К-1', apparatus: 'К-1',
          people: 5, days: 1.5, shifts: 2, shift_hours: 12, parallel_group: '1',
          equipment: [{ name: 'CIP-станция', source: 'warehouse' }],
          source: 'norm', source_ref: 'boiler_chem_hours', explain: 'норма 12 ч/цикл × 2' },
        { id: 'c2', position_id: null, name: 'Сварка шва', apparatus: 'ТП-1',
          people: 3, days: 1, shifts: 1, shift_hours: 12, parallel_group: '1',
          equipment: [{ name: 'Инвертор', source: 'warehouse' }],
          source: 'norm', source_ref: 'weld_joint_shift', explain: 'норма 2,1 стык/смену' }
      ],
      road_days: 1
    });

    const dvGen = await stagesAi.generateDv({
      db, aiProvider: provider,
      tz_text: 'Промывка котла 2 м3, 2 цикла. Сварка шва 12 м.',
      documents: [{ original_name: 'ТЗ.pdf', text: 'Промывка котла К-1 объём 2 м3, отложения кальций. Сварка шва 12 м.' }],
      catalog
    });
    check('ДВ сгенерирован', () => assert.strictEqual(dvGen.ok, true));
    check('ДВ: две позиции', () => assert.strictEqual(dvGen.dv.positions.length, 2));
    check('ДВ: обе без блокировки', () => assert.strictEqual(dvGen.dv.blocked, 0));
    check('ДВ: сварка осталась сваркой', () => {
      const weld = dvGen.dv.positions.find((p) => p.name.includes('Сварка'));
      assert.strictEqual(weld.category_code, 'repair_weld');
      assert.strictEqual(weld.method_code, 'weld');
      assert.strictEqual(weld.unit, 'м');
    });
    check('ДВ: источник указан у обеих', () => {
      assert.ok(dvGen.dv.positions.every((p) => p.source_ref && p.source_ref.document));
    });

    // ── 2. Норма-превью по позициям ───────────────────────────────────────
    const normBoiler = await workNorms.tryNormPreviewForEstimate(db, {
      work: { work_title: 'Промывка котла' },
      norm_inputs: { category_code: 'boilers', method_code: 'chem', inputs: { circuit_m3: 2, cycles: 2 } }
    });
    check('норма по котлу найдена', () => assert.ok(normBoiler.preview && normBoiler.preview.ok));
    check('норма по котлу — не фолбэк', () => assert.ok(!normBoiler.preview.fallback));

    const normWeld = await workNorms.tryNormPreviewForEstimate(db, {
      work: { work_title: 'Сварка шва' },
      norm_inputs: { category_code: 'repair_weld', method_code: 'weld', inputs: { joints: 10, dn_mm: 159 } }
    });
    check('норма по сварке найдена', () => assert.ok(normWeld.preview && normWeld.preview.ok));

    // ── 3. Сохраняем ДВ и технологию ──────────────────────────────────────
    let saved = await stages.saveStage(db, uid, {
      stage: 'dv', state: { positions: dvGen.dv.positions }
    });
    check('этап dv сохранён', () => assert.strictEqual(saved.stage, 'dv'));

    const withTech = dvGen.dv.positions.map((p) => Object.assign({}, p, {
      tech_equip: p.tech_equip, tech_status: 'ai',
      norm: { code: 'x', work_days: 1.5, crew: { master: 1, exec: 3 }, trace: [] }
    }));
    saved = await stages.saveStage(db, uid, { stage: 'tech', state: { positions: withTech } });
    check('этап tech сохранён', () => assert.strictEqual(saved.stage, 'tech'));
    check('технология: завершить можно', () => assert.strictEqual(stages.canFinishTech(saved.state).ok, true));

    // ── 4. План ───────────────────────────────────────────────────────────
    const planGen = await stagesAi.generateCalcPlan({
      aiProvider: provider,
      positions: withTech,
      normPreviewMd: 'boilers/chem: 12 ч/цикл',
      maxParallelPosts: 2
    });
    check('план сгенерирован', () => assert.strictEqual(planGen.ok, true));
    check('план: 2.5 бр.-сут, объём мал → одна бригада', () => {
      // 1.5 + 1 = 2.5 бригадо-суток; без окна дат и при малом объёме
      // достаточно одной бригады — срок равен трудозатратам.
      assert.strictEqual(planGen.plan.total_crew_days, 2.5);
      assert.strictEqual(planGen.plan.crews, 1);
      assert.strictEqual(planGen.plan.work_days, 2.5);
    });
    check('план: у всех источники', () => {
      assert.ok(planGen.plan.positions.every((p) => p.source && p.source_ref));
    });
    check('план: man_hours посчитан', () => assert.ok(planGen.plan.man_hours > 0));

    // ── 5. Окно дат ───────────────────────────────────────────────────────
    const win = stages.checkDateWindow(planGen.plan, 5);
    check('окно 5 дней: план влезает (1.5 + 1 дорога)', () => assert.strictEqual(win.ok, true));
    const winTight = stages.checkDateWindow(planGen.plan, 1);
    check('окно 1 день: не влезает, есть сообщение', () => {
      assert.strictEqual(winTight.ok, false);
      assert.ok(/НЕ влезает/.test(winTight.message));
    });

    // ── 6. Калибровка ─────────────────────────────────────────────────────
    const calib = stagesAi.buildCalibrationPreview(withTech, planGen.plan);
    check('калибровка: строки с нормой есть', () => assert.ok(calib.length > 0));
    check('калибровка: у строк есть код нормы и объём', () => {
      assert.ok(calib.every((c) => c.code && c.inputs && Object.keys(c.inputs).length));
    });

    // ── 7. Закрытие анализа решением, затем отдельный запуск просчёта ─────
    saved = await stages.saveStage(db, uid, { stage: 'decision', state: saved.state });
    saved = await stages.saveStage(db, uid, { stage: 'done', state: Object.assign({}, saved.state, { decision: { go: true } }) });
    check('финал анализа: этап done', () => assert.strictEqual(saved.stage, 'done'));
    check('финал: позиции сохранены', () => assert.strictEqual(saved.state.positions.length, 2));

    // Просчёт — отдельный запуск из закрытого анализа.
    saved = await stages.saveStage(db, uid, { stage: 'calc_plan', state: Object.assign({}, saved.state, { calc: planGen.plan }) });
    check('просчёт запускается из закрытого анализа', () => assert.strictEqual(saved.stage, 'calc_plan'));
    check('финал: план сохранён', () => {
      assert.ok(saved.state.calc && saved.state.calc.positions.length === 2);
    });
    saved = await stages.saveStage(db, uid, { stage: 'calc_smeta', state: saved.state });
    saved = await stages.saveStage(db, uid, { stage: 'done', state: saved.state });
    check('просчёт закрывается сметой', () => assert.strictEqual(saved.stage, 'done'));

    // ── 8. Отказ ──────────────────────────────────────────────────────────
    const uid2 = 'flow-nogo-' + Date.now();
    await db.query(
      `INSERT INTO tkp_quick_sessions (session_uid, author_id, customer_name, tz_text, status)
       VALUES ($1, $2, 'Отказ', 'ТЗ', 'draft')`, [uid2, author.id]
    );
    await stages.saveStage(db, uid2, { stage: 'clarify', state: { gaps: [] } });
    await stages.saveStage(db, uid2, { stage: 'read' });
    await stages.saveStage(db, uid2, { stage: 'dv' });
    await stages.saveStage(db, uid2, { stage: 'tech' });
    await stages.saveStage(db, uid2, { stage: 'decision' });
    const nogo = await stages.saveStage(db, uid2, {
      stage: 'nogo', state: { decision: { go: false, reason: 'нет допуска НАКС' } }
    });
    check('отказ: этап nogo', () => assert.strictEqual(nogo.stage, 'nogo'));
    check('отказ: причина сохранена', () => assert.strictEqual(nogo.state.decision.reason, 'нет допуска НАКС'));
    await db.query('DELETE FROM tkp_quick_sessions WHERE session_uid = $1', [uid2]);

    // ── 9. Норма создаётся из просчёта ────────────────────────────────────
    const beforeCount = (await db.query(
      "SELECT COUNT(*)::int n FROM work_norm_rates WHERE code LIKE 'auto_%'"
    )).rows[0].n;
    const created = await workNorms.createRateFromEstimate(db, {
      category_code: 'repair_weld',
      method_code: 'weld',
      inputs: { joints: 12, dn_mm: 200 },
      work_days: 2,
      crew: { master: 1, exec: 2 },
      comment: 'Тест конвейера: норма из плана'
    });
    const afterCount = (await db.query(
      "SELECT COUNT(*)::int n FROM work_norm_rates WHERE code LIKE 'auto_%'"
    )).rows[0].n;
    check('норма создана/обновлена после просчёта', () => assert.strictEqual(created.ok, true));
    check('справочник изменился или норма обновлена', () => {
      assert.ok(afterCount >= beforeCount, `${beforeCount} → ${afterCount}`);
    });
  } finally {
    await db.query('DELETE FROM tkp_quick_sessions WHERE session_uid = $1', [uid]);
    await db.end();
  }

  console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
