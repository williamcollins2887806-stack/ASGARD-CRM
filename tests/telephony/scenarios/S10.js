'use strict';

const assert = require('assert');
const { MockAmi } = require('./_mocks');

module.exports.id = 'S10';

module.exports.run = async function run() {
  const ami = new MockAmi();
  await ami.setVar('PJSIP/a', 'HOLD', '1');
  await ami.bridge('PJSIP/a', 'PJSIP/consult');
  assert.ok(ami.actions.some((a) => a.Action === 'Bridge'));
};
