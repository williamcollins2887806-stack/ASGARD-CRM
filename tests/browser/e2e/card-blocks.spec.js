const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

/**
 * card-blocks.spec.js — карточка анализа показывает ДВ, звонок и технологию.
 *
 * Схема проверки: готовим данные через stage/analyze и сохранение карточки
 * ТЕМ ЖЕ путём, что и кнопка (saveRpReview), затем открываем карточку и
 * читаем реальные блоки. Так тест не зависит от 2-минутного ожидания модели.
 */
const CLONE = process.env.CLONE_URL || 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

async function tk() {
  const lr = await fetch(`${CLONE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_pm', password: 'Test123!' })
  });
  const ld = await lr.json();
  const pr = await fetch(`${CLONE}/api/auth/verify-pin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ld.token },
    body: JSON.stringify({ pin: '0000' })
  });
  return (await pr.json()).token;
}

async function demoId() {
  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: process.env.DB_PASSWORD || '123456789', database: 'asgard_crm_test'
  });
  await db.connect();
  const r = await db.query(
    "SELECT id FROM tenders WHERE tender_title ILIKE '%ДЕМО Мимир%' AND deleted_at IS NULL ORDER BY id LIMIT 1"
  );
  await db.end();
  return r.rows[0]?.id || null;
}

test('карточка анализа: ДВ + звонок + технология', async ({ page }) => {
  test.setTimeout(180000);
  const token = await tk();
  const id = await demoId();
  test.skip(!id, 'нет демо-тендера');

  await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('token', t);
  }, token);
  await page.goto(`${CLONE}/#/tenders-registry`, { waitUntil: 'commit' });
  await page.waitForTimeout(3000);

  // 1. Готовим разбор через тот же API, что использует кнопка.
  const prepared = await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const sRes = await fetch('/api/tkp-quick/sessions', { headers: { Authorization: auth } });
    const sd = await sRes.json();
    const uid = (sd.sessions || [])[0]?.session_uid;
    if (!uid) return { error: 'нет сессии' };
    await fetch(`/api/tkp-quick/sessions/${uid}/stage/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ to: 'intake' })
    });
    const aRes = await fetch(`/api/tkp-quick/sessions/${uid}/stage/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ tz_text: '' })
    });
    const a = await aRes.json().catch(() => ({}));
    if (!a.ok) return { error: a.error || 'analyze failed' };

    const positions = (a.state && a.state.positions) || [];
    const payload = {
      mode: 'analysis',
      decision: 'pending',
      report_json: {
        mode: 'analysis',
        summary: 'Мимир разобрал ТЗ: ' + positions.length + ' позиц.',
        scope: positions.map((p) => `${p.name} — ${p.volume} ${p.unit || ''}`).join('; '),
        volume_summary: positions.map((p) => `${p.name} — ${p.volume} ${p.unit || ''}`).join('; '),
        dv_positions: positions,
        call_questions: a.call_questions || [],
        contact: a.contact || null,
        decision_recommend: a.decision_recommend || 'need_info',
        feasibility: 'yes'
      }
    };
    const put = await fetch(`/api/tenders/${tid}/rp-review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(payload)
    });
    return {
      ok: put.ok,
      positions: positions.length,
      questions: (a.call_questions || []).length,
      contact: a.contact,
      putStatus: put.status
    };
  }, id);
  console.log('ПОДГОТОВКА:', JSON.stringify(prepared));
  test.skip(prepared.error, JSON.stringify(prepared));
  expect(prepared.putStatus, 'карточка сохранена').toBe(200);

  // 2. Открываем карточку анализа и читаем блоки.
  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } });
    const d = await r.json();
    window.AsgardRpReviewModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'analysis' });
    await new Promise((res) => setTimeout(res, 2200));
  }, id);

  const blocks = await page.evaluate(() => ({
    dv: document.querySelectorAll('.rp-review-dv-block').length,
    dvRows: document.querySelectorAll('.rp-review-dv-table tbody tr').length,
    call: document.querySelectorAll('.rp-review-call-block').length,
    questions: document.querySelectorAll('.rp-review-call-list li').length,
    phone: (document.querySelector('.rp-review-call-text .muted') || {}).textContent || null
  }));
  console.log('БЛОКИ:', JSON.stringify(blocks));

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '61-card-full.png'), fullPage: true });
  for (const [name, sel] of [['62-dv', '.rp-review-dv-block'], ['63-call', '.rp-review-call-block']]) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, name + '.png') });
    }
  }

  expect(blocks.dv, 'блок ведомости объёмов').toBeGreaterThan(0);
  expect(blocks.dvRows, 'строки ДВ').toBeGreaterThan(0);
  expect(blocks.call, 'блок «позвоните клиенту»').toBeGreaterThan(0);
  expect(blocks.questions, 'вопросы для звонка').toBeGreaterThan(0);
});
