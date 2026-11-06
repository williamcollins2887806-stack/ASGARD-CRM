const { test } = require('@playwright/test');
require('dotenv').config();
const { Client } = require('pg');

const CLONE = process.env.CLONE_URL || 'http://127.0.0.1:3100';

test('полный путь: анализ с нормами → план с бригадами', async ({ page }) => {
  test.setTimeout(300000);
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

  const db = new Client({ host: 'localhost', port: 5432, user: 'asgard', password: '123456789', database: 'asgard_crm_test' });
  await db.connect();
  const r = await db.query("SELECT id FROM tenders WHERE tender_title ILIKE '%ДЕМО Мимир%' AND deleted_at IS NULL ORDER BY id LIMIT 1");
  await db.end();
  const id = r.rows[0].id;

  await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => { localStorage.setItem('asgard_token', t); localStorage.setItem('token', t); }, token);

  const TZ = 'Химическая промывка двух водогрейных котлов КВГМ по 2 м³ на котельной «Северная». ' +
    'Карбонатные отложения, 2 цикла, нейтрализация. Срок — 25 календарных дней. ' +
    'Также очистка приёмного бункера 200 м³ от зольных отложений вручную. ' +
    'Контакт: главный инженер, +7 900 000-00-01.';

  const res = await page.evaluate(async (args) => {
    const { tid, tz } = args;
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
    const positions = (a.state && a.state.positions) || [];

    // План: передаём окно дат как срок заказчика.
    const pl = await fetch(`/api/tkp-quick/sessions/${uid}/stage/calc-plan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ date_window: 25 })
    }).then((x) => x.json());

    return {
      analyzeOk: a.ok,
      positions: positions.length,
      withNorm: positions.filter((p) => p.norm && p.norm.code).length,
      normCodes: positions.map((p) => p.norm && p.norm.code).filter(Boolean).slice(0, 5),
      planOk: pl.ok,
      plan: pl.plan ? {
        work_days: pl.plan.work_days, crews: pl.plan.crews,
        people: pl.plan.people_total, total_crew_days: pl.plan.total_crew_days,
        window: pl.plan.window_days, fits: pl.plan.fits_window,
        sources: [...new Set((pl.plan.positions || []).map((p) => p.source))],
        warnings: pl.plan.warnings
      } : null,
      tid
    };
  }, { tid: id, tz: TZ });

  console.log('РЕЗУЛЬТАТ:', JSON.stringify(res, null, 1).slice(0, 1600));
});
