#!/usr/bin/env node
// Сводный прогон всех тестов Doc Hub / email-цепочки. Запускает каждый, собирает итог.
const { spawnSync } = require('child_process');
process.env.TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';

const TESTS = [
  ['Извлечение реквизитов счёта', 'tests/invoice-extract.test.js'],
  ['Детектор «Добро»', 'tests/approval-detector.test.js'],
  ['TTL согласования 72ч', 'tests/doc-approval-ttl-e2e.js'],
  ['Intake-оркестратор', 'tests/doc-email-intake.test.js'],
  ['Intake из письма', 'tests/doc-intake-from-email.test.js'],
  ['«Добро» в треде', 'tests/approval-thread.test.js'],
  ['Сквозная цепочка CRM→CRM', 'tests/email-chain-e2e.js'],
  ['Светофор: паритет SQL↔JS', 'tests/doc-traffic-parity-e2e.js'],
  ['Безопасность реестра', 'tests/doc-hub-security-e2e.js'],
  ['N1/N2/N3 (гонки, оракулы)', 'tests/doc-hub-nfix-e2e.js'],
  ['Акты сверки', 'tests/doc-recon-e2e.js'],
  ['Крон-дайджест', 'tests/doc-digest-e2e.js'],
  ['Входящие СФ', 'tests/doc-incoming-sf-e2e.js'],
  ['Касса бухгалтерии', 'tests/doc-buh-cash-e2e.js'],
  ['Реестр+архив бухгалтерии', 'tests/doc-buh-archive-e2e.js'],
];

let totalPass = 0, totalFail = 0; const failed = [];
console.log('СВОДНЫЙ ПРОГОН ТЕСТОВ Doc Hub\n' + '='.repeat(60));
for (const [name, file] of TESTS) {
  const r = spawnSync('node', [file], { encoding: 'utf8', env: process.env, timeout: 180000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/PASS (\d+) \/ FAIL (\d+)/);
  const p = m ? parseInt(m[1], 10) : 0;
  const f = m ? parseInt(m[2], 10) : (r.status ? 1 : 0);
  totalPass += p; totalFail += f;
  if (f > 0 || !m) failed.push(name);
  console.log(`${f === 0 && m ? 'OK  ' : 'FAIL'}  ${name.padEnd(34)} PASS ${p} / FAIL ${f}`);
}
console.log('='.repeat(60));
console.log(`ИТОГО: PASS ${totalPass} / FAIL ${totalFail}`);
if (failed.length) console.log('ПРОВАЛЫ: ' + failed.join(', '));
process.exit(totalFail ? 1 : 0);
