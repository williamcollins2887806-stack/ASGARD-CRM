'use strict';

/**
 * D-316: черновики и подтверждение отправки счетов (клон :3101).
 * ═══════════════════════════════════════════════════════════════════════════
 * Жалоба заказчика: «почему я закрыл и вышел, а счета ушли директору без
 * подтверждения».
 *
 * Проверяем ровно это:
 *   1. Создание счёта НЕ отправляет письмо директору (status='draft');
 *   2. Директор не получает уведомление на черновик;
 *   3. Черновик правится (PATCH) — сумма/поставщик реально меняются в БД;
 *   4. Черновик виден в «Мои черновики»;
 *   5. Черновик удаляется;
 *   6. Явная отправка (/submit) переводит в awaiting_dir и только ТОГДА письмо;
 *   7. Отправленный счёт PATCH/DELETE не даёт (нельзя переписать согласованное);
 *   8. Чужой черновик не отправить и не удалить.
 *
 * Требует: приложение на :3101 (БД asgard_crm_test), миграция V431.
 */

const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const BASE = process.env.DH_BASE || 'http://127.0.0.1:3101';
const SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';
const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

async function mint(id) {
  const u = (await db.query('SELECT id, login, name, role FROM users WHERE id=$1', [id])).rows[0];
  return { u, token: jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' }) };
}
const H = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

// Минимальный валидный файл-заглушка (сервер проверяет только путь/имя).
async function uploadStub(token, name) {
  const fd = new FormData();
  const blob = new Blob([Buffer.from('%PDF-1.4\n% stub\n')], { type: 'application/pdf' });
  fd.append('file', blob, name);
  const r = await fetch(BASE + '/api/payment-invoices/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('upload: ' + (j.error || r.status));
  return j;
}

(async () => {
  await db.connect();
  console.log('\n=== D-316: черновики счетов и подтверждение отправки ===');

  const col = await db.query(`SELECT 1 FROM information_schema.columns
     WHERE table_name='payment_invoices' AND column_name='submitted_at'`);
  if (!col.rows.length) { console.error('НЕТ submitted_at — примените migrations/V431__payment_drafts.sql к клону'); process.exit(1); }
  ok('миграция V431 применена (submitted_at есть)');

  // Инициатор — PROC (может создавать), второй — PM (не должен трогать чужое).
  const proc = (await db.query(`SELECT id FROM users WHERE role='PROC' AND is_active=true ORDER BY id LIMIT 1`)).rows[0];
  const other = (await db.query(`SELECT id FROM users WHERE role='PM' AND is_active=true ORDER BY id LIMIT 1`)).rows[0];
  if (!proc || !other) { console.error('нет подходящих пользователей'); process.exit(1); }
  const A = await mint(proc.id);
  const B = await mint(other.id);

  const dirBefore = (await db.query(
    `SELECT count(*)::int n FROM notifications WHERE user_id IN
       (SELECT id FROM users WHERE role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'))`)).rows[0].n;

  // ── 1. Создание = черновик, без письма ──
  const up = await uploadStub(A.token, 'draft-test.pdf');
  const createRes = await fetch(BASE + '/api/payment-invoices', {
    method: 'POST', headers: H(A.token),
    body: JSON.stringify({
      amount: 12345.67, supplier_name: 'ООО Черновик', basis_type: 'other',
      file_path: up.file_path, file_name: up.file_name, invoice_number: 'ЧК-1'
    })
  });
  const created = await createRes.json();
  if (createRes.status !== 200 && createRes.status !== 201) { bad('создание вернуло ' + createRes.status + ' ' + JSON.stringify(created).slice(0, 120)); }
  const id = created.id;
  const row = id ? (await db.query('SELECT status, submitted_at FROM payment_invoices WHERE id=$1', [id])).rows[0] : null;
  if (row && row.status === 'draft') ok('создан ЧЕРНОВИК (status=draft), не отправлен');
  else bad('создан не черновик: ' + JSON.stringify(row));
  if (row && row.submitted_at == null) ok('submitted_at пуст — директору не уходило');
  else bad('submitted_at заполнен при создании');
  if (created.mail && created.mail.sent === false) ok('mail.sent=false в ответе создания');
  else bad('в ответе создания mail не false: ' + JSON.stringify(created.mail));

  const dirAfter = (await db.query(
    `SELECT count(*)::int n FROM notifications WHERE user_id IN
       (SELECT id FROM users WHERE role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'))`)).rows[0].n;
  if (dirAfter === dirBefore) ok('уведомлений директорам не добавилось');
  else bad(`директора получили ${dirAfter - dirBefore} уведомлений на черновик`);

  // ── 2. Черновик правится ──
  const patch = await fetch(BASE + '/api/payment-invoices/' + id, {
    method: 'PATCH', headers: H(A.token),
    body: JSON.stringify({ amount: 999.99, supplier_name: 'ООО Исправлено', invoice_number: 'ЧК-2' })
  });
  const afterPatch = (await db.query('SELECT amount, supplier_name, invoice_number FROM payment_invoices WHERE id=$1', [id])).rows[0];
  if (patch.status === 200 && Number(afterPatch.amount) === 999.99 && afterPatch.supplier_name === 'ООО Исправлено') {
    ok('PATCH черновика сохраняет правки в БД (раньше был 404 + проглоченная ошибка)');
  } else bad('PATCH не сохранил: ' + patch.status + ' ' + JSON.stringify(afterPatch));

  // ── 3. Виден в «Мои черновики» ──
  const drafts = await (await fetch(BASE + '/api/payment-invoices/drafts', { headers: H(A.token) })).json();
  if ((drafts.items || []).some((d) => Number(d.id) === Number(id))) ok('черновик виден в «Мои черновики»');
  else bad('черновик не найден в списке черновиков');

  // ── 4. Чужой не может ни отправить, ни удалить ──
  const foreignSend = await fetch(BASE + '/api/payment-invoices/submit', {
    method: 'POST', headers: H(B.token), body: JSON.stringify({ ids: [id] })
  });
  const foreignDel = await fetch(BASE + '/api/payment-invoices/' + id, { method: 'DELETE', headers: H(B.token) });
  if (foreignSend.status === 404 || foreignSend.status === 403) ok('чужой черновик не отправить (' + foreignSend.status + ')');
  else bad('чужой черновик отправился: ' + foreignSend.status);
  if (foreignDel.status === 403 || foreignDel.status === 404) ok('чужой черновик не удалить (' + foreignDel.status + ')');
  else bad('чужой черновик удалился: ' + foreignDel.status);

  // ── 5. Явная отправка ──
  const dirBefore2 = (await db.query(
    `SELECT count(*)::int n FROM notifications WHERE user_id IN
       (SELECT id FROM users WHERE role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'))`)).rows[0].n;
  const sub = await fetch(BASE + '/api/payment-invoices/submit', {
    method: 'POST', headers: H(A.token), body: JSON.stringify({ ids: [id] })
  });
  const subJ = await sub.json();
  const afterSubmit = (await db.query('SELECT status, submitted_at FROM payment_invoices WHERE id=$1', [id])).rows[0];
  if (sub.status === 200 && (subJ.submitted || []).includes(id)) ok('явная отправка приняла черновик');
  else bad('отправка не приняла: ' + sub.status + ' ' + JSON.stringify(subJ).slice(0, 160));
  if (afterSubmit.status === 'awaiting_dir') ok('после отправки status=awaiting_dir');
  else bad('статус после отправки: ' + afterSubmit.status);
  if (afterSubmit.submitted_at) ok('submitted_at проставлен при отправке');
  else bad('submitted_at не проставлен');

  // ── 6. Отправленный нельзя править/удалить ──
  const patchSent = await fetch(BASE + '/api/payment-invoices/' + id, {
    method: 'PATCH', headers: H(A.token), body: JSON.stringify({ amount: 1 })
  });
  const delSent = await fetch(BASE + '/api/payment-invoices/' + id, { method: 'DELETE', headers: H(A.token) });
  if (patchSent.status === 409) ok('отправленный счёт не правится (409) — согласованное не переписать');
  else bad('отправленный счёт правится: ' + patchSent.status);
  if (delSent.status === 409) ok('отправленный счёт не удаляется (409)');
  else bad('отправленный счёт удаляется: ' + delSent.status);

  // ── 7. Удаление черновика ──
  const up2 = await uploadStub(A.token, 'draft-del.pdf');
  const c2 = await (await fetch(BASE + '/api/payment-invoices', {
    method: 'POST', headers: H(A.token),
    body: JSON.stringify({ amount: 10, supplier_name: 'ООО Удалить', basis_type: 'other', file_path: up2.file_path, file_name: up2.file_name })
  })).json();
  const delDraft = await fetch(BASE + '/api/payment-invoices/' + c2.id, { method: 'DELETE', headers: H(A.token) });
  const gone = (await db.query('SELECT count(*)::int n FROM payment_invoices WHERE id=$1', [c2.id])).rows[0].n;
  if (delDraft.status === 200 && gone === 0) ok('черновик удаляется');
  else bad('черновик не удалился: ' + delDraft.status + ' осталось=' + gone);

  // уборка
  await db.query('DELETE FROM payment_invoices WHERE id=$1', [id]);
  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERR', e.message); if (db) await db.end().catch(() => {}); process.exit(1); });
