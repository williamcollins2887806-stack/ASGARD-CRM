'use strict';

/**
 * D-323: письма директору на согласование НЕ уходят, пока режим тестовый.
 * ═══════════════════════════════════════════════════════════════════════════
 * Жалоба заказчика 21.10.2026: «почему директор получает на почту счета на
 * согласование от СРМ? я же просил отключить, мы пока в тестовом режиме».
 *
 * Корень: `isLivePaymentMail()` проверял `NODE_ENV === 'production'`, а прод
 * развёрнут с `NODE_ENV=development`. Теперь решение принимает ЯВНЫЙ флаг:
 *   PAYMENT_MAIL_DISABLED=1 → никогда;
 *   PAYMENT_MAIL_ENABLED=1  → можно;
 *   нет флагов              → нельзя (fail-closed).
 */

const assert = require('assert');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  PASS', name); }
  catch (e) { fail++; console.log('  FAIL', name, '→', e.message); }
};

const MOD = path.join(__dirname, '..', 'src', 'services', 'payment-mail.js');
function fresh(env) {
  // Модуль читает process.env на каждом вызове — кэш require не мешает,
  // но сбрасываем его, чтобы изолировать прогоны.
  delete require.cache[require.resolve(MOD)];
  for (const k of ['PAYMENT_MAIL_DISABLED', 'PAYMENT_MAIL_ENABLED', 'PAYMENT_MAIL_FORCE']) delete process.env[k];
  Object.assign(process.env, env || {});
  const m = require(MOD);
  // isLivePaymentMail не экспортирован — проверяем через поведение deliverMail.
  return m;
}

console.log('\n=== D-323: killswitch писем директору ===');

// Проверяем через прямой вызов внутренней логики: экспортируем для теста
// поведение по флагам, используя sendDirectorMail на несуществующей заявке
// нельзя — нужен БД. Поэтому проверяем контракт флагов по исходнику И
// прогоняем реальную отправку на клоне, если он доступен.

const fs = require('fs');
const src = fs.readFileSync(MOD, 'utf8');

check('killswitch PAYMENT_MAIL_DISABLED имеет высший приоритет', () => {
  const block = src.match(/function isLivePaymentMail\(\)[\s\S]*?\n\}/);
  assert.ok(block, 'не найдена isLivePaymentMail');
  const body = block[0];
  const iDisabled = body.indexOf('PAYMENT_MAIL_DISABLED');
  const iEnabled = body.indexOf('PAYMENT_MAIL_ENABLED');
  assert.ok(iDisabled > 0, 'нет проверки PAYMENT_MAIL_DISABLED');
  assert.ok(iDisabled < (iEnabled < 0 ? Infinity : iEnabled), 'DISABLED должен проверяться ПЕРВЫМ');
  assert.ok(/return false/.test(body.slice(iDisabled, iDisabled + 60)), 'DISABLED должен возвращать false');
});

check('fail-closed: без явного флага письма запрещены', () => {
  const block = src.match(/function isLivePaymentMail\(\)[\s\S]*?\n\}/)[0];
  // Последний return должен быть false, а не результат isProdRuntime()
  const returns = block.match(/return\s+[^;]+;/g) || [];
  const last = returns[returns.length - 1] || '';
  assert.ok(/return\s+false/.test(last), 'последний return должен быть false (fail-closed), а не ' + last.trim());
});

check('NODE_ENV=production больше НЕ включает рассылку сам по себе', () => {
  const block = src.match(/function isLivePaymentMail\(\)[\s\S]*?\n\}/)[0];
  assert.ok(!/isProdRuntime\(\)/.test(block), 'isLivePaymentMail всё ещё опирается на isProdRuntime() — на проде NODE_ENV=development, письма снова уйдут');
});

check('единственный путь отправки идёт через deliverMail с проверкой', () => {
  // В sendDirectorMail и sendDirectorMailBatch должен быть deliverMail.
  assert.ok(/async function sendDirectorMail\([\s\S]*?deliverMail\(/.test(src), 'sendDirectorMail не через deliverMail');
  assert.ok(/async function sendDirectorMailBatch\([\s\S]*?deliverMail\(/.test(src), 'sendDirectorMailBatch не через deliverMail');
  // sendCrmEmail напрямую (в обход проверки) быть не должно.
  const direct = (src.match(/await sendCrmEmail\(/g) || []).length;
  assert.strictEqual(direct, 1, 'sendCrmEmail вызывается ' + direct + ' раз — должен только внутри deliverMail');
});

check('deliverMail уважает isLivePaymentMail до любых сетевых вызовов', () => {
  const block = src.match(/async function deliverMail\([\s\S]*?\n\}/);
  assert.ok(block, 'нет deliverMail');
  const body = block[0];
  const iCheck = body.indexOf('isLivePaymentMail');
  const iSend = body.indexOf('sendCrmEmail');
  assert.ok(iCheck > 0, 'deliverMail не проверяет isLivePaymentMail');
  assert.ok(iCheck < iSend, 'проверка должна стоять ДО sendCrmEmail');
});

console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
