'use strict';
/**
 * D-362/D-363: тесты защиты от двойной отправки в оплату.
 * Логика: если у строки есть живая заявка или pay_status=paid — вторую не создаём.
 */
const assert = require('assert');

// Копия canSendToPay из doc-hub.js (держать синхронно)
function canSendToPay(row) {
  const st = String(row.payment_invoice_status || '');
  if (st && st !== 'rejected') {
    const label = {
      draft: 'черновик заявки',
      awaiting_dir: 'на согласовании у директора',
      pending_payment: 'согласовано, ждёт оплаты',
      paid: 'оплачено'
    }[st] || st;
    return { allowed: false, reason: 'already', label };
  }
  if (row.pay_status === 'paid') return { allowed: false, reason: 'paid', label: 'оплачено' };
  return { allowed: true, reason: '', label: '' };
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail++; }
}

console.log('=== 1. Живая заявка → отправлять НЕЛЬЗЯ ===');
for (const [st, label] of [
  ['draft', 'черновик заявки'],
  ['awaiting_dir', 'на согласовании у директора'],
  ['pending_payment', 'согласовано, ждёт оплаты'],
  ['paid', 'оплачено']
]) {
  t(`${st} → запрещено (${label})`, () => {
    const r = canSendToPay({ payment_invoice_status: st });
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.label, label);
  });
}

console.log('\n=== 2. Нет заявки → можно ===');
t('заявки нет → разрешено', () => {
  const r = canSendToPay({ pay_status: 'none' });
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.reason, '');
});
t('пустые поля → разрешено', () => {
  assert.strictEqual(canSendToPay({}).allowed, true);
});

console.log('\n=== 3. Отклонённая заявка не блокирует (можно создать новую) ===');
t('rejected → разрешено', () => {
  assert.strictEqual(canSendToPay({ payment_invoice_status: 'rejected' }).allowed, true);
});
t('статус пустой, но rejected в базе не придёт (JOIN фильтрует) → разрешено', () => {
  assert.strictEqual(canSendToPay({ payment_invoice_status: null }).allowed, true);
});

console.log('\n=== 4. pay_status=paid без заявки (старая ручная отметка) → нельзя ===');
t('paid → запрещено', () => {
  const r = canSendToPay({ pay_status: 'paid' });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'paid');
});

console.log('\n=== 5. Приоритет: живая заявка важнее pay_status ===');
t('awaiting_dir + pay_status=paid → показывает этап заявки', () => {
  const r = canSendToPay({ payment_invoice_status: 'awaiting_dir', pay_status: 'paid' });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.label, 'на согласовании у директора');
});

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
if (fail) process.exitCode = 1;
