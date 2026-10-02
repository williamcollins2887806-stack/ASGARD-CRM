'use strict';

const assert = require('assert');
const { MockAmi } = require('./_mocks');

module.exports.id = 'S14';

module.exports.run = async function run() {
  const ami = new MockAmi();
  await ami.hangup('PJSIP/stuck');
  assert.ok(ami.actions.some((a) => a.Action === 'Hangup'));
};
