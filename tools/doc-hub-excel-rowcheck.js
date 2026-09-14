'use strict';
/**
 * Row-check after Doc Hub Excel apply → post-apply-fix.md
 */
const fs = require('fs');
const path = require('path');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-excel');
const PASSWORD = process.env.TEST_PASSWORD || 'Test123!';

async function login() {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: process.env.TEST_LOGIN || 'test_admin', password: PASSWORD })
  }).then((r) => r.json());
  let token = lr.token;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: process.env.TEST_PIN || '0000' })
    }).then((r) => r.json());
    token = pr.token;
  }
  return token;
}

(async () => {
  const apply = JSON.parse(fs.readFileSync(path.join(OUT, 'apply-result.json'), 'utf8'));
  const rows = JSON.parse(fs.readFileSync(path.join(OUT, 'merged-rows.json'), 'utf8'));
  const token = await login();
  const hdr = { Authorization: 'Bearer ' + token };
  const checks = [];

  for (const item of (apply.items || [])) {
    const row = rows[item.index] || {};
    const doc = item.id
      ? await fetch(BASE + '/api/doc-registry/' + item.id, { headers: hdr }).then((r) => r.json()).catch(() => null)
      : null;
    const okDoc = !!(doc && doc.id);
    const officeOk = row.purpose_consumables ? !!item.office_expense_id : true;
    const workOk = row.work_title ? !!item.work_id : true;
    checks.push({
      index: item.index,
      invoice: row.invoice_number,
      action: item.action,
      doc_ok: okDoc,
      work_id: item.work_id || null,
      work_title: row.work_title || null,
      work_pm_name: row.work_pm_name || null,
      office_expense_id: item.office_expense_id || null,
      office_ok: officeOk,
      work_ok: workOk,
      amount: row.amount_gross,
      counterparty: row.counterparty_name
    });
  }

  const allOk = checks.every((c) => c.doc_ok && c.office_ok && c.work_ok);
  const md = [
    '# post-apply-fix',
    '',
    `- Checked at: ${new Date().toISOString()}`,
    `- Apply summary: created=${apply.created} skip=${apply.skip_duplicate} errors=${apply.errors}`,
    `- Row gate: ${allOk ? 'PASS' : 'FAIL'}`,
    '',
    '## Построчно',
    ...checks.map((c) => {
      const mark = (c.doc_ok && c.office_ok && c.work_ok) ? 'x' : ' ';
      return `- [${mark}] #${c.index} ${c.invoice} · doc=${c.doc_ok ? 'ok' : 'MISS'} · work=${c.work_id || '—'} (${c.work_title || 'office'}) РП=${c.work_pm_name || '—'} · office_exp=${c.office_expense_id || '—'} · ${c.amount} · ${c.counterparty}`;
    }),
    '',
    '## Правила',
    '- РП = отв. **за работу** (work_pm_name), не за документы',
    '- Офисные → office_expense_id / `#/office-expenses`',
    '- Объектные работы создаются при отсутствии',
    '- Дубли invoice skip-duplicate',
    '',
    '## Real twin Excel',
    'Когда будут боевые 2 файла — `node tools/doc-hub-excel-merge.js a.xlsx b.xlsx` → dry-run → apply → этот скрипт снова.',
    ''
  ];
  fs.writeFileSync(path.join(OUT, 'post-apply-fix.md'), md.join('\n'));
  console.log(JSON.stringify({ allOk, rows: checks.length }, null, 2));
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
