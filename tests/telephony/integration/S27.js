'use strict';

/**
 * S27: реальный createCmdServer — finalize с loopback без secret = OK;
 * AMI-команды без secret = 401; dialplan несёт X-PBX-Secret header.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {
  createPool,
  pickActiveUserId,
  runInbound,
  cleanupCall,
  seedOperators,
  setDutyUser,
  ensurePbxConfig,
} = require('./harness');

module.exports.id = 'S27';

function postJson(port, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? '' : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports.run = async function run() {
  const dialplan = fs.readFileSync(
    path.join(__dirname, '../../../ops/asterisk/extensions_asgard.conf'),
    'utf8'
  );
  assert.ok(dialplan.includes('X-PBX-Secret'), 'dialplan must send X-PBX-Secret');
  assert.ok(
    fs.existsSync(path.join(__dirname, '../../../ops/asterisk/asterisk.service.d/asgard-env.conf')),
    'asterisk env drop-in must exist so ENV(PBX_CMD_SECRET) can work on prod'
  );

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-s27-'));
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-s27-spool-'));
  process.env.PBX_RECORDINGS_ROOT = tmpRoot;
  process.env.ASTERISK_MONITOR_DIR = spool;
  process.env.PBX_CMD_SECRET = 's27-real-secret';

  // Fresh modules with env
  const cfgPath = require.resolve('../../../src/pbx/config');
  const recPath = require.resolve('../../../src/pbx/recording');
  const idxPath = require.resolve('../../../src/pbx/index');
  delete require.cache[cfgPath];
  delete require.cache[recPath];
  delete require.cache[idxPath];
  // Also clear ami/config deps of index
  Object.keys(require.cache)
    .filter((k) => k.includes(`${path.sep}src${path.sep}pbx${path.sep}`))
    .forEach((k) => delete require.cache[k]);

  const pbx = require('../../../src/pbx/index');
  assert.ok(typeof pbx.createCmdServer === 'function', 'createCmdServer must be exported');

  const pool = createPool();
  pbx.setPool(pool);
  const userId = await pickActiveUserId(pool);
  const pbxUid = 's27-' + Date.now();
  await ensurePbxConfig(pool, {});
  await seedOperators(pool, [
    { userId, on_line: true, sip_username: `u${userId}_s27`, webrtc_registered: true },
  ]);
  await setDutyUser(pool, userId);
  await runInbound(pool, { uniqueId: pbxUid });

  const monRel = `${pbxUid}.wav`;
  const monAbs = path.join(spool, monRel);
  fs.writeFileSync(monAbs, 'RIFF....WAVEfmt ');

  const srv = pbx.createCmdServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();

  try {
    // AMI-ish path without secret → 401
    const denied = await postJson(port, '/call/answer', { channel: 'PJSIP/x' });
    assert.strictEqual(denied.status, 401, 'AMI cmd without secret must 401');

    // Finalize without secret from loopback → allowed (open path)
    const fin = await postJson(port, '/recording/finalize', {
      pbxUid,
      callId: 'pbx_' + pbxUid,
      monFile: monRel,
    });
    assert.ok([200, 202].includes(fin.status), 'finalize without secret on loopback: ' + fin.status + ' ' + fin.body);
    const parsed = JSON.parse(fin.body);
    assert.strictEqual(parsed.ok, true, fin.body);

    const { rows } = await pool.query(
      `SELECT recording_url FROM call_history WHERE pbx_uid = $1`,
      [pbxUid]
    );
    assert.ok(rows[0].recording_url, 'recording_url set via real createCmdServer');

    // Wrong secret on finalize → 401
    const bad = await postJson(
      port,
      '/recording/finalize',
      { pbxUid: 'x' },
      { 'X-PBX-Secret': 'wrong' }
    );
    assert.strictEqual(bad.status, 401, 'wrong secret on finalize must 401');
  } finally {
    await new Promise((r) => srv.close(r));
    await cleanupCall(pool, pbxUid);
    await pool.end();
    delete process.env.PBX_CMD_SECRET;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(spool, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
};
