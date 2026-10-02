'use strict';

const assert = require('assert');
const astDb = require('../../../src/pbx/ast-db-fallback');

module.exports.id = 'S19';

module.exports.run = async function run() {
  assert.strictEqual(typeof astDb.setOperatorOnline, 'function');
  assert.strictEqual(typeof astDb.getOperatorOnline, 'function');
  assert.strictEqual(typeof astDb.listOnlineFromAstDb, 'function');
  assert.ok(astDb.FAMILY.includes('ASGARD/PBX/online'));
};
