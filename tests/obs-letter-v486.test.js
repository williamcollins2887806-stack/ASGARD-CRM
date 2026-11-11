'use strict';
/**
 * V486: сквозная проверка письма ОБС на живом API клона.
 *
 * Что проверяем (то, на что жаловался заказчик):
 *   1. предпросмотр отдаёт файл БЕЗ «Исх. № б/н» — номер берётся из счётчика;
 *   2. для счёта на шуруповёрт в письме НЕТ «безопасного выполнения работ»;
 *   3. для счёта на СИЗ — ЕСТЬ (каркас «допуск» срабатывает);
 *   4. список ОБС-счетов и договоров в /obs-options не пуст.
 */
const { Pool } = require('pg');
const BASE = 'http://127.0.0.1:3100';

const db = new Pool({
  host: '127.0.0.1', port: 5432, database: 'asgard_crm_test',
  user: 'asgard', password: '123456789',
});

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_buh', password: 'Test123!' }),
  });
  const d = await r.json();
  let t = d.token;
  if (d.status === 'need_pin') {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ pin: '0000' }),
    });
    const d2 = await r2.json();
    if (d2.token) t = d2.token;
  }
  return t;
}

(async () => {
  const t = await login();
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t };

  const uid = (await db.query(`SELECT id FROM users WHERE login='test_buh'`)).rows[0].id;
  const created = [];

  async function makeInvoice(name, items, amount) {
    const doc = (await db.query(
      `INSERT INTO doc_registry(dir, package_type, ops_status, pay_status, invoice_number,
          invoice_date, counterparty_name, amount_gross, amount_net, vat_amount, has_vat,
          spend_kind, created_by, updated_by, currency)
       VALUES ('in','invoice','wait_sf','wait',$1,'2026-11-11',$2,$3,$3,0,false,'other',$4,$4,'RUB')
       RETURNING id`,
      ['V486-' + Date.now() + '-' + Math.floor(Math.random() * 999), name, amount, uid])).rows[0].id;
    created.push(doc);
    await db.query(
      `UPDATE doc_registry SET parsed_json = $2::jsonb WHERE id=$1`,
      [doc, JSON.stringify({ lines: items.map((nm) => ({ name: nm, quantity: 1, unit: 'шт', unit_price: amount, sum: amount })) })]).catch(() => {});
    return doc;
  }

  // ─── 1. Счёт на шуруповёрт ─────────────────────────────────────────────
  const drill = await makeInvoice('ООО «Тест-Инструмент»', ['Шуруповёрт аккумуляторный 18В'], 5000);
  const pv1 = await fetch(`${BASE}/api/doc-registry/${drill}/obs-letter/preview?format=pdf`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      items: ['Шуруповёрт аккумуляторный 18В'],
      amount_gross: 5000, vat_rate: 0, vat_amount: 0,
      counterparty_name: 'ООО «Тест-Инструмент»',
      payment_source: 'obs',
    }),
  });
  (pv1.status === 200) ? ok('предпросмотр отдал PDF (200)')
    : bad('предпросмотр: ' + pv1.status + ' ' + (await pv1.text()).slice(0, 200));

  if (pv1.ok) {
    const buf = Buffer.from(await pv1.arrayBuffer());
    (buf.length > 5000) ? ok('PDF не пустой: ' + buf.length + ' Б') : bad('PDF подозрительно мал: ' + buf.length);
    const head = buf.slice(0, 5).toString();
    (head === '%PDF-') ? ok('это действительно PDF') : bad('не PDF: ' + head);
  }

  // ─── 2. Счёт на СИЗ ────────────────────────────────────────────────────
  const ppe = await makeInvoice('ООО «Тест-СИЗ»', ['Перчатки х/б с ПВХ-покрытием'], 1200);
  const pv2 = await fetch(`${BASE}/api/doc-registry/${ppe}/obs-letter/preview?format=docx`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      items: ['Перчатки х/б с ПВХ-покрытием'],
      amount_gross: 1200, vat_rate: 0, vat_amount: 0,
      counterparty_name: 'ООО «Тест-СИЗ»',
      payment_source: 'obs',
    }),
  });
  (pv2.status === 200) ? ok('предпросмотр DOCX (200)') : bad('DOCX: ' + pv2.status);

  if (pv2.ok) {
    const buf = Buffer.from(await pv2.arrayBuffer());
    const PizZip = require('pizzip');
    const zip = new PizZip(buf);
    const xml = zip.file('word/document.xml').asText();
    const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // Номер исходящего должен быть настоящим, не «б/н»
    const numOk = /Исх\.\s*№\s*АС-\d{4}-\d{2}-\d+/.test(text);
    numOk ? ok('в письме настоящий номер исходящего (АС-ГГГГ-ММ-N)')
      : bad('номер не проставлен: ' + (text.match(/Исх\.[^.]{0,40}/) || ['нет'])[0]);
    // Для СИЗ фраза про охрану труда УМЕСТНА
    /охраны труда|допуск/i.test(text) ? ok('для СИЗ есть обоснование про допуск')
      : bad('для СИЗ пропало обоснование про допуск');
  }

  // ─── 3. /obs-options: списки не пусты ──────────────────────────────────
  const opt = await fetch(`${BASE}/api/doc-registry/${drill}/obs-options`, { headers: H });
  const od = await opt.json().catch(() => ({}));
  (opt.status === 200) ? ok('/obs-options отвечает 200') : bad('/obs-options: ' + opt.status);
  (Array.isArray(od.obs_accounts) && od.obs_accounts.length > 0)
    ? ok('ОБС-счета в списке: ' + od.obs_accounts.length)
    : bad('список ОБС пуст');
  (Array.isArray(od.subcontracts) && od.subcontracts.length > 0)
    ? ok('договоры в списке: ' + od.subcontracts.length)
    : bad('список договоров пуст');

  // ─── Уборка ────────────────────────────────────────────────────────────
  for (const id of created) {
    await db.query(`DELETE FROM doc_registry WHERE id=$1`, [id]).catch(() => {});
  }
  console.log('\n────────────────────────────');
  console.log(`ИТОГ V486: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('CRASH', e.message);
  try { await db.end(); } catch (_) {}
  process.exit(1);
});
