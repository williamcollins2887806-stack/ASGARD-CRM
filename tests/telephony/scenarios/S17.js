'use strict';

const assert = require('assert');
const { MockAmi } = require('./_mocks');

module.exports.id = 'S17';

module.exports.run = async function run() {
  const ami = new MockAmi();
  await ami.setVar('PJSIP/x', 'TRANSFER_TARGET', 'u2');
  const v = await ami.getVar('PJSIP/x', 'TRANSFER_TARGET');
  assert.strictEqual(v, 'u2');
};
