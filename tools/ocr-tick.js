#!/usr/bin/env node
'use strict';
/**
 * Разовая обработка OCR-очереди: распаковка архивов и чтение документов.
 * Нужен, когда ждать фоновый воркер не хочется, а документы надо
 * превратить в текст сейчас (например, перед повторным анализом).
 *
 *   node tools/ocr-tick.js --tender=2138
 */
require('dotenv').config();
const { Client } = require('pg');
const TenderOcrWorker = require('../src/services/tender-ocr-worker');

const arg = (n) => {
  const a = process.argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.split('=')[1] : null;
};
const TENDER = Number(arg('tender')) || null;

(async () => {
  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: '123456789', database: process.env.DB_NAME || 'asgard_crm'
  });
  await db.connect();

  const log = (m) => console.log('  ' + m);
  const worker = new TenderOcrWorker(db, { info: log, warn: log, error: log });

  if (TENDER) {
    console.log(`ставлю в очередь тендер #${TENDER}`);
    await worker.enqueue(TENDER, 'manual-reocr');
  } else {
    console.log('ставлю в очередь все тендеры с незавершённым OCR');
    await worker.enqueuePendingTenders();
  }

  // Крутим тики, пока очередь не опустеет или не выйдет время.
  const started = Date.now();
  for (let i = 0; i < 40; i++) {
    const done = await worker._processNext();
    if (!done) break;
    if (Date.now() - started > 15 * 60 * 1000) {
      console.log('  стоп: 15 минут');
      break;
    }
  }

  // Отчёт: без COALESCE с типизацией — он падал на text/integer.
  let r;
  if (TENDER) {
    r = await db.query(
      'SELECT ocr_status, COUNT(*) n FROM documents WHERE tender_id = $1 GROUP BY 1 ORDER BY 2 DESC',
      [TENDER]
    );
  } else {
    r = await db.query(
      'SELECT ocr_status, COUNT(*) n FROM documents GROUP BY 1 ORDER BY 2 DESC'
    );
  }
  console.log('\nсостояние документов:');
  r.rows.forEach((x) => console.log(`  ${String(x.ocr_status || '—').padEnd(10)} ${x.n}`));

  let t;
  if (TENDER) {
    t = await db.query(
      `SELECT COUNT(*) n, SUM(LENGTH(COALESCE(ocr_text, ''))) chars FROM documents WHERE tender_id = $1`,
      [TENDER]
    );
  } else {
    t = await db.query(
      `SELECT COUNT(*) n, SUM(LENGTH(COALESCE(ocr_text, ''))) chars FROM documents`
    );
  }
  console.log(`  текста всего: ${t.rows[0].chars} симв. в ${t.rows[0].n} документах`);

  await db.end();
})().catch((e) => console.log('ФАТАЛЬНО:', e.message));
