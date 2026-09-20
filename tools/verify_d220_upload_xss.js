/**
 * verify_d220_upload_xss.js — гейт класса D-220 (stored XSS через загрузку файлов).
 *
 * Класс (вскрыт C1/C3-верификатором, затем повторно D-220-верификатором 20.09):
 *   расширение файла брали из имени клиента (path.extname(file.filename)), файл клали в
 *   uploads/, который раздаётся статикой либо роутами вида /api/files/preview.
 *   Браузер исполнял сохранённый `.html` в домене CRM от лица залогиненного сотрудника.
 *
 * Проверяемо и негативно (атака) и позитивно (легитимный файл не сломан).
 * Клон: TEST_BASE_URL по умолчанию http://127.0.0.1:3101, DB_NAME=asgard_crm_test.
 */
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (process.env.DB_NAME === 'asgard_crm') {
  console.error('[D-220] FAIL: прогон на прод-БД запрещён');
  process.exit(1);
}

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
  database: process.env.DB_NAME,
});

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function login(login, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (!r.ok) throw new Error(`login ${login}: HTTP ${r.status}`);
  const j = await r.json();
  let token = j.token;
  // У тестовых юзеров может быть PIN — логин отдаёт ограниченный токен (need_pin).
  if (j.status === 'need_pin' || j.status === 'need_setup') {
    const r2 = await fetch(`${BASE}/api/auth/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: process.env.TEST_PIN || '0000' }),
    });
    const j2 = await r2.json();
    if (j2.token) token = j2.token;
  }
  return token;
}

/** Отправляем сырой multipart, управляя filename/Content-Type как атакующий. */
async function rawMultipart(path, token, filename, contentType, body) {
  const boundary = '----d220boundary' + Math.random().toString(36).slice(2);
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const buf = Buffer.concat([Buffer.from(head, 'utf8'), payload, Buffer.from(tail, 'utf8')]);
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: buf,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, headers: r.headers, text, json };
}

const XSS = '<html><script>document.title="XSS-EXEC"</script></html>';

(async () => {
  const admin = await login('test_admin', process.env.TEST_ADMIN_PASS || 'Test123!');

  // ── 1. Юнит-уровень: политика расширений ────────────────────────────────
  const ue = require('../src/lib/upload-ext');
  check('1. safeStoredExt отбивает .html', ue.safeStoredExt('text/html', 'evil.html', { allow: 'doc' }) === null);
  check('2. safeStoredExt отбивает .svg', ue.safeStoredExt('image/svg+xml', 'x.svg', { allow: 'doc' }) === null);
  check('3. safeStoredExt отбивает .js', ue.safeStoredExt('application/javascript', 'a.js', { allow: 'doc' }) === null);
  check('4. safeStoredExt отбивает пустой MIME + .html имя', ue.safeStoredExt('', 'evil.html', { allow: 'doc' }) === null);
  check('5. safeStoredExt пустой MIME + .svg имя', ue.safeStoredExt('', 'x.svg', { allow: 'photo' }) === null);
  check('6. safeStoredExt пустой MIME + .pdf имя → .pdf', ue.safeStoredExt('', 'a.pdf', { allow: 'doc' }) === '.pdf');
  check('7. safeStoredExt image/png (спуф имени .html) → .png', ue.safeStoredExt('image/png', 'a.html', { allow: 'photo' }) === '.png');
  check('8. safeContentType(.html) → octet-stream', ue.safeContentType('.html', 'text/html') === 'application/octet-stream');
  check('9. safeContentType(.svg) → octet-stream', ue.safeContentType('.svg', 'image/svg+xml') === 'application/octet-stream');
  check('10. safeContentType(.png,text/html) → image/png', ue.safeContentType('.png', 'text/html') === 'image/png');
  check('11. inlineSafetyHeaders(.html) даёт CSP sandbox', /sandbox/.test(ue.inlineSafetyHeaders('.html')['Content-Security-Policy'] || ''));
  check('12. inlineSafetyHeaders(.pdf) пусто', Object.keys(ue.inlineSafetyHeaders('.pdf')).length === 0);

  // ── 2. Эксплойт 1 (найден верификатором): field-logistics attach ─────────
  const { rows: [log] } = await pool.query(
    `INSERT INTO field_logistics (work_id, employee_id, item_type, title, created_by)
     SELECT w.id, e.id, 'tool', 'D220 probe', 1
       FROM works w CROSS JOIN employees e LIMIT 1
     RETURNING id`
  ).catch(() => ({ rows: [null] }));

  if (log && log.id) {
    const atk = await rawMultipart(`/api/field/logistics/${log.id}/attach`, admin, 'evil.html', 'text/html', XSS);
    check('13. logistics: evil.html отклонён (415)', atk.status === 415, `status=${atk.status}`);
    const okPdf = await rawMultipart(`/api/field/logistics/${log.id}/attach`, admin, 'act.pdf', 'application/pdf', '%PDF-1.4 test');
    check('14. logistics: act.pdf принят (200)', okPdf.status === 200, `status=${okPdf.status}`);
    // Проверяем, что на диске не появился .html
    const { rows: docs } = await pool.query(
      `SELECT filename FROM documents WHERE work_id = (SELECT work_id FROM field_logistics WHERE id=$1)
         AND created_at > NOW() - INTERVAL '5 minutes'`, [log.id]
    );
    const bad = docs.filter((d) => /\.(html?|svg|js|xml)$/i.test(d.filename || ''));
    check('15. logistics: в БД нет .html-файлов', bad.length === 0, `bad=${bad.map((b) => b.filename).join(',')}`);
    await pool.query('DELETE FROM field_logistics WHERE id=$1', [log.id]).catch(() => {});
  } else {
    check('13-15. logistics (нет тестовой записи — пропуск, отметить)', false, 'не удалось создать field_logistics');
  }

  // ── 3. Эксплойт 2 (найден верификатором): expenses attach → /api/files/preview ──
  const { rows: [exp] } = await pool.query(
    `INSERT INTO work_expenses (work_id, category, amount, description, created_at)
     SELECT id, 'other', 1, 'D220 probe', NOW() FROM works LIMIT 1 RETURNING id`
  ).catch(() => ({ rows: [null] }));

  if (exp && exp.id) {
    const atk = await rawMultipart(`/api/expenses/attach/${exp.id}`, admin, 'evil.html', 'text/html', XSS);
    check('16. expenses: evil.html отклонён (415)', atk.status === 415, `status=${atk.status}`);

    const okJpg = await rawMultipart(`/api/expenses/attach/${exp.id}`, admin, 'receipt.jpg', 'image/jpeg', 'JPEGDATA');
    check('17. expenses: receipt.jpg принят (200)', okJpg.status === 200, `status=${okJpg.status}`);

    // Даже если .html как-то попал бы в БД — /api/files/preview обязан отдать неисполнимый тип.
    // (HTML из пользовательского контура сознательно делаем attachment: рендер — это и есть XSS.)
    const probeDisk = path.join(process.cwd(), 'uploads', 'd220_probe.html');
    fs.mkdirSync(path.dirname(probeDisk), { recursive: true });
    fs.writeFileSync(probeDisk, XSS);
    const { rows: [fake] } = await pool.query(
      `INSERT INTO documents (filename, original_name, mime_type, size, type, uploaded_by, download_url, created_at)
       VALUES ('d220_probe.html', 'd220_probe.html', 'text/html', 40, 'test', 1, '/uploads/d220_probe.html', NOW())
       RETURNING filename`
    );
    const prev = await fetch(`${BASE}/api/files/preview/${fake.filename}`, { headers: { Authorization: 'Bearer ' + admin } });
    const ct = (prev.headers.get('content-type') || '').toLowerCase();
    check('18. files/preview .html не исполняется как text/html', !ct.includes('text/html'), `content-type=${ct}`);
    const disp = (prev.headers.get('content-disposition') || '').toLowerCase();
    check('19. files/preview .html отдаётся attachment', disp.includes('attachment'), `disposition=${disp.slice(0, 60)}`);
    await prev.text().catch(() => {});
    await pool.query(`DELETE FROM documents WHERE filename='d220_probe.html'`);
    try { fs.unlinkSync(probeDisk); } catch (_) {}
    await pool.query('DELETE FROM work_expenses WHERE id=$1', [exp.id]).catch(() => {});
  } else {
    check('16-19. expenses (нет тестовой записи — пропуск)', false, 'не удалось создать work_expenses');
  }

  // ── 4. Глобальный барьер статики /uploads/* ─────────────────────────────
  // Кладём «атакующий» .html прямо на диск (эмуляция уже загруженного ранее файла).
  const dir = path.join(process.cwd(), 'uploads', 'assembly');
  fs.mkdirSync(dir, { recursive: true });
  const probeName = 'd220staticprobe.html';
  fs.writeFileSync(path.join(dir, probeName), XSS);
  const st = await fetch(`${BASE}/uploads/assembly/${probeName}`);
  const stCt = (st.headers.get('content-type') || '').toLowerCase();
  const stCsp = st.headers.get('content-security-policy') || '';
  check('20. статика /uploads .html: CSP sandbox', /sandbox/.test(stCsp), `csp=${stCsp.slice(0, 50)}`);
  check('21. статика /uploads .html: нет Allow-scripts', !/allow-scripts/.test(stCsp), `csp=${stCsp.slice(0, 50)}`);
  check('22. статика /uploads .html: nosniff', (st.headers.get('x-content-type-options') || '').includes('nosniff'));

  // Легитимный серверный HTML-экспорт сметы должен рендериться (CSP sandbox без скриптов).
  const estDir = path.join(process.cwd(), 'uploads', 'estimates');
  fs.mkdirSync(estDir, { recursive: true });
  const estName = 'd220_estimate_probe.html';
  fs.writeFileSync(path.join(estDir, estName), '<!doctype html><html><body><h1>Смета ок</h1></body></html>');
  const est = await fetch(`${BASE}/uploads/estimates/${estName}`);
  const estCt = (est.headers.get('content-type') || '').toLowerCase();
  check('23. статика /uploads estimates .html отдаётся как html', estCt.includes('text/html'), `ct=${estCt}`);
  const estBody = await est.text();
  check('24. статика /uploads estimates .html рендерится (тело цело)', estBody.includes('Смета ок'));

  // Неизвестное расширение — attachment.
  const binName = 'd220probe.weird';
  fs.writeFileSync(path.join(dir, binName), 'data');
  const bin = await fetch(`${BASE}/uploads/assembly/${binName}`);
  check('25. неизвестное расширение → octet-stream', (bin.headers.get('content-type') || '').includes('octet-stream'), `ct=${bin.headers.get('content-type')}`);

  fs.unlinkSync(path.join(dir, probeName));
  fs.unlinkSync(path.join(dir, binName));
  fs.unlinkSync(path.join(estDir, estName));

  // ── 5. Регресс: статика/public не затронута ─────────────────────────────
  const idx = await fetch(`${BASE}/`);
  check('26. public/index.html отдаётся как text/html', (idx.headers.get('content-type') || '').includes('text/html'));
  const svgIcon = await fetch(`${BASE}/icons/dasv.svg`);
  const iconCt = (svgIcon.headers.get('content-type') || '').toLowerCase();
  check('27. public/icons/*.svg отдаётся как image/svg+xml (не сломан)', iconCt.includes('svg'),
    `ct=${iconCt}, status=${svgIcon.status}`);

  await pool.end();

  const fail = results.filter((r) => !r.ok);
  console.log(`\nИТОГ: ${results.length - fail.length} PASS / ${fail.length} FAIL`);
  if (fail.length) fail.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.detail}`));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
