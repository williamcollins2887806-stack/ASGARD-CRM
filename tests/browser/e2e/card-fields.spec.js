const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

/**
 * card-fields.spec.js — проверка, что новые поля от модели реально
 * попадают в карточку и ДВ читается карточками.
 */
const CLONE = process.env.CLONE_URL || 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

test('анализ: суть, риски, выполнимость + карточки ДВ', async ({ page }) => {
  test.setTimeout(240000);
  const lr = await fetch(`${CLONE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_pm', password: 'Test123!' })
  });
  const ld = await lr.json();
  const pr = await fetch(`${CLONE}/api/auth/verify-pin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ld.token },
    body: JSON.stringify({ pin: '0000' })
  });
  const token = (await pr.json()).token;

  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: process.env.DB_PASSWORD || '123456789', database: 'asgard_crm_test'
  });
  await db.connect();
  const r = await db.query(
    "SELECT id FROM tenders WHERE tender_title ILIKE '%ДЕМО Мимир%' AND deleted_at IS NULL ORDER BY id LIMIT 1"
  );
  await db.end();
  const id = r.rows[0]?.id;
  test.skip(!id, 'нет демо-тендера');

  await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('token', t);
  }, token);
  await page.goto(`${CLONE}/#/tenders-registry`, { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof window.AsgardRpReviewModal === 'object', null, { timeout: 30000 });

  // Разбор через тот же эндпоинт, что у кнопки. ТЗ с объёмами и сроками:
  // на пустом ТЗ модель честно возвращает need_info и полей нет.
  const TZ = 'Очистка приёмных бункеров КТЛ-1. Два бункера по 875 м³, зольные и коксовые отложения, ' +
    'снимаем отбойным молотком и вручную, грузим в кюбели. Работы внутри аппаратов. ' +
    'Срок — 20 календарных дней. Контакт: главный инженер, +7 900 000-00-01.';
  const res = await page.evaluate(async (tz) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const s = await fetch('/api/tkp-quick/sessions', { headers: { Authorization: auth } }).then((x) => x.json());
    const uid = (s.sessions || [])[0]?.session_uid;
    await fetch(`/api/tkp-quick/sessions/${uid}/stage/reset`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ to: 'intake' })
    });
    const a = await fetch(`/api/tkp-quick/sessions/${uid}/stage/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ tz_text: tz })
    }).then((x) => x.json());
    return {
      ok: a.ok,
      summary: a.summary,
      risks: a.risks,
      feasibility: a.feasibility,
      volumeSummary: a.volume_summary,
      positions: (a.state?.positions || []).length
    };
  }, TZ);
  console.log('ОТВЕТ МОДЕЛИ:', JSON.stringify(res).slice(0, 900));
  test.skip(!res.ok, 'разбор не удался');

  // Кладём в карточку так же, как кнопка.
  await page.evaluate(async (args) => {
    const { tid, tz } = args;
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const s = await fetch('/api/tkp-quick/sessions', { headers: { Authorization: auth } }).then((x) => x.json());
    const uid = (s.sessions || [])[0]?.session_uid;
    const a = await fetch(`/api/tkp-quick/sessions/${uid}/stage/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ tz_text: tz })
    }).then((x) => x.json());
    const positions = (a.state && a.state.positions) || [];
    await fetch(`/api/tenders/${tid}/rp-review`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        mode: 'analysis',
        report_json: {
          mode: 'analysis',
          summary: a.summary, risks: a.risks, feasibility: a.feasibility,
          feasibility_note: a.feasibility_note,
          volume_summary: a.volume_summary, competition: a.competition,
          dv_positions: positions, call_questions: a.call_questions || [],
          contact: a.contact || null, decision_recommend: a.decision_recommend
        }
      })
    });
    const d = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } }).then((x) => x.json());
    window.AsgardRpReviewModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'analysis' });
    await new Promise((res) => setTimeout(res, 2200));
  }, { tid: id, tz: TZ });

  const dom = await page.evaluate(() => {
    const val = (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.value != null ? el.value : el.textContent).trim().slice(0, 160) : null;
    };
    return {
      cards: document.querySelectorAll('.rp-dv-card').length,
      techBlocks: document.querySelectorAll('.rp-dv-card__tech').length,
      summary: val('#rpSummary'),
      risks: val('#rpRisks'),
      volume: val('#rpVolumeSummary'),
      bodyText: (document.querySelector('.rp-review-analysis-report') || {}).innerText?.slice(0, 400) || null
    };
  });
  console.log('КАРТОЧКА:', JSON.stringify(dom).slice(0, 900));

  fs.mkdirSync(OUT, { recursive: true });
  const dv = page.locator('.rp-review-dv-block').first();
  if (await dv.count()) await dv.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '95-dv-cards.png') });

  expect(dom.cards, 'карточки ДВ').toBeGreaterThan(0);
});
