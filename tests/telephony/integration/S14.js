'use strict';

const assert = require('assert');
const { newMockAmi, cmdHangup } = require('./cmd-contract');

module.exports.id = 'S14';

module.exports.run = async function run() {
  const ami = newMockAmi();
  await cmdHangup(ami, { channel: 'PJSIP/stuck' });
  assert.ok(ami.actions.some((a) => a.Action === 'Hangup'));
};
