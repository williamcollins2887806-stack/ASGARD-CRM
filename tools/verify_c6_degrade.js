/**
 * C6 — визуальный Playwright-тест degrade-UX счёта (vanilla, КЛОН :3101).
 *
 * Проверяет, что падение ИИ/OCR НЕ убивает документ: в существующей модалке счёта
 * появляется баннер с причиной и три действия — «Повторить», «Вручную», «Отмена»;
 * ручной ввод реально сопоставляет строки через тот же API и рисует превью.
 *
 * Негатив моделируется route-interception: POST .../invoice/parse отдаём 200 с
 * { ai_unavailable: true } (как будто упал ИИ) и 500 (как будто упал сервер).
 *
 * Запуск: node tools/verify_c6_degrade.js
 */
const { chromium } = require('playwright');
const { Client } = require('pg');
const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
const pool = new Client({ host: '127.0.0.1', port: 5432, user: 'asgard', password: '123456789', database: process.env.CL_DB_NAME || 'asgard_crm_test' });

let pass = 0, fail = 0;
function check(name, ok, proof) { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${name}${proof ? ' — ' + proof : ''}`); }

(async () => {
  await pool.connect();
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  let procId = null;
  const hideThemeOverlay = async () => { await page.evaluate(() => { const el = document.getElementById('asgard-theme-selector'); if (el) el.style.display = 'none'; }); };
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await hideThemeOverlay();
    const auth = await page.evaluate(async (base) => {
      const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'test_pm', password: 'Test123!' }) });
      const d = await r.json();
      let t = d.token;
      if (d.status === 'need_pin') {
        const r2 = await fetch(base + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin: '0000' }) });
        t = ((await r2.json()).token) || t;
      }
      localStorage.setItem('asgard_token', t); localStorage.setItem('auth_token', t);
      const w = await fetch(base + '/api/works?limit=10', { headers: { Authorization: 'Bearer ' + t } }).then(x => x.json());
      const arr = w.works || w.items || w.rows || [];
      const cr = await fetch(base + '/api/procurement', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ work_id: (arr[0] || {}).id || null, title: 'VERIFY C6 degrade' }) }).then(x => x.json());
      return { token: !!t, procId: cr.item && cr.item.id };
    }, BASE);
    procId = auth.procId;
    check('login + черновик заявки', auth.token && !!procId, `procId=${procId}`);
    if (!procId) throw new Error('нет procId');

    // ─── Негатив 1: parse отдаёт ai_unavailable (упал ИИ) ───
    await ctx.route('**/api/procurement/*/invoice/parse', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ matches: [], unmatched: [], ai_unavailable: true, message: 'Текст распознан, но AI недоступен — заполните строки вручную' }) });
    });
    await page.evaluate((id) => window.AsgardProcurementPage.openInvoiceModal(id), procId);
    await page.waitForTimeout(500);
    await hideThemeOverlay();
    const hasFileInput = await page.locator('#inv-file').count();
    check('модалка счёта открыта (есть #inv-file)', hasFileInput > 0, '');
    // эмулируем выбор файла: dispatch change с фейковым File (xlsx → сразу parse)
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1, 2, 3])], 'scan.pdf', { type: 'application/pdf' }));
      const inp = document.getElementById('inv-file');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // ждём баннер деградации (parse через сервер даст ai_unavailable из route)
    await page.waitForSelector('#deg-retry', { timeout: 20000 }).catch(() => {});
    const deg = await page.evaluate(() => ({
      hasRetry: !!document.getElementById('deg-retry'),
      hasManual: !!document.getElementById('deg-manual'),
      hasCancel: !!document.getElementById('deg-cancel'),
      bannerText: (document.getElementById('inv-preview') || {}).innerText || '',
    }));
    check('C6: баннер деградации с причиной появился', deg.hasRetry && /недоступен|Повторить|Счёт не потерян/i.test(deg.bannerText), deg.bannerText.split('\n')[0].slice(0, 90));
    check('C6: есть «Повторить» и «Вручную» (документ жив)', deg.hasRetry && deg.hasManual && deg.hasCancel, `retry=${deg.hasRetry} manual=${deg.hasManual} cancel=${deg.hasCancel}`);

    // ─── «Повторить» переиспользует файл (route снова отдаёт ai_unavailable → тот же баннер) ───
    await hideThemeOverlay();
    await page.click('#deg-retry');
    await page.waitForTimeout(800);
    const afterRetry = await page.evaluate(() => !!document.getElementById('deg-retry'));
    check('C6: «Повторить» повторяет разбор (баннер не пропал при недоступном ИИ)', afterRetry, '');

    // ─── «Вручную»: ручной ввод сопоставляет строки (тот же API, без ИИ) ───
    await hideThemeOverlay();
    await page.click('#deg-manual');
    await page.waitForTimeout(300);
    const manualUi = await page.evaluate(() => !!document.getElementById('man-body') && !!document.getElementById('man-go'));
    check('C6: «Вручную» открывает ручной ввод (без новой модалки)', manualUi, '');

    // снимем route, чтобы ручной ввод получил РЕАЛЬНЫЙ ответ сопоставления
    await ctx.unroute('**/api/procurement/*/invoice/parse');
    // заведём в заявку позицию, чтобы было с чем сопоставить
    await page.evaluate(async (id) => {
      const t = localStorage.getItem('asgard_token');
      await fetch(`/api/procurement/${id}/items`, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Болгарка (УШМ) 125 мм', unit: 'шт', quantity: 1, delivery_target: 'warehouse' }) });
    }, procId);
    await page.fill('#man-body tr:nth-child(1) .man-name', 'УШМ 125');
    await page.fill('#man-body tr:nth-child(1) .man-qty', '1');
    await page.fill('#man-body tr:nth-child(1) .man-price', '4500');
    await hideThemeOverlay();
    await page.click('#man-go');
    await page.waitForTimeout(1500);
    const preview = await page.evaluate(() => {
      const h = document.getElementById('inv-preview');
      return { text: h ? h.innerText : '', hasApply: !!document.getElementById('inv-apply') };
    });
    check('C6: ручной ввод → превью сопоставления (есть «Применить»)', preview.hasApply, preview.text.split('\n').slice(0, 2).join(' / ').slice(0, 120));

    // ─── Негатив 2: parse отдаёт 500 (упал сервер) → тоже баннер, не «тост и пустота» ───
    await ctx.route('**/api/procurement/*/invoice/parse', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Внутренняя ошибка' }) });
    });
    await page.evaluate(() => { const el = document.getElementById('inv-preview'); if (el) el.innerHTML = ''; });
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1, 2, 3])], 'scan2.pdf', { type: 'application/pdf' }));
      const inp = document.getElementById('inv-file');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector('#deg-retry', { timeout: 20000 }).catch(() => {});
    const deg2 = await page.evaluate(() => ({ hasRetry: !!document.getElementById('deg-retry'), text: (document.getElementById('inv-preview') || {}).innerText || '' }));
    check('C6: при 500 тоже баннер (документ не потерян)', deg2.hasRetry && /Внутренняя ошибка|Счёт не потерян/i.test(deg2.text), deg2.text.split('\n')[0].slice(0, 80));

    const realErrors = consoleErrors.filter(e => !/favicon|sw\.js|ServiceWorker|Failed to load resource.*(401|500)/i.test(e));
    check('0 неожиданных JS-ошибок консоли', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  } catch (e) {
    check('НЕОЖИДАННАЯ ОШИБКА', false, e.message);
  } finally {
    try {
      if (procId) {
        await pool.query('DELETE FROM procurement_invoice_imports WHERE procurement_id=$1', [procId]).catch(() => {});
        await pool.query('DELETE FROM procurement_items WHERE procurement_id=$1', [procId]).catch(() => {});
        await pool.query('DELETE FROM procurement_history WHERE procurement_id=$1', [procId]).catch(() => {});
        await pool.query('DELETE FROM procurement_requests WHERE id=$1', [procId]).catch(() => {});
      }
    } catch (_) { }
    await pool.end().catch(() => {});
    await browser.close();
  }

  console.log('\n===================================================');
  console.log(`  ИТОГ: ${pass} PASS / ${fail} FAIL`);
  console.log('===================================================');
  process.exit(fail > 0 ? 1 : 0);
})();
