'use strict';

const assert = require('assert');
const { MockAmi } = require('./_mocks');

module.exports.id = 'S08';

module.exports.run = async function run() {
  const ami = new MockAmi();
  await ami.connect();
  await ami.originate({
    channel: 'PJSIP/operator1',
    context: 'outbound-crm',
    exten: '74993223062',
    priority: 1,
    callerId: 'ASGARD <74993223062>',
  });
  assert.ok(ami.actions.some((a) => a.Action === 'Originate'));
};
