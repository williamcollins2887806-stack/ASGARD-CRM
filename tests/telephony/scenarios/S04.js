'use strict';

const assert = require('assert');
const { MockAmi } = require('./_mocks');

module.exports.id = 'S04';

module.exports.run = async function run() {
  const ami = new MockAmi();
  await ami.connect();
  await ami.setVar('PJSIP/inbound-0001', 'DTMF_DIGIT', '1');
  const ok = await ami.waitForDtmf('PJSIP/inbound-0001', '1', 1000);
  assert.strictEqual(ok, true, 'confirm press 1');
};
