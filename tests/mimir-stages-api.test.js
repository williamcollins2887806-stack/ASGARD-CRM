#!/usr/bin/env node
'use strict';
/**
 * mimir-stages-api.test.js — проверка API этапов на клоне (БД + сервис).
 *
 * Проверяет то, что не покрыть чистым unit-тестом:
 *   • preflight реально сохраняется в сессию;
 *   • ответ на пробел продвигает этап и НЕ сбрасывает его;
 *   • optimistic lock даёт 409 при устаревшей версии;
 *   • повторный вход в сессию отдаёт тот же stage (продолжение с места).
 *
 * Запуск: node tests/mimir-stages-api.test.js [--db=asgard_crm_test]
 */
require('dotenv').config();
const assert = require('assert');
const { Client } = require('pg');
const st = require('../src/services/mimir-tender-stages');

const DB = (process.argv.find((a) => a.startsWith('--db=')) || '').split('=')[1] || 'asgard_crm_test';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

(async () => {
  const db = new Client({
    host: 'localhost', port: 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB
  });
  await db.connect();

  const mask = 'stage-test-' + Date.now();
  const { rows: [author] } = await db.query('SELECT id FROM users ORDER BY id LIMIT 1');
  const { rows: [sess] } = await db.query(
    `INSERT INTO tkp_quick_sessions (session_uid, author_id, customer_name, tz_text, status)
     VALUES ($1, $2, 'Проверка этапов', 'Промывка котла 2 м3, отложение кальций', 'draft')
     RETURNING session_uid`,
    [mask, author.id]
  );
  const uid = sess.session_uid;

  try {
    // 1. Начальный этап
    let s = await st.loadStage(db, uid);
    check('новая сессия начинается с intake', () => assert.strictEqual(s.stage, 'intake'));

    // 2. Preflight сохраняется, этап clarify
    const pf = st.preflight({ tz_text: 'Промывка котла', inputs: {} });
    check('preflight нашёл блокирующий объём', () => assert.ok(pf.gaps.some((g) => g.id === 'volume' && g.blocking)));

    s = await st.saveStage(db, uid, {
      stage: 'clarify',
      state: { gaps: pf.gaps.map((g) => ({ ...g })) }
    });
    check('этап перешёл в clarify', () => assert.strictEqual(s.stage, 'clarify'));
    check('версия увеличилась', () => assert.strictEqual(s.version, 1));

    // 3. Ответ на пробел → этап read, версия растёт
    let state = st.resolveGap(s.state, 'volume', { answer: '2 котла по 2 м3' });
    const blockingLeft = state.gaps.filter((g) => !g.resolved && g.blocking).length;
    s = await st.saveStage(db, uid, {
      stage: blockingLeft === 0 ? 'read' : 'clarify',
      state
    });
    check('после ответа этап read', () => assert.strictEqual(s.stage, 'read'));
    check('пробел отмечен закрытым', () => {
      const g = s.state.gaps.find((x) => x.id === 'volume');
      assert.strictEqual(g.resolved, true);
      assert.strictEqual(g.answer, '2 котла по 2 м3');
    });

    // 4. Продолжение с места: повторный load отдаёт тот же этап
    const again = await st.loadStage(db, uid);
    check('повторный вход продолжает с того же этапа', () => assert.strictEqual(again.stage, 'read'));
    check('состояние не потеряно', () => assert.strictEqual(again.state.gaps.length, pf.gaps.length));

    // 5. Нельзя прыгнуть через этап
    let jumped = null;
    try { await st.saveStage(db, uid, { stage: 'calc_smeta' }); } catch (e) { jumped = e; }
    check('прыжок через этапы запрещён', () => {
      assert.ok(jumped, 'ожидалась ошибка');
      assert.strictEqual(jumped.statusCode, 400);
    });

    // 6. Optimistic lock
    let conflict = null;
    try {
      await st.saveStage(db, uid, { stage: 'dv', expectedVersion: 0 });
    } catch (e) { conflict = e; }
    check('устаревшая версия → 409', () => {
      assert.ok(conflict, 'ожидалась ошибка');
      assert.strictEqual(conflict.statusCode, 409);
    });

    // 7. ДВ: две позиции, одна с неизвестным методом
    const catalog = { categories: (await db.query(
      'SELECT code, methods_json FROM work_norm_categories'
    )).rows };
    const dv = st.normalizeDv({
      positions: [
        { id: 'p1', name: 'Промывка котла', category_code: 'boilers', method_code: 'chem', volume: 2, unit: 'м3', tech_equip: 'кислота+CIP' },
        { id: 'p2', name: 'Сварка шва', category_code: 'repair_weld', method_code: 'laser', volume: 12, unit: 'м' }
      ]
    }, catalog);
    check('ДВ: одна позиция заблокирована, одна нет', () => {
      assert.strictEqual(dv.positions.length, 2);
      assert.strictEqual(dv.blocked, 1);
      assert.strictEqual(dv.positions[0].needs_classification, false);
      assert.strictEqual(dv.positions[1].needs_classification, true);
    });

    s = await st.saveStage(db, uid, { stage: 'dv', state: { positions: dv.positions } });
    check('ДВ сохранён и этап dv', () => assert.strictEqual(s.stage, 'dv'));

    // 8. Правка позиции РП снимает блокировку
    const fixed = st.applyPositionPatch(s.state, 'p2', {
      method_code: 'weld', tech_equip: 'инвертор 250А, электроды УОНИ, режим по НАКС'
    });
    s = await st.saveStage(db, uid, { stage: 'tech', state: fixed });
    check('после правки РП блокировка снята', () => {
      const p = s.state.positions.find((x) => x.id === 'p2');
      assert.strictEqual(p.needs_classification, false);
      assert.strictEqual(p.tech_status, 'rp');
    });

    // 9. Технология: можно завершать только когда у всех есть tech_equip
    const fin = st.canFinishTech(s.state);
    check('технология: завершение разрешено (у обеих позиций есть оснастка)', () => assert.strictEqual(fin.ok, true));

    // 10. План: параллельность
    const plan = st.normalizeCalcPlan({
      positions: [
        { id: 'a', people: 4, days: 2, parallel_group: '1', source: 'norm', source_ref: 'boiler_chem_hours' },
        { id: 'b', people: 4, days: 3, parallel_group: '1', source: 'norm', source_ref: 'boiler_chem_hours' },
        { id: 'c', people: 2, days: 1, parallel_group: '2', source: 'expert', explain: 'по практике прошлых объектов' }
      ]
    });
    check('план: work_days = сумма максимумов групп (4)', () => assert.strictEqual(plan.work_days, 4));
    check('план: у всех строк есть источник', () => {
      assert.ok(plan.positions.every((p) => p.source));
    });
    const win = st.checkDateWindow(plan, 20);
    check('план влезает в окно 20 дней', () => assert.strictEqual(win.ok, true));

    // 11. Финализация анализа: решение закрывает анализ, сметы нет
    s = await st.saveStage(db, uid, { stage: 'decision', state: s.state });
    s = await st.saveStage(db, uid, { stage: 'done', state: Object.assign({}, s.state, { decision: { go: true } }) });
    check('анализ закрывается решением done', () => assert.strictEqual(s.stage, 'done'));
    check('из анализа нельзя прыгнуть в смету', () => {
      assert.strictEqual(st.canTransition('decision', 'calc_smeta'), false);
    });
    check('после закрытого анализа просчёт запускается отдельно', () => {
      assert.strictEqual(st.canTransition('done', 'calc_plan'), true);
    });

    // 12. Версия монотонно росла (учитывая, что запрещённые переходы и 409 её не двигают)
    const final = await st.loadStage(db, uid);
    check('версия растёт монотонно (>=6)', () => assert.ok(final.version >= 6, 'version=' + final.version));
  } finally {
    await db.query('DELETE FROM tkp_quick_sessions WHERE session_uid = $1', [uid]);
    await db.end();
  }

  console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
