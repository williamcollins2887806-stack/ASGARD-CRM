#!/usr/bin/env node
/**
 * verify_analysis_checklist.js — гейт чек-листа анализа (D-203).
 *
 * Проверяет на ЖИВОМ приложении-двойнике (клон, НЕ прод) то, чего не поймать статикой.
 *
 *   API (обязательность и хранение)
 *   1)  шаблон из настроек: 10 базовых вопросов + 2 свободные строки, базовые required
 *   2a) RBAC: ТО не может править шаблон
 *   2b) ADMIN правит шаблон, свободные строки не теряются
 *   2c) сброс к дефолту возвращает 10+2
 *   3)  GET на чистом тендере: шаблон есть, ответов нет
 *   4)  PUT с неполными ответами при require_complete=1 → 400 CHECKLIST_INCOMPLETE со списком
 *   5)  PUT полными ответами сохранён и читается обратно (ответы + свободная строка + snapshot)
 *   6)  закрытие АНАЛИЗА без чек-листа → 400 CHECKLIST_REQUIRED (анализ не закрывается)
 *   7)  с заполненным чек-листом анализ закрывается (200), блокировки чек-листом нет
 *   8)  Word: 200 + docx + ZIP + ответ и заказчик внутри + нет плейсхолдеров
 *   9)  история у контрагента: GET /api/customers/:inn/analysis-checklists находит чек-лист
 *
 *   Фронт (настоящие модули в chromium)
 *  10) html(): 10 вопросов + 2 свободные строки + кнопка сохранения + шаги порядка работы
 *  11) collect(): пустые обязательные попадают в missing (блокирующая валидация)
 *  12) readOnly: все поля только для чтения и нет кнопки сохранения (просмотр в просчёте)
 *  13) rp_calc_modal.js: вкладка «Чек-лист» + renderChecklist + renderInto
 *  14) rp_review_modal.js: вкладка + сохранение rpClSave + requireComplete при закрытии
 *  15) customer-card.js: тянет /analysis-checklists и рисует блок
 *  16) index.html: analysis_checklist.js подключён
 *
 * Идемпотентность: гейт сам берёт два тендера с ОТКРЫТЫМ анализом, чистит их чек-листы,
 * а в финале восстанавливает снапшот строк `tender_rp_reviews` и удаляет созданные
 * чек-листы. Повторный запуск даёт тот же результат и не «выжигает» клон.
 *
 * Использование:
 *   TEST_BASE_URL=http://127.0.0.1:3200 node tools/verify_analysis_checklist.js
 *   CL_DB_NAME=asgard_crm_test CL_TENDER=2057 CL_TENDER_FINAL=2047 ... (переопределения)
 */

'use strict';

process.env.TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3200';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail == null ? '' : detail) });
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + detail + C.off : ''}`);
}

const { api, initTokens, getTokenSync } = require('../tests/config');

const BASE = process.env.TEST_BASE_URL;

const DB_CFG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
  database: process.env.CL_DB_NAME || 'asgard_crm_test'
};

let db = null;
let ids = [];
let snapReviews = [];
let snapSettings = null;

async function cloneDb() {
  if (db) return db;
  const { Client } = require('pg');
  db = new Client(DB_CFG);
  await db.connect();
  return db;
}

/** Выбирает тендеры с ОТКРЫТЫМ анализом и известным заказчиком. */
async function pickTenders() {
  if (process.env.CL_TENDER && process.env.CL_TENDER_FINAL) {
    return [Number(process.env.CL_TENDER), Number(process.env.CL_TENDER_FINAL)];
  }
  const r = await db.query(`
    SELECT r.tender_id
    FROM tender_rp_reviews r
    JOIN tenders t ON t.id = r.tender_id
    WHERE t.deleted_at IS NULL
      AND r.is_final = false
      AND r.analysis_finalized_at IS NULL
      AND t.customer_inn IS NOT NULL
      AND t.customer_name IS NOT NULL
      AND r.analysis_owner_user_id IS NOT NULL
    ORDER BY r.tender_id DESC
    LIMIT 2
  `);
  if (r.rows.length < 2) throw new Error('в клоне нет двух тендеров с открытым анализом — гейт не на чем гонять');
  return [r.rows[0].tender_id, r.rows[1].tender_id];
}

/** Снапшот + обнуление состояния перед проверками. */
async function prepare() {
  await cloneDb();
  ids = await pickTenders();
  snapReviews = (await db.query('SELECT * FROM tender_rp_reviews WHERE tender_id = ANY($1::int[])', [ids])).rows;
  if (!snapReviews.length) throw new Error('не нашёл строк tender_rp_reviews для ' + ids.join(', '));
  snapSettings = (await db.query('SELECT * FROM settings WHERE key = $1', ['analysis_checklist_template'])).rows[0] || null;

  await db.query('DELETE FROM tender_analysis_checklists WHERE tender_id = ANY($1::int[])', [ids]);
  await db.query(`
    UPDATE tender_rp_reviews SET
      is_final = false,
      analysis_finalized_at = NULL,
      analysis_finalized_by_user_id = NULL,
      decision = 'pending'
    WHERE tender_id = ANY($1::int[])
  `, [ids]);
}

/** Восстановление клона: строки reviews как были, чек-листы и настройка — как были. */
async function restore() {
  if (!db) return;
  try {
    await db.query('DELETE FROM tender_analysis_checklists WHERE tender_id = ANY($1::int[])', [ids]);

    for (const row of snapReviews) {
      const cols = Object.keys(row).filter((c) => c !== 'id' && c !== 'tender_id');
      const set = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
      await db.query(
        `UPDATE tender_rp_reviews SET ${set} WHERE id = $${cols.length + 1}`,
        [...cols.map((c) => row[c]), row.id]
      );
    }

    // ensureReview мог создать новую строку — её надо убрать.
    const keep = snapReviews.map((r) => r.id);
    const nowIds = (await db.query('SELECT id FROM tender_rp_reviews WHERE tender_id = ANY($1::int[])', [ids]))
      .rows.map((r) => r.id).filter((id) => !keep.includes(id));
    if (nowIds.length) {
      await db.query('DELETE FROM tender_rp_reviews WHERE id = ANY($1::int[])', [nowIds]);
    }

    if (snapSettings) {
      await db.query(`
        INSERT INTO settings (key, value_json, updated_at) VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, [snapSettings.key, snapSettings.value_json]);
    } else {
      await db.query('DELETE FROM settings WHERE key = $1', ['analysis_checklist_template']);
    }
  } catch (e) {
    console.error(C.red + 'restore FAILED: ' + e.message + C.off);
  } finally {
    await db.end();
    db = null;
  }
}

async function downloadDocx(pathUrl, role) {
  const r = await fetch(BASE + pathUrl, { headers: { Authorization: 'Bearer ' + getTokenSync(role) } });
  return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
}

(async function main() {
  await initTokens();
  await prepare();
  const TENDER_MAIN = ids[0];
  const TENDER_FINAL = ids[1];

  const tRow = await db.query('SELECT id, customer_name, customer_inn, tender_title FROM tenders WHERE id = $1', [TENDER_MAIN]);
  const inn = (tRow.rows[0] && tRow.rows[0].customer_inn) || '';

  // ── 1. Шаблон из настроек ─────────────────────────────────────────────
  try {
    const tplResp = await api('GET', '/api/settings/analysis-checklist-template', { role: 'ADMIN' });
    const q = tplResp.data.questions || [];
    const base = q.filter((x) => x.kind !== 'free');
    const free = q.filter((x) => x.kind === 'free');
    check('1 шаблон из настроек: 10 базовых вопросов + 2 свободные строки',
      tplResp.status === 200 && base.length === 10 && free.length === 2 &&
      base.every((x) => x.required) && free.every((x) => !x.required),
      'базовых=' + base.length + ', свободных=' + free.length);
  } catch (e) {
    check('1 шаблон из настроек: 10 базовых вопросов + 2 свободные строки', false, e.message);
  }

  // ── 2. RBAC и правка шаблона ──────────────────────────────────────────
  try {
    const deny = await api('PUT', '/api/settings/analysis-checklist-template', {
      role: 'TO', body: { questions: [{ id: 'x', text: 'Взлом', required: true }] }
    });
    check('2a ТО не может править шаблон чек-листа (403)', deny.status === 403 || deny.status === 401, 'status=' + deny.status);
  } catch (e) {
    check('2a ТО не может править шаблон чек-листа (403)', false, e.message);
  }

  try {
    const upd = await api('PUT', '/api/settings/analysis-checklist-template', {
      role: 'ADMIN', body: { questions: [{ id: 'q1', text: 'Изменённый вопрос из настроек?', required: true }] }
    });
    const q = (upd.data && upd.data.questions) || [];
    const renamed = q.some((x) => x.text === 'Изменённый вопрос из настроек?');
    const stillFree = q.filter((x) => x.kind === 'free').length;
    check('2b ADMIN правит шаблон, свободные строки не теряются',
      upd.status === 200 && renamed && stillFree === 2,
      'questions=' + q.length + ', свободных=' + stillFree + ', правка=' + renamed);
  } catch (e) {
    check('2b ADMIN правит шаблон, свободные строки не теряются', false, e.message);
  }

  try {
    const reset = await api('PUT', '/api/settings/analysis-checklist-template', { role: 'ADMIN', body: { reset: true } });
    const rq = (reset.data && reset.data.questions) || [];
    check('2c сброс к дефолту возвращает 10+2',
      reset.status === 200 && rq.filter((x) => x.kind !== 'free').length === 10 && rq.filter((x) => x.kind === 'free').length === 2,
      'questions=' + rq.length);
  } catch (e) {
    check('2c сброс к дефолту возвращает 10+2', false, e.message);
  }

  // ── 3. GET на чистом тендере ──────────────────────────────────────────
  let tpl = [];
  try {
    const g = await api('GET', `/api/tenders/${TENDER_MAIN}/analysis-checklist`, { role: 'TO' });
    tpl = g.data.template || [];
    check('3 GET чек-листа отдаёт шаблон, ответов ещё нет',
      g.status === 200 && tpl.length === 12 && !g.data.checklist,
      'шаблон=' + tpl.length + ', checklist=' + (g.data.checklist ? 'есть' : 'нет'));
  } catch (e) {
    check('3 GET чек-листа отдаёт шаблон, ответов ещё нет', false, e.message);
  }

  const qIds = tpl.filter((x) => x.kind !== 'free').map((x) => x.id);

  // ── 4. Обязательность на PUT ──────────────────────────────────────────
  try {
    const partial = {};
    if (qIds[0]) partial[qIds[0]] = 'Ответ только на первый';
    const bad = await api('PUT', `/api/tenders/${TENDER_MAIN}/analysis-checklist`, {
      role: 'TO', body: { answers: partial, free_answers: [], require_complete: 1 }
    });
    check('4 PUT с неполными ответами → 400 CHECKLIST_INCOMPLETE со списком',
      bad.status === 400 && bad.data && bad.data.code === 'CHECKLIST_INCOMPLETE' &&
      Array.isArray(bad.data.missing) && bad.data.missing.length === 9,
      'status=' + bad.status + ', code=' + (bad.data && bad.data.code) + ', missing=' + (bad.data && bad.data.missing ? bad.data.missing.length : '—'));
  } catch (e) {
    check('4 PUT с неполными ответами → 400 CHECKLIST_INCOMPLETE со списком', false, e.message);
  }

  // ── 5. Полное сохранение ──────────────────────────────────────────────
  const fullAnswers = {};
  qIds.forEach((id, i) => { fullAnswers[id] = 'Ответ №' + (i + 1) + ' — проверка гейта D-203'; });
  const freeAnswers = [{ id: 'free1', text: 'Свой вопрос аналитика', answer: 'Свой ответ аналитика' }];
  try {
    const put = await api('PUT', `/api/tenders/${TENDER_MAIN}/analysis-checklist`, {
      role: 'TO', body: { answers: fullAnswers, free_answers: freeAnswers, require_complete: 1 }
    });
    const round = await api('GET', `/api/tenders/${TENDER_MAIN}/analysis-checklist`, { role: 'TO' });
    const saved = round.data.checklist || {};
    const okAnswers = qIds.length === 10 && qIds.every((id) => saved.answers && saved.answers[id] === fullAnswers[id]);
    const okFree = Array.isArray(saved.free_answers) && saved.free_answers.some((f) => f.answer === 'Свой ответ аналитика');
    check('5 PUT полными ответами сохранён и читается обратно (ответы + свободная строка)',
      put.status === 200 && okAnswers && okFree && Array.isArray(saved.template_snapshot) && saved.template_snapshot.length === 12,
      'answers=' + Object.keys(saved.answers || {}).length + ', free=' + (saved.free_answers || []).length + ', snapshot=' + (saved.template_snapshot || []).length);
  } catch (e) {
    check('5 PUT полными ответами сохранён и читается обратно (ответы + свободная строка)', false, e.message);
  }

  // ── 6. Закрытие анализа БЕЗ чек-листа → 400 ───────────────────────────
  const rj = () => ({
    mode: 'analysis',
    summary: 'Гейт D-203: проверка обязательности чек-листа',
    feasibility: 'yes', risks: '', recommendation: ''
  });
  try {
    const noCl = await api('PUT', `/api/tenders/${TENDER_FINAL}/rp-review`, {
      role: 'ADMIN', body: { finalize: true, decision: 'submit', report_json: rj(), override_as_admin: true }
    });
    check('6 закрытие анализа без чек-листа → 400 CHECKLIST_REQUIRED',
      noCl.status === 400 && noCl.data && noCl.data.code === 'CHECKLIST_REQUIRED' && Array.isArray(noCl.data.missing) && noCl.data.missing.length === 10,
      'status=' + noCl.status + ', code=' + (noCl.data && noCl.data.code) + ', missing=' + (noCl.data && noCl.data.missing ? noCl.data.missing.length : '—'));
  } catch (e) {
    check('6 закрытие анализа без чек-листа → 400 CHECKLIST_REQUIRED', false, e.message);
  }

  // после отказа анализ обязан остаться закрытым=false
  try {
    const st = await db.query('SELECT analysis_finalized_at, is_final FROM tender_rp_reviews WHERE tender_id = $1', [TENDER_FINAL]);
    check('6b после отказа анализ НЕ закрылся', st.rows[0] && !st.rows[0].analysis_finalized_at && !st.rows[0].is_final,
      'analysis_finalized_at=' + st.rows[0].analysis_finalized_at + ', is_final=' + st.rows[0].is_final);
  } catch (e) {
    check('6b после отказа анализ НЕ закрылся', false, e.message);
  }

  // ── 7. С заполненным чек-листом анализ закрывается ────────────────────
  try {
    const g = await api('GET', `/api/tenders/${TENDER_FINAL}/analysis-checklist`, { role: 'ADMIN' });
    const t2 = g.data.template || [];
    const a2 = {};
    t2.filter((x) => x.kind !== 'free').forEach((x, i) => { a2[x.id] = 'Ответ ' + (i + 1); });
    const put = await api('PUT', `/api/tenders/${TENDER_FINAL}/analysis-checklist`, {
      role: 'ADMIN', body: { answers: a2, free_answers: [], require_complete: 1 }
    });
    if (put.status !== 200) throw new Error('PUT чек-листа: ' + put.status + ' — ' + JSON.stringify(put.data).slice(0, 160));

    const fin = await api('PUT', `/api/tenders/${TENDER_FINAL}/rp-review`, {
      role: 'ADMIN', body: { finalize: true, decision: 'submit', report_json: rj(), override_as_admin: true }
    });
    check('7 с заполненным чек-листом анализ закрывается (200), чек-лист не мешает',
      fin.status === 200,
      'status=' + fin.status + (fin.data && fin.data.code ? ', code=' + fin.data.code : '') +
      (fin.status !== 200 && fin.data && fin.data.error ? ', error=' + String(fin.data.error).slice(0, 90) : ''));
  } catch (e) {
    check('7 с заполненным чек-листом анализ закрывается (200), чек-лист не мешает', false, e.message);
  }

  // ── 7b. Закрытый анализ: чек-лист НЕЛЬЗЯ переписать (D-203, нашёл L3-верификатор) ──
  // Чек-лист — основание решения о подаче: после закрытия анализа он заморожен.
  try {
    const before = await api('GET', `/api/tenders/${TENDER_FINAL}/analysis-checklist`, { role: 'ADMIN' });
    const frozen = (before.data.checklist && before.data.checklist.answers) || {};
    const tamper = {};
    Object.keys(frozen).forEach((k) => { tamper[k] = 'ПРАВКА ПОСЛЕ ЗАКРЫТИЯ'; });
    const bad = await api('PUT', `/api/tenders/${TENDER_FINAL}/analysis-checklist`, {
      role: 'ADMIN', body: { answers: tamper, free_answers: [], require_complete: 1 }
    });
    const after = await api('GET', `/api/tenders/${TENDER_FINAL}/analysis-checklist`, { role: 'ADMIN' });
    const afterAnswers = (after.data.checklist && after.data.checklist.answers) || {};
    const unchanged = JSON.stringify(afterAnswers) === JSON.stringify(frozen);
    check('7b правка чек-листа после закрытия анализа → 409 CHECKLIST_LOCKED, ответы не изменились',
      bad.status === 409 && bad.data && bad.data.code === 'CHECKLIST_LOCKED' && unchanged,
      'status=' + bad.status + ', code=' + (bad.data && bad.data.code) + ', ответы не изменились=' + unchanged);
  } catch (e) {
    check('7b правка чек-листа после закрытия анализа → 409 CHECKLIST_LOCKED, ответы не изменились', false, e.message);
  }

  // ── 7c. ТО (роль «to») тоже не может переписать закрытый чек-лист ─────
  try {
    const bad = await api('PUT', `/api/tenders/${TENDER_FINAL}/analysis-checklist`, {
      role: 'TO', body: { answers: { q1: 'правка от ТО' }, free_answers: [], require_complete: 1 }
    });
    check('7c ТО не может переписать чек-лист закрытого анализа',
      bad.status === 409, 'status=' + bad.status + ', code=' + (bad.data && bad.data.code));
  } catch (e) {
    check('7c ТО не может переписать чек-лист закрытого анализа', false, e.message);
  }

  // ── 7d. Мягко удалённый тендер: чек-лист недоступен на ВСЕХ трёх роутах (D-203) ──
  // Инвариант держится одинаково на GET / PUT / .docx. Раньше GET отдавал ответы
  // удалённого тендера (нашёл L3-верификатор 20.09) — это утечка бюджета/оценки конкурентов.
  try {
    const { Client } = require('pg');
    const c = new Client(DB_CFG);
    await c.connect();
    const before = await c.query('SELECT deleted_at FROM tenders WHERE id = $1', [TENDER_MAIN]);
    const orig = before.rows[0] ? before.rows[0].deleted_at : undefined;
    if (orig === undefined) throw new Error('тендер ' + TENDER_MAIN + ' не найден в клоне');
    await c.query('UPDATE tenders SET deleted_at = NOW() WHERE id = $1', [TENDER_MAIN]);

    let getSt, putSt, docxSt, leaked = null;
    try {
      const g = await api('GET', `/api/tenders/${TENDER_MAIN}/analysis-checklist`, { role: 'TO' });
      getSt = g.status;
      leaked = (g.data && g.data.checklist && g.data.checklist.answers) || null;
      const p = await api('PUT', `/api/tenders/${TENDER_MAIN}/analysis-checklist`, {
        role: 'TO', body: { answers: { q1: 'x' }, free_answers: [] }
      });
      putSt = p.status;
      const d = await fetch(BASE + `/api/tenders/${TENDER_MAIN}/analysis-checklist.docx`, {
        headers: { Authorization: 'Bearer ' + getTokenSync('TO') }
      });
      docxSt = d.status;
    } finally {
      if (orig === null) await c.query('UPDATE tenders SET deleted_at = NULL WHERE id = $1', [TENDER_MAIN]);
      else await c.query('UPDATE tenders SET deleted_at = $2 WHERE id = $1', [TENDER_MAIN, orig]);
      const back = await c.query('SELECT deleted_at FROM tenders WHERE id = $1', [TENDER_MAIN]);
      const restored = back.rows[0] && back.rows[0].deleted_at === null;
      check('7d-bis deleted_at восстановлен после проверки (клон не испорчен)', restored, 'deleted_at=' + (back.rows[0] && back.rows[0].deleted_at));
      await c.end();
    }
    check('7d удалённый тендер: GET + PUT + .docx не отдают чек-лист (404 на всех)',
      getSt === 404 && putSt === 404 && docxSt === 404 && !leaked,
      'GET=' + getSt + ', PUT=' + putSt + ', docx=' + docxSt + ', ответы утекли=' + !!leaked);
  } catch (e) {
    check('7d удалённый тендер: GET + PUT + .docx не отдают чек-лист (404 на всех)', false, e.message);
  }

  // ── 7e. Несуществующий тендер → 404, а не 200 с пустым шаблоном ───────
  try {
    const g = await api('GET', '/api/tenders/999999999/analysis-checklist', { role: 'TO' });
    check('7e несуществующий тендер: GET чек-листа → 404',
      g.status === 404, 'status=' + g.status);
  } catch (e) {
    check('7e несуществующий тендер: GET чек-листа → 404', false, e.message);
  }

  // ── 7f. История у контрагента: чек-лист мягко удалённого тендера НЕ отдаётся ──
  // Тот же инвариант, что 7d, но другой роут (customers.js — третий сиблинг).
  try {
    const { Client } = require('pg');
    const c = new Client(DB_CFG);
    await c.connect();
    const before = await c.query('SELECT deleted_at FROM tenders WHERE id = $1', [TENDER_MAIN]);
    const orig = before.rows[0] ? before.rows[0].deleted_at : undefined;
    if (orig === undefined) throw new Error('тендер ' + TENDER_MAIN + ' не найден в клоне');

    const histLive = await api('GET', `/api/customers/${inn}/analysis-checklists`, { role: 'TO' });
    const foundLive = ((histLive.data && histLive.data.items) || []).some((x) => Number(x.tender_id) === TENDER_MAIN);

    await c.query('UPDATE tenders SET deleted_at = NOW() WHERE id = $1', [TENDER_MAIN]);
    let foundDead = null, leaked = false;
    try {
      const histDead = await api('GET', `/api/customers/${inn}/analysis-checklists`, { role: 'TO' });
      const items = (histDead.data && histDead.data.items) || [];
      const hit = items.find((x) => Number(x.tender_id) === TENDER_MAIN);
      foundDead = !!hit;
      leaked = !!(hit && hit.answers && Object.keys(hit.answers).length);
    } finally {
      if (orig === null) await c.query('UPDATE tenders SET deleted_at = NULL WHERE id = $1', [TENDER_MAIN]);
      else await c.query('UPDATE tenders SET deleted_at = $2 WHERE id = $1', [TENDER_MAIN, orig]);
      const back = await c.query('SELECT deleted_at FROM tenders WHERE id = $1', [TENDER_MAIN]);
      check('7f-bis deleted_at восстановлен после проверки истории',
        back.rows[0] && back.rows[0].deleted_at === null, 'deleted_at=' + (back.rows[0] && back.rows[0].deleted_at));
      await c.end();
    }
    check('7f история контрагента: удалённый тендер исчезает из выдачи, ответы не утекают',
      foundLive && !foundDead && !leaked,
      'в живой выдаче=' + foundLive + ', в выдаче удалённого=' + foundDead + ', ответы утекли=' + leaked);
  } catch (e) {
    check('7f история контрагента: удалённый тендер исчезает из выдачи, ответы не утекают', false, e.message);
  }

  // ── 8. Word ───────────────────────────────────────────────────────────
  try {
    const d = await downloadDocx(`/api/tenders/${TENDER_MAIN}/analysis-checklist.docx`, 'TO');
    const isZip = d.buf[0] === 0x50 && d.buf[1] === 0x4b;
    const ct = String(d.headers.get('content-type') || '');
    const cd = String(d.headers.get('content-disposition') || '');
    // DOCX — ZIP: текст в word/document.xml, читаем элемент, а не сырые байты архива.
    let xml = '';
    try {
      const PizZip = require('pizzip');
      xml = new PizZip(d.buf).file('word/document.xml').asText();
    } catch (e) { xml = ''; }
    // Снимаем теги и XML-экранирование, затем ищем самое длинное слово заказчика:
    // имя может быть разбито на несколько runs и содержать «кавычки»/&quot;.
    const plain = xml.replace(/<[^>]+>/g, ' ')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const custName = String((tRow.rows[0] && tRow.rows[0].customer_name) || '');
    const custToken = (custName.match(/[A-Za-zА-Яа-яЁё]{4,}/g) || []).sort((a, b) => b.length - a.length)[0] || '';
    const hasAnswer = plain.includes('проверка гейта D-203') || plain.includes('Свой ответ аналитика');
    const hasCustomer = !!custToken
      ? plain.includes(custToken) || plain.includes(custToken.toUpperCase()) || plain.includes(custToken.toLowerCase())
      : plain.includes(custName.slice(0, 6));
    const hasPlaceholder = /\{(tender_title|customer_name|author_name|created_at|num|text|answer)\}/.test(xml);
    check('8 Word: 200 + docx + ZIP + ответ и заказчик внутри + без плейсхолдеров',
      d.status === 200 && isZip && /wordprocessingml/.test(ct) && /attachment/.test(cd) &&
      hasAnswer && hasCustomer && !hasPlaceholder && d.buf.length > 1000,
      'status=' + d.status + ', zip=' + isZip + ', bytes=' + d.buf.length + ', xml=' + xml.length +
      ', ответ=' + hasAnswer + ', заказчик="' + custToken + '"→' + hasCustomer + ', плейсхолдер=' + hasPlaceholder);
  } catch (e) {
    check('8 Word: 200 + docx + ZIP + ответ и заказчик внутри + без плейсхолдеров', false, e.message);
  }

  // ── 9. История у контрагента ──────────────────────────────────────────
  try {
    const h = await api('GET', `/api/customers/${inn}/analysis-checklists`, { role: 'TO' });
    const items = (h.data && h.data.items) || [];
    const mine = items.find((x) => Number(x.tender_id) === TENDER_MAIN);
    check('9 история у контрагента находит чек-лист с работой и ответами',
      h.status === 200 && !!mine && !!mine.work_title && mine.answers && Object.keys(mine.answers).length === 10,
      'items=' + items.length + ', работа="' + String((mine && mine.work_title) || '').slice(0, 50) + '", ответов=' + (mine ? Object.keys(mine.answers || {}).length : 0));
  } catch (e) {
    check('9 история у контрагента находит чек-лист с работой и ответами', false, e.message);
  }

  // ── 10-12. Фронт: настоящий модуль в chromium ─────────────────────────
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }
  if (!chromium) {
    check('10 html() рисует 10 вопросов + 2 свободные строки + кнопку сохранения', false, 'playwright не найден');
    check('11 collect() отдаёт пустые обязательные в missing', false, 'playwright не найден');
    check('12 readOnly: все поля только для чтения, кнопки сохранения нет', false, 'playwright не найден');
  } else {
    const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      // Грузим стенд С ДИСКА: при setContent относительные file-URL считаются от about:blank.
      const fixture = path.join(os.tmpdir(), 'asgard-analysis-checklist.html');
      fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="host"></div>
<script src="${fileUrl(path.join(PUBLIC, 'assets/js/ui.js'))}"></script>
<script src="${fileUrl(path.join(PUBLIC, 'assets/js/analysis_checklist.js'))}"></script>
</body></html>`, 'utf8');
      await page.goto(fileUrl(fixture));
      await page.waitForTimeout(250);

      const loaded = await page.evaluate(() => !!(window.AsgardAnalysisChecklist));
      if (!loaded) throw new Error('AsgardAnalysisChecklist не загрузился со стенда');

      const probe = await page.evaluate(() => {
        const CL = window.AsgardAnalysisChecklist;
        const tpl = [];
        for (let i = 0; i < 10; i++) tpl.push({ id: 'q' + (i + 1), text: 'Вопрос ' + (i + 1), kind: 'question', required: true });
        tpl.push({ id: 'free1', text: 'Свободный вопрос 1', kind: 'free', required: false });
        tpl.push({ id: 'free2', text: 'Свободный вопрос 2', kind: 'free', required: false });

        const host = document.getElementById('host');
        host.innerHTML = CL.html(tpl, {}, [], {});
        const edit = {
          areas: host.querySelectorAll('[data-cl-id]').length,
          freeQ: host.querySelectorAll('[data-cl-free-q]').length,
          freeRows: host.querySelectorAll('.rp-cl-free-row').length,
          saveBtn: !!host.querySelector('#rpClSave'),
          steps: host.querySelectorAll('.rp-cl-step').length,
          missing: CL.collect(host).missing.length
        };

        const ro = document.createElement('div');
        ro.innerHTML = CL.html(tpl, {}, [], { readOnly: true });
        const readOnly = {
          areas: ro.querySelectorAll('[data-cl-id]').length,
          readonlyAreas: ro.querySelectorAll('[data-cl-id][readonly]').length,
          readonlyFree: ro.querySelectorAll('[data-cl-free-q][readonly]').length,
          saveBtn: !!ro.querySelector('#rpClSave')
        };
        return { edit, readOnly };
      });

      check('10 html() рисует 10 вопросов + 2 свободные строки + кнопку сохранения',
        probe.edit.areas === 10 && probe.edit.freeQ === 2 && probe.edit.freeRows === 2 &&
        probe.edit.saveBtn && probe.edit.steps === 4,
        'textarea=' + probe.edit.areas + ', свободных=' + probe.edit.freeQ + ', кнопка=' + probe.edit.saveBtn + ', шагов=' + probe.edit.steps);

      check('11 collect() отдаёт пустые обязательные в missing (блокирующая валидация)',
        probe.edit.missing === 10,
        'missing=' + probe.edit.missing + ' (ожидали 10)');

      check('12 readOnly: все поля только для чтения, кнопки сохранения нет',
        probe.readOnly.areas === 10 && probe.readOnly.readonlyAreas === 10 &&
        probe.readOnly.readonlyFree === 2 && !probe.readOnly.saveBtn,
        'readonly textarea=' + probe.readOnly.readonlyAreas + '/' + probe.readOnly.areas +
        ', свободных readonly=' + probe.readOnly.readonlyFree + ', кнопка=' + probe.readOnly.saveBtn);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      check('10 html() рисует 10 вопросов + 2 свободные строки + кнопку сохранения', false, msg);
      check('11 collect() отдаёт пустые обязательные в missing (блокирующая валидация)', false, msg);
      check('12 readOnly: все поля только для чтения, кнопки сохранения нет', false, msg);
    } finally {
      await browser.close();
    }
  }

  // ── 13-16. Интеграция в модули (по коду) ──────────────────────────────
  try {
    const calc = fs.readFileSync(path.join(PUBLIC, 'assets/js/rp_calc_modal.js'), 'utf8');
    const rev = fs.readFileSync(path.join(PUBLIC, 'assets/js/rp_review_modal.js'), 'utf8');
    const cc = fs.readFileSync(path.join(PUBLIC, 'assets/js/customer-card.js'), 'utf8');
    const idx = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    check('13 rp_calc_modal: вкладка «Чек-лист» + renderChecklist + renderInto',
      /id: 'checklist', label: 'Чек-лист'/.test(calc) && /function renderChecklist/.test(calc) && /renderInto\('rpCalcChecklistHost'/.test(calc),
      'вкладка=' + /id: 'checklist'/.test(calc) + ', renderChecklist=' + /function renderChecklist/.test(calc) + ', renderInto=' + /renderInto\('rpCalcChecklistHost'/.test(calc));
    check('14 rp_review_modal: вкладка «Чек-лист» + сохранение + requireComplete при закрытии',
      /checklist/.test(rev) && /rpClSave/.test(rev) && /requireComplete:\s*true/.test(rev),
      'rpClSave=' + /rpClSave/.test(rev) + ', requireComplete=' + /requireComplete:\s*true/.test(rev));
    check('15 customer-card: тянет /analysis-checklists и рисует блок',
      /analysis-checklists/.test(cc) && /ccChecklists/.test(cc),
      'fetch=' + /analysis-checklists/.test(cc) + ', блок=' + /ccChecklists/.test(cc));
    const m = /assets\/js\/analysis_checklist\.js\?v=([0-9.]+)/.exec(idx);
    check('16 index.html: analysis_checklist.js подключён (иначе модуль не загрузится)', !!m, m ? m[0] : 'тег не найден');
  } catch (e) {
    check('13 rp_calc_modal: вкладка «Чек-лист» + renderChecklist + renderInto', false, e.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(failed.length
    ? `${C.red}${failed.length} FAIL${C.off} из ${results.length}`
    : `${C.green}все ${results.length} PASS${C.off}`);
  return failed.length;
})().then(async (failedCount) => {
  await restore();
  process.exit(failedCount ? 1 : 0);
}).catch(async (e) => {
  console.error(C.red + 'FATAL: ' + (e && e.stack ? e.stack : e) + C.off);
  await restore();
  process.exit(1);
});
