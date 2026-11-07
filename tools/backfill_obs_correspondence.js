'use strict';

/**
 * tools/backfill_obs_correspondence.js
 *
 * V473: перенести уже созданные письма для ОБС в корреспонденцию.
 *
 * ПОЧЕМУ. До V473 письмо жило только отдельной строкой `doc_registry`
 * (`package_type='letter'`). В реестр переписки оно не попадало вообще: на
 * проде 9 писем в реестре и 0 в `correspondence`. Исходящие номера
 * «терялись» — их искали там, где ищут письма, и не находили.
 *
 * ЧТО ДЕЛАЕТ. Для каждого письма без записи в переписке:
 *   1. создаёт `correspondence` (`direction='outgoing'`, `letter_kind='obs_payment'`,
 *      `signing_status='finalized'`) с ИСТОРИЧЕСКИМ номером — новый не выдаёт;
 *   2. копирует PDF в корень uploads (uuid.pdf) и заводит `documents`
 *      с `correspondence_id` — чтобы вложение открывалось штатным роутом;
 *   3. связывает письмо со счётом: `correspondence.obs_invoice_doc_id`.
 *
 * ИДЕМПОТЕНТНОСТЬ. Повторный прогон пропускает письма, у которых уже есть
 * `obs_invoice_doc_id` в переписке. Ничего не удаляет и не переписывает суммы.
 *
 * ЗАПУСК:
 *   node tools/backfill_obs_correspondence.js            # dry-run (по умолчанию)
 *   node tools/backfill_obs_correspondence.js --apply    # записать
 *   node tools/backfill_obs_correspondence.js --apply --doc 2142,2138
 *
 * Требует переменных окружения как у приложения (DB_*), файл читает через
 * `uploads/doc-hub/obs-letters`.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../src/services/db');

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
const LETTER_DIR = path.join(UPLOAD_ROOT, 'doc-hub', 'obs-letters');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const onlyArg = argv.indexOf('--doc');
const ONLY = onlyArg >= 0 && argv[onlyArg + 1]
  ? argv[onlyArg + 1].split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean)
  : null;

function log(...a) { console.log(...a); }

/** Путь к PDF письма: из attachments[0].url → реальный файл на диске. */
function resolveLetterFile(attachments) {
  let atts = attachments;
  if (typeof atts === 'string') {
    try { atts = JSON.parse(atts); } catch (_) { atts = []; }
  }
  if (!Array.isArray(atts) || !atts.length) return null;
  const first = atts.find((a) => a && (a.url || a.path));
  if (!first) return null;
  let url = String(first.url || first.path);
  try { url = decodeURIComponent(url); } catch (_) { /* как есть */ }
  const base = path.basename(url);
  const full = path.join(LETTER_DIR, base);
  return fs.existsSync(full) ? full : null;
}

function isoDate(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function main() {
  log(`режим: ${APPLY ? 'ЗАПИСЬ (--apply)' : 'dry-run (ничего не меняется)'}`);
  if (ONLY) log('только письма:', ONLY.join(', '));

  const params = [];
  let where = `l.package_type='letter' AND l.deleted_at IS NULL`;
  if (ONLY && ONLY.length) {
    params.push(ONLY);
    where += ` AND l.id = ANY($${params.length}::int[])`;
  }

  const { rows } = await db.query(
    `SELECT l.id AS letter_id, l.invoice_number AS letter_no, l.invoice_date,
            l.attachments, l.created_by, l.work_id, l.created_at,
            d.id AS doc_id, d.invoice_number AS doc_no, d.counterparty_name,
            d.work_id AS doc_work_id, d.created_by AS doc_created_by,
            d.obs_account_id, d.subcontract_id,
            (SELECT c.id FROM correspondence c
              WHERE c.obs_invoice_doc_id = d.id AND c.deleted_at IS NULL
              ORDER BY c.id DESC LIMIT 1) AS existing_corr
       FROM doc_registry l
       LEFT JOIN doc_registry d
              ON d.obs_letter_doc_id = l.id AND d.deleted_at IS NULL
      WHERE ${where}
      ORDER BY l.id`,
    params);

  log(`всего писем: ${rows.length}`);

  let created = 0, skipped = 0, failed = 0;

  for (const r of rows) {
    const label = `#${r.letter_id} ${r.letter_no || 'б/н'}`;
    if (r.existing_corr) {
      log(`  SKIP ${label}: уже в переписке #${r.existing_corr}`);
      skipped++;
      continue;
    }
    if (!r.doc_id) {
      log(`  SKIP ${label}: не нашлось счёта-родителя (obs_letter_doc_id)`);
      skipped++;
      continue;
    }
    const file = resolveLetterFile(r.attachments);
    if (!file) {
      log(`  FAIL ${label}: PDF письма не найден в uploads (вложения пусты или файл удалён)`);
      failed++;
      continue;
    }

    const number = String(r.letter_no || '').replace(/^Исх\.\s*/i, '').trim() || `историческое-${r.letter_id}`;
    const date = isoDate(r.invoice_date || r.created_at);
    const subject = `Письмо для оплаты через ОБС по счёту № ${r.doc_no || r.doc_id}`
      + (r.counterparty_name ? ` (${r.counterparty_name})` : '');

    log(`  ${APPLY ? 'ADD ' : 'WOULD'} ${label} → переписка № ${number} от ${date}, счёт #${r.doc_id}`);

    if (!APPLY) { created++; continue; }

    try {
      await db.transaction(async (client) => {
        const corr = await client.query(
          `INSERT INTO correspondence (
             direction, date, number, doc_type, subject, body, content,
             counterparty, status, created_by, created_at, updated_at,
             work_id, letter_kind, doc_title, doc_sub,
             signing_status, version_no, is_current, finalized_at, sent_at,
             file_path, obs_account_id, obs_invoice_doc_id
           ) VALUES (
             'outgoing', $1::date, $2, 'letter', $3, $4, $4,
             $5, 'sent', $6, COALESCE($7::timestamptz, NOW()), NOW(),
             $8, 'obs_payment', 'Письмо для оплаты через ОБС', $9,
             'finalized', 1, true, COALESCE($7::timestamptz, NOW()), COALESCE($7::timestamptz, NOW()),
             $10, $11, $12
           ) RETURNING id`,
          [date, number, subject,
            `Письмо для оплаты через ОБС по счёту № ${r.doc_no || r.doc_id}`,
            r.counterparty_name || 'ОБС',
            r.created_by || r.doc_created_by || null,
            r.created_at || null,
            r.doc_work_id || r.work_id || null,
            `по счёту № ${r.doc_no || 'б/н'}`,
            null, r.obs_account_id || null, r.doc_id]);

        const corrId = corr.rows[0].id;

        // Копия файла в корень uploads: штатный /api/files/download/:name
        // отдаёт только файлы из корня (см. resolveStoredFilePath).
        const attachName = `${crypto.randomUUID()}.pdf`;
        const attachPath = path.join(UPLOAD_ROOT, attachName);
        fs.copyFileSync(file, attachPath);
        const stat = fs.statSync(attachPath);

        await client.query(
          `INSERT INTO documents (
             filename, original_name, mime_type, size, type,
             work_id, correspondence_id, uploaded_by, download_url, created_at
           ) VALUES ($1, $2, 'application/pdf', $3, 'Письмо', $4, $5, $6, $7, NOW())`,
          [attachName, path.basename(file), stat.size,
            r.doc_work_id || r.work_id || null, corrId,
            r.created_by || null, `/api/files/download/${attachName}`]);

        // Обновляем публичную ссылку письма в строке реестра — чтобы карточка
        // и реестр открывали файл одинаково.
        await client.query(
          `UPDATE doc_registry
              SET attachments = $2::jsonb, updated_at = NOW()
            WHERE id = $1`,
          [r.letter_id, JSON.stringify([{
            name: path.basename(file),
            url: '/uploads/doc-hub/obs-letters/' + encodeURIComponent(path.basename(file)),
            kind: 'obs_letter',
          }])]);
      });
      created++;
    } catch (e) {
      log(`  FAIL ${label}: ${e.message}`);
      failed++;
    }
  }

  log('');
  log(`итог: ${APPLY ? 'создано' : 'будет создано'} ${created}, пропущено ${skipped}, ошибок ${failed}`);
  if (!APPLY) {
    log('это dry-run — для записи запустите с --apply');
  }
  if (failed) process.exitCode = 1;
}

main()
  .then(() => db.pool.end?.())
  .catch((e) => { console.error(e); process.exitCode = 1; });
