#!/usr/bin/env node
'use strict';

/**
 * Проверка allowlist/blacklist типов документации: и обходы, и живые пути UI.
 *
 * R. Обходы системного типа: 'tkp ', ' tkp', 'tkp\n', 'ТКП', 'TKП', 'TkP', 'rp_tkp ' → отказ
 * S. Живые пути UI (не должны ломаться):
 *      «Документ», «Смета», «Корреспонденция», «Запрос», «Сопроводительное»,
 *      «Спецификация», «Письмо», «Комплект», «Платёжное поручение»,
 *      «Отчёт о расходах», 'employee_doc', «Документ просчёта»
 *    → все 200 (это реальные значения из DocsPackModal, approval_modals,
 *      Personnel/api.js, mobile EstimateReport, свободного поля карточки тендера)
 * T. Пустой type → пишется «Документ»
 *
 * Запуск: node tools/tkp-ai-types-probe.js <tenderId> [tokenFile]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const PORT = Number(process.env.PORT || 3100);
const tenderId = parseInt(process.argv[2], 10);
const token = (fs.readFileSync(process.argv[3] || 'tmp/token.txt', 'utf8').match(/eyJ[\w.-]+/) || [''])[0];

function makePdf() {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const font = path.join(process.cwd(), 'public', 'assets', 'fonts', 'DejaVuSans.ttf');
    if (fs.existsSync(font)) doc.font(font);
    doc.fontSize(11).text('Тестовый документ для проверки типа.');
    doc.end();
  });
}

function upload(fields, fileName, fileBuf) {
  const boundary = '----typp' + Date.now() + Math.random();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) continue;
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n'));
  }
  parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="'
    + fileName + '"\r\nContent-Type: application/pdf\r\n\r\n'));
  parts.push(fileBuf);
  parts.push(Buffer.from('\r\n--' + boundary + '--\r\n'));
  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: '/api/files/upload', method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
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
    r.write(body);
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
  const pdf = await makePdf();

  const clearDocs = () => db.query(
    "DELETE FROM documents WHERE tender_id = $1 AND type <> 'tkp'", [tenderId]
  );

  // ── R. Обходы системного типа (только латинские идентификаторы)
  // Принципиально: системный тип — это латиница ('tkp', 'rp_tkp'). Кириллическая
  // метка 'ТКП' — легитимный пользовательский тип из DOC_TYPES в DocsPackModal,
  // её блокировать НЕЛЬЗЯ (22 документа в БД с этим типом).
  console.log('\nR) обходы системного типа (латиница с мусором)');
  const bypass = ['tkp ', ' tkp', 'tkp\n', 'TkP', 'TKP', 'rp_tkp ', 'rp_tkp\n',
    'tkp\t', 'tkp\u00a0', 'tkp\u200b', 'tkp\r\n', 'TKp', 'Rp_Tkp'];
  const leaked = [];
  for (const v of bypass) {
    await clearDocs();
    const r = await upload({ tender_id: String(tenderId), type: v }, 'x.pdf', pdf);
    if (r.status === 200) leaked.push(JSON.stringify(v) + '→' + r.status);
  }
  ok(leaked.length === 0, 'все варианты системного типа отклонены',
    leaked.length ? leaked.join(', ') : bypass.length + ' вариантов');

  // ── S. Живые пути UI
  console.log('\nS) живые пути UI (не должны ломаться)');
  const liveTypes = [
    // Значения из DOC_TYPES модалки «Комплект документов» (DocsPackModal.jsx)
    'Запрос', 'ТКП', 'Сопроводительное', 'Спецификация', 'Договор', 'Прочее',
    // Модалки бухгалтерии (approval_modals.js)
    'Платёжное поручение', 'Отчёт о расходах',
    // Свободное поле карточки тендера (tenders.js: placeholder «ТЗ / Письмо / Комплект»)
    'Письмо', 'Комплект', 'ТЗ',
    // Прочее из UI
    'Документ', 'Смета', 'Корреспонденция', 'Ссылка', 'Чек', 'Счёт',
    'Документ просчёта', 'employee_doc'
  ];
  const broken = [];
  for (const v of liveTypes) {
    await clearDocs();
    const r = await upload({ tender_id: String(tenderId), type: v }, 'x.pdf', pdf);
    if (r.status !== 200) broken.push(v + '→' + r.status + (r.body && r.body.code ? '(' + r.body.code + ')' : ''));
  }
  ok(broken.length === 0, 'все ' + liveTypes.length + ' живых типов принимаются',
    broken.length ? broken.join(', ') : 'OK');

  // ── T. Пустой type → «Документ»
  console.log('\nT) пустой type');
  await clearDocs();
  const t = await upload({ tender_id: String(tenderId), type: '' }, 'x.pdf', pdf);
  const stored = t.status === 200
    ? (await db.query(
      'SELECT type FROM documents WHERE tender_id = $1 ORDER BY id DESC LIMIT 1', [tenderId]
    )).rows[0]
    : null;
  ok(t.status === 200 && stored && stored.type === 'Документ',
    'пустой type → «Документ»', 'HTTP ' + t.status + ' stored=' + JSON.stringify(stored && stored.type));

  await clearDocs();

  console.log('\n' + (fails ? 'ИТОГ: FAIL (' + fails + ')' : 'ИТОГ: OK — обходы закрыты, живые пути работают'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
