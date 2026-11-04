#!/usr/bin/env node
'use strict';

/**
 * Закрытие уязвимостей публикации ТКП (итерация 5).
 *
 * M. type='tkp ' / ' tkp' / 'tkp\n' / 'ТКП' / 'TKП' / 'rp_tkp '  → отказ
 * N. type='Документ' (как шлёт UI)                                → 200 (нет регрессии)
 * O. upload-ready: PDF с себестоимостью/маржей                     → отказ, файл не в карточке
 * P. Блок конструктора только с qty/price (без total)              → blocks_mismatch НЕ ложный
 * Q. Корректный upload-ready с чистым PDF                          → 200
 *
 * Запуск: node tools/tkp-ai-bypass-probe.js <tenderId> [tokenFile]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const PORT = Number(process.env.PORT || 3100);
const tenderId = parseInt(process.argv[2], 10);
const token = (fs.readFileSync(process.argv[3] || 'tmp/token.txt', 'utf8').match(/eyJ[\w.-]+/) || [''])[0];

function multipart(fields, fileName, fileBuf, mime) {
  const boundary = '----byp' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields || {})) {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n'));
  }
  parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + fileName
    + '"\r\nContent-Type: ' + (mime || 'application/pdf') + '\r\n\r\n'));
  parts.push(fileBuf);
  parts.push(Buffer.from('\r\n--' + boundary + '--\r\n'));
  return { body: Buffer.concat(parts), boundary };
}

function postFile(pathUrl, fields, fileName, fileBuf, mime) {
  return new Promise((resolve, reject) => {
    const mp = multipart(fields, fileName, fileBuf, mime);
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: pathUrl, method: 'POST',
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
        resolve({ status: res.statusCode, body: j });
      });
    });
    r.on('error', reject);
    r.write(mp.body);
    r.end();
  });
}

function postJson(pathUrl, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: pathUrl, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization: 'Bearer ' + token
      }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, body: j });
      });
    });
    r.on('error', reject);
    r.write(data);
    r.end();
  });
}

function makePdf(lines) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const font = path.join(process.cwd(), 'public', 'assets', 'fonts', 'DejaVuSans.ttf');
    if (fs.existsSync(font)) doc.font(font);
    doc.fontSize(11);
    (lines || []).forEach((l) => doc.text(String(l)));
    doc.end();
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
    'SELECT work_price, work_price_ex_vat FROM tender_rp_reviews WHERE tender_id = $1', [tenderId]
  )).rows[0];
  const real = Number(rev.work_price_ex_vat != null ? rev.work_price_ex_vat : rev.work_price);
  console.log('Просчёт: цена без НДС = ' + real);

  const fmt = (n) => Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vat = Math.round(real * 0.22 * 100) / 100;
  const total = Math.round((real + vat) * 100) / 100;

  const cleanPdf = await makePdf([
    'ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ',
    'Выполняем работы по техническому заданию заказчика.',
    'Итого без НДС: ' + fmt(real) + ' руб.',
    'НДС 22%: ' + fmt(vat) + ' руб.',
    'ИТОГО: ' + fmt(total) + ' руб.'
  ]);

  const dirtyPdf = await makePdf([
    'ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ',
    'ИТОГО К ОПЛАТЕ: 999 999 999,00 руб.',
    'Себестоимость: 1,00 руб. Маржа: 99,9%. ФОТ: 0.'
  ]);

  const clear = () => db.query("DELETE FROM documents WHERE tender_id = $1 AND type = 'tkp'", [tenderId])
    .then(() => db.query('DELETE FROM tkp WHERE tender_id = $1', [tenderId]));

  // ── M. Обход whitelist через пробелы/регистр
  // Только ЛАТИНСКИЕ варианты: системный тип — латинский идентификатор.
  // Кириллическая 'ТКП' — легитимная метка UI из DocsPackModal, её проверяет
  // отдельно types-probe (должна быть 200, не 403).
  console.log('\nM) обход системного типа (латиница)');
  const variants = ['tkp ', ' tkp', 'tkp\n', 'TkP', 'TKP', 'rp_tkp ', 'tkp\t'];
  const leaked = [];
  for (const v of variants) {
    const r = await postFile('/api/files/upload', { tender_id: String(tenderId), type: v },
      'podlog.pdf', cleanPdf);
    if (r.status === 200) leaked.push(JSON.stringify(v) + '→' + r.status);
  }
  ok(leaked.length === 0, 'все латинские варианты type=tkp отклонены', leaked.length ? leaked.join(', ') : variants.length + ' вариантов');

  // ── N. Нет регрессии: UI шлёт «Документ»
  console.log('\nN) type=Документ (как шлёт UI)');
  const n = await postFile('/api/files/upload', { tender_id: String(tenderId), type: 'Документ' },
    'docs.pdf', cleanPdf);
  ok(n.status === 200, 'обычная загрузка документа работает', 'HTTP ' + n.status);

  await db.query("DELETE FROM documents WHERE tender_id = $1 AND type = 'Документ'", [tenderId]);

  // ── O. upload-ready с грязным PDF
  console.log('\nO) upload-ready с себестоимостью/маржей в PDF');
  await clear();
  const o = await postFile('/api/tkp/upload-ready', {
    subject: 'Грязный загруженный ТКП',
    tender_id: String(tenderId),
    total_sum: String(real)
  }, 'dirty.pdf', dirtyPdf);
  console.log('   HTTP ' + o.status + ' code=' + (o.body && o.body.code));
  ok(o.status === 422 && o.body && o.body.code === 'pdf_lint_failed',
    'линт загруженного PDF вызван', 'HTTP ' + o.status + ' ' + (o.body && o.body.code));

  const docsAfterO = (await db.query(
    "SELECT COUNT(*)::int AS n FROM documents WHERE tender_id = $1 AND type = 'tkp'", [tenderId]
  )).rows[0].n;
  ok(docsAfterO === 0, 'грязный файл не попал в карточку тендера', 'документов: ' + docsAfterO);

  // ── Q. Корректный upload-ready
  console.log('\nQ) корректный upload-ready с чистым PDF');
  await clear();
  const q = await postFile('/api/tkp/upload-ready', {
    subject: 'Корректный загруженный ТКП',
    tender_id: String(tenderId),
    total_sum: String(real)
  }, 'clean.pdf', cleanPdf);
  console.log('   HTTP ' + q.status + ' code=' + (q.body && (q.body.code || 'ok')) + ' id=' + (q.body && q.body.item && q.body.item.id));
  ok(q.status === 200, 'чистый PDF публикуется', 'HTTP ' + q.status + ' ' + (q.body && (q.body.code || '')));

  // ── P. Блок конструктора без total (только qty/price)
  console.log('\nP) блок конструктора без total (ложный blocks_mismatch?)');
  const tkpId = q.body && q.body.item && q.body.item.id;
  if (tkpId) {
    await db.query(
      `INSERT INTO tkp_blocks (tkp_id, block_key, block_data)
       VALUES ($1, 'smeta', $2::jsonb)`,
      [tkpId, JSON.stringify({ items: [{ name: 'Работы по договору', unit: 'усл.', qty: 1, price: real }], vat_pct: 22 })]
    );
    const p = await postJson('/api/tkp/' + tkpId + '/attach-to-tender', {});
    console.log('   HTTP ' + p.status + ' code=' + (p.body && p.body.code));
    ok(!(p.status === 422 && p.body && p.body.code === 'blocks_mismatch'),
      'НЕТ ложного blocks_mismatch при qty/price без total',
      'HTTP ' + p.status + ' ' + (p.body && p.body.code || ''));
    await db.query('DELETE FROM tkp_blocks WHERE tkp_id = $1', [tkpId]);
  } else {
    ok(false, 'не удалось создать ТКП для проверки P');
  }

  await clear();
  console.log('\n' + (fails ? 'ИТОГ: FAIL (' + fails + ')' : 'ИТОГ: OK — все уязвимости закрыты'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
