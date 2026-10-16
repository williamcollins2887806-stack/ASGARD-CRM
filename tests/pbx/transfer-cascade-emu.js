'use strict';
/**
 * Эмуляция resolveTransferDial без звонка (L3, 12.10.2026).
 *
 * Прогоняет каскад перевода для всех входов и печатает таблицу:
 *   вход -> targets[] -> TRANSFER_DIAL / TRANSFER_FALLBACK / TRANSFER_RETURN_DIAL.
 *
 * Использует мок-БД: db.connect() -> client с query(), реагирующий на SQL.
 * Ничего не деплоит и не звонит.
 *
 * Usage: node tests/pbx/transfer-cascade-emu.js
 */
const { resolveTransferDial } = require('../../src/pbx/index');

const CFG = { browser_ring_sec: 10, mobile_ring_sec: 30 };

function mockDb(op, initiator) {
  return {
    connect: async () => ({
      query: async (sql) => {
        // loadPbxConfig
        if (/FROM settings/i.test(sql)) {
          return { rows: [{ value_json: JSON.stringify(CFG) }] };
        }
        // целевой оператор (по user_id или sip/mobile)
        if (/JOIN users u ON u\.id = o\.user_id/i.test(sql) && !/WHERE o\.user_id = \$1\s*$/.test(sql + '')) {
          return { rows: op ? [op] : [] };
        }
        if (/WHERE o\.user_id = \$1/i.test(sql)) {
          return { rows: op ? [op] : [] };
        }
        return { rows: [] };
      },
      release: () => {},
    }),
  };
}

async function run(label, op, body) {
  const db = mockDb(op, null);
  let out;
  try {
    out = await resolveTransferDial(db, body);
  } catch (e) {
    out = { error: e.message };
  }
  const first = out.targets && out.targets[0];
  const second = out.targets && out.targets[1];
  console.log(
    `${label.padEnd(34)} | dial=${String(out.dial || '(пусто)').padEnd(34)}` +
    ` | fallback=${String(out.fallback || '(пусто)').padEnd(34)}` +
    ` | ret=${out.returnDial || '(пусто)'}` +
    ` | t1=${first ? first.targetType : '-'} t2=${second ? second.targetType : '-'}` +
    ` | timeout=${out.timeout}/${out.fallbackTimeout}`
  );
}

async function main() {
  const OP_FULL = {
    user_id: 3474, sip_username: 'u3474', mobile_phone: '79160614809',
    webrtc_registered: true, receive_mode: 'browser', on_line: true, can_accept: true,
  };
  const OP_NO_MOBILE = {
    user_id: 3474, sip_username: 'u3474', mobile_phone: null,
    webrtc_registered: true, receive_mode: 'browser', on_line: true, can_accept: true,
  };
  const OP_NO_SIP = {
    user_id: 3474, sip_username: null, mobile_phone: '79160614809',
    webrtc_registered: false, receive_mode: 'mobile', on_line: true, can_accept: true,
  };

  console.log('=== resolveTransferDial: каскад (эмуляция) ===');
  console.log('INITIATOR (кто переводит): user_id=1, sip=u1');
  await run("browser + online  (есть моб.)", OP_FULL, { target: '3474', target_mode: 'webrtc', user_id: 1 });
  await run("mobile  + online", OP_FULL, { target: '3474', target_mode: 'mobile', user_id: 1 });
  await run("mode не задан (default)", OP_FULL, { target: '3474', user_id: 1 });
  await run("нет мобильного (browser)", OP_NO_MOBILE, { target: '3474', target_mode: 'webrtc', user_id: 1 });
  await run("нет SIP (mobile fallback)", OP_NO_SIP, { target: '3474', target_mode: 'webrtc', user_id: 1 });
  await run("mobile-режим без SIP", OP_NO_SIP, { target: '3474', target_mode: 'mobile', user_id: 1 });
  await run("невалидный mode ('x')", OP_FULL, { target: '3474', target_mode: 'x', user_id: 1 });
  await run("пустой target", OP_FULL, { target: '', target_mode: 'webrtc', user_id: 1 });
  await run("номер напрямую (PSTN)", null, { target: '79267638055', user_id: 1 });
}

main().catch((e) => { console.error(e); process.exit(1); });
