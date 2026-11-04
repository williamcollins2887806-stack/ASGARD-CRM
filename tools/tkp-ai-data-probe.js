#!/usr/bin/env node
'use strict';

/**
 * Закрытие обхода через generic CRUD /api/data/documents (итерация 8).
 *
 * U. POST /api/data/documents с type='tkp'           → 403 system_doc_type
 * V. PUT  /api/data/documents/:id с type='tkp'        → 403 (или запись не создана)
 * W. PUT существующего системного документа           → 403 system_doc_locked
 * X. POST с type='Ссылка' (реальный путь UI)          → 200 (нет регрессии)
 * Y. POST/PUT с type='Документ'                     → 200 (нет регрессии)
 * Z. Подмена download_url у настоящего ТКП            → отказ
 *
 * Запуск: node tools/tkp-ai-data-probe.js <tenderId> [tokenFile]
 */

const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.PORT || 3100);
const tenderId = parseInt(process.argv[2], 10);
const token = (fs.readFileSync(process.argv[3] || 'tmp/token.txt', 'utf8').match(/eyJ[\w.-]+/) || [''])[0];

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Authorization: 'Bearer ' + token };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, body: j });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
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

  const clear = () => db.query(
    "DELETE FROM documents WHERE tender_id = $1 AND type <> 'Документ'", [tenderId]
  ).catch(() => {});

  // ── U. POST с type=tkp
  console.log('\nU) POST /api/data/documents с type=tkp');
  const u = await req('POST', '/api/data/documents', {
    filename: 'fake.pdf',
    original_name: 'Подделка.pdf',
    type: 'tkp',
    tender_id: tenderId,
    download_url: 'https://evil.example/fake.pdf'
  });
  console.log('   HTTP ' + u.status + ' code=' + (u.body && (u.body.error || u.body.code)));
  ok(u.status === 403, 'создание системного типа запрещено', 'HTTP ' + u.status);

  const fakeCount = (await db.query(
    "SELECT COUNT(*)::int AS n FROM documents WHERE tender_id = $1 AND type = 'tkp' AND download_url LIKE '%evil%'",
    [tenderId]
  )).rows[0].n;
  ok(fakeCount === 0, 'подделка не попала в БД', 'записей: ' + fakeCount);

  // ── X. POST с type='Ссылка' (реальный путь UI)
  console.log('\nX) POST с type=Ссылка (как InlineDocsBar)');
  await clear();
  const x = await req('POST', '/api/data/documents', {
    filename: 'link',
    original_name: 'Ссылка на закупку',
    type: 'Ссылка',
    tender_id: tenderId,
    file_url: 'https://zakupki.gov.ru/notice/123'
  });
  console.log('   HTTP ' + x.status + ' id=' + (x.body && (x.body.item ? x.body.item.id : x.body.id)));
  ok(x.status === 200, 'ссылка создаётся (нет регрессии)', 'HTTP ' + x.status);

  const linkId = x.body && (x.body.item ? x.body.item.id : x.body.id);

  // ── V. PUT с type=tkp
  console.log('\nV) PUT /api/data/documents/:id с type=tkp');
  if (linkId) {
    const v = await req('PUT', '/api/data/documents/' + linkId, { type: 'tkp' });
    console.log('   HTTP ' + v.status + ' code=' + (v.body && (v.body.error || v.body.code)));
    ok(v.status === 403, 'смена типа на системный запрещена', 'HTTP ' + v.status);

    const after = (await db.query('SELECT type FROM documents WHERE id = $1', [linkId])).rows[0];
    ok(after && after.type === 'Ссылка', 'тип не изменился', 'в БД: ' + (after && after.type));
  } else {
    ok(false, 'не удалось создать ссылку для V');
  }

  // ── W. Подмена download_url у настоящего ТКП
  console.log('\nW) подмена download_url у системного ТКП');
  await clear();
  const real = await db.query(
    'SELECT id FROM documents WHERE type = $1 LIMIT 1', ['tkp']
  ).catch(() => ({ rows: [] }));

  if (real.rows[0]) {
    const id = real.rows[0].id;
    const before = (await db.query('SELECT download_url FROM documents WHERE id = $1', [id])).rows[0];
    const w = await req('PUT', '/api/data/documents/' + id, {
      download_url: 'https://evil.example/stolen.pdf'
    });
    console.log('   HTTP ' + w.status + ' code=' + (w.body && (w.body.error || w.body.code)));
    ok(w.status === 403, 'правка системного документа запрещена', 'HTTP ' + w.status);

    const after = (await db.query('SELECT download_url FROM documents WHERE id = $1', [id])).rows[0];
    ok(after && after.download_url === before.download_url,
      'download_url настоящего ТКП не изменён',
      String(after && after.download_url).slice(0, 60));
  } else {
    console.log('   ПРОПУСК: в клоне нет системного документа type=tkp');
  }

  // ── Y. type='Документ' работает
  console.log('\nY) type=Документ (не должно ломаться)');
  const y = await req('POST', '/api/data/documents', {
    filename: 'doc.pdf',
    original_name: 'Обычный документ',
    type: 'Документ',
    tender_id: tenderId
  });
  console.log('   HTTP ' + y.status);
  ok(y.status === 200, 'обычный документ создаётся', 'HTTP ' + y.status);

  await clear();

  console.log('\n' + (fails ? 'ИТОГ: FAIL (' + fails + ')' : 'ИТОГ: OK — обход через data API закрыт'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
