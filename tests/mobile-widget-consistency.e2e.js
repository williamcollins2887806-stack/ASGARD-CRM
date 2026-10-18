/**
 * UI-проверка мобильного экрана согласований директора:
 *  1) вкладка «Касса» показывает и «К ВЫДАЧЕ» и «ЖДУТ РЕШЕНИЯ»;
 *  2) вкладка «Выплаты» показывает «К ВЫПЛАТЕ» (3 позиции из виджета);
 *  3) вкладка «Счета» показывает «К ОПЛАТЕ»;
 *  4) цифры на вкладке совпадают с виджетом /director-summary/queues.
 * Требует: бэкенд на TEST_BASE_URL (по умолчанию :3200), собранный public/m.
 */
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3200';
const LOGIN = process.env.TEST_LOGIN || 'test_director_comm';
const PASS = process.env.TEST_PASS || 'Test123!';
const PIN = process.env.TEST_PIN || '0000';

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS ' + m); };
const bad = (m) => { fail++; console.log('  FAIL ' + m); };

(async () => {
  // Ожидаемые числа — из единого источника правды
  const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: LOGIN, password: PASS }) });
  let d = await lr.json(); let token = d.token;
  if (d.status === 'need_pin') {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ pin: PIN }) });
    const d2 = await r2.json(); if (d2.token) token = d2.token;
  }
  const q = await (await fetch(BASE + '/api/director-summary/queues', { headers: { Authorization: 'Bearer ' + token } })).json();
  console.log('Виджет (ожидаем):', JSON.stringify({ approvals: q.approvals, toExecute: q.toExecute }));

  const browser = await chromium.launch();
  let page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // SSE держит соединение открытым — навигация «на сети» иногда не завершается.
  page.setDefaultNavigationTimeout(20000);

  // Авторизация: кладём токен в localStorage как это делает приложение
  await page.goto(BASE + '/m/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t);
    try { localStorage.setItem('auth-storage', JSON.stringify({ state: { token: t }, version: 0 })); } catch (_) {}
  }, token);

  const openTab = async (tab) => {
    // networkidle не наступает: приложение держит постоянный SSE-поток.
    // Каждую вкладку открываем в СВЕЖЕЙ странице — иначе SPA-состояние
    // предыдущей вкладки мешает рендеру (флапает).
    if (page) await page.close().catch(() => {});
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.setDefaultNavigationTimeout(20000);
    await page.goto(BASE + '/m/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.evaluate((t) => localStorage.setItem('asgard_token', t), token);
    await page.goto(`${BASE}/m/director-approvals?tab=${tab}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.body.innerText.length > 40,
      null, { timeout: 15000 }
    ).catch(() => {});
    await page.waitForTimeout(4500);
    return page;
  };

  const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

  // ── 1. Касса ──
  await openTab('cash');
  let t = await text();
  if (/К ВЫДАЧЕ/i.test(t)) {
    const m = t.match(/К ВЫДАЧЕ · (\d+)/i);
    const n = m ? Number(m[1]) : null;
    if (n === q.toExecute.cash.count) ok(`Касса: «К ВЫДАЧЕ · ${n}» = виджет ${q.toExecute.cash.count}`);
    else bad(`Касса: «К ВЫДАЧЕ · ${n}» ≠ виджет ${q.toExecute.cash.count}`);
  } else if (q.toExecute.cash.count === 0) ok('Касса: секции «К выдаче» нет и виджет = 0 (корректно)');
  else bad('Касса: секция «К ВЫДАЧЕ» НЕ отрисована, хотя в виджете ' + q.toExecute.cash.count);

  if (q.approvals.cash.count > 0) {
    const m = t.match(/ЖДУТ РЕШЕНИЯ · (\d+)/i);
    if (m && Number(m[1]) === q.approvals.cash.count) ok(`Касса: «ЖДУТ РЕШЕНИЯ · ${m[1]}» = виджет ${q.approvals.cash.count}`);
    else bad(`Касса: «ЖДУТ РЕШЕНИЯ» ${m ? m[1] : '—'} ≠ виджет ${q.approvals.cash.count}`);
  }

  // ── 2. Выплаты ──
  await openTab('payouts');
  t = await text();
  if (q.toExecute.payouts.count > 0) {
    const m = t.match(/К ВЫПЛАТЕ · (\d+)/i);
    if (m && Number(m[1]) === q.toExecute.payouts.count) ok(`Выплаты: «К ВЫПЛАТЕ · ${m[1]}» = виджет ${q.toExecute.payouts.count}`);
    else bad(`Выплаты: «К ВЫПЛАТЕ» ${m ? m[1] : 'НЕ найдено'} ≠ виджет ${q.toExecute.payouts.count}`);
  } else ok('Выплаты: виджет к выплате = 0');

  if (q.approvals.payouts.count > 0) {
    const m = t.match(/Согласовать всех \((\d+)\)/i);
    if (m && Number(m[1]) === q.approvals.payouts.count) ok(`Выплаты: «Согласовать всех (${m[1]})» = виджет ${q.approvals.payouts.count}`);
    else bad(`Выплаты: «Согласовать всех» ${m ? m[1] : '—'} ≠ виджет ${q.approvals.payouts.count}`);
  }

  // ── 3. Счета ──
  await openTab('invoices');
  t = await text();
  if (q.toExecute.invoices.count > 0) {
    const m = t.match(/К ОПЛАТЕ · (\d+)/i);
    if (m && Number(m[1]) === q.toExecute.invoices.count) ok(`Счета: «К ОПЛАТЕ · ${m[1]}» = виджет ${q.toExecute.invoices.count}`);
    else bad(`Счета: «К ОПЛАТЕ» ${m ? m[1] : 'НЕ найдено'} ≠ виджет ${q.toExecute.invoices.count}`);
  } else ok('Счета: виджет к оплате = 0');
  if (q.approvals.invoices.count > 0) {
    const cnt = (t.match(/Согласовать/gi) || []).length;
    if (cnt >= q.approvals.invoices.count) ok(`Счета: кнопок «Согласовать» ≥ ${q.approvals.invoices.count} (виджет ${q.approvals.invoices.count})`);
    else bad(`Счета: кнопок «Согласовать» ${cnt} < виджет ${q.approvals.invoices.count}`);
  }

  // ── 4. Главная: виджет и вкладка показывают одно ──
  await openTab('cash');
  await page.goto(BASE + '/m/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const home = await text();
  if (/Нужно ваше решение|Всё согласовано/i.test(home)) ok('Главная: единый виджет очередей отрисован');
  else bad('Главная: виджет очередей НЕ найден');
  const total = q.approvals.total_count;
  if (total > 0 && home.includes(String(total))) ok(`Главная: число ${total} в очереди присутствует`);
  else if (total === 0) ok('Главная: очередь пуста (0) — корректно');

  await page.screenshot({ path: 'tools/_widget_audit_home.png', fullPage: false }).catch(() => {});
  await openTab('payouts');
  await page.screenshot({ path: 'tools/_widget_audit_payouts.png', fullPage: true }).catch(() => {});
  await openTab('cash');
  await page.screenshot({ path: 'tools/_widget_audit_cash.png', fullPage: true }).catch(() => {});

  await browser.close();
  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ОШИБКА ТЕСТА:', e.message); process.exit(1); });
