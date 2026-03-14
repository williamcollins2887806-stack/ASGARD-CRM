'use strict';

/**
 * ASGARD CRM — E2E Webhook Simulator
 * Симулирует полный цикл звонка через HTTP запросы к webhook endpoints
 *
 * Использование:
 *   node tests/telephony/e2e-webhook-simulator.js
 *
 * Примечание: требуется настроенный MANGO_API_KEY и MANGO_API_SALT
 * для корректной подписи. Без них тест проверяет только доступность endpoints.
 */

const https = require('https');
const crypto = require('crypto');
const helpers = require('./helpers');

const BASE_URL = process.env.TEST_URL || 'https://127.0.0.1';
const API_KEY = process.env.MANGO_API_KEY || '';
const API_SALT = process.env.MANGO_API_SALT || '';

function sign(json) {
  return crypto.createHash('sha256').update(API_KEY + json + API_SALT).digest('hex');
}

function postWebhook(path, data) {
  const json = JSON.stringify(data);
  const postData = `vpbx_api_key=${encodeURIComponent(API_KEY)}&sign=${encodeURIComponent(sign(json))}&json=${encodeURIComponent(json)}`;

  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      },
      rejectUnauthorized: false
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function simulateIncomingCall() {
  const entryId = 'sim_' + Date.now();
  const callId = 'sim_call_' + Date.now();
  const callerNumber = '79161234567';
  const extension = '200';

  console.log('\n═══ E2E: Симуляция входящего звонка ═══');
  console.log(`  Entry ID: ${entryId}`);
  console.log(`  Caller:   ${callerNumber}`);
  console.log(`  Extension: ${extension}`);

  // Шаг 1: Звонок появился
  console.log('\n  [1] Sending call:Appeared...');
  const r1 = await postWebhook('/api/telephony/webhook/events/call', {
    entry_id: entryId,
    call_id: callId,
    timestamp: Math.floor(Date.now() / 1000),
    seq: 1,
    call_state: 'Appeared',
    location: 'abonent',
    from: { number: callerNumber },
    to: { number: extension, line_number: '74951234567' },
    call_direction: 1
  });
  console.log(`      Response: ${r1.status} ${r1.body.slice(0, 100)}`);

  await sleep(1000);

  // Шаг 2: Звонок подключён
  console.log('  [2] Sending call:Connected...');
  const r2 = await postWebhook('/api/telephony/webhook/events/call', {
    entry_id: entryId,
    call_id: callId,
    timestamp: Math.floor(Date.now() / 1000),
    seq: 2,
    call_state: 'Connected',
    location: 'abonent',
    from: { number: callerNumber },
    to: { number: extension },
    call_direction: 1
  });
  console.log(`      Response: ${r2.status} ${r2.body.slice(0, 100)}`);

  await sleep(2000);

  // Шаг 3: Звонок завершён
  console.log('  [3] Sending call:Disconnected...');
  const r3 = await postWebhook('/api/telephony/webhook/events/call', {
    entry_id: entryId,
    call_id: callId,
    timestamp: Math.floor(Date.now() / 1000),
    seq: 3,
    call_state: 'Disconnected',
    location: 'abonent',
    from: { number: callerNumber },
    to: { number: extension },
    call_direction: 1,
    disconnect_reason: 1100
  });
  console.log(`      Response: ${r3.status} ${r3.body.slice(0, 100)}`);

  await sleep(500);

  // Шаг 4: Summary
  console.log('  [4] Sending summary...');
  const now = Math.floor(Date.now() / 1000);
  const r4 = await postWebhook('/api/telephony/webhook/events/summary', {
    entry_id: entryId,
    call_direction: 1,
    from: { number: callerNumber },
    to: { number: extension, line_number: '74951234567' },
    line_number: '74951234567',
    create_ts: now - 65,
    forward_ts: now - 60,
    talk_ts: now - 55,
    end_ts: now,
    entry_result: 1,
    talk_duration: 55,
    is_record: 1,
    recording_id: 'rec_' + entryId,
    disconnect_reason: 1100
  });
  console.log(`      Response: ${r4.status} ${r4.body.slice(0, 100)}`);

  console.log('\n  ✅ Симуляция завершена');
  return { entryId, callId };
}

async function simulateMissedCall() {
  const entryId = 'missed_' + Date.now();
  const callerNumber = '79999888777';

  console.log('\n═══ E2E: Симуляция пропущенного звонка ═══');

  // Появился
  console.log('  [1] Sending call:Appeared...');
  await postWebhook('/api/telephony/webhook/events/call', {
    entry_id: entryId,
    call_id: entryId,
    timestamp: Math.floor(Date.now() / 1000),
    seq: 1,
    call_state: 'Appeared',
    location: 'abonent',
    from: { number: callerNumber },
    to: { number: '200' },
    call_direction: 1
  });

  await sleep(500);

  // Отключён (не ответили)
  console.log('  [2] Sending call:Disconnected...');
  await postWebhook('/api/telephony/webhook/events/call', {
    entry_id: entryId,
    call_id: entryId,
    timestamp: Math.floor(Date.now() / 1000),
    seq: 2,
    call_state: 'Disconnected',
    location: 'abonent',
    from: { number: callerNumber },
    to: { number: '200' },
    call_direction: 1,
    disconnect_reason: 1110
  });

  await sleep(500);

  // Summary (missed)
  const now = Math.floor(Date.now() / 1000);
  console.log('  [3] Sending missed summary...');
  await postWebhook('/api/telephony/webhook/events/summary', {
    entry_id: entryId,
    call_direction: 1,
    from: { number: callerNumber },
    to: { number: '200' },
    create_ts: now - 10,
    forward_ts: 0,
    talk_ts: 0,
    end_ts: now,
    entry_result: 0,
    talk_duration: 0,
    is_record: 0,
    disconnect_reason: 1110
  });

  console.log('  ✅ Пропущенный звонок отправлен');
}

async function testPing() {
  console.log('\n═══ E2E: Ping ═══');
  const r = await postWebhook('/api/telephony/webhook/ping', {});
  console.log(`  Response: ${r.status}`);
  if (r.status !== 200) console.log('  ⚠️  Ping returned non-200');
  else console.log('  ✅ Ping OK');
}

// Main
async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  📞 TELEPHONY E2E WEBHOOK SIMULATOR          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Mango configured: ${!!(API_KEY && API_SALT)}`);

  try {
    await testPing();
    await simulateIncomingCall();
    await simulateMissedCall();

    console.log('\n═══════════════════════════════════');
    console.log('  ✅ Все симуляции выполнены');
    console.log('═══════════════════════════════════\n');
  } catch (err) {
    console.error('\n  ❌ Ошибка:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { simulateIncomingCall, simulateMissedCall, testPing };
