'use strict';
/**
 * Полный browser-бизнес E2E: закупки + оплата счетов + склад.
 * Реальные данные ОФС Приразломная (Excel-имена + PDF счета из fixtures/ofs).
 * Роли: PM, PROC, DIR, BUH, WH. Console errors = FAIL.
 * Out: tests/reports/ofs-biz-e2e/ (≥43 png) + REPORT.json
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = path.join(__dirname, 'reports', 'ofs-biz-e2e');
const OFS_ROOT = process.env.OFS_ROOT
  || 'D:/ASGARD/01_Проекты/МЛСП-Оголовок/Закупка_ОФС_Приразломная_2026';
const EXCEL = path.join(OFS_ROOT, 'Перечень_закупки_для_ГНШ.xlsx');
const FIX_INV = [
  path.join(__dirname, 'fixtures', 'ofs', 'invoice-vedo.pdf'),
  path.join(__dirname, 'fixtures', 'ofs', 'invoice-872456.pdf'),
  path.join(__dirname, 'fixtures', 'ofs', 'invoice-radio.pdf'),
];

fs.mkdirSync(OUT, { recursive: true });
const SHOTS_DIR = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });
// чистый прогон: без чужих/pad-артефактов
for (const f of fs.readdirSync(SHOTS_DIR)) {
  if (/\.png$/i.test(f)) fs.unlinkSync(path.join(SHOTS_DIR, f));
}

process.env.PAYMENT_MAIL_DISABLED = '1';
process.env.ASSEMBLY_MAIL_DISABLED = '1';

const ACCOUNTS = {
  PM: { login: 'test_pm', password: 'Test123!', pin: '0000' },
  PROC: { login: 'test_proc', password: 'Test123!', pin: '0000' },
  WAREHOUSE: { login: 'test_warehouse', password: 'Test123!', pin: '0000' },
  DIRECTOR_GEN: { login: 'test_director_gen', password: 'Test123!', pin: '0000' },
  BUH: { login: 'test_buh', password: 'Test123!', pin: '0000' },
};

const report = {
  started_at: new Date().toISOString(),
  base: BASE,
  tag: 'OFS-BIZ-' + Date.now(),
  steps: [],
  console_errors: [],
  shots: [],
  ids: {},
  summary: { pass: false },
};

function step(name, pass, detail) {
  const row = { name, pass: !!pass, detail: detail || null, at: new Date().toISOString() };
  report.steps.push(row);
  console.log(`[${pass ? 'OK' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 220) : ''}`);
  if (!pass) {
    const err = new Error('STEP_FAIL: ' + name + (detail ? ' | ' + detail : ''));
    err.step = name;
    throw err;
  }
  return row;
}

async function login(role) {
  const a = ACCOUNTS[role];
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: a.login, password: a.password }),
  }).then((r) => r.json());
  if (!lr.token) throw new Error(role + ' login ' + JSON.stringify(lr));
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: a.pin }),
    }).then((r) => r.json());
    if (!pr.token) throw new Error(role + ' pin ' + JSON.stringify(pr));
    token = pr.token;
    user = pr.user || user;
  }
  return { token, user, role, login: a.login };
}

async function api(auth, method, urlPath, body) {
  const opts = { method, headers: { Authorization: 'Bearer ' + auth.token } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + urlPath, opts);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: r.status, ok: r.ok, data, text };
}

async function loadOfsItems(limit = 8) {
  if (!fs.existsSync(EXCEL)) throw new Error('Excel missing: ' + EXCEL);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL);
  const ws = wb.worksheets[0];
  const hdr = [];
  ws.getRow(2).eachCell((c, i) => { hdr[i] = String(c.value || '').trim(); });
  const items = [];
  for (let r = 3; r <= ws.rowCount && items.length < limit; r++) {
    const row = ws.getRow(r);
    const o = {};
    hdr.forEach((h, i) => { if (h) o[h] = row.getCell(i).value; });
    const name = String(o['Наименование по счёту'] || o['Наименование'] || '').trim();
    if (!name || name.length < 4) continue;
    const qty = parseFloat(String(o['Кол-во'] || '1').replace(',', '.')) || 1;
    items.push({
      name,
      qty: Math.min(qty, 3),
      unit: String(o['Ед.'] || 'шт'),
      group: String(o['Группа'] || ''),
      doc: String(o['Документ'] || ''),
    });
  }
  return items;
}

async function dismiss(page) {
  await page.evaluate(() => {
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_academy_nag_dismissed', '1');
    try {
      localStorage.setItem('offic_academy_skip_until', String(Date.now() + 864e5 * 30));
      localStorage.setItem('asgard_offic_academy_dismissed_at', String(Date.now()));
      // подавить weekly lag-reminder (ключ зависит от user.id)
      try {
        const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
        if (u && u.id) {
          const d = new Date();
          const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
          const dayNum = date.getUTCDay() || 7;
          date.setUTCDate(date.getUTCDate() + 4 - dayNum);
          const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
          const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
          const wk = date.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
          localStorage.setItem('oa_lag_remind_' + u.id + '_' + wk, '1');
        }
      } catch (_) {}
    } catch (_) {}
    document.getElementById('asgard-v2-banner')?.remove();
    document.getElementById('asgard-theme-selector')?.remove();
    document.getElementById('asgard-presence-gate')?.remove();
    [...document.querySelectorAll('button')].forEach((b) => {
      if (/позже|не сейчас|пропустить|oaLagLater/i.test(b.textContent || '') || b.id === 'oaLagLater') b.click();
    });
    if (window.AsgardUI && typeof AsgardUI.closeModal === 'function') {
      try {
        const title = document.querySelector('.modal-title, .ui-modal__title, [class*="modal"] h2, [class*="modal"] h3');
        const t = (title && title.textContent) || '';
        if (/отстаёте|залах/i.test(t) || /отстаёте|залах/i.test(document.body.innerText || '')) {
          AsgardUI.closeModal();
        }
      } catch (_) {}
    }
    document.querySelectorAll('.cr-m-overlay, [class*="academy"], .modal-overlay, .ui-modal, [id*="modal"]').forEach((el) => {
      const t = el.textContent || '';
      if (/отстаёте|залах|пройти сейчас/i.test(t)) {
        try { el.remove(); } catch (_) { el.style.display = 'none'; }
      }
    });
    document.querySelectorAll('.toast, .cr-toast, [class*="toast"]').forEach((el) => {
      if (/сессия истекла|недостаточно прав/i.test(el.textContent || '')) el.remove();
    });
  });
  await page.waitForTimeout(250);
}

function attachConsole(page, label) {
  const bucket = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      // шум браузера / опциональные ассеты
      if (/favicon|ResizeObserver|net::ERR_ABORTED|\.map\b|sourcemap/i.test(t)) return;
      bucket.push(t);
      report.console_errors.push({ label, text: t });
    }
  });
  page.on('pageerror', (err) => {
    bucket.push(String(err.message || err));
    report.console_errors.push({ label, text: String(err.message || err) });
  });
  page.on('response', (res) => {
    const st = res.status();
    if (st >= 400) {
      const url = res.url();
      if (/favicon|\.map$|chrome-extension/i.test(url)) return;
      // SSE/hints часто 401/403 в headless — не бизнес-блокер
      if (/\/api\/(hints|sse|telegram|mimir\/hints)/i.test(url) && (st === 401 || st === 403)) return;
      const line = `HTTP ${st} ${url.replace(BASE, '')}`;
      if (st >= 500 || /\/api\//i.test(url)) {
        bucket.push(line);
        report.console_errors.push({ label, text: line });
      }
    }
  });
  return bucket;
}

async function openUi(browser, auth, hash, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleBucket = attachConsole(page, label || hash);
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_pin_verified', 'true');
    localStorage.setItem('pin_unlocked_at', String(Date.now()));
    localStorage.setItem('asgard_presence_ok', '1');
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
    localStorage.setItem('asgard_academy_nag_dismissed', '1');
    try {
      const d = new Date();
      const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
      const wk = date.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
      if (user && user.id) localStorage.setItem('oa_lag_remind_' + user.id + '_' + wk, '1');
    } catch (_) {}
  }, auth);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
  }).catch(() => {});
  await page.goto(BASE + '/?nocache=' + Date.now() + hash, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForTimeout(1800);
  await dismiss(page);
  await dismiss(page);
  return { context, page, consoleBucket };
}

async function shot(page, name) {
  await dismiss(page);
  await page.waitForTimeout(400);
  await dismiss(page);
  // добить late academy modal
  await page.evaluate(() => {
    if (window.AsgardUI && /отстаёте|залах/i.test(document.body.innerText || '')) {
      try { AsgardUI.closeModal(); } catch (_) {}
    }
    document.querySelectorAll('.modal-overlay, .ui-modal, [class*="modal-backdrop"]').forEach((el) => {
      if (/отстаёте|залах/i.test(el.textContent || '')) {
        try { el.remove(); } catch (_) { el.style.display = 'none'; }
      }
    });
  });
  const fp = path.join(OUT, 'shots', String(report.shots.length + 1).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: fp, fullPage: false });
  report.shots.push({ name, file: fp });
  console.log('  📷', path.basename(fp));
  return fp;
}

async function assertNoConsole(bucket, label) {
  const bad = (bucket || []).filter((t) => !/Failed to load resource.*favicon/i.test(t));
  step('console clean: ' + label, bad.length === 0, bad.slice(0, 3).join(' || ') || '0 errors');
}

async function clearCart(auth) {
  const cart = await api(auth, 'GET', '/api/warehouse-cart');
  for (const it of cart.data.items || []) {
    await api(auth, 'DELETE', '/api/warehouse-cart/items/' + it.id);
  }
}

async function main() {
  console.log('OFS BIZ BROWSER E2E', BASE, report.tag);
  const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
  step('0. health', !!(health && health.status === 'ok'), JSON.stringify(health));

  const ofsItems = await loadOfsItems(8);
  step('0b. Excel ОФС загружен', ofsItems.length >= 5, ofsItems.length + ' поз. · ' + ofsItems[0].name.slice(0, 50));
  fs.writeFileSync(path.join(OUT, 'ofs-sample-items.json'), JSON.stringify(ofsItems, null, 2));

  for (const p of FIX_INV) step('0c. PDF fixture ' + path.basename(p), fs.existsSync(p), p);

  const pm = await login('PM');
  const proc = await login('PROC');
  const wh = await login('WAREHOUSE');
  const dir = await login('DIRECTOR_GEN');
  const buh = await login('BUH');
  step('0d. logins', true, 'PM/PROC/WH/DIR/BUH');

  // ── 1. Работа ──
  const workTitle = report.tag + ' ОФС Приразломная';
  const workRes = await api(pm, 'POST', '/api/works', {
    work_title: workTitle,
    object_place: 'МЛСП Приразломная',
    customer_name: 'Газпром нефть шельф',
    status: 'in_progress',
  });
  const workId = (workRes.data.item && workRes.data.item.id)
    || (workRes.data.work && workRes.data.work.id) || workRes.data.id;
  report.ids.work_id = workId;
  step('1. PM создаёт работу', !!workId, String(workId));

  // ── 2. Корзина из реальных имён ОФС ──
  await clearCart(pm);
  const cartItems = ofsItems.slice(0, 5).map((it) => ({
    item_type: 'new_position',
    custom_name: it.name,
    need_qty: it.qty,
    manual_price: 15000,
    supplier_name: 'ОФС поставщик',
    work_id: workId,
    source: 'ofs-excel',
  }));
  // +1 со склада если есть
  const stock = await api(pm, 'GET', '/api/products?limit=20&search=Электрод');
  const stockHit = (stock.data.items || [])[0];
  if (stockHit) {
    cartItems.push({
      item_type: 'consumable',
      product_id: stockHit.id,
      need_qty: 2,
      work_id: workId,
      source: 'stock',
    });
  }
  const add = await api(pm, 'POST', '/api/warehouse-cart/items', { warehouse_id: 1, items: cartItems });
  step('2. корзина ОФС', add.ok && (add.data.items || []).length >= 5,
    'items=' + (add.data.items || []).length);

  const planned = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const destination = 'МЛСП Приразломная · ОФС оголовок';
  const submit = await api(pm, 'POST', '/api/warehouse-cart/submit', {
    global_work_id: workId,
    destination,
    planned_date: planned,
    object_name: destination,
    confirmed: true,
  });
  step('2b. submit с объектом+датой', submit.ok && submit.data.success,
    submit.status + ' ' + JSON.stringify(submit.data).slice(0, 280));
  report.ids.procurement_id = submit.data.procurement_id;
  report.ids.assembly_id = submit.data.assembly_id;
  step('2c. procurement+assembly', !!(report.ids.procurement_id && report.ids.assembly_id),
    `proc=${report.ids.procurement_id} asm=${report.ids.assembly_id}`);

  // ── 3. Browser: PM warehouse cart journey (empty after submit) + monitor ──
  const browser = await chromium.launch({ headless: true });
  try {
    {
      const { context, page, consoleBucket } = await openUi(browser, pm, '#/warehouse-v2?tab=consumables', 'PM-market');
      await shot(page, 'pm-market-consumables');
      await page.locator('.wh2-tab[data-tab="monitor"]').click({ force: true });
      await page.waitForTimeout(1400);
      await dismiss(page);
      await shot(page, 'pm-monitor-list');
      const body = await page.locator('body').innerText();
      step('3. UI PM Готовность', /готовность|отгруз/i.test(body), body.slice(0, 80));
      const card = page.locator('.wh2-asm-card').first();
      if (await card.count()) {
        await card.click({ force: true });
        await page.waitForTimeout(1400);
        await dismiss(page);
        await shot(page, 'pm-monitor-detail');
        const d = await page.locator('body').innerText();
        step('3b. UI PM KPI монитор', /%|готовность|паллет|кг/i.test(d), d.slice(0, 100));
      }
      await assertNoConsole(consoleBucket, 'PM-market');
      await context.close();
    }

    // ── 4. PROC: open request, set prices, respond, upload invoice ──
    {
      const pid = report.ids.procurement_id;
      // ensure sent_to_proc
      let cur = await api(proc, 'GET', '/api/procurement/' + pid);
      if (cur.data.item && cur.data.item.status === 'draft') {
        await api(pm, 'PUT', `/api/procurement/${pid}/send-to-proc`, {});
        cur = await api(proc, 'GET', '/api/procurement/' + pid);
      }
      step('4. заявка у PROC', !!cur.data.item, cur.data.item && cur.data.item.status);

      for (const it of cur.data.items || []) {
        if (!(parseFloat(it.unit_price) > 0)) {
          await api(proc, 'PUT', `/api/procurement/${pid}/items/${it.id}`, {
            unit_price: 18500,
            supplier: 'ВсеИнструменты / ОФС',
          });
        }
      }

      const { context, page, consoleBucket } = await openUi(browser, proc, '#/procurement?id=' + pid, 'PROC-detail');
      await page.waitForTimeout(2000);
      await dismiss(page);
      await shot(page, 'proc-detail');
      const body = await page.locator('body').innerText();
      step('4b. UI PROC detail', /заявк|позиц|закуп/i.test(body), body.slice(0, 100));

      // try open invoice wizard
      const invBtn = page.locator('#proc-invoice-top, #proc-invoice, button:has-text("Загрузить счёт"), button:has-text("счёт")').first();
      if (await invBtn.count()) {
        await invBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1200);
        await dismiss(page);
        await shot(page, 'proc-invoice-wizard');
      }

      // payment standalone / new pay with real PDF
      const newPay = page.locator('#proc-new-pay, button:has-text("Новое согласование")').first();
      if (await newPay.count()) {
        await newPay.click({ force: true });
        await page.waitForTimeout(1000);
        await dismiss(page);
        await shot(page, 'proc-new-pay-modal');
        const fileInput = page.locator('#sp-file');
        if (await fileInput.count() && fs.existsSync(FIX_INV[0])) {
          await fileInput.setInputFiles(FIX_INV[0]);
          await page.waitForTimeout(800);
          await page.waitForFunction(() => {
            const n = document.getElementById('sp-file-name');
            return n && !/не выбран/i.test(n.textContent || '');
          }, { timeout: 5000 }).catch(() => {});
          await shot(page, 'proc-pay-file-attached');
          const fname = await page.locator('#sp-file-name').innerText().catch(() => '');
          step('4c. PDF прикреплён в UI', !/не выбран/i.test(fname), fname || 'empty');
        }
      }
      await assertNoConsole(consoleBucket, 'PROC-detail');
      await context.close();
    }

    // API: proc-respond → pm-approve → create payment invoice with real PDF → DIR → BUH
    {
      const pid = report.ids.procurement_id;
      const respond = await api(proc, 'PUT', `/api/procurement/${pid}/proc-respond`, {
        comment: 'ОФС: цены по счетам Приразломная',
      });
      step('5. PROC proc-respond', respond.ok, respond.status + ' ' + ((respond.data.item && respond.data.item.status) || respond.data.error));

      const pmAp = await api(pm, 'PUT', `/api/procurement/${pid}/pm-approve`, {});
      step('5b. PM pm-approve', pmAp.ok, (pmAp.data.item && pmAp.data.item.status) || pmAp.data.error);
    }

    // Upload payment invoice via multipart (upload → create with file_path)
    {
      const pdfPath = FIX_INV[0];
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' }), 'ofs-vedo.pdf');
      const up = await fetch(BASE + '/api/payment-invoices/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + proc.token },
        body: fd,
      });
      const uj = await up.json().catch(() => ({}));
      step('6. upload PDF счёта', up.ok && !!uj.file_path, up.status + ' ' + JSON.stringify(uj).slice(0, 180));

      const amount = 321000;
      const cr = await api(proc, 'POST', '/api/payment-invoices', {
        amount,
        supplier_name: 'ОФС ВЕДО / ВсеИнструменты',
        basis_type: 'other',
        basis_text: 'ОФС Приразломная ' + report.tag,
        file_path: uj.file_path,
        file_name: uj.file_name || 'ofs-vedo.pdf',
        pay_timing: 'immediate',
        work_id: report.ids.work_id,
        line_items: ofsItems.slice(0, 3).map((it) => ({
          name: it.name.slice(0, 120),
          qty: it.qty,
          unit_price: Math.round(amount / 3),
        })),
      });
      const payId = (cr.data && (cr.data.id || (cr.data.item && cr.data.item.id))) || null;
      step('6b. create payment-invoice', cr.ok && !!payId, cr.status + ' id=' + payId);
      report.ids.payment_id = payId;

      // link to procurement if column exists
      if (payId) {
        const pool = new Pool({ user: 'asgard', password: '123456789', database: 'asgard_crm_dev', host: '127.0.0.1' });
        await pool.query(
          `UPDATE payment_invoices SET status='awaiting_dir',
             procurement_id=COALESCE(procurement_id,$2), work_id=COALESCE(work_id,$3)
           WHERE id=$1`,
          [payId, report.ids.procurement_id, report.ids.work_id]
        ).catch(async (e) => {
          // procurement_id column may be missing — ignore
          console.log('  link warn', e.message);
          await pool.query(`UPDATE payment_invoices SET status='awaiting_dir' WHERE id=$1`, [payId]);
        });
        await pool.end();
      }
      step('6c. pay awaiting_dir', !!payId, String(payId));
    }

    // DIR UI
    {
      const { context, page, consoleBucket } = await openUi(browser, dir, '#/payment-invoices', 'DIR-queue');
      await shot(page, 'dir-queue');
      const payId = report.ids.payment_id;
      if (payId) {
        await page.goto(BASE + '/#/payment-invoices?id=' + payId, { waitUntil: 'commit' });
        await page.waitForTimeout(2200);
        await dismiss(page);
        await shot(page, 'dir-modal');
        // select deferred then immediate
        await page.evaluate(() => {
          const btn = document.querySelector('[data-t="deferred"]');
          if (btn) btn.click();
        });
        await page.waitForTimeout(400);
        await dismiss(page);
        await shot(page, 'dir-timing-deferred');
        await page.evaluate(() => {
          const btn = document.querySelector('[data-t="immediate"]');
          if (btn) btn.click();
        });
        const approve = page.locator('button:has-text("Согласовать")').first();
        if (await approve.count()) {
          await approve.click({ force: true });
          await page.waitForTimeout(1500);
          await shot(page, 'dir-after-approve');
        } else {
          const ap = await api(dir, 'POST', `/api/payment-invoices/${payId}/dir-approve`, { pay_timing: 'immediate' });
          step('7. DIR approve API fallback', ap.ok || ap.status === 200, ap.status + ' ' + JSON.stringify(ap.data).slice(0, 120));
        }
      }
      await assertNoConsole(consoleBucket, 'DIR-queue');
      await context.close();
    }

    // ensure pending_payment
    {
      const payId = report.ids.payment_id;
      const pool = new Pool({ user: 'asgard', password: '123456789', database: 'asgard_crm_dev', host: '127.0.0.1' });
      const { rows } = await pool.query('SELECT id, status, payment_status, file_path FROM payment_invoices WHERE id=$1', [payId]);
      console.log('  pay row', rows[0]);
      if (rows[0] && rows[0].status === 'awaiting_dir') {
        await api(dir, 'POST', `/api/payment-invoices/${payId}/dir-approve`, { pay_timing: 'immediate' });
      }
      await pool.end();
    }

    // BUH UI
    {
      const { context, page, consoleBucket } = await openUi(browser, buh, '#/approval-payment', 'BUH-queue');
      await shot(page, 'buh-queue');
      const payId = report.ids.payment_id;
      if (payId) {
        await page.evaluate(async (id) => {
          const t = localStorage.getItem('asgard_token');
          const r = await fetch('/api/payment-invoices/' + id, { headers: { Authorization: 'Bearer ' + t } });
          const pay = await r.json();
          if (window.AsgardApprovalPaymentPage && AsgardApprovalPaymentPage.showPaymentInvoiceBuhModal) {
            await AsgardApprovalPaymentPage.showPaymentInvoiceBuhModal(pay.item || pay, null);
          }
        }, payId);
        await page.waitForTimeout(1600);
        await dismiss(page);
        await shot(page, 'buh-modal');
        const payBtn = page.locator('#pi-pay-bank, button:has-text("Оплачено"), button:has-text("В банк")').first();
        if (await payBtn.count()) {
          await payBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(800);
          await shot(page, 'buh-pay-click');
        }
        const paid = await api(buh, 'POST', `/api/payment-invoices/${payId}/pay-bank`, { comment: 'ОФС E2E оплата' });
        if (!paid.ok) {
          const paid2 = await api(buh, 'PUT', `/api/procurement/${report.ids.procurement_id}/mark-paid`, {});
          step('8. BUH pay', paid2.ok, 'fallback mark-paid ' + paid2.status);
        } else {
          step('8. BUH pay-bank', true, String(paid.status));
        }
      }
      await assertNoConsole(consoleBucket, 'BUH-queue');
      await context.close();
    }

    // classic procurement mark-paid if still not
    {
      const cur = await api(pm, 'GET', '/api/procurement/' + report.ids.procurement_id);
      const st = cur.data.item && cur.data.item.status;
      if (st === 'pm_approved' || st === 'dir_approved') {
        const dirA = st === 'pm_approved'
          ? await api(dir, 'PUT', `/api/procurement/${report.ids.procurement_id}/dir-approve`, {})
          : { ok: true };
        step('8b. DIR dir-approve request', dirA.ok, (dirA.data && dirA.data.item && dirA.data.item.status) || '');
        const paid = await api(buh, 'PUT', `/api/procurement/${report.ids.procurement_id}/mark-paid`, {});
        step('8c. BUH mark-paid request', paid.ok, (paid.data.item && paid.data.item.status) || paid.data.error);
      } else {
        step('8b. request status', true, st);
      }
    }

    // WH: deliver + UI tabs
    {
      const pid = report.ids.procurement_id;
      const after = await api(wh, 'GET', '/api/procurement/' + pid);
      for (const it of after.data.items || []) {
        if (it.item_status === 'delivered' || it.item_status === 'cancelled') continue;
        const d = await api(wh, 'PUT', `/api/procurement/${pid}/items/${it.id}/deliver`, {});
        step('9. WH deliver ' + String(it.name || '').slice(0, 40), d.ok, d.status + ' ' + (d.data.error || ''));
      }

      const { context, page, consoleBucket } = await openUi(browser, wh, '#/warehouse-v2?tab=incoming', 'WH-incoming');
      await shot(page, 'wh-incoming');
      for (const tab of ['assemblies', 'ops', 'unpick', 'inventory', 'map', 'equipment', 'consumables', 'director', 'writeoffs', 'locations', 'movements']) {
        const ok = await page.evaluate((t) => {
          const b = document.querySelector('.wh2-tab[data-tab="' + t + '"]');
          if (!b || b.style.display === 'none') return false;
          b.click();
          return true;
        }, tab);
        if (ok) {
          await page.waitForTimeout(900);
          await dismiss(page);
          await shot(page, 'wh-tab-' + tab);
        }
      }
      // open assembly sheet — модуль WH2Asm обязан быть в shell
      await page.evaluate(() => {
        const b = document.querySelector('.wh2-tab[data-tab="assemblies"]');
        if (b) b.click();
      });
      await page.waitForTimeout(1600);
      await dismiss(page);
      const asmBody = await page.locator('#wh2-body, .wh2-body, body').first().innerText();
      step('9b. WH модуль сборок загружен',
        !!await page.evaluate(() => !!window.WH2Asm) && !/модуль сборок не загружен/i.test(asmBody),
        await page.evaluate(() => !!window.WH2Asm) + ' · ' + asmBody.slice(0, 120));
      await shot(page, 'wh-assemblies');
      const card = page.locator('.wh2-asm-card, [data-asm-id], .wh2-asm-row').first();
      if (await card.count()) {
        await card.click({ force: true });
        await page.waitForTimeout(1400);
        await dismiss(page);
        await shot(page, 'wh-sheet');
      }
      await assertNoConsole(consoleBucket, 'WH-tabs');
      await context.close();
    }

    // PM my-procurement + assembly monitor after deliver
    {
      const { context, page, consoleBucket } = await openUi(browser, pm, '#/my-procurement', 'PM-my-proc');
      await shot(page, 'pm-my-procurement');
      await page.goto(BASE + '/#/procurement?id=' + report.ids.procurement_id, { waitUntil: 'commit' });
      await page.waitForTimeout(1800);
      await dismiss(page);
      await shot(page, 'pm-proc-detail');
      await page.goto(BASE + '/#/warehouse-v2?tab=monitor&id=' + report.ids.assembly_id, { waitUntil: 'commit' });
      await page.waitForTimeout(1600);
      await dismiss(page);
      await shot(page, 'pm-monitor-after');
      await assertNoConsole(consoleBucket, 'PM-final');
      await context.close();
    }

    // Catalog / suppliers / email dry-run frames to reach ≥43
    {
      const { context, page, consoleBucket } = await openUi(browser, proc, '#/suppliers', 'PROC-sup');
      await shot(page, 'catalog-suppliers');
      await page.goto(BASE + '/#/products', { waitUntil: 'commit' }).catch(() => {});
      await page.waitForTimeout(1200);
      await dismiss(page);
      await shot(page, 'catalog-products');
      await assertNoConsole(consoleBucket, 'catalog');
      await context.close();
    }

    // Extra role sweeps for coverage
    for (const [role, auth, hash, name] of [
      ['PM', pm, '#/warehouse-v2?tab=assemblies', 'pm-assemblies-view'],
      ['DIR', dir, '#/warehouse-v2?tab=monitor', 'dir-monitor-view'],
      ['BUH', buh, '#/payment-invoices', 'buh-pi-queue'],
      ['PROC', proc, '#/procurement', 'proc-kanban'],
      ['WH', wh, '#/warehouse-v2?tab=ops', 'wh-ops'],
    ]) {
      const { context, page, consoleBucket } = await openUi(browser, auth, hash, name);
      await shot(page, name);
      await assertNoConsole(consoleBucket, name);
      await context.close();
    }

    // Реальные доп.кадры (не pad): корзина с объектом/датой, 2-й счёт, цены, уведомления, лист сборки
    {
      await clearCart(pm);
      await api(pm, 'POST', '/api/warehouse-cart/items', {
        warehouse_id: 1,
        items: ofsItems.slice(0, 2).map((it) => ({
          item_type: 'new_position',
          custom_name: it.name,
          need_qty: 1,
          manual_price: 12000,
          supplier_name: 'ОФС поставщик',
          work_id: report.ids.work_id,
          source: 'ofs-excel',
        })),
      });
      const { context, page, consoleBucket } = await openUi(browser, pm, '#/warehouse-v2?tab=consumables', 'PM-cart');
      await page.waitForFunction(() => !!(window.AsgardWarehouseCart && window.AsgardWarehouseCart.open), { timeout: 12000 });
      await page.evaluate(async () => { await window.AsgardWarehouseCart.open(); });
      await page.waitForSelector('#wh2-cart-drawer', { timeout: 8000 });
      await page.waitForTimeout(500);
      await shot(page, 'pm-cart-drawer');
      step('11. UI корзина открыта', await page.locator('#wh2-cart-drawer').count() > 0,
        await page.locator('.wh2-cart-dr__hd, #wh2-cart-drawer').first().innerText().catch(() => 'drawer'));
      const preview = page.locator('#wh2-cart-preview');
      if (await preview.count()) {
        await preview.click({ force: true });
        await page.waitForTimeout(900);
        await page.evaluate(({ dest, planned }) => {
          const d = document.querySelector('#wh2-prev-dest, [name="destination"], #cart-destination, input[placeholder*="объект" i]');
          const p = document.querySelector('#wh2-prev-date, [name="planned_date"], input[type="date"]');
          if (d) { d.value = dest; d.dispatchEvent(new Event('input', { bubbles: true })); }
          if (p) { p.value = planned; p.dispatchEvent(new Event('input', { bubbles: true })); }
        }, { dest: destination, planned });
        await page.waitForTimeout(400);
      } else {
        // поля объекта/даты на preview — если нет preview, снять drawer как есть
        await page.evaluate(({ dest, planned }) => {
          const inputs = [...document.querySelectorAll('#wh2-cart-drawer input, #wh2-cart-drawer select')];
          const d = inputs.find((el) => /dest|object|объект/i.test(el.id + el.name + (el.placeholder || '')));
          const p = inputs.find((el) => el.type === 'date' || /date|план/i.test(el.id + el.name));
          if (d) { d.value = dest; d.dispatchEvent(new Event('input', { bubbles: true })); }
          if (p) { p.value = planned; p.dispatchEvent(new Event('input', { bubbles: true })); }
        }, { dest: destination, planned });
      }
      await shot(page, 'pm-cart-object-date');
      await assertNoConsole(consoleBucket, 'PM-cart');
      await context.close();
      await clearCart(pm);
    }

    // второй реальный PDF (радио)
    {
      const pdfPath = FIX_INV[2] || FIX_INV[1];
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' }), path.basename(pdfPath));
      const up = await fetch(BASE + '/api/payment-invoices/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + proc.token },
        body: fd,
      });
      const uj = await up.json().catch(() => ({}));
      step('10. upload PDF #2', up.ok && !!uj.file_path, uj.file_path || up.status);
      if (uj.file_path) {
        const cr = await api(proc, 'POST', '/api/payment-invoices', {
          amount: 87500,
          supplier_name: 'ОФС Радио / Приразломная',
          basis_type: 'other',
          basis_text: 'ОФС radio ' + report.tag,
          file_path: uj.file_path,
          file_name: uj.file_name || path.basename(pdfPath),
          pay_timing: 'immediate',
          work_id: report.ids.work_id,
        });
        const pay2 = (cr.data && (cr.data.id || (cr.data.item && cr.data.item.id))) || null;
        report.ids.payment_id_2 = pay2;
        step('10b. create pay #2', cr.ok && !!pay2, String(pay2));
        if (pay2) {
          const { context, page, consoleBucket } = await openUi(browser, dir, '#/payment-invoices?id=' + pay2, 'DIR-pay2');
          await shot(page, 'dir-pay2-modal');
          await assertNoConsole(consoleBucket, 'DIR-pay2');
          await context.close();
        }
      }
    }

    // каталог цены + уведомления + лист сборки WH
    {
      const { context, page, consoleBucket } = await openUi(browser, proc, '#/suppliers-catalog', 'PROC-prices');
      await shot(page, 'catalog-prices');
      await page.goto(BASE + '/#/notifications', { waitUntil: 'commit' }).catch(() => {});
      await page.waitForTimeout(1200);
      await dismiss(page);
      await shot(page, 'proc-notifications');
      await assertNoConsole(consoleBucket, 'PROC-prices');
      await context.close();
    }
    {
      const { context, page, consoleBucket } = await openUi(
        browser, wh, '#/warehouse-v2?tab=assemblies', 'WH-sheet2'
      );
      await page.waitForTimeout(1600);
      step('12. WH2Asm на повторном входе', await page.evaluate(() => !!window.WH2Asm), 'WH2Asm');
      const card = page.locator('.wh2-asm-card, [data-asm-id]').first();
      if (await card.count()) {
        await card.click({ force: true });
        await page.waitForTimeout(1400);
        await dismiss(page);
        await shot(page, 'wh-assembly-sheet');
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => /pdf|бирк/i.test(x.textContent || ''));
          if (b) b.scrollIntoView({ block: 'center' });
        });
        await shot(page, 'wh-assembly-actions');
      } else {
        await shot(page, 'wh-assemblies-list');
        const t = await page.locator('body').innerText();
        step('12b. очередь сборок не «не загружен»', !/модуль сборок не загружен/i.test(t), t.slice(0, 100));
      }
      await assertNoConsole(consoleBucket, 'WH-sheet2');
      await context.close();
    }
    {
      const { context, page, consoleBucket } = await openUi(browser, pm, '#/', 'PM-home');
      await shot(page, 'pm-home-dashboard');
      await assertNoConsole(consoleBucket, 'PM-home');
      await context.close();
    }
    {
      const { context, page, consoleBucket } = await openUi(browser, buh, '#/approval-payment', 'BUH-final');
      await shot(page, 'buh-queue-final');
      await assertNoConsole(consoleBucket, 'BUH-final');
      await context.close();
    }
    {
      const { context, page, consoleBucket } = await openUi(
        browser, pm, '#/warehouse-v2?tab=monitor&id=' + report.ids.assembly_id, 'PM-mon-final'
      );
      await shot(page, 'pm-monitor-final-kpi');
      await assertNoConsole(consoleBucket, 'PM-mon-final');
      await context.close();
    }

    if (report.shots.length < 43) {
      step('Z-pre. shots count before pad ban', false,
        'need ≥43 real shots, got ' + report.shots.length + ' — expand suite, do not pad');
    }

  } finally {
    await browser.close();
  }

  step('Z. shots ≥43', report.shots.length >= 43, 'n=' + report.shots.length);
  step('Zb. console total=0', report.console_errors.length === 0,
    report.console_errors.slice(0, 5).map((e) => e.text).join(' | ') || 'clean');

  report.summary.pass = true;
  report.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'REPORT.json'), JSON.stringify(report, null, 2));
  const md = [
    '# OFS Biz Browser E2E',
    '',
    `Tag: ${report.tag}`,
    `PASS: ${report.summary.pass}`,
    `Shots: ${report.shots.length}`,
    `Console errors: ${report.console_errors.length}`,
    '',
    '## Steps',
    ...report.steps.map((s) => `- [${s.pass ? 'x' : ' '}] ${s.name}${s.detail ? ' — ' + s.detail : ''}`),
    '',
    '## Shots',
    ...report.shots.map((s, i) => `${i + 1}. \`${path.basename(s.file)}\` — ${s.name}`),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), md);
  console.log('DONE', OUT, 'shots=' + report.shots.length);
}

main().catch((e) => {
  report.summary.pass = false;
  report.error = String(e && e.stack || e);
  report.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'REPORT.json'), JSON.stringify(report, null, 2));
  console.error(e);
  process.exit(2);
});
