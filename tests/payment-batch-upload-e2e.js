// Реальная загрузка счёта в модалку партии: прогресс → OCR → поля → НДС/основание.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const OUT = 'tests/reports/payment-v412';
fs.mkdirSync(OUT, { recursive: true });

// Берём реальный счёт из uploads (Wildberries PDF).
function findInvoice() {
  const root = path.join(__dirname, '..', 'uploads', 'mail');
  const walk = (d) => {
    if (!fs.existsSync(d)) return null;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { const r = walk(f); if (r) return r; }
      else if (/\.pdf$/i.test(e.name) && fs.statSync(f).size > 10000) return f;
    }
    return null;
  };
  return walk(root);
}

async function login(ctx, l, p) {
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { login: l, password: p } });
  const j = await r.json(); let t = j.token;
  if (j.status === 'need_pin' || j.need_pin) {
    for (const pin of ['0000', '1234']) {
      const r2 = await ctx.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t }, data: { pin } });
      const j2 = await r2.json().catch(() => ({}));
      if (j2.token) { t = j2.token; break; }
    }
  }
  return t;
}

(async () => {
  const pdf = findInvoice();
  console.log('счёт для теста:', pdf ? path.basename(pdf) : 'НЕ НАЙДЕН');
  if (!pdf) return;

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));
  await p.goto(BASE + '/', { waitUntil: 'commit' });
  await p.waitForTimeout(1100);
  const t = await login(ctx, 'test_pm', 'Test123!');
  await p.evaluate((tk) => localStorage.setItem('asgard_token', tk), t);
  await p.goto(BASE + '/#/my-procurement', { waitUntil: 'commit' });
  await p.reload({ waitUntil: 'commit' });
  await p.waitForTimeout(2400);
  await p.waitForFunction(() => !!window.AsgardPaymentBatch, { timeout: 15000 }).catch(() => {});

  await p.evaluate(() => window.AsgardPaymentBatch.open());
  await p.waitForSelector('#pb-file', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(900);
  // Загружаем файл в инпут
  const inp = await p.$('#pb-file');
  if (!inp) { console.log('нет инпута'); await b.close(); return; }
  await inp.setInputFiles(pdf);
  console.log('файл подан, ждём OCR…');

  // Ждём готовности (status=ready) до 120с
  const ready = await p.waitForFunction(() => {
    const el = document.querySelector('.pbatch__item--ready');
    return !!el;
  }, { timeout: 120000 }).catch(() => null);

  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => ({
    items: document.querySelectorAll('.pbatch__item').length,
    ready: document.querySelectorAll('.pbatch__item--ready').length,
    err: document.querySelectorAll('.pbatch__item--error').length,
    errText: (document.querySelector('.pbatch__item-err') || {}).textContent || null,
    paneErr: (document.querySelector('.pbatch__pane-load-s') || {}).textContent || null,
    vatOptions: [...document.querySelectorAll('.pbatch__vat-sel option')].map((o) => o.textContent.trim()),
    basisOptions: [...document.querySelectorAll('.pbatch__basis-sel option')].map((o) => o.textContent.trim()),
    hasPreview: !!document.querySelector('.pbatch__preview img'),
    previewSrc: (document.querySelector('.pbatch__preview img') || {}).src || null,
    previewHTML: (document.querySelector('.pbatch__preview') || {}).innerHTML || null,
    imgError: (document.querySelector('.pbatch__prev-err') || {}).textContent || null,
    supplier: (document.querySelector('[data-f="supplier_name"]') || {}).value || null,
    amount: (document.querySelector('[data-f="amount"]') || {}).value || null,
    invoiceNo: (document.querySelector('[data-f="invoice_number"]') || {}).value || null,
    vatSel: (document.querySelector('.pbatch__vat-sel') || {}).value,
    submitDisabled: (document.querySelector('#pb-submit') || {}).disabled
  }));
  await p.screenshot({ path: `${OUT}/with-invoice.png`, fullPage: false }).catch(() => {});
  console.log(JSON.stringify(info, null, 1));
  console.log('JS-ошибки:', errs.length ? errs : 'нет');
  await b.close();
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
