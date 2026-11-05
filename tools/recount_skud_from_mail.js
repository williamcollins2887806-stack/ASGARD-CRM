#!/usr/bin/env node
/**
 * Перезаливка отчётов СКУД с диска (вложения с почты) новым парсером.
 * 1) soft-delete живых импортов + чистка punches/hours/флагов как revert
 * 2) import каждого .xls заново
 *
 * Запуск на проде: node tools/recount_skud_from_mail.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
process.chdir('/var/www/asgard-crm');

const skudImport = require('/var/www/asgard-crm/src/services/skud-import');

const FILES = [
  'uploads/mail/2026-11-05/01ae7494-bc0c-4fd9-b92d-2927124db9fc/события 01.07-31.07.xls',
  'uploads/mail/2026-11-05/01ae7494-bc0c-4fd9-b92d-2927124db9fc/события 01.08-31.08.xls',
  'uploads/mail/2026-11-05/01ae7494-bc0c-4fd9-b92d-2927124db9fc/события 01.09-30.09.xls',
  'uploads/mail/2026-11-05/01ae7494-bc0c-4fd9-b92d-2927124db9fc/события 01.10-31.10.xls'
];

async function softDeleteAllLive(db) {
  const { rows } = await db.query(
    `SELECT id FROM skud_imports WHERE deleted_at IS NULL ORDER BY id`
  );
  const out = [];
  for (const r of rows) {
    const res = await skudImport.revertImport(db, r.id, null);
    out.push(res);
    console.log('reverted import', r.id, res.periodFrom, '→', res.periodTo);
  }
  return out;
}

async function sampleAndrosov(db, label) {
  const { rows } = await db.query(
    `SELECT oh.date::text, oh.office_minutes
       FROM office_hours_daily oh
       JOIN staff s ON s.id = oh.staff_id
      WHERE s.name ILIKE '%Андросов%'
        AND oh.date IN (DATE '2026-10-27', DATE '2026-10-28', DATE '2026-10-29', DATE '2026-10-30')
      ORDER BY oh.date`
  );
  console.log(label, rows);
}

(async () => {
  const pool = new Pool({
    connectionString: 'postgresql://asgard:123456789@127.0.0.1/asgard_crm'
  });
  const db = { query: (...a) => pool.query(...a), pool };

  await sampleAndrosov(db, 'BEFORE');
  await softDeleteAllLive(db);

  for (const rel of FILES) {
    const full = path.join('/var/www/asgard-crm', rel);
    if (!fs.existsSync(full)) {
      console.error('MISSING', full);
      continue;
    }
    const buf = fs.readFileSync(full);
    const name = path.basename(full);
    console.log('importing', name, 'bytes', buf.length);
    try {
      const res = await skudImport.importSkudReport(db, {
        buffer: buf,
        filename: name,
        source: 'mail',
        emailId: 5313
      });
      if (res.skipped) {
        console.log('SKIP', name, res.skipped, res.message);
      } else {
        console.log('OK', name, res.periodFrom, res.periodTo,
          'people', res.people, 'days', res.daysWritten,
          'replaced', res.replaced && res.replaced.overlapped);
      }
    } catch (e) {
      console.error('FAIL', name, e.message);
    }
  }

  // Ноябрь: ищем любой оставшийся недельный файл
  const extra = [
    '/var/www/asgard-crm/uploads',
  ];
  // find sobytiya / 26.10-01.11
  const { execSync } = require('child_process');
  let found = '';
  try {
    found = execSync(
      'find /var/www/asgard-crm/uploads -type f \\( -iname "*26.10*" -o -iname "*01.11*" -o -iname "*sobytiya*" \\) 2>/dev/null | head -20',
      { encoding: 'utf8' }
    );
  } catch (_) {}
  console.log('extra candidates:\n', found);
  for (const line of found.split('\n').map((x) => x.trim()).filter(Boolean)) {
    if (!/\.xls/i.test(line)) continue;
    if (FILES.some((f) => line.endsWith(path.basename(f)))) continue;
    const buf = fs.readFileSync(line);
    const name = path.basename(line);
    console.log('importing extra', name);
    try {
      const res = await skudImport.importSkudReport(db, {
        buffer: buf, filename: name, source: 'manual'
      });
      console.log(res.skipped ? ('SKIP ' + res.skipped) : ('OK ' + res.periodFrom + ' ' + res.periodTo + ' days ' + res.daysWritten));
    } catch (e) {
      console.error('FAIL extra', name, e.message);
    }
  }

  await sampleAndrosov(db, 'AFTER');
  const { rows: imps } = await pool.query(
    `SELECT id, period_from::text, period_to::text, file_name FROM skud_imports WHERE deleted_at IS NULL ORDER BY period_from`
  );
  console.log('LIVE IMPORTS', imps);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
