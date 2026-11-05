#!/usr/bin/env node
'use strict';

/**
 * Читаем реальный PDF полного КП и проверяем, что в нём есть всё нужное.
 *
 * Гейт `lintPdfBuffer` говорит «чисто», но не говорит «полно». Этот скрипт —
 * про полноту: позиции, суммы, условия, техплан. Именно его результат
 * показывает, что ТО получит нормальный документ, а не одну строку.
 *
 * Запуск (нужен поднятый клон :3100):
 *   node tools/tkp-full-kp-read.js <tenderId>
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3100);
const tenderId = parseInt(process.argv[2], 10) || 2042;
const TOKEN_FILE = path.join(__dirname, '..', 'tmp', 'token.txt');
const token = (fs.readFileSync(TOKEN_FILE, 'utf8').match(/eyJ[\w.-]+/) || [''])[0];

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        buf: Buffer.concat(chunks),
        type: res.headers['content-type'] || ''
      }));
    });
    r.on('error', reject);
    r.write(data);
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
  const lint = require('../src/services/client-doc-lint');
  const pdfParse = require('pdf-parse');

  const draft = await post('/api/tkp/ai-draft', { tender_id: tenderId, variant: 'full' });
  if (draft.status !== 200) {
    console.error('ai-draft упал:', draft.buf.toString('utf8').slice(0, 600));
    process.exit(1);
  }
  const d = JSON.parse(draft.buf.toString('utf8')).draft;
  const items = (d.items && d.items.items) || [];

  // Предпросмотр отдаёт ровно тот PDF, который увидит ТО.
  const prev = await post('/api/tkp/preview-pdf', Object.assign({}, d, {
    tender_id: tenderId, source: 'ai_tender', kp_variant: 'full'
  }));
  ok(prev.status === 200, 'preview-pdf 200', 'HTTP ' + prev.status + ' ' + prev.type);
  if (prev.status !== 200) {
    console.log(prev.buf.toString('utf8').slice(0, 800));
    process.exit(1);
  }

  fs.writeFileSync(path.join('tmp', 'full-kp-' + tenderId + '.pdf'), prev.buf);
  const parsed = await pdfParse(prev.buf);
  const text = String(parsed.text || '').replace(/[\s\u00a0]+/g, ' ');
  console.log('страниц: ' + parsed.numpages + ', символов: ' + text.length);

  const price = d.items.subtotal;
  const vat = d.items.vat_sum;
  const total = d.items.total_with_vat;
  const fmt = (n) => Number(n).toLocaleString('ru-RU', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).replace(/\s/g, ' ');
  const has = (s) => text.replace(/\u00a0/g, ' ').indexOf(s) >= 0;

  ok(has('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ'), 'титул на месте');
  ok(has(String(d.customer_name || '')) || String(d.customer_name || '').length < 3,
    'заказчик в документе', d.customer_name);

  // Позиции: каждая должна упоминаться хотя бы началом названия.
  const missing = items.filter((it) => {
    const short = String(it.name).slice(0, 24);
    return !has(short);
  });
  ok(missing.length === 0, 'все позиции попали в PDF',
    missing.length ? 'нет: ' + missing.map((m) => m.name.slice(0, 30)).join(' | ') : 'позиций: ' + items.length);

  // Суммы
  ok(has(fmt(price)) || has(fmt(price).replace(/,00$/, '')), 'цена без НДС в PDF', fmt(price));
  ok(has(fmt(total)), 'итог с НДС в PDF', fmt(total));

  // Условия из техплана
  const cond = (d.items.full && d.items.full.conditions) || {};
  if (cond.regime) ok(has(cond.regime.slice(0, 30)), 'условия: режим работ', cond.regime.slice(0, 60));
  if (cond.personnel) ok(has(cond.personnel.split(',')[0].slice(0, 20)), 'условия: персонал', cond.personnel.slice(0, 70));

  // Инвентарные номера складских позиций
  const inv = items.filter((i) => i.inventory_number).map((i) => i.inventory_number);
  if (inv.length) {
    const invMissing = inv.filter((n) => !has(n));
    ok(invMissing.length === 0, 'инвентарные номера в PDF', inv.join(', '));
  }

  // Никакой внутренней кухни
  const gate = await lint.lintPdfBuffer(prev.buf, { allowedNumbers: [price, total, vat] });
  ok(gate.ok, 'линтер чист (внутренняя кухня не протекла)',
    gate.hits.length ? JSON.stringify(gate.hits.slice(0, 3)) : 'хитов: 0');

  console.log('\nфайл: tmp/full-kp-' + tenderId + '.pdf');
  console.log(fails ? 'ИТОГ: FAIL (' + fails + ')' : 'ИТОГ: OK — документ полный и чистый');
  try { await db.end(); } catch (_) {}
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
