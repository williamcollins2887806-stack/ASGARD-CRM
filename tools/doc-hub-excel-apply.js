'use strict';
/**
 * Apply merged Doc Hub Excel JSON via API.
 * Usage:
 *   node tools/doc-hub-excel-apply.js tests/reports/doc-hub-excel/merged-rows.json [--dry-run-only]
 *
 * Env: TEST_BASE_URL, TEST_LOGIN, TEST_PASSWORD, TEST_PIN, DOC_HUB_TOKEN (optional Bearer)
 */
const fs = require('fs');
const path = require('path');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PASSWORD = process.env.TEST_PASSWORD || 'Test123!';
const DRY_ONLY = process.argv.includes('--dry-run-only');

async function login() {
  if (process.env.DOC_HUB_TOKEN) return process.env.DOC_HUB_TOKEN;
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
  if (!token) throw new Error('login failed: ' + JSON.stringify(lr));
  return token;
}

(async () => {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('Usage: node tools/doc-hub-excel-apply.js merged-rows.json [--dry-run-only]');
    process.exit(2);
  }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('rows', rows.length, 'base', BASE, DRY_ONLY ? 'DRY_ONLY' : 'APPLY');
  const token = await login();
  const hdr = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  // Chunk large payloads
  const chunkSize = Number(process.env.DOC_HUB_APPLY_CHUNK || 200);
  const dryAll = { create: 0, skip_duplicate: 0, needs_manual: 0, items: [] };
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const dry = await fetch(BASE + '/api/doc-registry/excel/dry-run', {
      method: 'POST', headers: hdr, body: JSON.stringify({ rows: chunk })
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error('dry-run ' + r.status + ' ' + JSON.stringify(j));
      return j;
    });
    dryAll.create += dry.create || 0;
    dryAll.skip_duplicate += dry.skip_duplicate || 0;
    dryAll.needs_manual += dry.needs_manual || 0;
    (dry.items || []).forEach((it) => dryAll.items.push({ ...it, index: (it.index || 0) + i }));
    console.log('dry chunk', i, '-', i + chunk.length, dry.create, dry.skip_duplicate, dry.needs_manual);
  }

  const outDir = path.dirname(file);
  fs.writeFileSync(path.join(outDir, 'dry-run.json'), JSON.stringify(dryAll, null, 2));

  if (DRY_ONLY) {
    console.log(JSON.stringify({ dry: {
      create: dryAll.create,
      skip_duplicate: dryAll.skip_duplicate,
      needs_manual: dryAll.needs_manual
    }, outDir }, null, 2));
    return;
  }

  const applyAll = { created: 0, skip_duplicate: 0, needs_manual: 0, errors: 0, items: [] };
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const apply = await fetch(BASE + '/api/doc-registry/excel/apply', {
      method: 'POST', headers: hdr, body: JSON.stringify({ rows: chunk })
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error('apply ' + r.status + ' ' + JSON.stringify(j));
      return j;
    });
    applyAll.created += apply.created || 0;
    applyAll.skip_duplicate += apply.skip_duplicate || 0;
    applyAll.needs_manual += apply.needs_manual || 0;
    applyAll.errors += apply.errors || 0;
    (apply.items || []).forEach((it) => applyAll.items.push({ ...it, index: (it.index || 0) + i }));
    console.log('apply chunk', i, '-', i + chunk.length, apply.created, apply.skip_duplicate, apply.errors);
  }

  fs.writeFileSync(path.join(outDir, 'apply-result.json'), JSON.stringify(applyAll, null, 2));
  const fix = [
    '# post-apply-fix',
    '',
    `- Dry-run: create=${dryAll.create} skip=${dryAll.skip_duplicate} manual=${dryAll.needs_manual}`,
    `- Apply: created=${applyAll.created} skip=${applyAll.skip_duplicate} manual=${applyAll.needs_manual} errors=${applyAll.errors}`,
    '',
    '## Checklist',
    '- [ ] Ответственные → users CRM',
    '- [ ] Работы привязаны / созданы',
    '- [ ] Офисные счета в #/office-expenses',
    '- [ ] Суммы/НДС/контрагенты vs Excel',
    ''
  ];
  fs.writeFileSync(path.join(outDir, 'post-apply-fix.md'), fix.join('\n'));
  console.log(JSON.stringify({
    dry: { create: dryAll.create, skip: dryAll.skip_duplicate, manual: dryAll.needs_manual },
    apply: { created: applyAll.created, skip: applyAll.skip_duplicate, manual: applyAll.needs_manual, errors: applyAll.errors },
    outDir
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
