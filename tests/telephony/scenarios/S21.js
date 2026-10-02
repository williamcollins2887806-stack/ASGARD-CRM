'use strict';

const assert = require('assert');
const { MockAmi } = require('./_mocks');

module.exports.id = 'S21';

module.exports.run = async function run() {
  const ami = new MockAmi();
  await ami.action({ Action: 'DbPut', Family: 'ASGARD/PBX/online', Key: '7', Val: '1' });
  assert.ok(ami.actions.length >= 1);
};
