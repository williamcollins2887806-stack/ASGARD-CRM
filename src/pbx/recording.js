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
    try {
      // rename работает только в пределах одной ФС и требует прав на исходный каталог;
      // asterisk-спул нам недоступен на запись — копируем, затем best-effort удаляем.
      fs.renameSync(sourcePath, destPath);
    } catch (e) {
      fs.copyFileSync(sourcePath, destPath);
      try { fs.unlinkSync(sourcePath); } catch (_) { /* оставляем исходник asterisk */ }
    }
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
 * Asterisk закрывает WAV с задержкой, поэтому при pending_file ждём и пробуем снова.
 */
async function finalizeOnHangup(pool, opts) {
  const pbxUid = opts.pbxUid || opts.pbx_uid;
  if (!pbxUid && !opts.sourcePath && !opts.monFile) {
    return { ok: false, reason: 'no_uid' };
  }
  const maxAttempts = Number(process.env.PBX_FINALIZE_ATTEMPTS || 8);
  let lastPending = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const r = await finalizeRecording(pool, opts);
      return { ok: true, attempt, ...r };
    } catch (e) {
      if (String(e.message || '').includes('Recording source missing')) {
        lastPending = e.message;
        // Ждём сброса MixMonitor: 1с, 2с, 3с… (в сумме ~30с)
        await new Promise((res) => setTimeout(res, Math.min(attempt, 5) * 1000));
        continue;
      }
      throw e;
    }
  }
  return { ok: false, reason: 'pending_file', error: lastPending };
}

/**
 * Фоновый sweep: привязать записи, у которых h-хук/AMI-событие не долетели.
 * Ищет свежие call_history с pbx_uid без recording_url и пробует finalize.
 */
async function sweepRecordings(pool, { lookbackMinutes = 15, limit = 30 } = {}) {
  if (!pool) return { ok: false, reason: 'no_pool' };
  const { rows } = await pool.query(
    `SELECT pbx_uid FROM call_history
      WHERE pbx_uid IS NOT NULL AND pbx_uid <> ''
        AND (recording_url IS NULL OR recording_url = '')
        AND started_at > NOW() - ($1 || ' minutes')::interval
      ORDER BY id DESC LIMIT $2`,
    [String(lookbackMinutes), limit]
  );
  const attached = [];
  for (const r of rows) {
    try {
      const res = await finalizeOnHangup(pool, { pbxUid: r.pbx_uid, callId: 'pbx_' + r.pbx_uid });
      if (res.ok) attached.push(r.pbx_uid);
    } catch (_) { /* пропускаем — попробуем на следующем тике */ }
  }
  return { ok: true, scanned: rows.length, attached };
}

/**
 * Сохранить голосовое сообщение: перенести WAV в recordings, привязать к звонку,
 * пометить как голосовую почту и разослать пуш пропущенного.
 * @param {import('pg').Pool} pool
 * @param {{pbxUid?: string, callId?: string, file?: string}} opts
 */
async function saveVoicemail(pool, opts) {
  const pbxUid = opts.pbxUid || opts.pbx_uid;
  const file = opts.file || opts.sourcePath;
  if (!pbxUid || !file || !fs.existsSync(file)) {
    return { ok: false, reason: 'no_file', file };
  }
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const destDir = path.join(config.recordingsRoot, yyyy, mm);
  fs.mkdirSync(destDir, { recursive: true });
  const base = `vm_${pbxUid}.wav`;
  const destPath = path.join(destDir, base);
  try {
    fs.renameSync(file, destPath);
  } catch (_) {
    fs.copyFileSync(file, destPath);
    try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
  }
  const relUrl = `/recordings/${yyyy}/${mm}/${base}`;

  if (pool) {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE call_history
            SET recording_url = $1, record_path = $2, call_type = 'missed',
                status = 'missed', outcome = 'voicemail', updated_at = NOW()
          WHERE pbx_uid = $3`,
        [relUrl, destPath, pbxUid]
      );
      await client.query('SELECT pg_notify($1, $2)', [
        'pbx_recording_ready',
        JSON.stringify({ call_id: 'pbx_' + pbxUid, pbx_uid: pbxUid, path: destPath, url: relUrl, voicemail: true }),
      ]);
    } finally {
      client.release();
    }
  }
  return { ok: true, destPath, relUrl, voicemail: true };
}

module.exports = { finalizeRecording, finalizeOnHangup, findRecordingSource, sweepRecordings, saveVoicemail };
