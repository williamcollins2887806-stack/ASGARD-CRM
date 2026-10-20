'use strict';

/**
 * D-306c: приватность подписей под-ответственных.
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик 20.10.2026: «эти фильтры другие не должны видеть — только внутри
 * аккаунта, только пользователь их видит».
 *
 * Проверяем на клоне (:3101), что на ОДНОМ аккаунте два пользователя
 * не видят подписи друг друга:
 *   1. A ставит подпись на документ аккаунта X;
 *   2. A видит её в /owner-notes и фильтром `owner_note`;
 *   3. B (тот же аккаунт X) НЕ видит её в /owner-notes;
 *   4. B не находит строку фильтром `owner_note` (чужая подпись не работает);
 *   5. в карточке документа B получает `doc_owner_note = null`, A — своё значение;
 *   6. `doc_owner_note_by` не уходит на фронт вовсе (не раскрываем автора);
 *   7. B не может «присвоить» чужую подпись, отправив `doc_owner_note_by`
 *      в теле запроса (автор берётся только из сессии).
 *
 * Требует: приложение на :3101 (БД asgard_crm_test).
 * Запуск: $env:JWT_SECRET='asgard-jwt-secret-2026'; node tests/doc-owner-note-privacy.runtime.js
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

(async () => {
  await db.connect();
  console.log('\n=== D-306c: приватность подписей под-ответственных ===');

  // Колонка должна быть (миграция V430).
  const col = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name='doc_registry' AND column_name='doc_owner_note_by'`);
  if (!col.rows.length) {
    console.error('НЕТ колонки doc_owner_note_by — примените migrations/V430__doc_owner_note_privacy.sql к клону');
    process.exit(1);
  }
  ok('колонка doc_owner_note_by есть в клоне');

  // Два офис-менеджера на ОДНОМ аккаунте АГПЗ (как 4 человека в реальности).
  const A = await mint(3471);  // Тумаева
  const B = await mint(4698);  // АГПЗ (офис) — тот же тип роли, «сосед по аккаунту»

  const doc = (await db.query(
    `SELECT id, doc_owner_id FROM doc_registry
      WHERE deleted_at IS NULL AND doc_owner_id = 4698 ORDER BY id LIMIT 1`)).rows[0];
  if (!doc) { console.error('нет документа АГПЗ для теста'); process.exit(1); }

  // Чистим перед тестом.
  await db.query(`UPDATE doc_registry SET doc_owner_note=NULL, doc_owner_note_by=NULL WHERE id=$1`, [doc.id]);

  // ── 1. A ставит подпись ──
  const put = await fetch(`${BASE}/api/doc-registry/${doc.id}`, {
    method: 'PUT', headers: H(A.token),
    body: JSON.stringify({ doc_owner_note: 'Пираев С.' })
  });
  if (put.status !== 200) { bad('A не смог поставить подпись, status=' + put.status); }
  else {
    const row = (await db.query('SELECT doc_owner_note, doc_owner_note_by FROM doc_registry WHERE id=$1', [doc.id])).rows[0];
    if (row.doc_owner_note === 'Пираев С.' && Number(row.doc_owner_note_by) === A.u.id) {
      ok('A поставил подпись, автор проставлен из сессии');
    } else bad('подпись/автор не сохранились: ' + JSON.stringify(row));
  }

  // ── 2. A видит подсказку и фильтрует ──
  const notesA = await (await fetch(`${BASE}/api/doc-registry/owner-notes?doc_owner_id=4698`, { headers: H(A.token) })).json();
  if ((notesA.notes || []).some((n) => n.note === 'Пираев С.')) ok('A видит свою подпись в подсказках');
  else bad('A не видит свою подпись: ' + JSON.stringify(notesA));

  const fA = await (await fetch(`${BASE}/api/doc-registry?limit=50&scope=all&owner_note=${encodeURIComponent('Пираев С.')}`, { headers: H(A.token) })).json();
  if (fA.total >= 1 && fA.items.some((x) => x.id === doc.id)) ok(`A фильтрует по своей подписи (найдено ${fA.total})`);
  else bad('A не нашёл свою строку фильтром: total=' + fA.total);

  // ── 3. B НЕ видит чужую подпись в подсказках ──
  const notesB = await (await fetch(`${BASE}/api/doc-registry/owner-notes?doc_owner_id=4698`, { headers: H(B.token) })).json();
  if (!(notesB.notes || []).some((n) => n.note === 'Пираев С.')) ok('B НЕ видит чужую подпись в подсказках');
  else bad('УТЕЧКА: B видит чужую подпись: ' + JSON.stringify(notesB));

  // ── 4. B не может отфильтровать по чужой подписи ──
  const fB = await (await fetch(`${BASE}/api/doc-registry?limit=50&scope=all&owner_note=${encodeURIComponent('Пираев С.')}`, { headers: H(B.token) })).json();
  const leaked = (fB.items || []).some((x) => x.id === doc.id);
  if (!leaked) ok('B фильтром по чужой подписи строку не получает');
  else bad('УТЕЧКА: B нашёл чужую строку фильтром');

  // ── 5. карточка: A видит своё, B — null ──
  const getA = await (await fetch(`${BASE}/api/doc-registry/${doc.id}`, { headers: H(A.token) })).json();
  if (getA.doc_owner_note === 'Пираев С.') ok('A видит свою подпись в карточке');
  else bad('A не видит свою подпись в карточке: ' + JSON.stringify(getA.doc_owner_note));

  const getB = await (await fetch(`${BASE}/api/doc-registry/${doc.id}`, { headers: H(B.token) })).json();
  if (getB.doc_owner_note == null) ok('B в карточке не видит чужую подпись (null)');
  else bad('УТЕЧКА в карточке: B видит ' + JSON.stringify(getB.doc_owner_note));

  // ── 6. автор не уходит на фронт ──
  if (getA.doc_owner_note_by === undefined && getB.doc_owner_note_by === undefined) ok('doc_owner_note_by не отдаётся на фронт');
  else bad('автор подписи утёк на фронт');

  // ── 7. B не может присвоить чужую подпись через тело запроса ──
  const take = await fetch(`${BASE}/api/doc-registry/${doc.id}`, {
    method: 'PUT', headers: H(B.token),
    body: JSON.stringify({ doc_owner_note_by: A.u.id, comment_text: `${getB.comment_text || ''} `.trim() })
  });
  const after = (await db.query('SELECT doc_owner_note_by FROM doc_registry WHERE id=$1', [doc.id])).rows[0];
  if (take.status === 200 && Number(after.doc_owner_note_by) === A.u.id) ok('B не может подменить автора через тело запроса');
  else bad('автора удалось подменить из тела: ' + JSON.stringify(after));

  // ── 8. B перезаписывает подпись → становится её автором и видит её ──
  const putB = await fetch(`${BASE}/api/doc-registry/${doc.id}`, {
    method: 'PUT', headers: H(B.token),
    body: JSON.stringify({ doc_owner_note: 'Михайлушкин А.' })
  });
  const rowB = (await db.query('SELECT doc_owner_note, doc_owner_note_by FROM doc_registry WHERE id=$1', [doc.id])).rows[0];
  const notesB2 = await (await fetch(`${BASE}/api/doc-registry/owner-notes?doc_owner_id=4698`, { headers: H(B.token) })).json();
  const notesA2 = await (await fetch(`${BASE}/api/doc-registry/owner-notes?doc_owner_id=4698`, { headers: H(A.token) })).json();
  if (putB.status === 200 && Number(rowB.doc_owner_note_by) === B.u.id) ok('B перезаписал подпись — автором стал B');
  else bad('после перезаписи автором остался не B: ' + JSON.stringify(rowB));
  if ((notesB2.notes || []).some((n) => n.note === 'Михайлушкин А.')) ok('B видит свою новую подпись');
  else bad('B не видит свою новую подпись');
  if (!(notesA2.notes || []).some((n) => n.note === 'Михайлушкин А.')) ok('A не видит подпись, которую вписал B');
  else bad('УТЕЧКА: A видит новую подпись B');

  // ── 9. не-подписанная правка не крадёт автора (решено: если подпись не меняли) ──
  await db.query(`UPDATE doc_registry SET doc_owner_note='Пираев С.', doc_owner_note_by=$2 WHERE id=$1`, [doc.id, A.u.id]);
  await fetch(`${BASE}/api/doc-registry/${doc.id}`, {
    method: 'PUT', headers: H(B.token),
    body: JSON.stringify({ comment_text: 'правка суммы без смены подписи' })
  });
  const keep = (await db.query('SELECT doc_owner_note_by FROM doc_registry WHERE id=$1', [doc.id])).rows[0];
  if (Number(keep.doc_owner_note_by) === A.u.id) ok('правка без смены подписи не отбирает авторство у A');
  else bad('авторство перешло к B при правке без смены подписи');

  // уборка
  await db.query(`UPDATE doc_registry SET doc_owner_note=NULL, doc_owner_note_by=NULL WHERE id=$1`, [doc.id]);
  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERR', e.message); if (db) await db.end().catch(() => {}); process.exit(1); });
