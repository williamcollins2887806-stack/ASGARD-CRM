#!/usr/bin/env node
// Сводный прогон всех тестов Doc Hub / email-цепочки. Запускает каждый, собирает итог.
const { spawnSync } = require('child_process');
process.env.TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
// Стенд не выходит в боевой SMTP (D-216-класс): без этого тест дайджеста висел
// ~128 с на таймаутах соединения и не доходил до проверки антидубля.
process.env.SMTP_DISABLED = process.env.SMTP_DISABLED || '1';

const TESTS = [
  ['Классификатор типа документа', 'tests/doc-classifier.test.js'],
  ['Извлечение реквизитов счёта', 'tests/invoice-extract.test.js'],
  ['Позиции счёта (номенклатура)', 'tests/invoice-lines.test.js'],
  ['Номенклатура без дублей', 'tests/catalog-dedup.test.js'],
  ['Договор/объект из счёта', 'tests/contract-match.test.js'],
  ['Подбор объекта (как пишут люди)', 'tests/work-match.test.js'],
  ['Привязка объекта к заявке', 'tests/payment-work-link.test.js'],
  ['Фикстуры счетов (синтетика)', 'tests/invoice-fixtures.test.js'],
  ['Реальные счета: intake', 'tests/real-invoices-intake.test.js'],
  ['Детектор «Добро»', 'tests/approval-detector.test.js'],
  ['TTL согласования 72ч', 'tests/doc-approval-ttl-e2e.js'],
  ['Intake-оркестратор', 'tests/doc-email-intake.test.js'],
  ['Инициатор по почте отправителя', 'tests/intake-initiator.test.js'],
  ['Контур теста заказчика (E2E)', 'tests/test-contour-e2e.js'],
  ['Доставка: файл+бух+ранний «Добро»', 'tests/intake-delivery-e2e.js'],
  ['Отложенное согласие (Добро раньше)', 'tests/deferred-approval.test.js'],
  ['Intake из письма', 'tests/doc-intake-from-email.test.js'],
  ['«Добро» в треде', 'tests/approval-thread.test.js'],
  ['Сквозная цепочка CRM→CRM', 'tests/email-chain-e2e.js'],
  ['Светофор: паритет SQL↔JS', 'tests/doc-traffic-parity-e2e.js'],
  ['Безопасность реестра', 'tests/doc-hub-security-e2e.js'],
  ['N1/N2/N3 (гонки, оракулы)', 'tests/doc-hub-nfix-e2e.js'],
  ['Акты сверки', 'tests/doc-recon-e2e.js'],
  ['Акты: файл, светофор, зачёты', 'tests/doc-recon-acts-ext.js'],
  ['Акты: утечка файла и traversal', 'tests/doc-recon-leak-fix.js'],
  ['Крон-дайджест', 'tests/doc-digest-e2e.js'],
  ['Входящие СФ', 'tests/doc-incoming-sf-e2e.js'],
  ['Касса бухгалтерии', 'tests/doc-buh-cash-e2e.js'],
  ['Реестр+архив бухгалтерии', 'tests/doc-buh-archive-e2e.js'],
  ['Счёт→заявка→номенклатура', 'tests/doc-hub-intake-nomenclature.js'],
  ['Расход по объекту без дублей', 'tests/expense-dedup.test.js'],
];

let totalPass = 0, totalFail = 0; const failed = [];

async function main() {
  console.log('СВОДНЫЙ ПРОГОН ТЕСТОВ Doc Hub\n' + '='.repeat(60));
  const runOne = (file) => {
    const r = spawnSync('node', [file], { encoding: 'utf8', env: process.env, timeout: 300000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const m = out.match(/PASS (\d+) \/ FAIL (\d+)/);
    return { m, p: m ? parseInt(m[1], 10) : 0, f: m ? parseInt(m[2], 10) : (r.status ? 1 : 0), out };
  };
  for (const [name, file] of TESTS) {
    // /api/auth/login ограничен 5 попытками в минуту (src/routes/auth.js:320).
    // На 21 тесте подряд лимит исчерпывался и тесты «падали» — это ограничение
    // стенда, не кода: даём окно перед каждым прогоном.
    await new Promise((res) => setTimeout(res, 13000));
    let { m, p, f, out } = runOne(file);
    // Если упало, а тест зелёный на изоляции — почти всегда это 429 по логину.
    // Даём окну восстановиться и повторяем ОДИН раз (не маскируем реальный баг:
    // при повторном падении результат остаётся FAIL).
    if (f > 0 || !m) {
      await new Promise((res) => setTimeout(res, 45000));
      const again = runOne(file);
      if (again.f === 0 && again.m) { m = again.m; p = again.p; f = 0; }
      else { m = again.m; p = again.p; f = again.f; out = again.out; }
    }
    totalPass += p; totalFail += f;
    if (f > 0 || !m) failed.push(name);
    console.log(`${f === 0 && m ? 'OK  ' : 'FAIL'}  ${name.padEnd(34)} PASS ${p} / FAIL ${f}`);
  }
  console.log('='.repeat(60));
  console.log(`ИТОГО: PASS ${totalPass} / FAIL ${totalFail}`);
  if (failed.length) console.log('ПРОВАЛЫ: ' + failed.join(', '));
  process.exit(totalFail ? 1 : 0);
}

main();
