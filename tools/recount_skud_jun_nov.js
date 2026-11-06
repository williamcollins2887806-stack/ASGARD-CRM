#!/usr/bin/env node
/**
 * Перезаливка отчётов СКУД июль–ноябрь (июньских файлов на диске нет).
 * Запуск на проде: node tools/recount_skud_jun_nov.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

process.chdir('/var/www/asgard-crm');
const skudImport = require('/var/www/asgard-crm/src/services/skud-import');

const FILES = [
  // Абсолютные пути тоже ок — ниже path.resolve не ломает абсолют.
  'uploads/mail/2026-11-05/01ae7494-bc0c-4fd9-b92d-2927124db9fc/события 01.07-31.07.xls',
  'uploads/mail/2026-11-05/01ae7494-bc0c-4fd9-b92d-2927124db9fc/события 01.08-31.08.xls',
  'uploads/mail/2026-11-05/01ae7494-bc0c-4fd9-b92d-2927124db9fc/события 01.09-30.09.xls',
  'uploads/mail/2026-11-05/01ae7494-bc0c-4fd9-b92d-2927124db9fc/события 01.10-31.10.xls',
  // Неделя 26.10–01.11 (копия sha256=b4b5421e…, лежит в /tmp после прошлой сессии).
  // Июня на диске нет — в SPAN его не будет.
  '/tmp/skud-week.xls'
];

async function softDeleteAllLive(db) {
  const { rows } = await db.query(
    `SELECT id, file_name, period_from::text, period_to::text
       FROM skud_imports WHERE deleted_at IS NULL ORDER BY id`
  );
  for (const r of rows) {
    const res = await skudImport.revertImport(db, r.id, null);
    console.log('reverted', r.id, r.file_name, r.period_from, '→', r.period_to, res);
  }
  return rows.length;
}

(async () => {
  const pool = new Pool({
    connectionString: 'postgresql://asgard:123456789@127.0.0.1/asgard_crm'
  });
  const db = { query: (...a) => pool.query(...a), pool };

  console.log('=== soft-delete live imports ===');
  await softDeleteAllLive(db);

  // Тестовая строка staff без users — гасим, чтобы не всплывала до выкатки фильтра
  const hide = await db.query(
    `UPDATE staff SET is_active = false, updated_at = NOW()
      WHERE id = 287 AND name ILIKE '%тест%'
      RETURNING id, name`
  );
  console.log('deactivated test staff', hide.rows);

  for (const rel of FILES) {
    const full = path.isAbsolute(rel) ? rel : path.join('/var/www/asgard-crm', rel);
    if (!fs.existsSync(full)) {
      console.error('MISSING', full);
      continue;
    }
    const buf = fs.readFileSync(full);
    const name = rel === '/tmp/skud-week.xls' ? 'события 26.10-01.11.xls' : path.basename(full);
    console.log('importing', name, 'bytes', buf.length);
    try {
      const res = await skudImport.importSkudReport(db, {
        buffer: buf,
        filename: name,
        source: 'mail',
        emailId: null
      });
      if (res.skipped) {
        console.log('SKIP', name, res.skipped, res.message || '');
      } else {
        console.log('OK', name, res.periodFrom, '→', res.periodTo,
          'people', res.people, 'mapped', res.peopleMapped,
          'days', res.daysWritten, 'unmatched', (res.unmatched || []).length,
          'replaced', JSON.stringify(res.replaced || null));
      }
    } catch (e) {
      console.error('FAIL', name, e.message);
    }
  }

  const { rows: span } = await db.query(
    `SELECT MIN(date)::text AS min_d, MAX(date)::text AS max_d, COUNT(*)::int AS punches
       FROM skud_punches sp
       JOIN skud_imports si ON si.id = sp.import_id AND si.deleted_at IS NULL`
  );
  const { rows: live } = await db.query(
    `SELECT id, file_name, period_from::text, period_to::text
       FROM skud_imports WHERE deleted_at IS NULL ORDER BY period_from, id`
  );
  console.log('LIVE', live);
  console.log('SPAN', span[0]);

  // Прочие (skip / без staff)
  const { rows: extras } = await db.query(
    `SELECT sp.raw_person, COUNT(DISTINCT sp.date)::int AS days
       FROM skud_punches sp
       JOIN skud_imports si ON si.id = sp.import_id AND si.deleted_at IS NULL
      WHERE NOT EXISTS (
              SELECT 1 FROM skud_person_map m
               WHERE m.raw_name = sp.raw_person AND m.staff_id IS NOT NULL AND m.matched_by <> 'skip'
            )
      GROUP BY sp.raw_person ORDER BY days DESC`
  );
  console.log('EXTRAS', extras);

  await pool.end();
  console.log('DONE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
