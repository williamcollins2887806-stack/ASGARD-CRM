'use strict';

const assert = require('assert');
const { newMockAmi, cmdHold, cmdBridge } = require('./cmd-contract');

module.exports.id = 'S10';

module.exports.run = async function run() {
  const ami = newMockAmi();
  await cmdHold(ami, { channel: 'PJSIP/a', hold: true });
  assert.ok(ami.actions.some((a) => a.Action === 'Redirect' && a.context === 'hold'));
  await cmdBridge(ami, { channel1: 'PJSIP/a', channel2: 'PJSIP/consult' });
  assert.ok(ami.actions.some((a) => a.Action === 'Bridge'));
};
