#!/usr/bin/env node
'use strict';

/**
 * Закрытие путей публикации ТКП, найденных верификатором (итерация 4).
 *
 * I.  POST /api/tkp/upload-ready при director_review_status='rejected'  → 409
 * J.  POST /api/tkp/upload-ready с ценой в 1000 раз ниже просчёта        → 422
 * K.  POST /api/files/upload с type='tkp' (подлог типа)                  → 403
 * L.  Корректный upload-ready при чистом просчёте                        → 200
 *
 * Запуск: node tools/tkp-ai-upload-probe.js <tenderId> [tokenFile]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3100);
const tenderId = parseInt(process.argv[2], 10);
const token = (fs.readFileSync(process.argv[3] || 'tmp/token.txt', 'utf8').match(/eyJ[\w.-]+/) || [''])[0];

function multipart(fields, fileField, fileName, fileBuf, mime) {
  const boundary = '----tkpai' + Date.now();
  const parts = [];

  for (const [k, v] of Object.entries(fields || {})) {
    parts.push(Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n'
    ));
  }
  if (fileBuf) {
    parts.push(Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="' + fileField
      + '"; filename="' + fileName + '"\r\nContent-Type: ' + (mime || 'application/pdf') + '\r\n\r\n'
    ));
    parts.push(fileBuf);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from('--' + boundary + '--\r\n'));

  return { body: Buffer.concat(parts), boundary };
}

function post(path, fields, fileField, fileName, fileBuf) {
  return new Promise((resolve, reject) => {
    const mp = multipart(fields, fileField, fileName, fileBuf);
    const r = http.request({
      host: '127.0.0.1', port: PORT, path, method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + mp.boundary,
        'Content-Length': mp.body.length,
        Authorization: 'Bearer ' + token
      }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, body: j, raw: buf });
      });
    });
    r.on('error', reject);
    r.write(mp.body);
    r.end();
  });
}

let fails = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
  if (!cond) fails += 1;
}

(async () => {
  const db = require('../src/services/db');

  const rev = (await db.query(
    'SELECT work_price, work_price_ex_vat FROM tender_rp_reviews WHERE tender_id = $1',
    [tenderId]
  )).rows[0];
  if (!rev) { console.error('Нет просчёта для тендера ' + tenderId); process.exit(1); }
  const real = Number(rev.work_price_ex_vat != null ? rev.work_price_ex_vat : rev.work_price);
  console.log('Просчёт: цена без НДС = ' + real);

  // Минимальный валидный PDF с корректными суммами просчёта.
  // Без сумм линт справедливо откажет (amount_missing) — так и должно быть.
  const tinyPdfPath = path.join(process.cwd(), 'tmp', 'probe-tkp.pdf');
  const PDFDocument = require('pdfkit');

  const clear = () => db.query("DELETE FROM documents WHERE tender_id = $1 AND type = 'tkp'", [tenderId])
    .then(() => db.query('DELETE FROM tkp WHERE tender_id = $1', [tenderId]));

  const fmtRu = (n) => Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vat = Math.round(real * 0.22 * 100) / 100;
  const total = Math.round((real + vat) * 100) / 100;

  await new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => { fs.writeFileSync(tinyPdfPath, Buffer.concat(chunks)); resolve(); });
    const font = path.join(process.cwd(), 'public', 'assets', 'fonts', 'DejaVuSans.ttf');
    if (fs.existsSync(font)) doc.font(font);
    doc.fontSize(11);
    doc.text('ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ');
    doc.text('Выполняем работы по техническому заданию заказчика.');
    doc.text('Итого без НДС: ' + fmtRu(real) + ' руб.');
    doc.text('НДС 22%: ' + fmtRu(vat) + ' руб.');
    doc.text('ИТОГО: ' + fmtRu(total) + ' руб.');
    doc.end();
  });
  const pdfBuf = fs.readFileSync(tinyPdfPath);

  // ── K. Подлог типа через общий загрузчик
  console.log('\nK) POST /api/files/upload с type=tkp');
  const k = await post('/api/files/upload',
    { tender_id: String(tenderId), type: 'tkp' },
    'file', 'podlog.pdf', pdfBuf);
  console.log('   HTTP ' + k.status + ' code=' + (k.body && k.body.code));
  ok(k.status === 403 && k.body && k.body.code === 'system_doc_type',
    'подлог type=tkp запрещён', 'HTTP ' + k.status);

  // ── I. upload-ready при отклонении директора
  console.log('\nI) upload-ready при director_review_status=rejected');
  await clear();
  await db.query("UPDATE tender_rp_reviews SET director_review_status = 'rejected' WHERE tender_id = $1", [tenderId]);
  const i = await post('/api/tkp/upload-ready', {
    subject: 'Загруженное ТКП при отклонении',
    tender_id: String(tenderId),
    total_sum: String(real),
    items: JSON.stringify({ items: [{ name: 'Работа', unit: 'усл.', qty: 1, price: real, total: real }], vat_pct: 22, subtotal: real })
  }, 'file', 'rejected.pdf', pdfBuf);
  console.log('   HTTP ' + i.status + ' code=' + (i.body && i.body.code));
  ok(i.status === 409 && i.body && i.body.code === 'director_rejected',
    'upload-ready заблокирован при отклонении', 'HTTP ' + i.status);
  await db.query('UPDATE tender_rp_reviews SET director_review_status = NULL WHERE tender_id = $1', [tenderId]);

  // ── J. upload-ready с ценой в 1000 раз ниже
  console.log('\nJ) upload-ready с ценой в 1000 раз ниже просчёта');
  await clear();
  const cheap = Math.round(real / 1000 * 100) / 100;
  const j = await post('/api/tkp/upload-ready', {
    subject: 'Дешёвое ТКП',
    tender_id: String(tenderId),
    total_sum: String(cheap),
    items: JSON.stringify({ items: [{ name: 'Работа', unit: 'усл.', qty: 1, price: cheap, total: cheap }], vat_pct: 22, subtotal: cheap })
  }, 'file', 'cheap.pdf', pdfBuf);
  console.log('   HTTP ' + j.status + ' code=' + (j.body && j.body.code));
  ok(j.status === 422 && j.body && j.body.code === 'sum_mismatch',
    'заниженная цена в upload-ready заблокирована', 'HTTP ' + j.status);

  const leftover = (await db.query('SELECT COUNT(*)::int AS n FROM tkp WHERE tender_id = $1', [tenderId])).rows[0].n;
  ok(leftover === 0, 'после отказа ТКП в БД не осталось', 'записей: ' + leftover);

  // ── L. Корректный upload-ready
  console.log('\nL) корректный upload-ready');
  await clear();
  const l = await post('/api/tkp/upload-ready', {
    subject: 'Корректное загруженное ТКП',
    tender_id: String(tenderId),
    total_sum: String(real),
    items: JSON.stringify({ items: [{ name: 'Работа', unit: 'усл.', qty: 1, price: real, total: real }], vat_pct: 22, subtotal: real })
  }, 'file', 'good.pdf', pdfBuf);
  console.log('   HTTP ' + l.status + ' id=' + (l.body && l.body.item && l.body.item.id));
  ok(l.status === 200 && l.body && l.body.item && l.body.item.id,
    'корректная загрузка проходит', 'HTTP ' + l.status);

  await clear();
  try { fs.unlinkSync(tinyPdfPath); } catch (_) {}

  console.log('\n' + (fails ? 'ИТОГ: FAIL (' + fails + ')' : 'ИТОГ: OK — все пути публикации закрыты'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
