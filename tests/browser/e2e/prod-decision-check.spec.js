const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PROD = process.env.PROD_URL || 'https://asgard-crm.ru';
const TOKEN = process.env.PROD_TOKEN || '';
const TENDER = Number(process.env.PROD_TENDER || 2147);
const OUT = path.join(__dirname, '../../../tests/reports/mimir-prod');

test('прод: экран решения с блоком звонка', async ({ page }) => {
  test.skip(!TOKEN, 'нужен PROD_TOKEN');
  await page.goto(`${PROD}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('token', t);
  }, TOKEN);
  await page.goto(`${PROD}/#/pm-calculations`, { waitUntil: 'commit' });
  await page.waitForTimeout(2500);

  // Находим сессию анализа именно этого тендера и доводим до решения через API.
  const info = await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch('/api/tkp-quick/sessions', { headers: { Authorization: auth } });
    const d = await r.json();
    const list = d.sessions || [];
    return { count: list.length, uid: list[0]?.session_uid };
  }, TENDER);
  console.log('сессий:', info.count);

  // Берём сессию с наибольшим числом позиций и переводим в решение.
  const picked = await page.evaluate(async () => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch('/api/tkp-quick/sessions', { headers: { Authorization: auth } });
    const d = await r.json();
    let best = null;
    for (const s of (d.sessions || []).slice(0, 15)) {
      const sr = await fetch(`/api/tkp-quick/sessions/${s.session_uid}/stage`, { headers: { Authorization: auth } });
      const sd = await sr.json().catch(() => ({}));
      const n = (sd.state?.positions || []).length;
      if (!best || n > best.n) best = { uid: s.session_uid, n, stage: sd.stage, version: sd.version };
    }
    return best;
  });
  console.log('выбрана:', JSON.stringify(picked));
  test.skip(!picked || picked.n === 0, 'нет сессии с позициями');

  // Ведём по этапам до решения.
  const walk = await page.evaluate(async (p) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const stages = ['read', 'dv', 'tech', 'decision'];
    let version = p.version;
    const log = [];
    for (const st of stages) {
      const sr = await fetch(`/api/tkp-quick/sessions/${p.uid}/stage`, { headers: { Authorization: auth } });
      const sd = await sr.json().catch(() => ({}));
      version = sd.version;
      const rr = await fetch(`/api/tkp-quick/sessions/${p.uid}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ stage: st, state: sd.state, expected_version: version })
      });
      const rd = await rr.json().catch(() => ({}));
      log.push(`${st}:${rr.status}`);
      if (rr.status !== 200) break;
    }
    return log;
  }, picked);
  console.log('переходы:', walk.join(' '));

  await page.evaluate((u) => {
    window.AsgardMimirStages.open({ sessionUid: u, title: 'Анализ тендера · решение', subtitle: 'Проверка на проде' });
  }, picked.uid);
  await page.waitForSelector('.mst-modal', { timeout: 20000 });
  await page.waitForTimeout(1800);

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '03-decision-prod.png'), fullPage: false });

  const stage = await page.locator('.mst-step.is-now').innerText().catch(() => '');
  console.log('ЭТАП:', stage.replace(/\s+/g, ' '));
  const call = await page.locator('.mst-callout').count();
  const questions = await page.locator('.mst-callout__list li').count();
  const note = await page.locator('.mst-callnote').count();
  console.log('звонок:', call, '| вопросов:', questions, '| пометка «смета не здесь»:', note);
  expect(call).toBeGreaterThan(0);
});
