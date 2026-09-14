'use strict';
/**
 * Apply merged Doc Hub Excel JSON via API + write post-apply-fix.md checklist scaffold.
 * Usage: node tools/doc-hub-excel-apply.js tests/reports/doc-hub-excel/merged-rows.json
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const PASSWORD = process.env.TEST_PASSWORD || 'Test123!';

async function login() {
  const login = process.env.TEST_LOGIN || 'test_admin';
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: PASSWORD })
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
  if (!token) throw new Error('login failed');
  return token;
}

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node tools/doc-hub-excel-apply.js merged-rows.json');
    process.exit(2);
  }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const token = await login();
  const hdr = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const dry = await fetch(BASE + '/api/doc-registry/excel/dry-run', {
    method: 'POST', headers: hdr, body: JSON.stringify({ rows })
  }).then((r) => r.json());
  const apply = await fetch(BASE + '/api/doc-registry/excel/apply', {
    method: 'POST', headers: hdr, body: JSON.stringify({ rows })
  }).then((r) => r.json());
  const outDir = path.dirname(file);
  fs.writeFileSync(path.join(outDir, 'dry-run.json'), JSON.stringify(dry, null, 2));
  fs.writeFileSync(path.join(outDir, 'apply-result.json'), JSON.stringify(apply, null, 2));
  const fix = [
    '# post-apply-fix',
    '',
    `- Dry-run: ${JSON.stringify(dry.summary || dry)}`,
    `- Apply: ${JSON.stringify(apply.summary || apply)}`,
    '',
    '## Checklist (каждая строка)',
    '- [ ] Ответственные → users CRM (не null)',
    '- [ ] Работы привязаны / созданы; РП = отв. за работу (не за документы)',
    '- [ ] Офисные счета в #/office-expenses',
    '- [ ] Расходы по объекту без дублей',
    '- [ ] Суммы/НДС/контрагенты vs Excel',
    ''
  ];
  fs.writeFileSync(path.join(outDir, 'post-apply-fix.md'), fix.join('\n'));
  console.log(JSON.stringify({ dry: dry.summary || dry, apply: apply.summary || apply, outDir }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
