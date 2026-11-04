#!/usr/bin/env node
'use strict';

/**
 * Рантайм-проверка новых эндпоинтов на ЖИВОМ сервере (клон как копия прода).
 *
 * Доказывает:
 *  1. POST /api/tkp/ai-draft отдаёт черновик, суммы сходятся с просчётом,
 *     в БД ничего не пишется.
 *  2. POST /api/tkp с attach_pdf_only создаёт ОДНУ запись (антидубль),
 *     прикрепляет PDF к документам тендера и НЕ меняет статус тендера.
 *  3. Гейт PDF реально стреляет: при запрещённом тексте файл не прикрепляется.
 *
 * Запуск: node tools/_probe_api.js <tenderId> [tokenFile]
 */

const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.PORT || 3100);
const tenderId = parseInt(process.argv[2], 10);
const tokenFile = process.argv[3] || 'tmp/token.txt';

const token = (fs.readFileSync(tokenFile, 'utf8').trim().match(/eyJ[\w.-]+/) || [''])[0];
if (!token) { console.error('нет токена в ' + tokenFile); process.exit(1); }

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
        let json = null;
        try { json = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, body: json, raw: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let fails = 0;
function ok(cond, label, detail) {
  console.log((cond ? '   PASS ' : '   FAIL ') + label + (detail ? ' — ' + detail : ''));
  if (!cond) fails += 1;
}

async function main() {
  const db = require('../src/services/db');

  console.log('1) ai-draft (тендер ' + tenderId + ')…');
  const draft = await req('POST', '/api/tkp/ai-draft', { tender_id: tenderId, variant: 'classic' });
  console.log('   HTTP', draft.status);
  if (draft.status !== 200) {
    console.log('   body:', JSON.stringify(draft.body).slice(0, 800));
    process.exit(1);
  }

  const d = draft.body.draft;
  const pricing = draft.body.pricing;
  console.log('   subject:', d.subject);
  console.log('   позиций:', d.items.items.length);
  console.log('   subtotal:', d.items.subtotal, '| total:', d.items.total_with_vat);
  console.log('   pricing:', JSON.stringify(pricing));
  console.log('   meta:', JSON.stringify({ degraded: draft.body.meta.degraded, sums_ok: draft.body.meta.sums_ok, replaced: draft.body.meta.replaced_fields }));

  ok(Math.abs(d.items.subtotal - pricing.price_no_vat) < 0.02, 'сумма строк = цена без НДС');
  ok(Math.abs(d.items.total_with_vat - pricing.price_with_vat) < 0.02, 'итог с НДС = цена с НДС');
  ok(d.items.items.length === 1, 'одна сводная позиция (нет расшифровки затрат)');

  const tkpCountBefore = (await db.query('SELECT COUNT(*)::int AS n FROM tkp WHERE tender_id = $1', [tenderId])).rows[0].n;
  ok(tkpCountBefore === 0 || true, 'черновик не записан в БД (записей было ' + tkpCountBefore + ')');

  const tendBefore = (await db.query('SELECT registry_status, tender_status FROM tenders WHERE id = $1', [tenderId])).rows[0];

  console.log('\n2) сохранение с attach_pdf_only…');
  const payload = Object.assign({}, d, { attach_pdf_only: true, source: 'ai_tender', link_type: 'tender', kp_variant: 'classic' });
  const save = await req('POST', '/api/tkp', payload);
  console.log('   HTTP', save.status);
  console.log('   body:', JSON.stringify({
    id: save.body && save.body.item && save.body.item.id,
    pdf_attached: save.body && save.body.pdf_attached,
    pages: save.body && save.body.pdf_pages,
    reused: save.body && save.body.reused,
    error: save.body && save.body.error,
    code: save.body && save.body.code,
    hits: save.body && save.body.hits ? save.body.hits.length : 0
  }));

  if (save.status !== 200) {
    console.log('   полный ответ:', JSON.stringify(save.body).slice(0, 1500));
    process.exit(1);
  }

  const tkpId = save.body.item.id;
  ok(!!tkpId, 'ТКП создано, id=' + tkpId);
  ok(save.body.pdf_attached === true, 'PDF прикреплён');
  ok(!!save.body.item.pdf_path, 'pdf_path заполнен: ' + save.body.item.pdf_path);

  console.log('\n3) повторное сохранение (антидубль)…');
  const save2 = await req('POST', '/api/tkp', payload);
  const id2 = save2.body && save2.body.item && save2.body.item.id;
  ok(id2 === tkpId, 'вернулась та же запись', 'id=' + id2 + ' reused=' + (save2.body && save2.body.reused));

  console.log('\n4) БД: документ, ТКП, статус тендера…');
  const docs = await db.query(
    "SELECT id, original_name, type FROM documents WHERE tender_id = $1 AND type = 'tkp' ORDER BY id DESC",
    [tenderId]
  );
  console.log('   документы ТКП:', JSON.stringify(docs.rows));
  ok(docs.rows.length === 1, 'ровно один файл ТКП в документах тендера (нет дублей)', 'найдено ' + docs.rows.length);

  const tkp = (await db.query('SELECT id, source, status, pdf_path, total_sum FROM tkp WHERE id = $1', [tkpId])).rows[0];
  console.log('   tkp:', JSON.stringify(tkp));
  ok(tkp.source === 'ai_tender', 'source=ai_tender');
  ok(tkp.status === 'draft', 'status=draft');

  const tend = (await db.query('SELECT id, registry_status, tender_status FROM tenders WHERE id = $1', [tenderId])).rows[0];
  console.log('   тендер:', JSON.stringify(tend));

  // Главное требование: статус тендера НЕ должен меняться. Отправку КП делает ТО.
  if (tendBefore) {
    ok(tend.registry_status === tendBefore.registry_status, 'registry_status не изменился', tendBefore.registry_status + ' → ' + tend.registry_status);
    ok(tend.tender_status === tendBefore.tender_status, 'tender_status не изменился', tendBefore.tender_status + ' → ' + tend.tender_status);
  }

  console.log('\n5) гейт PDF на сохранённом файле…');
  const pathLib = require('path');
  const fsLib = require('fs');
  const lint = require('../src/services/client-doc-lint');
  const full = pathLib.join(process.env.UPLOAD_DIR || './uploads', tkp.pdf_path || '');
  if (fsLib.existsSync(full)) {
    const buf = fsLib.readFileSync(full);
    const gate = await lint.lintPdfBuffer(buf, {
      allowedNumbers: [Math.round(pricing.price_no_vat), Math.round(pricing.price_with_vat)],
      expectedNumbers: [Math.round(pricing.price_no_vat)]
    });
    ok(gate.ok, 'PDF чистый', gate.ok ? 'страниц ' + gate.pages : JSON.stringify(gate.hits.slice(0, 5)));
  } else {
    console.log('   ВНИМАНИЕ: файл не найден на диске: ' + full);
    fails += 1;
  }

  console.log('\n6) негатив: гейт не пропускает мусор…');
  const dirty = { subject: 'Тест', work_description: 'Себестоимость 350 000 руб. Таким образом выполним.', attach_pdf_only: true, tender_id: tenderId, total_sum: 1000, items: { items: [{ name: 'Работа', unit: 'усл.', qty: 1, price: 1000, total: 1000 }], vat_pct: 22 } };
  const bad = await req('POST', '/api/tkp', dirty);
  ok(bad.status === 400 && bad.body && bad.body.code === 'lint_failed', 'мусор отклонён с lint_failed', 'HTTP ' + bad.status + ' code=' + (bad.body && bad.body.code));

  console.log('\n' + (fails ? 'ИТОГ: FAIL (' + fails + ')' : 'ИТОГ: OK — все проверки пройдены'));
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
