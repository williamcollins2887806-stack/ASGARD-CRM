'use strict';

const assert = require('assert');
const { buildRingNotifyPayload } = require('../../../src/pbx/call-lifecycle');

module.exports.id = 'S24';

module.exports.run = async function run() {
  const payload = buildRingNotifyPayload({
    pbxUid: 'test-uid',
    caller: '+74951234567',
    lookup: { name: 'Ivan', company: 'OOO Test', inn: '1234567890', type: 'customer' },
    target: { userId: 42, targetType: 'webrtc' },
    channel: 'PJSIP/x',
    callHistoryId: 1001,
  });
  assert.strictEqual(payload.event, 'call:incoming');
  assert.strictEqual(payload.user_id, 42);
  const d = payload.data;
  assert.ok(d.call_id && d.callId);
  assert.strictEqual(d.from_number, '+74951234567');
  assert.strictEqual(d.fromNumber, '+74951234567');
  assert.strictEqual(d.client_name, 'Ivan');
  assert.strictEqual(d.clientName, 'Ivan');
  assert.strictEqual(d.client_company, 'OOO Test');
  assert.strictEqual(d.clientCompany, 'OOO Test');
  assert.strictEqual(d.pbx_uid, 'test-uid');
};
