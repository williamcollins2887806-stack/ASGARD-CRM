/**
 * verify_d220b_chains.js — рантайм-репетиция ДВУХ цепочек, доказанных верификатором 21.09.
 *
 * 1) rp-review-collab: POST /api/tenders/:id/rp-review/my-draft/estimate/... → uploads/rp_estimates
 *    → отдача через tender-files /view/:docId с типом из БД.
 * 2) tender-files /view/:docId — раньше стримил файл НАПРЯМУЮ (минуя CSP-барьер статики /uploads/*)
 *    и брал Content-Type из docs.mime_type → исполнение .html/.svg в real chromium.
 *
 * Тест создаёт документ с опасным расширением прямо в БД+на диске (эмуляция ранее загруженного),
 * получает токен шаринга и открывает /view в chromium: скрипт НЕ должен исполниться.
 * Негативный контроль методики: тот же payload через data:-URL обязан исполниться.
 */
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (process.env.DB_NAME === 'asgard_crm') { console.error('[D-220b] FAIL: прод-БД запрещена'); process.exit(1); }

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { Pool } = require('pg');

const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'asgard', password: '123456789', database: process.env.DB_NAME });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`); };

const XSS = '<!doctype html><html><head><title>ORIGINAL</title></head><body><h1>doc</h1><script>document.title="D220B-EXEC";</script></body></html>';

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

(async () => {
  // ── берём любой тендер и создаём токен шаринга файлов ─────────────────────
  const { rows: [t] } = await pool.query('SELECT id FROM tenders ORDER BY id DESC LIMIT 1');
  if (!t) { console.log('нет тендеров — пропуск'); process.exit(0); }

  const rawToken = crypto.randomBytes(16).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await pool.query(
    `INSERT INTO tender_file_share_tokens (tender_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour') RETURNING id`, [t.id, tokenHash]
  );

  // ── кладём «опасный» документ и в БД, и на диск ───────────────────────────
  const relDir = path.join('uploads', 'rp_estimates', String(t.id));
  const absDir = path.join(process.cwd(), relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const fname = `d220b_probe_${Date.now()}.html`;
  fs.writeFileSync(path.join(absDir, fname), XSS);
  const { rows: [doc] } = await pool.query(
    `INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
     VALUES ($1,$1,'text/html',$2,'rp_estimate',$3,1,$4,NOW()) RETURNING id`,
    [fname, Buffer.byteLength(XSS), t.id, `/uploads/rp_estimates/${t.id}/${fname}`]
  );

  // 1) Прямая проверка /view: заголовки не должны быть text/html
  const view = await fetch(`${BASE}/tender-files/${rawToken}/view/${doc.id}`);
  const ct = (view.headers.get('content-type') || '').toLowerCase();
  const disp = (view.headers.get('content-disposition') || '').toLowerCase();
  check('1. tender-files /view: .html не отдан как text/html', !ct.includes('text/html'), `content-type=${ct}`);
  check('2. tender-files /view: .html не inline', !disp.startsWith('inline'), `disposition=${disp.slice(0, 40)}`);
  const csp = view.headers.get('content-security-policy') || '';
  check('3. tender-files /view: есть CSP sandbox без allow-scripts', /sandbox/.test(csp) && !/allow-scripts/.test(csp), `csp=${csp.slice(0, 50) || '(нет)'}`);
  await view.text().catch(() => {});

  // 2) Браузер: тот же URL — скрипт НЕ должен исполниться.
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
  let execTitle = null;
  try {
    await page.goto(`${BASE}/tender-files/${rawToken}/view/${doc.id}`, { waitUntil: 'load', timeout: 8000 });
    await page.waitForTimeout(400);
    execTitle = await page.title();
  } catch (e) {
    // «Download is starting» — это и есть правильное поведение: файл не рендерится как страница,
    // значит никакой скрипт в домене CRM исполниться не может.
    execTitle = /download is starting/i.test(String(e && e.message)) ? '(download, не рендер)' : null;
    if (execTitle === null) throw e;
  }
  check('4. браузер: tender-files /view — скрипт НЕ исполнен', execTitle !== 'D220B-EXEC', `результат="${execTitle}"`);
  // Негативный контроль методики: payload рабочий.
  await page.goto('data:text/html,<html><head><title>ORIGINAL</title></head><body><scr' + 'ipt>document.title="D220B-EXEC";</scr' + 'ipt></body></html>', { waitUntil: 'load' });
  const ctrl = await page.title();
  check('5. негативный контроль: payload рабочий (data-URL → D220B-EXEC)', ctrl === 'D220B-EXEC', `title="${ctrl}"`);
  await browser.close();

  // 3) Загрузчик rp-review-collab: evil.html не должен сохраниться как .html
  const pm = await login('test_pm', process.env.TEST_PM_PASSWORD || 'Test123!').catch(() => null);
  if (pm) {
    const fd = new FormData();
    fd.append('file', new Blob([XSS], { type: 'text/html' }), 'evil.html');
    const up = await fetch(`${BASE}/api/tenders/${t.id}/rp-review/my-draft/estimate${''}?phase=analysis`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + pm }, body: fd,
    });
    check('6. rp-review загрузка .html отклонена/не сохранена как .html', up.status === 415 || up.status === 403 || up.status === 400, `status=${up.status}`);
    await up.text().catch(() => {});
  } else {
    check('6. rp-review загрузка (нет test_pm — пропуск, отметить)', false, 'login test_pm не удался');
  }

  // cleanup
  await pool.query(`DELETE FROM documents WHERE filename LIKE 'd220b_probe_%'`).catch(() => {});
  await pool.query(`DELETE FROM tender_file_share_tokens WHERE token_hash=$1`, [tokenHash]).catch(() => {});
  try { fs.unlinkSync(path.join(absDir, fname)); } catch (_) {}
  await pool.end();

  const fail = results.filter((r) => !r.ok);
  console.log(`\nИТОГ: ${results.length - fail.length} PASS / ${fail.length} FAIL`);
  fail.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.detail}`));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
