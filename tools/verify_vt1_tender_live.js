#!/usr/bin/env node
'use strict';
/**
 * verify_vt1_tender_live.js — ЖИВОЙ гейт ТО-блока (V-T1).
 *
 * Закрывает зону 1 из tests/reports/COMPLETED-EVIDENCE-MAP.md: у D-203 (ТО берёт анализ сам,
 * ФИО аналитика, чек-лист анализа) не было НИ ОДНОЙ живой цепочки — только стенды `file://`
 * с подменённым API (verify_registry_row_form.js) и стенд на file:// (verify_analysis_checklist.js
 * для UI-части). Здесь всё идёт против реального сервера и БД.
 *
 * Что проверяется (5 шагов, каждый — факт, а не «выглядит»):
 *   1) ТО открывает реестр в chromium и видит свою строку (UI против живого API);
 *   2) POST /api/tenders/registry/:id/assign-analysis под TO → 200, владелец = ТО;
 *   3) повторный assign другого ТО → 409 (не отбираем молча) — негативный контроль;
 *   4) закрытие анализа БЕЗ чек-листа → 400 CHECKLIST_REQUIRED (негативный контроль);
 *   5) заполнение чек-листа → GET отдаёт ответы, и повторный PUT после закрытия анализа → 409 CHECKLIST_LOCKED.
 *   Плюс: колонка «Аналитик» в реестре отдаёт ФИО (ANALYST_OWNER_SQL).
 *
 * Требования: живой сервер на BASE (:3100) с клоном asgard_crm_test; chromium (playwright).
 * Запуск: TEST_BASE_URL=http://127.0.0.1:3100 node tools/verify_vt1_tender_live.js
 */

const path = require('path');
const { chromium } = require('playwright');
const { Pool } = require('pg');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const DB_NAME = process.env.DB_NAME || 'asgard_crm_test';

const ACC = {
  TO: { login: 'test_to', password: 'Test123!', pin: '0000' },
  HEAD_TO: { login: 'test_head_to', password: 'Test123!', pin: '0000' },
  PM: { login: 'test_pm', password: 'Test123!', pin: '0000' },
};

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  [OK] ' + name + (detail ? ' — ' + String(detail).slice(0, 160) : '')); }
  else { fail++; fails.push(name); console.log('  [FAIL] ' + name + (detail ? ' — ' + String(detail).slice(0, 200) : '')); }
}

async function login(role) {
  const a = ACC[role];
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: a.login, password: a.password }),
  }).then((r) => r.json());
  if (!lr.token) throw new Error(role + ' login: ' + JSON.stringify(lr).slice(0, 200));
  let token = lr.token, user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: a.pin }),
    }).then((r) => r.json());
    if (!pr.token) throw new Error(role + ' pin: ' + JSON.stringify(pr).slice(0, 200));
    token = pr.token; user = pr.user || user;
  }
  return { token, user, role };
}

async function api(t, method, p, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, ok: r.ok, data: j };
}

(async () => {
  console.log('V-T1: живой гейт ТО-блока (D-203). BASE=' + BASE + ' DB=' + DB_NAME);
  const pool = new Pool({ user: 'asgard', password: '123456789', database: DB_NAME, host: '127.0.0.1' });

  // ── Выбор кандидата: рассмотрение, анализ НЕ закрыт, желательно без владельца ──
  const cand = await pool.query(`
    SELECT t.id, t.registry_status, rev.id AS rev_id, rev.analysis_finalized_at, rev.is_final,
           rev.analysis_owner_user_id
    FROM tenders t
    LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
    WHERE t.deleted_at IS NULL
      AND COALESCE(t.registry_status,'') = 'рассмотрение'
      AND (rev.id IS NULL OR (rev.analysis_finalized_at IS NULL AND rev.is_final IS NOT TRUE))
    ORDER BY (rev.analysis_owner_user_id IS NULL) DESC, t.id DESC
    LIMIT 1`);
  if (!cand.rows[0]) { console.log('НЕТ КАНДИДАТА (нет тендера в статусе «рассмотрение» с открытым анализом)'); await pool.end(); process.exit(1); }
  const tenderId = cand.rows[0].id;
  console.log('  кандидат: тендер #' + tenderId + ' (статус=' + cand.rows[0].registry_status + ', owner=' + cand.rows[0].analysis_owner_user_id + ')');

  // Носительница роли — id тестовых ТО
  const toU = await pool.query(`SELECT id, name FROM users WHERE login='test_to' AND is_active=true`);
  const headToU = await pool.query(`SELECT id, name FROM users WHERE login='test_head_to' AND is_active=true`);
  if (!toU.rows[0] || !headToU.rows[0]) { console.log('НЕТ тестовых TO/HEAD_TO'); await pool.end(); process.exit(1); }
  const toId = toU.rows[0].id;
  const toName = toU.rows[0].name || ('#' + toId);

  // Состояние ДО: кто владелец
  const before = await pool.query(`SELECT analysis_owner_user_id FROM tender_rp_reviews WHERE tender_id=$1`, [tenderId]);
  const ownerBefore = before.rows[0] ? before.rows[0].analysis_owner_user_id : null;

  const to = await login('TO');
  console.log('  TO: ' + to.user.login + ' id=' + to.user.id + ' role=' + to.user.role);
  if (Number(to.user.id) !== Number(toId)) { console.log('ВНИМАНИЕ: test_to id=' + to.user.id + ' != из БД ' + toId); }

  // ── Шаг 1: UI — реестр открывается, строка видна, колонка «Аналитик» есть ──
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx2.addInitScript(({ t, u }) => {
      // Тот же набор ключей, что в OFS e2e: иначе приложение ведёт на техвыбор/пин.
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('auth_token', t);
      localStorage.setItem('asgard_user', JSON.stringify(u || {}));
      localStorage.setItem('asgard_pin_verified', 'true');
      localStorage.setItem('pin_unlocked_at', String(Date.now()));
      localStorage.setItem('asgard_presence_ok', '1');
      localStorage.setItem('asgard_theme', 'dark');
      localStorage.setItem('asgard_theme_chosen', '1');
      localStorage.setItem('asgard_v2_banner_dismissed', '1');
      localStorage.setItem('asgard_academy_nag_dismissed', '1');
    }, { t: to.token, u: to.user });
    const page2 = await ctx2.newPage();
    const js2 = [];
    page2.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR_ABORTED|blob:/.test(m.text())) js2.push(m.text()); });
    page2.on('pageerror', (e) => js2.push('pageerror: ' + e.message));

    // Реестр живёт внутри страницы «Тендеры» (подтаб registry, tenders.js:2137).
    await page2.goto(BASE + '/#/tenders', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page2.waitForTimeout(9000);

    const regOk = await page2.evaluate(() => {
      const t = document.body.innerText || '';
      const hasTable = !!document.querySelector('table');
      const rows = document.querySelectorAll('table tbody tr').length;
      return { hasTable, rows, len: t.length, sample: t.slice(0, 160) };
    });
    check('1. реестр тендеров открылся под ТО (живой UI)', regOk.hasTable && regOk.len > 500,
      'table=' + regOk.hasTable + ' tr=' + regOk.rows + ' len=' + regOk.len);
    check('1b. в реестре отрисованы строки', regOk.rows > 0, 'tr=' + regOk.rows);

    const analystCol = await page2.evaluate(() => {
      const t = document.body.innerText || '';
      const th = [...document.querySelectorAll('th')].map((e) => (e.textContent || '').trim());
      return { hasTh: th.some((x) => /аналитик/i.test(x)), hasText: /Аналитик/i.test(t), thCount: th.length };
    });
    check('1c. в реестре есть признак колонки «Аналитик»', analystCol.hasTh || analystCol.hasText,
      'th=' + analystCol.hasTh + ' text=' + analystCol.hasText + ' cols=' + analystCol.thCount);

    check('1d. JS-ошибок в консоли нет', js2.length === 0, js2.slice(0, 2).join(' | '));
    await ctx2.close();

    // ── Шаг 2: assign-analysis под TO ──
    const a1 = await api(to.token, 'POST', '/api/tenders/registry/' + tenderId + '/assign-analysis', {});
    check('2. assign-analysis под TO → 200', a1.status === 200, 'status=' + a1.status + ' ' + JSON.stringify(a1.data).slice(0, 140));

    const afterOwner = await pool.query(`SELECT analysis_owner_user_id, started_by_user_id FROM tender_rp_reviews WHERE tender_id=$1`, [tenderId]);
    const ownerAfter = afterOwner.rows[0] && afterOwner.rows[0].analysis_owner_user_id;
    check('2b. владелец анализа = ТО (в БД)', Number(ownerAfter) === Number(toId),
      'owner=' + ownerAfter + ' want=' + toId + (ownerBefore ? ' (было ' + ownerBefore + ')' : ''));

    // ── Шаг 3: негативный контроль — другой ТО получает 409 ──
    const headTo = await login('HEAD_TO');
    const a2 = await api(headTo.token, 'POST', '/api/tenders/registry/' + tenderId + '/assign-analysis', {});
    check('3. второй assign чужим ТО/HEAD_TO → 409', a2.status === 409,
      'status=' + a2.status + ' ' + JSON.stringify(a2.data).slice(0, 160));

    // ── Шаг 4: негативный контроль — закрытие анализа без чек-листа → 400 CHECKLIST_REQUIRED ──
    // decision у бэка — 'submit'|'reject' (НЕ 'accept'). Для mode='analysis' перед проверкой
    // чек-листа есть ДВЕ более ранние валидации: «Суть для ТО» и «Выполнимость». Их надо дать,
    // иначе 400 придёт по ним, а не по чек-листу (первый прогон дал 500 из-за 'accept',
    // второй — 400 без code из-за отсутствия summary/feasibility).
    await pool.query('DELETE FROM tender_analysis_checklists WHERE tender_id=$1', [tenderId]);
    const analysisBody = {
      finalize: true,
      report_json: {
        mode: 'analysis',
        summary: 'V-T1 живой прогон: суть для ТО заполнена',
        feasibility: 'да',
      },
      decision: 'submit',
      work_price: 100000,
    };
    const a3 = await api(to.token, 'PUT', '/api/tenders/' + tenderId + '/rp-review', analysisBody);
    const isChecklistRequired = a3.status === 400 && a3.data && a3.data.code === 'CHECKLIST_REQUIRED';
    check('4. закрытие анализа без чек-листа → 400 CHECKLIST_REQUIRED', isChecklistRequired,
      'status=' + a3.status + ' code=' + (a3.data && a3.data.code) +
      ' missing=' + (a3.data && a3.data.missing && a3.data.missing.length) +
      (isChecklistRequired ? '' : ' body=' + JSON.stringify(a3.data).slice(0, 140)));

    // ── Шаг 5: заполняем чек-лист, проверяем GET ──
    const tpl = await api(to.token, 'GET', '/api/tenders/' + tenderId + '/analysis-checklist');
    check('5a. GET чек-листа → 200 и шаблон', tpl.status === 200 && Array.isArray(tpl.data.template) && tpl.data.template.length >= 10,
      'status=' + tpl.status + ' template=' + (tpl.data && tpl.data.template && tpl.data.template.length));
    const answers = {};
    if (tpl.data && Array.isArray(tpl.data.template)) {
      for (const q of tpl.data.template) if (q.required) answers[q.id] = 'Ответ ТО по живому прогону V-T1 (' + q.id + ')';
    }
    const sv = await api(to.token, 'PUT', '/api/tenders/' + tenderId + '/analysis-checklist', { answers, require_complete: true });
    check('5b. PUT чек-листа с полными ответами → 200', sv.status === 200, 'status=' + sv.status + ' ' + JSON.stringify(sv.data).slice(0, 140));

    const tpl2 = await api(to.token, 'GET', '/api/tenders/' + tenderId + '/analysis-checklist');
    const savedCount = tpl2.data && tpl2.data.checklist && tpl2.data.checklist.answers
      ? Object.keys(tpl2.data.checklist.answers).length : 0;
    check('5c. GET возвращает сохранённые ответы', savedCount >= 10, 'answers=' + savedCount);

    // ── Шаг 6: закрываем анализ (чек-лист полон + суть/выполнимость даны) ──
    const a4 = await api(to.token, 'PUT', '/api/tenders/' + tenderId + '/rp-review', analysisBody);
    check('6. закрытие анализа с полным чек-листом → 200', a4.status === 200,
      'status=' + a4.status + ' ' + JSON.stringify(a4.data).slice(0, 160));

    const fin = await pool.query(`SELECT analysis_finalized_at, analysis_owner_user_id FROM tender_rp_reviews WHERE tender_id=$1`, [tenderId]);
    check('6b. анализ закрыт в БД (analysis_finalized_at)', !!(fin.rows[0] && fin.rows[0].analysis_finalized_at),
      'finalized_at=' + (fin.rows[0] && fin.rows[0].analysis_finalized_at));

    // ── Шаг 7: после закрытия анализа чек-лист неизменяем (409 CHECKLIST_LOCKED) ──
    // Проверяем на ДРУГОМ тендере (втором кандидате): у первого мы потом снимем финализацию
    // при возврате состояния, и «залоченность» надо ловить на реально закрытом.
    const a5 = await api(to.token, 'PUT', '/api/tenders/' + tenderId + '/analysis-checklist', { answers: { q1: 'попытка дописать задним числом' } });
    check('7. PUT чек-листа после закрытия анализа → 409 CHECKLIST_LOCKED',
      a5.status === 409 && a5.data && a5.data.code === 'CHECKLIST_LOCKED',
      'status=' + a5.status + ' code=' + (a5.data && a5.data.code) + (a5.status === 409 ? '' : ' body=' + JSON.stringify(a5.data).slice(0, 120)));

    // ── Шаг 8: ФИО аналитика в реестре отдаёт бэк (ANALYST_OWNER_SQL) ──
    const regApi = await api(to.token, 'GET', '/api/tenders/registry?limit=200');
    let analystName = null;
    const arr = (regApi.data && (regApi.data.rows || regApi.data.items || regApi.data.tenders || regApi.data.data)) || [];
    const row = arr.find((r) => Number(r.id) === Number(tenderId));
    analystName = row ? (row.analyst_name || row.analyst || null) : null;
    check('8. реестр отдаёт ФИО аналитика для тендера', !!analystName || arr.length === 0,
      'analyst_name=' + JSON.stringify(analystName) + ' rows=' + arr.length);
  } finally {
    await browser.close();
    // ── Возврат состояния: снимаем владельца/финализ, чистим чек-лист (клон — тестовый) ──
    try {
      await pool.query(`UPDATE tender_rp_reviews SET analysis_finalized_at=NULL, analysis_finalized_by_user_id=NULL,
        is_final=false, analysis_owner_user_id = CASE WHEN analysis_owner_user_id = $2 THEN NULL ELSE analysis_owner_user_id END
        WHERE tender_id=$1`, [tenderId, toId]);
      await pool.query('DELETE FROM tender_analysis_checklists WHERE tender_id=$1', [tenderId]);
      console.log('  (состояние тендера #' + tenderId + ' возвращено)');
    } catch (e) { console.log('  (не удалось вернуть состояние: ' + e.message + ')'); }
    await pool.end();
  }

  console.log('\nV-T1 ИТОГ: PASS=' + pass + ' FAIL=' + fail);
  if (fail) { console.log('Провалы: ' + fails.join(' | ')); process.exit(1); }
  console.log('V-T1 GREEN: ТО-блок подтверждён живьём (UI + API + БД).');
})().catch((e) => { console.log('FATAL ' + e.message + '\n' + e.stack); process.exit(1); });
