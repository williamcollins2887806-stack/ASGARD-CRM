'use strict';

const assert = require('assert');
const { newMockAmi, cmdTransferConsult } = require('./cmd-contract');

module.exports.id = 'S11';

module.exports.run = async function run() {
  const ami = newMockAmi();
  await cmdTransferConsult(ami, { channel: 'PJSIP/main', target: 'u_consult' });
  assert.ok(ami.actions.some((a) => a.Action === 'Redirect' && a.context === 'hold'));
  assert.ok(ami.actions.some((a) => a.Action === 'Originate' && a.Exten === 'consult'));
};
