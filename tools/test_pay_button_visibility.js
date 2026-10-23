'use strict';
/**
 * D-365/D-366: тесты видимости кнопки «В очередь оплаты» и очистки черновиков.
 */
const assert = require('assert');

// Копия payActionState из doc-hub.js (держать синхронно)
function payActionState(row) {
  const st = String(row.payment_invoice_status || '');
  if (st && st !== 'rejected') {
    const label = {
      draft: 'черновик заявки',
      awaiting_dir: 'на согласовании у директора',
      pending_payment: 'согласовано, ждёт оплаты',
      paid: 'оплачено'
    }[st] || st;
    return { show: false, allowed: false, reason: 'already', label };
  }
  if (row.pay_status === 'approved_by_dir') {
    return { show: false, allowed: false, reason: 'archive', label: 'согласован' };
  }
  if (row.pay_status === 'paid') {
    return { show: false, allowed: false, reason: 'paid', label: 'оплачено' };
  }
  return { show: true, allowed: true, reason: '', label: '' };
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail++; }
}

console.log('=== 1. Заявка есть → кнопки НЕТ (действие уже сделано) ===');
for (const st of ['draft', 'awaiting_dir', 'pending_payment', 'paid']) {
  t(`${st} → кнопка скрыта`, () => {
    const r = payActionState({ payment_invoice_status: st });
    assert.strictEqual(r.show, false, 'кнопку показывать нельзя');
  });
}

console.log('\n=== 2. Архив с пройденным согласованием → кнопки НЕТ ===');
t('approved_by_dir → кнопка скрыта', () => {
  const r = payActionState({ pay_status: 'approved_by_dir' });
  assert.strictEqual(r.show, false);
  assert.strictEqual(r.reason, 'archive');
});
t('paid → кнопка скрыта', () => {
  assert.strictEqual(payActionState({ pay_status: 'paid' }).show, false);
});

console.log('\n=== 3. Заявки нет вовсе → кнопка ЕСТЬ ===');
t('пустая строка → кнопка видна и активна', () => {
  const r = payActionState({});
  assert.strictEqual(r.show, true);
  assert.strictEqual(r.allowed, true);
});
t('pay_status=none → кнопка видна', () => {
  assert.strictEqual(payActionState({ pay_status: 'none' }).show, true);
});
t('pay_status=wait → кнопка видна (ждёт оплаты без заявки)', () => {
  assert.strictEqual(payActionState({ pay_status: 'wait' }).show, true);
});

console.log('\n=== 4. Отклонённая заявка не скрывает кнопку ===');
t('rejected → кнопка видна (можно отправить заново)', () => {
  const r = payActionState({ payment_invoice_status: 'rejected' });
  assert.strictEqual(r.show, true);
});

console.log('\n=== 5. Приоритет: живая заявка важнее pay_status ===');
t('awaiting_dir + paid → скрыта по заявке', () => {
  const r = payActionState({ payment_invoice_status: 'awaiting_dir', pay_status: 'paid' });
  assert.strictEqual(r.show, false);
  assert.strictEqual(r.reason, 'already');
});

console.log('\n=== 6. Логика очистки черновиков (правила, без БД) ===');
/** Закрывать ли черновик: старше TTL и без документа реестра. */
function shouldCloseDraft(row, ttlHours, now) {
  if (row.status !== 'draft') return false;
  if (row.doc_registry_id) return false;          // уже попал в реестр — не трогаем
  const ageH = (now - new Date(row.created_at).getTime()) / 3600000;
  return ageH > ttlHours;
}
const now = Date.now();
t('свежий черновик (1ч) → НЕ закрываем', () => {
  assert.strictEqual(shouldCloseDraft({ status: 'draft', created_at: new Date(now - 3600000) }, 168, now), false);
});
t('старый черновик (8 суток) → закрываем', () => {
  assert.strictEqual(shouldCloseDraft({ status: 'draft', created_at: new Date(now - 8 * 24 * 3600000) }, 168, now), true);
});
t('черновик с документом реестра → НЕ закрываем', () => {
  assert.strictEqual(shouldCloseDraft({
    status: 'draft', doc_registry_id: 123, created_at: new Date(now - 30 * 24 * 3600000)
  }, 168, now), false);
});
t('не черновик → НЕ закрываем', () => {
  assert.strictEqual(shouldCloseDraft({
    status: 'awaiting_dir', created_at: new Date(now - 30 * 24 * 3600000)
  }, 168, now), false);
});

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
if (fail) process.exitCode = 1;
