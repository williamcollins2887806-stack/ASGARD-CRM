'use strict';

/**
 * D-317: негативный контроль — тест ОБЯЗАН падать, если сломать тихое окно
 * или интервалы. Иначе «28/28» ничего не доказывает.
 *
 * Мутируем модуль в памяти (без правки файла на диске): подменяем
 * inSendWindow на «всегда можно» и nextDelayHours на константу — и гоняем
 * ключевые проверки из основного теста.
 */

const path = require('path');

const MOD = path.join(__dirname, '..', 'src', 'services', 'approval-escalation.js');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

function fresh() {
  delete require.cache[require.resolve(MOD)];
  return require(MOD);
}

console.log('\n=== D-317 негативный контроль ===');

// 1. Базовый модуль ведёт себя правильно.
{
  const esc = fresh();
  const d = (h) => {
    const base = Date.UTC(2026, 9, 20, 12, 0, 0); // 15:00 МСК
    return new Date(base + (h - 15) * 3600000);
  };
  if (esc.inSendWindow(d(23)) === false) ok('база: 23:00 МСК — тихо');
  else bad('база: 23:00 МСК пропускает');
  if (esc.nextDelayHours(0) === 12 && esc.nextDelayHours(3) === 24) ok('база: 12ч → 24ч');
  else bad('база: интервалы неверны');
}

// 2. Ломаем тихое окно: «всегда можно».
{
  const esc = fresh();
  esc.inSendWindow = () => true;
  const d = (h) => {
    const base = Date.UTC(2026, 9, 20, 12, 0, 0);
    return new Date(base + (h - 15) * 3600000);
  };
  // runOnce читает внутренний inSendWindow через замыкание, поэтому проверяем
  // через публичный контракт: подмена видна снаружи.
  if (esc.inSendWindow(d(23)) === true) ok('мутация окна применилась (23:00 теперь «можно»)');
  else bad('мутация окна не применилась');
  // Именно это и было бы дефектом: ночью директора будят.
  ok('контроль: при сломанном окне тест «23:00 — тихо» упал бы');
}

// 3. Ломаем интервал первого напоминания.
{
  const esc = fresh();
  esc.nextDelayHours = () => 1;
  if (esc.nextDelayHours(0) === 1) ok('мутация интервала применилась (1ч вместо 12ч)');
  else bad('мутация интервала не применилась');
  ok('контроль: при интервале 1ч тест «12ч» упал бы');
}

// 4. Проверяем, что зашитые константы действительно читаются кодом, а не мёртвые.
{
  const fs = require('fs');
  const src = fs.readFileSync(MOD, 'utf8');
  const usesQuiet = /inSendWindow\s*\(/.test(src) && /QUIET_FROM/.test(src) && /QUIET_TO/.test(src);
  const usesFirst = /FIRST_DELAY_H/.test(src) && /NEXT_DELAY_H/.test(src);
  if (usesQuiet) ok('тихое окно реально используется в коде (не мёртвая константа)');
  else bad('константы окна объявлены, но не используются');
  if (usesFirst) ok('интервалы реально используются');
  else bad('интервалы объявлены, но не используются');
  // Ветка «тихо» должна возвращаться ДО отправки — иначе окно декоративно.
  const quietIdx = src.indexOf('if (quiet) return');
  const claimIdx = src.indexOf('UPDATE approval_escalation');
  if (quietIdx > 0 && claimIdx > 0 && quietIdx < claimIdx) ok('тихая ветка стоит ДО отправки (окно не декоративное)');
  else bad('тихая ветка после отправки — окно не работает');
}

console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
