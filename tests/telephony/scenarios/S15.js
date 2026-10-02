'use strict';

const assert = require('assert');
const { MockAgiSession } = require('./_mocks');

module.exports.id = 'S15';

module.exports.run = async function run() {
  const agi = new MockAgiSession({ agi_callerid: '+79001112233' });
  await agi.setVariable('CALLERID(num)', agi.env.agi_callerid);
  assert.strictEqual(agi.vars['CALLERID(num)'], '+79001112233');
};
