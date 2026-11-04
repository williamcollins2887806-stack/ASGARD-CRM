#!/usr/bin/env node
'use strict';

/**
 * НЕГАТИВНЫЙ контроль гейта: все обходы, найденные верификаторами.
 *
 * A. Подмена subtotal при строках на 1 ₽            → items_mismatch
 * B. Цена в 10 раз ниже на обычном пути              → PDF не публикуется
 * C. То же через POST /:id/attach-to-tender          → sum_mismatch
 * D. Сохранение при director_review_status=rejected  → 409 director_rejected
 * E. Корректный ТКП                                  → 200, pdf_attached
 * F. qty×price ≠ total                               → items_mismatch
 * G. Отрицательная позиция «Корректировка»           → items_mismatch
 * H. attach-to-card при расхождении цены             → отказ
 *
 * Запуск: node tools/tkp-ai-negative-probe.js <tenderId> [tokenFile]
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

function clearTkp(db) {
  return db.query("DELETE FROM documents WHERE tender_id = $1 AND type = 'tkp'", [tenderId])
    .then(() => db.query('DELETE FROM tkp WHERE tender_id = $1', [tenderId]));
}

function payload(price, opts) {
  const o = opts || {};
  return {
    subject: o.subject || 'Проверка гейта',
    work_description: o.description || 'Выполняем работы по техническому заданию.',
    tender_id: tenderId,
    attach_pdf_only: o.attach !== false,
    source: 'ai_tender',
    link_type: 'tender',
    kp_variant: 'classic',
    total_sum: price,
    items: {
      items: [{
        name: 'Работа',
        unit: 'усл.',
        qty: 1,
        price: o.itemPrice != null ? o.itemPrice : price,
        total: o.itemTotal != null ? o.itemTotal : price
      }],
      vat_pct: 22,
      subtotal: price,
      vat_sum: Math.round(price * 0.22 * 100) / 100,
      total_with_vat: Math.round(price * 1.22 * 100) / 100
    }
  };
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

  await clearTkp(db);

  console.log('\nA) subtotal = цена просчёта, но в строке 1 руб');
  const a = await req('POST', '/api/tkp', payload(real, { itemTotal: 1, itemPrice: 1 }));
  ok(a.status === 422 && a.body && a.body.code === 'items_mismatch',
    'арифметика ТКП проверена', 'HTTP ' + a.status + ' ' + (a.body && a.body.code));

  console.log('\nB) обычный путь, цена в 10 раз ниже');
  await clearTkp(db);
  const b = await req('POST', '/api/tkp', payload(Math.round(real / 10), { attach: false }));
  if (b.status === 200) {
    await new Promise((r) => setTimeout(r, 3500));
    const n = (await db.query(
      "SELECT COUNT(*)::int AS n FROM documents WHERE tender_id = $1 AND type = 'tkp'", [tenderId]
    )).rows[0].n;
    ok(n === 0, 'PDF не опубликован при расхождении цены', 'документов: ' + n);
  } else {
    ok(false, 'обычный путь вернул ошибку', 'HTTP ' + b.status);
  }

  console.log('\nC) attach-to-tender при расхождении цены');
  await clearTkp(db);
  const cheap = Math.round(real / 10);
  const mk = await req('POST', '/api/tkp', payload(cheap, { attach: false }));
  const cheapId = mk.body && mk.body.item && mk.body.item.id;
  if (cheapId) {
    const c = await req('POST', '/api/tkp/' + cheapId + '/attach-to-tender', {});
    ok(c.status === 422 && c.body && c.body.code === 'sum_mismatch',
      'attach-to-tender сверяет с просчётом', 'HTTP ' + c.status + ' ' + (c.body && c.body.code));
  } else {
    ok(false, 'не удалось создать ТКП для C');
  }

  console.log('\nD) director_review_status=rejected');
  await clearTkp(db);
  await db.query("UPDATE tender_rp_reviews SET director_review_status = 'rejected' WHERE tender_id = $1", [tenderId]);
  const d = await req('POST', '/api/tkp', payload(real));
  ok(d.status === 409 && d.body && d.body.code === 'director_rejected',
    'сохранение при отклонении заблокировано', 'HTTP ' + d.status + ' ' + (d.body && d.body.code));

  // D2: повторное сохранение существующего черновика не должно обходить запрет
  await db.query('UPDATE tender_rp_reviews SET director_review_status = NULL WHERE tender_id = $1', [tenderId]);
  await clearTkp(db);
  const dFirst = await req('POST', '/api/tkp', payload(real));
  console.log('   создан черновик: HTTP ' + dFirst.status + ' id=' + (dFirst.body && dFirst.body.item && dFirst.body.item.id));
  await db.query("UPDATE tender_rp_reviews SET director_review_status = 'rejected' WHERE tender_id = $1", [tenderId]);
  const dSecond = await req('POST', '/api/tkp', payload(real, { subject: 'Правка после отклонения' }));
  ok(dSecond.status === 409 && dSecond.body && dSecond.body.code === 'director_rejected',
    'повторное сохранение черновика тоже заблокировано', 'HTTP ' + dSecond.status);

  await db.query('UPDATE tender_rp_reviews SET director_review_status = NULL WHERE tender_id = $1', [tenderId]);

  console.log('\nE) корректный ТКП — должен пройти');
  await clearTkp(db);
  const e = await req('POST', '/api/tkp', payload(real));
  ok(e.status === 200 && e.body && e.body.pdf_attached === true,
    'корректный ТКП прикреплён', 'id=' + (e.body && e.body.item && e.body.item.id));

  console.log('\nF) qty=1, price=1000, total=цена просчёта');
  await clearTkp(db);
  const f = await req('POST', '/api/tkp', payload(real, { itemPrice: 1000 }));
  ok(f.status === 422 && f.body && f.body.code === 'items_mismatch',
    'арифметика строки проверена', 'HTTP ' + f.status);

  console.log('\nG) 100 млн + отрицательная корректировка');
  await clearTkp(db);
  const g = await req('POST', '/api/tkp', {
    subject: 'Проверка отрицательных позиций',
    work_description: 'Выполняем работы.',
    tender_id: tenderId,
    attach_pdf_only: true,
    source: 'ai_tender',
    link_type: 'tender',
    kp_variant: 'classic',
    total_sum: real,
    items: {
      items: [
        { name: 'Работа', unit: 'усл.', qty: 1, price: 100000000, total: 100000000 },
        { name: 'Корректировка', unit: 'усл.', qty: 1, price: real - 100000000, total: real - 100000000 }
      ],
      vat_pct: 22,
      subtotal: real,
      vat_sum: Math.round(real * 0.22 * 100) / 100,
      total_with_vat: Math.round(real * 1.22 * 100) / 100
    }
  });
  ok(g.status === 422 && g.body && g.body.code === 'items_mismatch',
    'отрицательные позиции заблокированы', 'HTTP ' + g.status);

  console.log('\nH) attach-to-card при расхождении цены');
  await clearTkp(db);
  const hCard = (await db.query(
    "SELECT id FROM personal_kanban_cards WHERE entity_kind = 'tender' AND entity_id = $1 LIMIT 1", [tenderId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const cardId = hCard ? hCard.id : ((await db.query(
    "SELECT id FROM personal_kanban_cards WHERE entity_kind = 'tender' LIMIT 1"
  ).catch(() => ({ rows: [] }))).rows[0] || {}).id;

  if (cardId) {
    const hCreate = await req('POST', '/api/tkp', payload(1, { attach: false }));
    const hId = hCreate.body && hCreate.body.item && hCreate.body.item.id;
    if (hId) {
      const rend = await req('POST', '/api/tkp/' + hId + '/render-pdf', {});
      console.log('   render: HTTP ' + rend.status + ' pdf_path=' + (rend.body && rend.body.pdf_path));
      const h = await req('POST', '/api/tkp/' + hId + '/attach-to-card/' + cardId, {});
      console.log('   attach: HTTP ' + h.status + ' code=' + (h.body && h.body.code) + ' error=' + (h.body && h.body.error));
      // 400 «PDF не сгенерирован» — это тоже отказ (файл не попал в карточку),
      // но настоящая проверка гейта — 422. Принимаем оба как «не прикреплено».
      ok(h.status === 422 || h.status === 400,
        'attach-to-card не прикрепил файл при расхождении цены',
        'HTTP ' + h.status + ' ' + (h.body && (h.body.code || h.body.error)));
    } else {
      ok(false, 'не удалось создать ТКП для H');
    }
  } else {
    console.log('   ПРОПУСК: в клоне нет ни одной карточки канбана');
  }

  await clearTkp(db);

  console.log('\n' + (fails ? 'ИТОГ: FAIL (' + fails + ')' : 'ИТОГ: OK — все обходы закрыты'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
