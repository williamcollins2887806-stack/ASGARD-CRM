'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('./config');

function monitorCandidates(pbxUid, monFile) {
  // MixMonitor в dialplan пишет в /var/spool/asterisk/recordings (см. extensions_asgard.conf).
  const ASG_REC = process.env.ASTERISK_RECORDINGS_DIR || '/var/spool/asterisk/recordings';
  const dirs = [
    ASG_REC,
    process.env.ASTERISK_MONITOR_DIR || '/var/spool/asterisk/monitor',
    config.recordingsRoot,
  ];
  const list = [];
  if (monFile) {
    list.push(monFile);
    if (!path.isAbsolute(monFile)) {
      for (const d of dirs) list.push(path.join(d, monFile));
    }
  }
  if (pbxUid) {
    const base = String(pbxUid);
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    for (const d of dirs) {
      list.push(path.join(d, base + '.wav'));
      list.push(path.join(d, base + '.WAV'));
      list.push(path.join(d, yyyy, mm, base + '.wav'));
    }
  }
  return list;
}

/**
 * Найти файл MixMonitor по pbxUid / monFile.
 */
function findRecordingSource(opts) {
  const cands = monitorCandidates(opts.pbxUid || opts.pbx_uid, opts.monFile || opts.sourcePath);
  for (const p of cands) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Перенос MixMonitor файла в иерархию YYYY/MM и NOTIFY в PostgreSQL.
 * @param {object} pool — pg Pool
 * @param {object} opts — { sourcePath, callId, pbxUid, monFile }
 */
async function finalizeRecording(pool, opts) {
  let sourcePath = opts.sourcePath || opts.monFile || null;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    sourcePath = findRecordingSource(opts);
  }
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Recording source missing: ${opts.sourcePath || opts.pbxUid || opts.monFile}`);
  }
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const root = config.recordingsRoot;
  const destDir = path.join(root, yyyy, mm);
  fs.mkdirSync(destDir, { recursive: true });
  const base = path.basename(sourcePath);
  const destPath = path.join(destDir, base);
  if (path.resolve(sourcePath) !== path.resolve(destPath)) {
    fs.renameSync(sourcePath, destPath);
  }

  const relUrl = `/recordings/${yyyy}/${mm}/${base}`;
  const pbxUid = opts.pbxUid || opts.pbx_uid || null;
  const payload = {
    call_id: opts.callId || opts.call_id || (pbxUid ? 'pbx_' + pbxUid : null),
    pbx_uid: pbxUid,
    path: destPath,
    url: relUrl,
  };

  if (pool) {
    const client = await pool.connect();
    try {
      if (pbxUid) {
        await client.query(
          `UPDATE call_history SET recording_url = $1, record_path = $2, updated_at = NOW()
           WHERE pbx_uid = $3`,
          [relUrl, destPath, pbxUid]
        );
      }
      await client.query('SELECT pg_notify($1, $2)', [
        'pbx_recording_ready',
        JSON.stringify(payload),
      ]);
    } finally {
      client.release();
    }
  }

  return { destPath, relUrl };
}

/**
 * Hangup-хук: найти файл и finalize. Не бросает, если файла ещё нет (MixMonitor flush).
 */
async function finalizeOnHangup(pool, opts) {
  const pbxUid = opts.pbxUid || opts.pbx_uid;
  if (!pbxUid && !opts.sourcePath && !opts.monFile) {
    return { ok: false, reason: 'no_uid' };
  }
  try {
    const r = await finalizeRecording(pool, opts);
    return { ok: true, ...r };
  } catch (e) {
    if (String(e.message || '').includes('Recording source missing')) {
      return { ok: false, reason: 'pending_file', error: e.message };
    }
    throw e;
  }
}

module.exports = { finalizeRecording, finalizeOnHangup, findRecordingSource };
