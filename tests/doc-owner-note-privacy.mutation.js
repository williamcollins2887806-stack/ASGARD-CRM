'use strict';

/**
 * D-306c: НЕГАТИВНЫЙ КОНТРОЛЬ приватности подписей — на уровне SQL.
 * ═══════════════════════════════════════════════════════════════════════════
 * Зачем: тест `doc-owner-note-privacy.runtime.js` зелёный. Но зелёный тест
 * ничего не доказывает, пока не показано, что на ДЕФЕКТНОМ коде он падает.
 *
 * Первая версия этого контроля поднимала сервер с испорченным исходником и
 * ловила 500 — но 500 приходил не от утечки, а от сломанного вывода типа
 * параметра (`could not determine data type of parameter $1`). Такой контроль
 * доказывал бы ошибку, а не утечку. Поэтому здесь проверка детерминированная:
 * гоняем РЕАЛЬНУЮ форму запроса `/owner-notes` в двух вариантах —
 *   • С фильтром автора (как в коде) — обязан разделять A и B;
 *   • БЕЗ фильтра автора (дефект) — обязан показать B чужую подпись.
 * Если второй вариант НЕ утекает, значит фильтр не является тем, что защищает,
 * и тест приватности — пустая лампочка.
 *
 * Запуск: node tests/doc-owner-note-privacy.mutation.js
 * Требует: PostgreSQL `asgard_crm_test`, миграции V429 + V430.
 */

const { Client } = require('pg');

const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

// Та же форма, что в GET /owner-notes: $1 — автор (из сессии), $2 — аккаунт.
const sqlOwnerNotes = (withAuthorFilter) => `
  SELECT BTRIM(d.doc_owner_note) AS note, count(*)::int AS n,
         bool_or(d.doc_owner_id = $2) AS same_owner
    FROM doc_registry d
   WHERE d.deleted_at IS NULL
     AND d.doc_owner_note IS NOT NULL AND BTRIM(d.doc_owner_note) <> ''
     ${withAuthorFilter ? 'AND d.doc_owner_note_by = $1' : 'AND (d.doc_owner_note_by = $1 OR TRUE)'}
   GROUP BY 1
   ORDER BY bool_or(d.doc_owner_id = $2) DESC, count(*) DESC, 1
   LIMIT 200`;

(async () => {
  await db.connect();
  console.log('\n=== D-306c негативный контроль (SQL): фильтр автора действительно защищает ===');

  for (const col of ['doc_owner_note', 'doc_owner_note_by']) {
    const c = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='doc_registry' AND column_name=$1`, [col]);
    if (!c.rows.length) { console.error('НЕТ колонки ' + col + ' — примените V429/V430 к клону'); process.exit(1); }
  }
  ok('колонки doc_owner_note и doc_owner_note_by есть');

  // Два «соседа по аккаунту»: A=3471 (Тумаева), B=4698 (АГПЗ).
  const A = 3471, B = 4698;
  const ids = (await db.query(
    `SELECT id FROM doc_registry WHERE deleted_at IS NULL ORDER BY id LIMIT 2`)).rows.map((r) => r.id);
  if (ids.length < 2) { console.error('мало строк в клоне'); process.exit(1); }

  // Подпись A на документе, подпись B на другом — как в реальности.
  await db.query(
    `UPDATE doc_registry SET doc_owner_note='Пираев С.', doc_owner_note_by=$2 WHERE id=$1`, [ids[0], A]);
  await db.query(
    `UPDATE doc_registry SET doc_owner_note='Михайлушкин А.', doc_owner_note_by=$2 WHERE id=$1`, [ids[1], B]);

  // ── С фильтром автора (как в коде) ──
  const forA = (await db.query(sqlOwnerNotes(true), [A, 4698])).rows.map((r) => r.note);
  const forB = (await db.query(sqlOwnerNotes(true), [B, 4698])).rows.map((r) => r.note);

  if (forA.includes('Пираев С.')) ok('с фильтром: A видит свою подпись');
  else bad('с фильтром: A не видит свою подпись — фильтр сломан');
  if (!forA.includes('Михайлушкин А.')) ok('с фильтром: A НЕ видит подпись B');
  else bad('с фильтром: A видит подпись B — утечка');
  if (!forB.includes('Пираев С.')) ok('с фильтром: B НЕ видит подпись A');
  else bad('с фильтром: B видит подпись A — утечка');

  // ── БЕЗ фильтра автора (дефект) — здесь утечка ОБЯЗАНА появиться ──
  const leakA = (await db.query(sqlOwnerNotes(false), [A, 4698])).rows.map((r) => r.note);
  const leakB = (await db.query(sqlOwnerNotes(false), [B, 4698])).rows.map((r) => r.note);

  if (leakA.includes('Михайлушкин А.')) ok('контроль: без фильтра A ВИДИТ подпись B (дефект воспроизводится)');
  else bad('контроль: без фильтра утечки нет — значит фильтр автора ни при чём, тест приватности ничего не доказывает');
  if (leakB.includes('Пираев С.')) ok('контроль: без фильтра B ВИДИТ подпись A (дефект воспроизводится)');
  else bad('контроль: без фильтра B не видит подпись A — контроль несостоятелен');

  // ── Фильтр в реестре (?owner_note=) тоже должен быть привязан к автору ──
  const listSql = (withAuthor) => `
    SELECT count(*)::int n FROM doc_registry d
     WHERE d.deleted_at IS NULL
       AND lower(BTRIM(COALESCE(d.doc_owner_note,''))) = ANY($1::text[])
       ${withAuthor ? 'AND d.doc_owner_note_by = $2' : ''}`;
  const asB = (await db.query(listSql(true), [['пираев с.'], B])).rows[0].n;
  const asBNoAuth = (await db.query(listSql(false), [['пираев с.']])).rows[0].n;
  if (asB === 0) ok('фильтр реестра: B по чужой подписи получает 0 строк');
  else bad('фильтр реестра: B получил ' + asB + ' строк по чужой подписи');
  if (asBNoAuth >= 1) ok('контроль: без привязки к автору фильтр реестра отдаёт чужую строку');
  else bad('контроль: без привязки к автору строка не находится — проверка несостоятельна');

  // уборка
  await db.query(`UPDATE doc_registry SET doc_owner_note=NULL, doc_owner_note_by=NULL WHERE id = ANY($1::int[])`, [ids]);
  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERR', e.message); if (db) await db.end().catch(() => {}); process.exit(1); });
