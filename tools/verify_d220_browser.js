/**
 * verify_d220_browser.js — браузерное доказательство, что stored XSS класса D-220 закрыт.
 * Поднимает реальный chromium (playwright), кладёт «атакующий» файл в uploads/ и проверяет,
 * что при открытии URL скрипт НЕ выполняется (title не меняется), для всех трёх путей раздачи:
 *   1) статика /uploads/*
 *   2) роут /api/files/preview/*
 *   3) роут /api/files/download/*
 * А также что серверный HTML-экспорт сметы (.html без скриптов) по-прежнему РЕНДЕРИТСЯ.
 */
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (process.env.DB_NAME === 'asgard_crm') { console.error('[D-220] FAIL: прод-БД запрещена'); process.exit(1); }

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { Pool } = require('pg');

const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'asgard', password: '123456789', database: process.env.DB_NAME });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`); };

async function login(loginName, password) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: loginName, password }) });
  const j = await r.json();
  let token = j.token;
  if (j.status === 'need_pin' || j.status === 'need_setup') {
    const r2 = await fetch(`${BASE}/api/auth/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ pin: '0000' }) });
    const j2 = await r2.json();
    if (j2.token) token = j2.token;
  }
  return token;
}

const XSS = '<!doctype html><html><head><title>ORIGINAL</title></head><body><h1>doc</h1><script>document.title="XSS-EXEC";</script></body></html>';
const EST = '<!doctype html><html><head><title>Смета</title></head><body><h1>Смета ок</h1></body></html>';

(async () => {
  const admin = await login('test_admin', 'Test123!');
  const asmDir = path.join(process.cwd(), 'uploads', 'assembly');
  const estDir = path.join(process.cwd(), 'uploads', 'estimates');
  fs.mkdirSync(asmDir, { recursive: true });
  fs.mkdirSync(estDir, { recursive: true });
  const xssStatic = path.join(asmDir, 'd220b_xss.html');
  const estFile = path.join(estDir, 'd220b_estimate.html');
  fs.writeFileSync(xssStatic, XSS);
  fs.writeFileSync(estFile, EST);

  // Документ в БД для проверки preview/download.
  await pool.query(`DELETE FROM documents WHERE filename IN ('d220b_xss.html','d220b_estimate.html')`).catch(() => {});
  await pool.query(
    `INSERT INTO documents (filename, original_name, mime_type, size, type, uploaded_by, download_url, created_at)
     VALUES ('d220b_xss.html','d220b_xss.html','text/html',$1,'test',1,'/uploads/assembly/d220b_xss.html',NOW())`, [Buffer.byteLength(XSS)]
  );

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // в контексте не нужен логин для статики; для API — Authorization через route.
  await ctx.addInitScript(([t]) => { window.__tok = t; }, [admin]);
  await page.route('**/api/files/**', (route) => {
    route.continue({ headers: { ...route.request().headers(), Authorization: 'Bearer ' + admin } });
  });

  async function titleAfterOpen(url) {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    return await page.title();
  }

  // 1. Статика /uploads/*.html
  const t1 = await titleAfterOpen(`${BASE}/uploads/assembly/d220b_xss.html`);
  check('B1. браузер: статика .html — скрипт НЕ исполнен', t1 !== 'XSS-EXEC', `title="${t1}"`);

  // 2. /api/files/preview/*.html
  const t2 = await titleAfterOpen(`${BASE}/api/files/preview/d220b_xss.html`);
  check('B2. браузер: files/preview .html — скрипт НЕ исполнен', t2 !== 'XSS-EXEC', `title="${t2}"`);

  // 3. /api/files/download/*.html
  const t3 = await titleAfterOpen(`${BASE}/api/files/download/d220b_xss.html`);
  check('B3. браузер: files/download .html — скрипт НЕ исполнен', t3 !== 'XSS-EXEC', `title="${t3}"`);

  // 4. Легитимная серверная HTML-смета (без скриптов) должна отрендериться в браузере.
  const t4 = await titleAfterOpen(`${BASE}/uploads/estimates/d220b_estimate.html`);
  const body4 = await page.textContent('h1').catch(() => '');
  check('B4. браузер: серверная смета .html рендерится', t4 === 'Смета' && /Смета ок/.test(body4), `title="${t4}" body="${body4}"`);

  // 5. Негативный контроль методики: если бы мы отключили защиту, скрипт бы исполнился.
  //    Проверяем, что сам payload рабочий — открываем data-URL (без нашей CSP).
  const t5 = await titleAfterOpen('data:text/html,<html><head><title>ORIGINAL</title></head><body><scr' + 'ipt>document.title="XSS-EXEC";</scr' + 'ipt></body></html>');
  check('B5. негативный контроль: payload рабочий (data-URL → XSS-EXEC)', t5 === 'XSS-EXEC', `title="${t5}"`);

  await browser.close();
  await pool.query(`DELETE FROM documents WHERE filename='d220b_xss.html'`).catch(() => {});
  try { fs.unlinkSync(xssStatic); } catch (_) {}
  try { fs.unlinkSync(estFile); } catch (_) {}
  await pool.end();

  const fail = results.filter((r) => !r.ok);
  console.log(`\nИТОГ: ${results.length - fail.length} PASS / ${fail.length} FAIL`);
  if (fail.length) fail.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.detail}`));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
