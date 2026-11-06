#!/usr/bin/env node
'use strict';
/**
 * Перезапуск извлечения текста по документам с нулевым результатом.
 *
 * Зачем: дефекты чтения (7z не в PATH, ExcelJS падал на .xls и на xlsx
 * с картинками) оставили часть документов с ocr_status='failed' и пустым
 * текстом. Файлы на диске есть — их надо просто прочитать заново.
 *
 *   node tools/reocr-empty.js --tender=2138
 *   node tools/reocr-empty.js --tender=2138 --apply
 */
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const arg = (n) => {
  const a = process.argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.split('=')[1] : null;
};
const TENDER = Number(arg('tender')) || null;
const APPLY = process.argv.includes('--apply');

const { resolveDocumentPath } = require('../src/services/pdf-ocr');
const tkpParser = require('../src/services/tkp-parser');
const archiveExtractor = require('../src/services/archiveExtractor');

const ARCHIVE_EXT = /\.(zip|rar|7z|tar|gz|bz2)$/i;

(async () => {
  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: '123456789', database: process.env.DB_NAME || 'asgard_crm'
  });
  await db.connect();

  const sql = TENDER
    ? `SELECT id, tender_id, original_name, filename, download_url FROM documents
        WHERE tender_id = $1 AND COALESCE(LENGTH(ocr_text),0) = 0 ORDER BY id`
    : `SELECT id, tender_id, original_name, filename, download_url FROM documents
        WHERE COALESCE(LENGTH(ocr_text),0) = 0 ORDER BY tender_id, id`;
  const { rows } = await db.query(sql, TENDER ? [TENDER] : []);

  console.log(`документов с пустым текстом: ${rows.length}${TENDER ? ' (тендер ' + TENDER + ')' : ''}`);
  console.log(`режим: ${APPLY ? 'запись' : 'сухой прогон'}\n`);

  let ok = 0;
  let arch = 0;
  let missing = 0;
  let failed = 0;

  for (const doc of rows) {
    const abs = resolveDocumentPath(doc);
    if (!abs) {
      missing += 1;
      console.log(`  ✗ #${doc.id} файла нет на диске — ${doc.original_name.slice(0, 50)}`);
      continue;
    }

    const isArch = ARCHIVE_EXT.test(doc.original_name || '') || ARCHIVE_EXT.test(abs);
    if (isArch) {
      arch += 1;
      console.log(`  ⧗ #${doc.id} архив — ${doc.original_name.slice(0, 50)} (распаковывается воркером)`);
      if (APPLY) {
        await db.query(
          `UPDATE documents SET ocr_status = 'pending', ocr_error = NULL WHERE id = $1`, [doc.id]
        );
      }
      continue;
    }

    try {
      const buf = fs.readFileSync(abs);
      const r = await tkpParser.extractTextOnly({
        buf, originalName: doc.original_name, allowOcr: false
      });
      const text = String(r.text || '').trim();
      if (text.length >= 20) {
        ok += 1;
        console.log(`  ✓ #${doc.id} ${text.length} симв — ${doc.original_name.slice(0, 50)}`);
        if (APPLY) {
          await db.query(
            `UPDATE documents SET ocr_text = $2, ocr_status = 'done',
               ocr_completed_at = NOW(), ocr_error = NULL, ocr_model = 'reocr-parser'
             WHERE id = $1`,
            [doc.id, text.slice(0, 200000)]
          );
        }
      } else {
        failed += 1;
        console.log(`  ✗ #${doc.id} пусто (${text.length}) — ${doc.original_name.slice(0, 50)}`);
        if (APPLY) {
          await db.query(
            `UPDATE documents SET ocr_status = 'pending', ocr_error = NULL WHERE id = $1`, [doc.id]
          );
        }
      }
    } catch (e) {
      failed += 1;
      console.log(`  ✗ #${doc.id} ошибка: ${e.message.slice(0, 60)} — ${doc.original_name.slice(0, 40)}`);
    }
  }

  await db.end();
  console.log(`\nитог: извлечено ${ok}, архивов ${arch}, файлов нет ${missing}, не вышло ${failed}`);
})();
