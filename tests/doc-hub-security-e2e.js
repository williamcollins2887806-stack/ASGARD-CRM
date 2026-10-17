'use strict';
/**
 * E2E: безопасность реестра документов (S1–S5 верификатора 16.10.2026).
 * Клон БД asgard_crm_test, приложение-двойник :3100.
 *
 * Покрывает:
 *   S1 — scope=all не обходит матрицу (не-привилегированные видят только своё);
 *   S2 — IDOR: чужая строка недоступна ни в GET /:id, ни в /:id/* (6 ручек);
 *   S3 — upload отклоняет исполняемые типы (.html/.svg);
 *   S4 — текстовые поля санитайзятся (нет HTML-тегов);
 *   S5 — гонка: два одновременных dir-approve → ровно один успех.
 *
 * Запуск: node tests/doc-hub-security-e2e.js   (нужен :3100 на клоне)
 */
const { Pool } = require('pg');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Ждём подъёма двойника
  let up = false;
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) { up = true; break; } } catch (_) {}
    await sleep(2000);
  }
  if (!up) { console.error('НЕТ :3100 — подними двойник: DB_NAME=asgard_crm_test PORT=3100 node src/index.js'); process.exit(2); }

  const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });

  const login = async (l, p) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
    const d = await r.json(); let t = d.token;
    if (d.status === 'need_pin') {
      for (const pin of ['0000', '1234']) {
        const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
        const d2 = await r2.json(); if (d2.token) { t = d2.token; break; }
      }
    }
    return t;
  };
  const call = async (token, method, url, body) => {
    const u = url.startsWith('/api') ? url : '/api' + url;
    const r = await fetch(BASE + u, {
      method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: body ? JSON.stringify(body) : undefined
    });
    let d = null; try { d = await r.json(); } catch (_) {}
    return { st: r.status, d };
  };

  const P = 'Test123!';
  const tokens = {};
  for (const [role, loginName] of [
    ['ADMIN', 'test_admin'], ['BUH', 'test_buh'], ['PM', 'test_pm'], ['HEAD_PM', 'test_head_pm'],
    ['TO', 'test_to'], ['HEAD_TO', 'test_head_to'], ['PROC', 'test_proc'],
    ['WAREHOUSE', 'test_warehouse'], ['OFFICE_MANAGER', 'test_office_manager'], ['DIRECTOR_COMM', 'test_director_comm']
  ]) { tokens[role] = await login(loginName, P); }

  // ── Фикстуры: своя строка и чужая ────────────────────────────────────
  const users = (await db.query(
    `SELECT u.id, u.role FROM users u WHERE u.role IN ('PM','PROC','TO','WAREHOUSE') AND u.is_active=true ORDER BY u.id LIMIT 4`
  )).rows;
  const ownerPm = users.find((u) => u.role === 'PM') || users[0];
  const stranger = users.find((u) => u.id !== ownerPm.id) || users[1];
  // Владелец-админ: ADMIN по умолчанию (scope=mine) видит только СВОИ строки —
  // для PUT/upload нужна строка, где doc_owner_id = admin.
  const adminUser = (await db.query(`SELECT id FROM users WHERE login='test_admin'`)).rows[0];

  async function createDoc(fields) {
    const cols = Object.keys(fields);
    const vals = Object.values(fields);
    const ph = cols.map((_, i) => '$' + (i + 1));
    const { rows } = await db.query(
      `INSERT INTO doc_registry (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING id`, vals);
    return rows[0].id;
  }

  const ownId = await createDoc({ dir: 'in', counterparty_name: 'E2E-SEC-OWN', amount_gross: 1000, doc_owner_id: adminUser.id, invoice_number: 'E2E-SEC-1', invoice_date: '2026-09-01' });
  const foreignId = await createDoc({ dir: 'in', counterparty_name: 'E2E-SEC-FOREIGN', amount_gross: 2000, doc_owner_id: stranger.id, invoice_number: 'E2E-SEC-2', invoice_date: '2026-09-01', spend_kind: 'office' });
  const cleanup = [ownId, foreignId];

  console.log('\n=== S1: scope=all не обходит матрицу ===');
  {
    // PM со scope=all НЕ должен видеть строку чужого владельца (office, чужой doc_owner).
    const r = await call(tokens.PM, 'GET', '/doc-registry?scope=all&limit=200');
    const ids = (r.d.items || []).map((x) => x.id);
    ok('PM scope=all не видит чужую строку', !ids.includes(foreignId), 'st=' + r.st);
    // Привилегированный (BUH) со scope=all — видит. Ищем по ВСЕМ страницам:
    // limit=200 мог не вместить свежую строку (в клоне >200 записей) → флейк.
    const idsB = [];
    for (let page = 1; page <= 10; page++) {
      const rb = await call(tokens.BUH, 'GET', `/doc-registry?scope=all&limit=200&page=${page}`);
      const chunk = (rb.d.items || []).map((x) => x.id);
      idsB.push(...chunk);
      if (chunk.length < 200 || idsB.includes(foreignId)) break;
    }
    ok('BUH scope=all видит чужую строку', idsB.includes(foreignId));
    // WAREHOUSE не должен падать (42883) и не видит office-строку.
    const rw = await call(tokens.WAREHOUSE, 'GET', '/doc-registry?limit=200');
    ok('WAREHOUSE не 500', rw.st === 200, 'st=' + rw.st);
    const rwAll = await call(tokens.WAREHOUSE, 'GET', '/doc-registry?scope=all&limit=200');
    ok('WAREHOUSE scope=all не 500', rwAll.st === 200, 'st=' + rwAll.st);
    ok('WAREHOUSE не видит office-строку', !((rwAll.d.items || []).map((x) => x.id).includes(foreignId)));
    const rwk = await call(tokens.WAREHOUSE, 'GET', '/doc-registry/kpi');
    ok('WAREHOUSE /kpi не 500', rwk.st === 200, 'st=' + rwk.st);
    const rwe = await call(tokens.WAREHOUSE, 'GET', '/doc-registry/export-xlsx');
    ok('WAREHOUSE /export-xlsx не 500', rwe.st === 200 || rwe.st === 200, 'st=' + rwe.st);
  }

  console.log('\n=== S1b: привилегированный открывает карточку, которую видит в списке ===');
  {
    const rb = await call(tokens.ADMIN, 'GET', '/doc-registry?scope=all&limit=200');
    const seen = (rb.d.items || []).map((x) => x.id);
    const target = seen.find((x) => x !== ownId) || foreignId;
    const card = await call(tokens.ADMIN, 'GET', '/doc-registry/' + target);
    ok('ADMIN открывает видимую строку (200)', card.st === 200, 'id=' + target + ' st=' + card.st);
    const q = await call(tokens.ADMIN, 'POST', '/doc-registry/' + target + '/quick', { action: 'due', payment_due_at: '2026-12-31' });
    ok('ADMIN quick по видимой строке (200)', q.st === 200, 'st=' + q.st);
  }

  console.log('\n=== S2c: write-IDOR в import-1c закрыт ===');
  {
    const before = (await db.query('SELECT onec_id FROM doc_registry WHERE id=$1', [foreignId])).rows[0];
    const r = await call(tokens.PM, 'POST', '/doc-registry/import-1c', { rows: [{ id: foreignId, onec_id: 'E2E-IDOR-PROBE' }] });
    const after = (await db.query('SELECT onec_id FROM doc_registry WHERE id=$1', [foreignId])).rows[0];
    ok('import-1c не меняет чужую строку', (before.onec_id || null) === (after.onec_id || null), 'before=' + before.onec_id + ' after=' + after.onec_id + ' st=' + r.st);
    const items = (r.d && r.d.items) || [];
    ok('import-1c пометил forbidden/unmatched', items.some((x) => x.status === 'forbidden' || x.status === 'unmatched'), JSON.stringify(items));
  }

  console.log('\n=== S2d: excel/apply только привилегированным ===');
  {
    const r = await call(tokens.PM, 'POST', '/doc-registry/excel/apply', { rows: [{ dir: 'in', counterparty_name: 'E2E-EXCEL', amount_gross: 1, invoice_number: 'E2E-X', invoice_date: '2026-09-01' }] });
    ok('PM excel/apply → 403', r.st === 403, 'st=' + r.st);
  }

  console.log('\n=== S2: IDOR — чужая строка недоступна (6 ручек) ===');
  {
    const foreignOwnerLogin = { PM: 'test_pm', PROC: 'test_proc', TO: 'test_to' }[stranger.role];
    // Берём токен роли, которая ТОЧНО не владелец foreign-строки.
    let attackerTok = tokens.PM;
    if (stranger.role === 'PM' && ownerPm.role === 'PM') attackerTok = tokens.TO; // TO не владелец
    if (stranger.id === ownerPm.id) attackerTok = tokens.WAREHOUSE;

    const g = await call(attackerTok, 'GET', '/doc-registry/' + foreignId);
    ok('GET /:id чужой → 404', g.st === 404, 'st=' + g.st);
    const q = await call(attackerTok, 'POST', '/doc-registry/' + foreignId + '/quick', { action: 'due', payment_due_at: '2026-12-01' });
    ok('POST /:id/quick чужой → 404', q.st === 404, 'st=' + q.st);
    const u = await call(attackerTok, 'PUT', '/doc-registry/' + foreignId, { comment_text: 'hack' });
    ok('PUT /:id чужой → 404', u.st === 404, 'st=' + u.st);
    const d = await call(attackerTok, 'DELETE', '/doc-registry/' + foreignId);
    ok('DELETE /:id чужой → 404', d.st === 404, 'st=' + d.st);
    const pc = await call(attackerTok, 'POST', '/doc-registry/' + foreignId + '/parse-catalog', {});
    ok('POST /:id/parse-catalog чужой → 404', pc.st === 404, 'st=' + pc.st);
    const le = await call(attackerTok, 'POST', '/doc-registry/' + foreignId + '/link-expense', {});
    ok('POST /:id/link-expense чужой → 404', le.st === 404, 'st=' + le.st);
  }

  console.log('\n=== S2b: export-1c уважает видимость ===');
  {
    const r = await call(tokens.PM, 'POST', '/doc-registry/export-1c', { ids: [foreignId] });
    const csv = (r.d && r.d.csv) || '';
    ok('PM export-1c не отдаёт чужую строку', !csv.includes('E2E-SEC-FOREIGN'), 'count=' + (r.d && r.d.count));
  }

  console.log('\n=== S4: санитайз текстовых полей (XSS) ===');
  {
    const xssId = await createDoc({ dir: 'in', counterparty_name: 'E2E-XSS', amount_gross: 100, doc_owner_id: adminUser.id, invoice_number: 'E2E-XSS-1', invoice_date: '2026-09-01' });
    cleanup.push(xssId);
    const put = await call(tokens.ADMIN, 'PUT', '/doc-registry/' + xssId, { comment_text: '<img src=x onerror=alert(1)>привет<script>bad()</script>' });
    ok('PUT с XSS принят (200)', put.st === 200, 'st=' + put.st);
    const row = (await db.query('SELECT comment_text FROM doc_registry WHERE id=$1', [xssId])).rows[0];
    ok('comment_text не пустой', !!row.comment_text, JSON.stringify(row.comment_text));
    ok('comment_text без HTML-тегов', !/[<>]/.test(row.comment_text || ''), JSON.stringify(row.comment_text));
    ok('comment_text сохранил текст', (row.comment_text || '').includes('привет'));
  }

  console.log('\n=== S3: upload отклоняет исполняемые типы ===');
  {
    // multipart с .html + text/html → должен быть 400
    const boundary = '----e2esec' + Date.now();
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.html"\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script>\r\n--${boundary}--\r\n`
    );
    const r = await fetch(BASE + '/api/doc-registry/' + ownId + '/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tokens.ADMIN, 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body
    });
    ok('upload .html отклонён', r.status === 400, 'st=' + r.status);
    // .json должен приниматься (UI рекламирует) — иначе ломается quick_pay.
    const bnd2 = '----e2esecjson' + Date.now();
    const body2 = Buffer.from(
      `--${bnd2}\r\nContent-Disposition: form-data; name="file"; filename="catalog.json"\r\nContent-Type: application/json\r\n\r\n{"a":1}\r\n--${bnd2}--\r\n`
    );
    const r2 = await fetch(BASE + '/api/doc-registry/' + ownId + '/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tokens.ADMIN, 'Content-Type': 'multipart/form-data; boundary=' + bnd2 },
      body: body2
    });
    ok('upload .json принят', r2.status === 200, 'st=' + r2.status);
  }

  console.log('\n=== S5: гонка согласования (ровно один успех) ===');
  {
    const emp = (await db.query('SELECT id FROM users WHERE role=$1 LIMIT 1', ['PM'])).rows[0];
    const payIns = await db.query(
      `INSERT INTO payment_invoices (status, supplier_name, amount, basis_text, created_by, created_at)
       VALUES ('awaiting_dir', 'E2E-RACE-SUP', 5000, 'e2e race', $1, NOW()) RETURNING id`, [emp.id]);
    const pid = payIns.rows[0].id;
    try {
      const [a, b2] = await Promise.all([
        call(tokens.DIRECTOR_COMM, 'POST', '/payment-invoices/' + pid + '/dir-approve', {}),
        call(tokens.DIRECTOR_COMM, 'POST', '/payment-invoices/' + pid + '/dir-approve', {})
      ]);
      // Успех = применённое решение; already — идемпотентный повтор (не второй «успех»).
      const okCount = [a, b2].filter((x) => x.st === 200 && x.d && x.d.ok && !x.d.already).length;
      const alreadyCount = [a, b2].filter((x) => x.d && x.d.already).length;
      ok('ровно один успех согласования', okCount === 1, 'ok=' + okCount + ' st=' + a.st + '/' + b2.st + ' already=' + alreadyCount);
      const row = (await db.query('SELECT status FROM payment_invoices WHERE id=$1', [pid])).rows[0];
      ok('статус после гонки = pending_payment', row.status === 'pending_payment', row.status);
    } finally {
      await db.query('DELETE FROM payment_invoices WHERE id=$1', [pid]);
    }
  }

  // ── Уборка ───────────────────────────────────────────────────────────
  for (const id of cleanup) { try { await db.query('DELETE FROM doc_registry WHERE id=$1', [id]); } catch (_) {} }
  await db.end();

  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ: PASS ${pass} / FAIL ${fail}`);
  if (fail) { console.log('FAIL: ' + fails.join(' | ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
