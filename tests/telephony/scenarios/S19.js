'use strict';

const assert = require('assert');
const { MockAmi } = require('./_mocks');

module.exports.id = 'S19';

module.exports.run = async function run() {
  const ami = new MockAmi();
  const ok = await ami.waitForDtmf('PJSIP/nodtmf', '1', 300);
  assert.strictEqual(ok, false);
};
