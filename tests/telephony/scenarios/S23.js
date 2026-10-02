'use strict';

const assert = require('assert');
const { MockAgiSession } = require('./_mocks');

module.exports.id = 'S23';

module.exports.run = async function run() {
  const agi = new MockAgiSession();
  await agi.setVariable('ASGARD_PBX_UID', 'call-test-uuid');
  assert.ok(agi.vars.ASGARD_PBX_UID);
};
