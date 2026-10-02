'use strict';

/**
 * S25: hangup → finalizeOnHangup пишет recording_url (контур MixMonitor→CMD).
 */
const assert = require('assert');
const fs = require('fs');
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

module.exports.id = 'S25';

function loadFinalize(tmpRoot, spool) {
  process.env.PBX_RECORDINGS_ROOT = tmpRoot;
  process.env.ASTERISK_MONITOR_DIR = spool;
  const cfgPath = require.resolve('../../../src/pbx/config');
  const recPath = require.resolve('../../../src/pbx/recording');
  delete require.cache[cfgPath];
  delete require.cache[recPath];
  return require('../../../src/pbx/recording');
}

module.exports.run = async function run() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-rec-'));
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-spool-'));
  const { finalizeOnHangup } = loadFinalize(tmpRoot, spool);

  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  const pbxUid = 's25-' + Date.now();
  await ensurePbxConfig(pool, {});
  await seedOperators(pool, [
    { userId, on_line: true, sip_username: `u${userId}_s25`, webrtc_registered: true },
  ]);
  await setDutyUser(pool, userId);
  await runInbound(pool, { uniqueId: pbxUid });

  const monRel = `2026/10/${pbxUid}.wav`;
  const monAbs = path.join(spool, monRel);
  fs.mkdirSync(path.dirname(monAbs), { recursive: true });
  fs.writeFileSync(monAbs, 'RIFF....WAVEfmt ');

  // Dialplan `h` + CMD: monFile relative + pbxUid
  const dialplanConf = fs.readFileSync(
    path.join(__dirname, '../../../ops/asterisk/extensions_asgard.conf'),
    'utf8'
  );
  assert.ok(dialplanConf.includes('exten => h,1'), 'dialplan must have hangup h extension');
  assert.ok(dialplanConf.includes('/recording/finalize'), 'dialplan must curl finalize');

  try {
    const r = await finalizeOnHangup(pool, {
      pbxUid,
      callId: 'pbx_' + pbxUid,
      monFile: monRel,
    });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.ok(r.destPath && fs.existsSync(r.destPath));
    const { rows } = await pool.query(
      `SELECT recording_url FROM call_history WHERE pbx_uid = $1`,
      [pbxUid]
    );
    assert.ok(rows[0].recording_url, 'recording_url must be set after hangup finalize');
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(spool, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
};
