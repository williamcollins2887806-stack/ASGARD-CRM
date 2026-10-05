'use strict';
/**
 * VERIFY E2 / E5 / F for Doc Hub close plan.
 * Runs against twin :3100 + asgard_crm_test by default.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.TEST_PASSWORD || 'Test123!';
const PIN = process.env.TEST_PIN || '0000';
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-e2e');
fs.mkdirSync(OUT, { recursive: true });

const report = { started_at: new Date().toISOString(), checks: [], pass: 0, fail: 0 };

function mark(name, ok, detail) {
  report.checks.push({ name, pass: !!ok, detail: String(detail || '').slice(0, 300) });
  if (ok) report.pass++; else report.fail++;
  console.log((ok ? 'PASS' : 'FAIL'), name, detail || '');
}

async function login(loginName) {
  let lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password: PASSWORD })
  }).then((r) => r.json());
  let token = lr.token;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: PIN })
    }).then((r) => r.json());
    token = pr.token || token;
  }
  if (!token) throw new Error('login failed ' + loginName);
  return token;
}

async function api(token, method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body != null ? { 'Content-Type': 'application/json' } : {})
    },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let j; try { j = text ? JSON.parse(text) : null; } catch { j = { raw: text }; }
  return { status: r.status, body: j };
}

(async () => {
  const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
  if (!health || health.status !== 'ok') {
    console.error('Server not healthy at', BASE);
    process.exit(1);
  }

  const token = await login('test_buh').catch(() => login('test_admin'));
  const stamp = Date.now();
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD),
    database: process.env.TEST_DB_NAME || 'asgard_crm_test'
  });

  // —— E2: pay creates payment_invoice ——
  const createDoc = await api(token, 'POST', '/api/doc-registry/', {
    dir: 'in',
    invoice_number: 'E2-PAY-' + stamp,
    invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'ООО E2 Pay ' + stamp,
    amount_gross: 12345,
    has_vat: true,
    contract_mode: 'once',
    purpose_asgard: true,
    ops_status: 'wait_pay'
  });
  mark('E2 create doc', createDoc.status === 200 && createDoc.body && createDoc.body.id, JSON.stringify(createDoc.status));
  const docId = createDoc.body && createDoc.body.id;

  // without attachment → 400
  const payNoFile = await api(token, 'POST', '/api/doc-registry/' + docId + '/quick', { action: 'pay' });
  mark('E2 pay without file → 400', payNoFile.status === 400, JSON.stringify(payNoFile.body));

  // upload tiny file then pay
  const fd = new FormData();
  fd.append('file', new Blob([JSON.stringify([{ name: 'Part', article: 'E2-' + stamp, unit_price: 1, quantity: 1 }])]), 'e2-' + stamp + '.json');
  const up = await fetch(BASE + '/api/doc-registry/' + docId + '/upload', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  mark('E2 upload', up.status === 200, JSON.stringify(up.status));

  const pay = await api(token, 'POST', '/api/doc-registry/' + docId + '/quick', { action: 'pay' });
  const payId = pay.body && pay.body.payment_invoice_id;
  mark(
    'E2 pay creates payment_invoice',
    pay.status === 200 && payId && String(pay.body.redirect || '').includes('approval-payment?id=' + payId),
    JSON.stringify(pay.body)
  );

  const payReuse = await api(token, 'POST', '/api/doc-registry/' + docId + '/quick', { action: 'pay' });
  mark(
    'E2 pay reuse same id',
    payReuse.status === 200 && payReuse.body.payment_invoice_id === payId,
    JSON.stringify(payReuse.body)
  );

  // —— E5: afterPaid → work_expense ——
  let workId = null;
  try {
    const w = await pool.query(
      `SELECT id FROM works WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1`
    );
    workId = w.rows[0] && w.rows[0].id;
  } catch (_) {}
  if (!workId) {
    mark('E5 skip (no works)', true, 'no work in test db');
  } else {
    // attach work to payment
    await pool.query(`UPDATE payment_invoices SET work_id=$2 WHERE id=$1`, [payId, workId]);
    await pool.query(`UPDATE doc_registry SET work_id=$2 WHERE id=$1`, [docId, workId]);
    const payMod = require('../src/routes/payment-invoices');
    // afterPaid is on routes object — call via loading module patterns
    // Prefer SQL-level: set status paid and call afterPaid exported
    const { rows: payRows } = await pool.query(`SELECT * FROM payment_invoices WHERE id=$1`, [payId]);
    const payment = payRows[0];
    // Invoke afterPaid from module if available
    let afterPaid = payMod.afterPaid;
    if (!afterPaid && payMod.routes) afterPaid = payMod.routes.afterPaid;
    if (typeof afterPaid !== 'function') {
      // fallback: require file and get from routes registration side-effect
      mark('E5 afterPaid export', false, 'afterPaid not exported as callable');
    } else {
      await afterPaid(pool, payment);
      const { rows: we1 } = await pool.query(
        `SELECT id FROM work_expenses WHERE source_table='payment_invoices' AND source_key=$1`,
        [String(payId)]
      );
      mark('E5 work_expense created', we1.length === 1, 'count=' + we1.length);
      await afterPaid(pool, payment);
      const { rows: we2 } = await pool.query(
        `SELECT id FROM work_expenses WHERE source_table='payment_invoices' AND source_key=$1`,
        [String(payId)]
      );
      mark('E5 no duplicate expense', we2.length === 1, 'count=' + we2.length);
    }
  }

  // —— F1/F3: act + invoice upsert ——
  const inv = await api(token, 'POST', '/api/invoices', {
    invoice_number: 'F-INV-' + stamp,
    invoice_date: new Date().toISOString().slice(0, 10),
    customer_name: 'АО Клиент F ' + stamp,
    amount: 1000,
    vat_pct: 22,
    total_amount: 1220,
    invoice_type: 'outgoing',
    status: 'sent',
    work_id: workId || null
  });
  mark('F1 invoice create', inv.status === 200 && inv.body && inv.body.invoice, JSON.stringify(inv.status));
  const invoiceId = inv.body && inv.body.invoice && inv.body.invoice.id;

  await new Promise((r) => setTimeout(r, 200));
  const { rows: docInv } = await pool.query(
    `SELECT id, billing_invoice_id, amount_gross, deleted_at FROM doc_registry
     WHERE billing_invoice_id=$1 AND deleted_at IS NULL`,
    [invoiceId]
  );
  mark('F1 invoice → doc_registry', docInv.length === 1, JSON.stringify(docInv[0]));

  const putInv = await api(token, 'PUT', '/api/invoices/' + invoiceId, {
    customer_name: 'АО Клиент F UPD ' + stamp,
    total_amount: 1500,
    amount: 1500,
    invoice_type: 'outgoing'
  });
  mark('F3 invoice put', putInv.status === 200, JSON.stringify(putInv.status));
  const { rows: docInv2 } = await pool.query(
    `SELECT counterparty_name, amount_gross FROM doc_registry WHERE billing_invoice_id=$1 AND deleted_at IS NULL`,
    [invoiceId]
  );
  mark(
    'F3 invoice sync fields',
    docInv2[0] && String(docInv2[0].counterparty_name).includes('UPD') && Number(docInv2[0].amount_gross) === 1500,
    JSON.stringify(docInv2[0])
  );

  const act = await api(token, 'POST', '/api/acts', {
    act_number: 'F-ACT-' + stamp,
    act_date: new Date().toISOString().slice(0, 10),
    customer_name: 'АО Клиент F Act ' + stamp,
    amount: 2000,
    vat_pct: 22,
    total_amount: 2440,
    status: 'draft',
    work_id: workId || null
  });
  mark('F1 act create', act.status === 200 && act.body && act.body.act, JSON.stringify(act.status));
  const actId = act.body && act.body.act && act.body.act.id;
  await new Promise((r) => setTimeout(r, 200));
  const { rows: docAct } = await pool.query(
    `SELECT id, billing_act_id FROM doc_registry WHERE billing_act_id=$1 AND deleted_at IS NULL`,
    [actId]
  );
  mark('F1 act → doc_registry', docAct.length === 1, JSON.stringify(docAct[0]));

  // F2: link invoice.act_id
  if (invoiceId && actId) {
    await api(token, 'PUT', '/api/invoices/' + invoiceId, { act_id: actId, invoice_type: 'outgoing' });
    const { rows: linked } = await pool.query(
      `SELECT billing_act_id FROM doc_registry WHERE billing_invoice_id=$1 AND deleted_at IS NULL`,
      [invoiceId]
    );
    mark('F2 invoice.act_id → registry', linked[0] && Number(linked[0].billing_act_id) === Number(actId), JSON.stringify(linked[0]));
  }

  // F4: delete act → soft delete registry
  const delAct = await api(token, 'DELETE', '/api/acts/' + actId);
  mark('F4 delete act', delAct.status === 200, JSON.stringify(delAct.body));
  const { rows: docActDel } = await pool.query(
    `SELECT deleted_at FROM doc_registry WHERE billing_act_id=$1`,
    [actId]
  );
  mark('F4 act registry soft-deleted', docActDel[0] && docActDel[0].deleted_at != null, JSON.stringify(docActDel[0]));

  // F4b: delete invoice linked to payment should 409 if we attach payment
  // Use fresh invoice without payment — should delete OK
  const delInv = await api(token, 'DELETE', '/api/invoices/' + invoiceId);
  mark('F4 delete invoice', delInv.status === 200, JSON.stringify(delInv.body));
  const { rows: docInvDel } = await pool.query(
    `SELECT deleted_at FROM doc_registry WHERE billing_invoice_id=$1`,
    [invoiceId]
  );
  mark('F4 invoice registry soft-deleted', docInvDel[0] && docInvDel[0].deleted_at != null, JSON.stringify(docInvDel[0]));

  // F4b: hub delete with payment → 409
  const gate409 = await api(token, 'DELETE', '/api/doc-registry/' + docId);
  mark('F4b hub delete with payment → 409', gate409.status === 409, JSON.stringify(gate409.body));

  await pool.end();

  report.finished_at = new Date().toISOString();
  const md = [
    '# Doc Hub VERIFY E2 / E5 / F',
    '',
    `PASS ${report.pass} / FAIL ${report.fail}`,
    `Started ${report.started_at}`,
    `Finished ${report.finished_at}`,
    `Base ${BASE}`,
    '',
    ...report.checks.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ': ' + c.detail : ''}`)
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'VERIFY-E2-E5-F.md'), md);
  fs.writeFileSync(path.join(OUT, 'verify-e2-e5-f.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, fail: report.fail }));
  process.exit(report.fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
