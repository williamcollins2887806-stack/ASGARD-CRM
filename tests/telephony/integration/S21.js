'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPool, pickActiveUserId, runInbound, cleanupCall, seedOperators, setDutyUser, ensurePbxConfig } = require('./harness');

module.exports.id = 'S21';

function loadFinalizeRecording(tmpRoot) {
  process.env.PBX_RECORDINGS_ROOT = tmpRoot;
  const cfgPath = require.resolve('../../../src/pbx/config');
  const recPath = require.resolve('../../../src/pbx/recording');
  delete require.cache[cfgPath];
  delete require.cache[recPath];
  return require('../../../src/pbx/recording').finalizeRecording;
}

module.exports.run = async function run() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-rec-'));
  const finalizeRecording = loadFinalizeRecording(tmpRoot);

  const pool = createPool();
  const userId = await pickActiveUserId(pool);
  const pbxUid = 's21-' + Date.now();
  await ensurePbxConfig(pool, {});
  await seedOperators(pool, [
    { userId, on_line: true, sip_username: `u${userId}_s21`, webrtc_registered: true },
  ]);
  await setDutyUser(pool, userId);
  await runInbound(pool, { uniqueId: pbxUid });

  const src = path.join(tmpRoot, 'mix-' + pbxUid + '.wav');
  fs.writeFileSync(src, 'RIFF....WAVEfmt ');

  try {
    const r = await finalizeRecording(pool, {
      sourcePath: src,
      pbxUid,
      callId: 'pbx_' + pbxUid,
    });
    assert.ok(r.destPath && fs.existsSync(r.destPath));
    assert.ok(r.relUrl.startsWith('/recordings/'));
    const { rows } = await pool.query(
      `SELECT recording_url FROM call_history WHERE pbx_uid = $1`,
      [pbxUid]
    );
    assert.strictEqual(rows[0].recording_url, r.relUrl);
  } finally {
    await cleanupCall(pool, pbxUid);
    await pool.end();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
};
