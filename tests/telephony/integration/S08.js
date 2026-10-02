'use strict';

const assert = require('assert');
const { newMockAmi, cmdOriginateOutbound } = require('./cmd-contract');

module.exports.id = 'S08';

module.exports.run = async function run() {
  const ami = newMockAmi();
  await ami.connect();
  await cmdOriginateOutbound(ami, {
    channel: 'PJSIP/operator1',
    context: 'outbound-crm',
    exten: '74993223062',
    callerId: 'ASGARD <74993223062>',
  });
  assert.ok(ami.actions.some((a) => a.Action === 'Originate'));
};
