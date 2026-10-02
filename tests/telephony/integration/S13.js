'use strict';

const assert = require('assert');
const { newMockAmi, cmdHold } = require('./cmd-contract');

module.exports.id = 'S13';

module.exports.run = async function run() {
  const ami = newMockAmi();
  await cmdHold(ami, { channel: 'PJSIP/in', hold: false });
  assert.ok(
    ami.actions.some((a) => a.Action === 'Redirect' && a.context === 'from-mango-inbound')
  );
};
