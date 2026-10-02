'use strict';

const { getAmiClient, amiConfigured } = require('./ami-client');

const FAMILY = 'ASGARD/PBX/online';

async function setOperatorOnline(userId, online) {
  if (!amiConfigured()) throw new Error('AMI not configured');
  const ami = getAmiClient();
  await ami.action({
    Action: 'DbPut',
    Family: FAMILY,
    Key: String(userId),
    Val: online ? '1' : '0',
  });
}

async function getOperatorOnline(userId) {
  if (!amiConfigured()) throw new Error('AMI not configured');
  const ami = getAmiClient();
  const res = await ami.action({
    Action: 'DbGet',
    Family: FAMILY,
    Key: String(userId),
  });
  return res.Val === '1';
}

async function listOnlineFromAstDb() {
  if (!amiConfigured()) throw new Error('AMI not configured');
  const ami = getAmiClient();
  const res = await ami.action({
    Action: 'DbGetTree',
    Family: FAMILY,
  });
  const raw = res.Val || '';
  const ids = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\d+):\s*1$/);
    if (m) ids.push(parseInt(m[1], 10));
  }
  return ids;
}

module.exports = {
  FAMILY,
  setOperatorOnline,
  getOperatorOnline,
  listOnlineFromAstDb,
};
