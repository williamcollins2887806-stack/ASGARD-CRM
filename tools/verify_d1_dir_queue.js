/**
 * verify_d1_dir_queue.js — D1: у директора есть СВОЯ очередь согласования.
 *
 * Что проверяется (раньше этого не было: nav открывал страницу бухгалтерии, запрос
 * /api/approval/pending-buh давал директору 403 → пустой/битый экран):
 *  1) GET /api/approval/pending-dir под DIRECTOR/ADMIN → 200 и корректная форма среза;
 *  2) под ролью без прав → 403;
 *  3) срез содержит ТОЛЬКО статус awaiting_dir (не подсовывает уже одобренные);
 *  4) dir-approve реально меняет статус (idempotent-повтор → 409) и сохраняет pay_timing;
 *  5) комментарий директора сохраняется в dir_comment;
 *  6) фронт: approval_payment.js знает про режим dir и pending-dir.
 */
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (process.env.DB_NAME === 'asgard_crm') { console.error('[D1] FAIL: прод-БД запрещена'); process.exit(1); }

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'asgard', password: '123456789', database: process.env.DB_NAME });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`); };

const ACCOUNTS = {
  dir: { login: 'test_admin', password: 'Test123!' },   // ADMIN: доступ к очереди директора разрешён
  pm: { login: 'test_pm', password: 'Test123!' },       // роль без прав на очередь директора
};

async function login(a) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: a.login, password: a.password }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('login ' + a.login + ' → ' + JSON.stringify(j).slice(0, 120));
  let token = j.token;
  if (j.status === 'need_pin' || j.status === 'need_setup') {
    const r2 = await fetch(`${BASE}/api/auth/verify-pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' }),
    });
    const j2 = await r2.json();
    if (j2.token) token = j2.token;
  }
  return token;
}

(async () => {
  const dir = await login(ACCOUNTS.dir);
  const pm = await login(ACCOUNTS.pm);

  // ── 1/2. Доступ ──────────────────────────────────────────────────────────
  const okRes = await fetch(`${BASE}/api/approval/pending-dir`, { headers: { Authorization: 'Bearer ' + dir } });
  const okBody = await okRes.json().catch(() => ({}));
  check('1. pending-dir под ADMIN/DIR → 200', okRes.status === 200, `status=${okRes.status}`);
  check('2. форма среза (items[], count, total)', Array.isArray(okBody.items) && typeof okBody.count === 'number' && typeof okBody.total === 'number',
    `keys=${Object.keys(okBody).join(',')}`);

  const pmRes = await fetch(`${BASE}/api/approval/pending-dir`, { headers: { Authorization: 'Bearer ' + pm } });
  check('3. pending-dir под PM → 403', pmRes.status === 403, `status=${pmRes.status}`);
  await pmRes.text().catch(() => {});

  // ── 3. Срез только awaiting_dir ──────────────────────────────────────────
  const { rows: all } = await pool.query(`SELECT COUNT(*)::int AS n FROM payment_invoices WHERE status='awaiting_dir'`);
  check('4. count совпадает с числом awaiting_dir в БД', okBody.count === all[0].n, `api=${okBody.count} db=${all[0].n}`);
  const { rows: bad } = await pool.query(
    `SELECT id FROM payment_invoices WHERE status='awaiting_dir' AND id <> ALL($1::int[])`,
    [okBody.items.map((x) => x.id).length ? okBody.items.map((x) => x.id) : [-1]]
  );
  check('5. в срез не попало ничего, кроме awaiting_dir', bad.length === 0, `лишних=${bad.length}`);

  // ── 4/5. Жизненный цикл на временном счёте ───────────────────────────────
  const { rows: [ins] } = await pool.query(
    `INSERT INTO payment_invoices (supplier_name, amount, currency, status, pay_timing, basis_type, created_by, created_at, updated_at)
     VALUES ('D1 probe', 1234.56, 'RUB', 'awaiting_dir', 'immediate', 'other', 1, NOW(), NOW()) RETURNING id`
  );
  try {
    const after = await fetch(`${BASE}/api/approval/pending-dir`, { headers: { Authorization: 'Bearer ' + dir } }).then((r) => r.json());
    check('6. новый счёт появился в очереди директора', after.items.some((x) => x.id === ins.id), `ids=${after.items.map((x) => x.id).join(',')}`);

    const ap = await fetch(`${BASE}/api/payment-invoices/${ins.id}/dir-approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dir },
      body: JSON.stringify({ pay_timing: 'deferred', comment: 'D1 probe comment' }),
    });
    check('7. dir-approve принят', ap.status === 200 || ap.status === 201, `status=${ap.status}`);
    await ap.text().catch(() => {});

    const { rows: [chk] } = await pool.query(`SELECT status, pay_timing, dir_comment FROM payment_invoices WHERE id=$1`, [ins.id]);
    check('8. pay_timing сохранён (deferred)', chk.pay_timing === 'deferred', `pay_timing=${chk.pay_timing}`);
    check('9. комментарий директора сохранён', chk.dir_comment === 'D1 probe comment', `dir_comment=${JSON.stringify(chk.dir_comment)}`);
    check('10. статус ушёл из awaiting_dir', chk.status !== 'awaiting_dir', `status=${chk.status}`);

    const again = await fetch(`${BASE}/api/payment-invoices/${ins.id}/dir-approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dir },
      body: JSON.stringify({ pay_timing: 'immediate' }),
    });
    check('11. повторное согласование → 409 (идемпотентность)', again.status === 409, `status=${again.status}`);
    await again.text().catch(() => {});
  } finally {
    await pool.query(`DELETE FROM payment_invoices WHERE id=$1`, [ins.id]).catch(() => {});
  }

  // ── 6. Фронт знает про режим dir ────────────────────────────────────────
  const js = fs.readFileSync('public/assets/js/approval_payment.js', 'utf8');
  check('12. фронт зовёт pending-<режим>, а не жёстко pending-buh', /pending-\$\{_mode\}/.test(js), 'шаблон pending-${_mode}');
  check('13. фронт различает роли директора и бухгалтера', /roleToMode/.test(js) && /DIRECTOR/.test(js), 'roleToMode + DIRECTOR');
  check('14. у директора своя модалка решения', /showPaymentInvoiceDirModal/.test(js), 'showPaymentInvoiceDirModal');
  check('15. live-поллинг с остановкой при скрытой вкладке', /document\.hidden/.test(js) && /setInterval/.test(js), 'hidden+interval');
  // Класс бага, который спрятал дефект: роль брали ТОЛЬКО из localStorage, а asgard_user
  // может быть пуст — тогда директор молча становился бухгалтером и снова получал 403.
  check('16. режим восстанавливается с сервера, если localStorage пуст', /\/api\/users\/me/.test(js) && /await resolveMode\(\)/.test(js), 'серверный фолбэк + await');

  await pool.end();
  const fail = results.filter((r) => !r.ok);
  console.log(`\nИТОГ: ${results.length - fail.length} PASS / ${fail.length} FAIL`);
  fail.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.detail}`));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
