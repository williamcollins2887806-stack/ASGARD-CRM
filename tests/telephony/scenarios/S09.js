'use strict';

const assert = require('assert');
const { MockAmi } = require('./_mocks');

module.exports.id = 'S09';

module.exports.run = async function run() {
  const ami = new MockAmi();
  await ami.redirect('PJSIP/caller-1', 'transfer', 'blind', 1);
  assert.ok(ami.actions.some((a) => a.Action === 'Redirect' && a.exten === 'blind'));
};
