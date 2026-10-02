'use strict';

const assert = require('assert');
const { newMockAmi, cmdTransferBlind } = require('./cmd-contract');

module.exports.id = 'S09';

module.exports.run = async function run() {
  const ami = newMockAmi();
  await cmdTransferBlind(ami, { channel: 'PJSIP/caller-1', target: 'u2_peer' });
  assert.ok(ami.actions.some((a) => a.Action === 'Redirect' && a.exten === 'blind'));
  const ch = ami.channels.get('PJSIP/caller-1');
  assert.strictEqual(ch.TRANSFER_TARGET, 'u2_peer');
};
