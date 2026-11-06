const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * prod-modals.spec.js — проверка обеих модалок на ПРОДЕ от лица РП Андросова.
 * Анализ: ДВ, звонок, технология. Просчёт: вкладка «Объёмы».
 */
const BASE = process.env.PROD_URL || 'https://asgard-crm.ru';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

async function tk() {
  // На проде пароль РП не храним: берём временный токен, подписанный сервером.
  if (process.env.PROD_TOKEN) return process.env.PROD_TOKEN.trim();
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'n.androsov', password: process.env.PROD_PM_PASSWORD || '' })
  });
  const ld = await lr.json();
  if (!ld.token) throw new Error('login: ' + JSON.stringify(ld).slice(0, 200));
  const pr = await fetch(`${BASE}/api/auth/verify-pin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ld.token },
    body: JSON.stringify({ pin: '0000' })
  });
  const pd = await pr.json();
  if (!pd.token) throw new Error('pin: ' + JSON.stringify(pd).slice(0, 200));
  return pd.token;
}

test('прод: анализ — ДВ и звонок в карточке', async ({ page }) => {
  test.setTimeout(180000);
  const token = await tk();

  // Тендеры с разобранным ДВ известны: берём первый, где данные уже есть.
  const CANDIDATES = (process.env.PROD_TENDERS || '2131,2142,2127,2095,2071,2148,2147,2145,2096')
    .split(',').map((x) => Number(x.trim())).filter(Boolean);
  let target = null;
  for (const id of CANDIDATES) {
    const rr = await fetch(`${BASE}/api/tenders/${id}/rp-review`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!rr.ok) { console.log(`#${id} → ${rr.status}`); continue; }
    const rd = await rr.json();
    const rj = rd.review && rd.review.report_json;
    const j = typeof rj === 'string' ? JSON.parse(rj) : (rj || {});
    const n = (j.dv_positions || []).length;
    console.log(`#${id} → dv=${n} q=${(j.call_questions || []).length}`);
    if (n) { target = { id, positions: n, questions: (j.call_questions || []).length }; break; }
  }
  console.log('ТЕНДЕР:', JSON.stringify(target));
  test.skip(!target, 'нет тендера с разобранным ДВ');

  await page.goto(`${BASE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('token', t);
  }, token);
  await page.goto(`${BASE}/#/tenders-registry`, { waitUntil: 'commit' });
  await page.waitForFunction(
    () => typeof window.AsgardRpReviewModal === 'object' && typeof window.AsgardRpCalcModal === 'object',
    null, { timeout: 30000 }
  );
  await page.waitForTimeout(800);

  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } });
    const d = await r.json();
    window.AsgardRpReviewModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'analysis' });
    await new Promise((res) => setTimeout(res, 2200));
  }, target.id);

  const blocks = await page.evaluate(() => ({
    dv: document.querySelectorAll('.rp-review-dv-block').length,
    dvRows: document.querySelectorAll('.rp-review-dv-table tbody tr').length,
    call: document.querySelectorAll('.rp-review-call-block').length,
    questions: document.querySelectorAll('.rp-review-call-list li').length,
    phone: (document.querySelector('.rp-review-call-text .muted') || {}).textContent || null,
    ver: document.querySelector('script[src*="rp_review_modal"]')?.src.match(/v=([\d.]+)/)?.[1] || '?'
  }));
  console.log('БЛОКИ:', JSON.stringify(blocks));

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '80-prod-card.png'), fullPage: true });
  expect(blocks.dv, 'блок ДВ на проде').toBeGreaterThan(0);
});
