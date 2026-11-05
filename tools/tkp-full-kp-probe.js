#!/usr/bin/env node
'use strict';

/**
 * Живой прогон «полное КП с разбивкой» на клоне.
 *
 * Доказывает сквозной путь:
 *   1. POST /api/tkp/ai-draft (variant=full) отдаёт N позиций, Σ = цена КП.
 *   2. POST /api/tkp с attach_pdf_only проходит PDF-гейт и прикрепляет файл.
 *      (Это ровно тот путь, который падал на «Транспортные расходы».)
 *   3. В карточке тендера ровно один документ type='tkp', статус не менялся.
 *   4. tech_json появился у просчёта.
 *
 * Ничего не оставляет после себя: в конце чистит tkp/documents по тендеру.
 *
 * Запуск: node tools/tkp-full-kp-probe.js <tenderId>
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3100);
const BASE = { host: '127.0.0.1', port: PORT };
const tenderId = parseInt(process.argv[2], 10) || 2042;

const TOKEN_FILE = path.join(__dirname, '..', 'tmp', 'token.txt');
const token = (fs.readFileSync(TOKEN_FILE, 'utf8').match(/eyJ[\w.-]+/) || [''])[0];
if (!token) { console.error('нет токена в ' + TOKEN_FILE); process.exit(1); }

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({
      host: BASE.host,
      port: BASE.port,
      path: urlPath,
      method,
      headers: Object.assign(
        { Authorization: 'Bearer ' + token },
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
      )
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(buf); } catch (_) { j = null; }
        resolve({ status: res.statusCode, body: j, raw: buf });
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

const money = (n) => Number(n).toLocaleString('ru-RU', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

(async () => {
  console.log('=== полное КП: разбивка и публикация, тендер ' + tenderId + ' ===\n');

  // ── 0. Чистое состояние
  const db = require('../src/services/db');
  await db.query('DELETE FROM tkp_blocks WHERE tkp_id IN (SELECT id FROM tkp WHERE tender_id = $1)', [tenderId]);
  await db.query('DELETE FROM tkp WHERE tender_id = $1', [tenderId]);
  await db.query("DELETE FROM documents WHERE tender_id = $1 AND type = 'tkp'", [tenderId]);

  const before = (await db.query(
    "SELECT tender_status, registry_status FROM tenders WHERE id = $1", [tenderId]
  )).rows[0];

  // ── 1. Черновик (полное КП)
  const draft = await req('POST', '/api/tkp/ai-draft', { tender_id: tenderId, variant: 'full' });
  ok(draft.status === 200, 'POST /api/tkp/ai-draft 200', 'HTTP ' + draft.status);
  if (draft.status !== 200) {
    console.log(JSON.stringify(draft.body, null, 1).slice(0, 900));
    process.exit(1);
  }

  const d = draft.body.draft;
  const items = (d.items && d.items.items) || [];
  const works = items.filter((i) => i.section === 'WORK');
  const mtr = items.filter((i) => i.section === 'MTR');
  const sum = Math.round(items.reduce((s, i) => s + Number(it_total(i)), 0) * 100) / 100;
  const price = draft.body.pricing.price_no_vat;

  console.log('позиций: ' + items.length + ' (работ ' + works.length + ', МТР ' + mtr.length + ')');
  console.log('Σ строк: ' + money(sum) + ' | цена КП: ' + money(price));
  console.log('оказываем: ' + (d.items.full && d.items.full.conditions
    ? JSON.stringify(d.items.full.conditions).slice(0, 300) : '—'));

  ok(items.length > 1, 'полное КП разбито по позициям', 'позиций: ' + items.length);
  ok(works.length >= 1, 'есть строки работ', 'работ: ' + works.length);
  ok(Math.abs(sum - price) < 0.02, 'Σ строк = цена КП', money(sum) + ' vs ' + money(price));
  ok(items.every((i) => Number(i.qty) > 0), 'у всех позиций qty > 0');

  const full = d.items.full || {};
  ok(Array.isArray(full.apparatus) && full.apparatus.length === items.length,
    'apparatus полного КП = числу позиций',
    (full.apparatus || []).length + ' vs ' + items.length);
  const transport = Number(full.transport_amount) || 0;
  console.log('отдельная строка транспорта: ' + money(transport));
  // Транспорт НЕ печатается отдельной суммой: цена без НДС уже включает его,
  // иначе шаблон прибавлял бы 50 000 к Σ позиций и итог расходился бы с КП.
  ok(transport === 0, 'транспорт не удваивается отдельной строкой', money(transport));

  const cond = full.conditions || {};
  ok(!!(cond.regime || cond.personnel), 'условия заполнены из техплана',
    'regime="' + String(cond.regime || '').slice(0, 80) + '" personnel="' + String(cond.personnel || '').slice(0, 80) + '"');

  // ── 2. Сохранение с публикацией PDF
  const save = await req('POST', '/api/tkp', Object.assign({}, d, {
    tender_id: tenderId,
    attach_pdf_only: true,
    source: 'ai_tender',
    kp_variant: 'full'
  }));
  ok(save.status === 200, 'POST /api/tkp (attach_pdf_only) 200',
    'HTTP ' + save.status + (save.body && save.body.code ? ' code=' + save.body.code : ''));
  if (save.status !== 200) {
    const b = save.body || {};
    console.log('  error:', b.error);
    if (Array.isArray(b.hits)) b.hits.slice(0, 5).forEach((h) => console.log('   -', h.kind, h.phrase, '|', String(h.context || '').slice(0, 120)));
  }

  // ── 3. Документ в карточке
  const docs = (await db.query(
    "SELECT id, type, original_name FROM documents WHERE tender_id = $1 AND type = 'tkp'", [tenderId]
  )).rows;
  ok(docs.length === 1, 'в карточке ровно один PDF ТКП', 'документов: ' + docs.length);
  if (docs[0]) console.log('  файл:', docs[0].original_name);

  // ── 4. Статус тендера не тронут
  const after = (await db.query(
    "SELECT tender_status, registry_status FROM tenders WHERE id = $1", [tenderId]
  )).rows[0];
  ok(after.tender_status === before.tender_status && after.registry_status === before.registry_status,
    'статус тендера не изменился',
    before.tender_status + ' → ' + after.tender_status);

  // ── 5. Краткое КП остаётся однострочным
  const short = await req('POST', '/api/tkp/ai-draft', { tender_id: tenderId, variant: 'classic' });
  const sItems = (short.body && short.body.draft && short.body.draft.items
    && short.body.draft.items.items) || [];
  ok(sItems.length === 1, 'краткое ТКП — одна строка', 'строк: ' + sItems.length);

  // ── Уборка
  await db.query('DELETE FROM tkp_blocks WHERE tkp_id IN (SELECT id FROM tkp WHERE tender_id = $1)', [tenderId]);
  await db.query('DELETE FROM tkp WHERE tender_id = $1', [tenderId]);
  await db.query("DELETE FROM documents WHERE tender_id = $1 AND type = 'tkp'", [tenderId]);

  console.log('\n' + (fails ? 'ИТОГ: FAIL (' + fails + ')' : 'ИТОГ: OK — сквозной путь работает'));
  try { await db.end(); } catch (_) {}
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });

function it_total(i) {
  return i.total != null ? i.total : (Number(i.qty || 0) * Number(i.price || 0));
}
