'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('./config');

function monitorCandidates(pbxUid, monFile) {
  // MixMonitor в dialplan пишет в /var/spool/asterisk/recordings (см. extensions_asgard.conf).
  const ASG_REC = process.env.ASTERISK_RECORDINGS_DIR || '/var/spool/asterisk/recordings';
  const dirs = [
    ASG_REC,
    // Приоритет — спул Asterisk. Копия в recordingsRoot может оказаться
    // «пустышкой» (44 байта), если её сделали до окончания записи, поэтому
    // сначала всегда пробуем первоисточник (инцидент 09.10.2026).
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
 * Запись «пустая»: только WAV-заголовок, аудио-данных нет.
 *
 * Причина (замер на проде 09.10.2026): в спуле Asterisk файл создаётся сразу, а
 * MixMonitor пишет данные по ходу разговора. Если скопировать файл рано (или
 * скопировать заголовок целиком), получается 44 байта с `data size = 0`:
 *   RIFF size_field=36, chunk 'data' size=0
 * → 24 из 33 записей были битыми, STT получал пустоту и расшифровывался в 0 символов.
 */
function isEmptyWav(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (st.size < 1000) return true;
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(64);
      const n = fs.readSync(fd, head, 0, 64, 0);
      if (n < 44) return true;
      if (head.toString('ascii', 0, 4) !== 'RIFF') return false; // не WAV — не нам судить
      // Ищем чанк data и читаем его заявленный размер.
      let i = 12;
      while (i + 8 <= n) {
        const id = head.toString('ascii', i, i + 4);
        const size = head.readUInt32LE(i + 4);
        if (id === 'data') return size === 0;
        i += 8 + size + (size & 1);
      }
      return false;
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return false;
  }
}

/**
 * Склейка раздельных дорожек MixMonitor r()/t() в один стерео-файл.
 *
 * r() = что СЛЫШИТ канал, на котором висит запись, t() = что ГОВОРИТ.
 * Запись inbound стоит на канале клиента → r = оператор, t = клиент.
 * Запись outbound стоит на канале оператора → r = клиент, t = оператор.
 * Нормализуем так, чтобы L = клиент, R = оператор (для STT по каналам).
 *
 * Проверки (инцидент-разбор 11.10.2026, ffmpeg amerge):
 *  - amerge падает (rc=254, файл не создан) на битой/отсутствующей дорожке;
 *  - без -shortest результат обрезается по короткой, теряя конец длинной.
 * Поэтому: обе валидны → amerge + -shortest (или одна → дублируем в стерео).
 * Возвращает путь к стерео или null (тогда остаётся моно).
 */
function mergeStereo(rPath, tPath, outPath, direction) {
  const fsx = require('fs');
  const { spawnSync } = require('child_process');
  const has = (p) => { try { return fsx.existsSync(p) && fsx.statSync(p).size > 1000; } catch (_) { return false; } };
  const valid = (p) => {
    if (!has(p)) return false;
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', p], { encoding: 'utf8' });
    const d = parseFloat(String(r.stdout || '').trim());
    return Number.isFinite(d) && d > 0;
  };
  const rOk = valid(rPath);
  const tOk = valid(tPath);
  if (!rOk && !tOk) return null;

  // L = клиент, R = оператор.
  // inbound: r = оператор → в R, t = клиент → в L.
  // outbound: r = клиент → в L, t = оператор → в R.
  let leftSrc, rightSrc;
  if (rOk && tOk) {
    leftSrc = direction === 'inbound' ? tPath : rPath;
    rightSrc = direction === 'inbound' ? rPath : tPath;
  } else {
    leftSrc = rOk ? rPath : tPath;
    rightSrc = leftSrc; // одна сторона — дублируем (сторона известна как unknown)
  }

  if (leftSrc === rightSrc) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', leftSrc, '-af', 'pan=stereo|c0=c0|c1=c0', '-y', outPath], { encoding: 'utf8' });
    return r.status === 0 && valid(outPath) ? outPath : null;
  }
  const r = spawnSync('ffmpeg', [
    '-v', 'error', '-i', leftSrc, '-i', rightSrc,
    '-filter_complex', '[0:a][1:a]amerge=inputs=2[a]', '-map', '[a]', '-shortest',
    '-y', outPath,
  ], { encoding: 'utf8' });
  if (r.status === 0 && valid(outPath)) return outPath;
  console.warn('[recording] amerge failed:', String(r.stderr || '').slice(0, 200));
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
  // Не копируем «пустышку»: Asterisk ещё не дописал аудио. Бросаем ошибку с тем
  // же маркером, что и отсутствие файла, — finalizeOnHangup повторит попытку.
  if (isEmptyWav(sourcePath)) {
    throw new Error(`Recording source missing (empty wav, ${fs.statSync(sourcePath).size} bytes): ${sourcePath}`);
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

  // Атрибуция звонка оператору: dialplan шлёт endpoint вызывающего (u<user_id>).
  let opUserId = null;
  const opRaw = String(opts.operator || opts.operatorUser || '').trim();
  const m = /^u(\d+)$/.exec(opRaw);
  if (m) opUserId = parseInt(m[1], 10);
  const direction = (opts.direction === 'inbound') ? 'inbound'
    : (opts.direction === 'outbound' ? 'outbound' : null);
  const callType = opts.callType || opts.call_type || direction || null;
  const outNumber = opts.number ? String(opts.number).replace(/[^\d+]/g, '') || null : null;

  // Стерео из раздельных дорожек r()/t() (dialplan их пишет как <base>-r/-t.wav).
  // Нормализуем L = клиент, R = оператор (для STT по каналам). Моно остаётся.
  // ВАЖНО: дорожки лежат в ТОМ ЖЕ подкаталоге, что и моно (YYYY/MM) — раньше
  // искали по basename без подкаталога, поэтому стерео не собиралось
  // (инцидент 11.10.2026: -r/-t есть, .stereo.wav нет).
  let effDestPath = destPath;
  let effRelUrl = relUrl;
  try {
    const srcBase = base.replace(/\.(wav|WAV)$/, '');
    // Дорожки r()/t() лежат рядом с исходным моно-файлом (тот же YYYY/MM).
    // Раньше искали по basename в корне спула → стерео не собиралось.
    const srcDir = path.dirname(sourcePath);
    const spool = [
      process.env.ASTERISK_RECORDINGS_DIR || '/var/spool/asterisk/recordings',
      config.recordingsRoot,
    ];
    let rPath = null;
    let tPath = null;
    const tryDirs = [srcDir, path.join(config.recordingsRoot, yyyy, mm),
      path.join(process.env.ASTERISK_RECORDINGS_DIR || '/var/spool/asterisk/recordings', yyyy, mm)];
    for (const d of tryDirs) {
      const rC = path.join(d, srcBase + '-r.wav');
      const tC = path.join(d, srcBase + '-t.wav');
      if (!rPath && fs.existsSync(rC)) rPath = rC;
      if (!tPath && fs.existsSync(tC)) tPath = tC;
    }
    // Плюс плоский поиск в корне спула (на случай старого dialplan).
    for (const d of spool) {
      const rC = path.join(d, srcBase + '-r.wav');
      const tC = path.join(d, srcBase + '-t.wav');
      if (!rPath && fs.existsSync(rC)) rPath = rC;
      if (!tPath && fs.existsSync(tC)) tPath = tC;
    }
    if (rPath || tPath) {
      const stereoOut = path.join(destDir, srcBase + '.stereo.wav');
      const merged = mergeStereo(rPath, tPath, stereoOut, direction);
      if (merged) {
        effDestPath = merged;
        effRelUrl = `/recordings/${yyyy}/${mm}/${path.basename(merged)}`;
        for (const p of [rPath, tPath]) { try { if (p) fs.unlinkSync(p); } catch (_) {} }
      }
    }
  } catch (e) {
    console.warn('[recording] stereo merge skipped:', e.message);
  }

  const payload = {
    call_id: opts.callId || opts.call_id || (pbxUid ? 'pbx_' + pbxUid : null),
    pbx_uid: pbxUid,
    path: effDestPath,
    url: effRelUrl,
  };

  if (pool) {
    const client = await pool.connect();
    try {
      if (pbxUid) {
        const upd = await client.query(
          // НАПРАВЛЕНИЕ: НЕ перезаписываем уже определённое (инцидент 28.10.2026).
          // `h`-расширения dialplan шлют direction=outbound безусловно, в том
          // числе для ПЛЕЧА ОПЕРАТОРА входящего звонка (канал PJSIP/u<id> живёт в
          // контексте [from-internal], а не во входящем). Из-за этого входящий
          // «клиент → 74993223062» переписывался в исходящий, и в журнале вместо
          // номера клиента показывался номер Асгарда. Авторитетный источник —
          // вебхук Mango (call_direction 1/2), он же и создаёт строку.
          // Поэтому: направление ставим только если оно ещё не задано.
          `UPDATE call_history SET
             recording_url = $1, record_path = $2,
             user_id = COALESCE(user_id, $4),
             answered_by = COALESCE(answered_by, $4),
             direction = CASE WHEN direction IS NULL THEN $5 ELSE direction END,
             call_type = CASE WHEN call_type IS NULL THEN $6 ELSE call_type END,
             from_number = COALESCE(from_number, $7),
             to_number = COALESCE(to_number, $8),
             updated_at = NOW()
           WHERE pbx_uid = $3`,
          [effRelUrl, effDestPath, pbxUid, opUserId, direction, callType,
            direction === 'outbound' ? null : outNumber,
            direction === 'outbound' ? outNumber : null]
        );
        // Исходящие из браузера (from-internal) часто уже есть в call_history —
        // строку завёл вебхук Mango (source IS NULL) с реальным номером. Раньше
        // finalize не находил её по pbx_uid, создавал вторую строку без номеров,
        // и в журнале появлялись дубли «Неизвестный» (инцидент 09.10.2026).
        // Поэтому сначала пробуем привязать запись к такой строке по совпадению
        // направления и номера в пределах окна, и только потом создаём новую.
        if (upd.rowCount === 0) {
          const numCol = direction === 'inbound' ? 'from_number' : 'to_number';
          // Почему не только по номеру: dialplan может не передать
          // ASGARD_OUT_NUMBER (пустая переменная), и тогда прежняя версия с
          // LIKE по номеру не находила строку — появлялся дубль (жалоба 09.10).
          // Поэтому ищем по номеру, а если его нет — по самому свежему
          // «осиротевшему» исходящему за окно 5 минут.
          const match = outNumber ? await client.query(
            `UPDATE call_history SET
               pbx_uid = $1, recording_url = $2, record_path = $3,
               user_id = COALESCE(user_id, $5),
               answered_by = COALESCE(answered_by, $5),
               direction = COALESCE(direction, $6),
               call_type = COALESCE(call_type, $7),
               updated_at = NOW()
             WHERE id = (
               SELECT id FROM call_history
                WHERE pbx_uid IS NULL
                  AND (recording_url IS NULL OR recording_url = '')
                  AND ${numCol} LIKE '%' || $4 || '%'
                  AND ABS(EXTRACT(EPOCH FROM (COALESCE(started_at, created_at) - NOW()))) < 600
                ORDER BY COALESCE(started_at, created_at) DESC
                LIMIT 1
             )
             RETURNING id`,
            [String(pbxUid), effRelUrl, effDestPath, outNumber, opUserId, direction, callType]
          ) : await client.query(
            `UPDATE call_history SET
               pbx_uid = $1, recording_url = $2, record_path = $3,
               user_id = COALESCE(user_id, $4),
               answered_by = COALESCE(answered_by, $4),
               direction = COALESCE(direction, $5),
               call_type = COALESCE(call_type, $6),
               updated_at = NOW()
             WHERE id = (
               SELECT id FROM call_history
                WHERE pbx_uid IS NULL
                  AND (recording_url IS NULL OR recording_url = '')
                  AND direction = COALESCE($5, direction)
                  AND ABS(EXTRACT(EPOCH FROM (COALESCE(started_at, created_at) - NOW()))) < 300
                ORDER BY COALESCE(started_at, created_at) DESC
                LIMIT 1
             )
             RETURNING id`,
            [String(pbxUid), effRelUrl, effDestPath, opUserId, direction, callType]
          );
          if (match.rowCount > 0) {
            // Слили с существующей строкой — дубль не создаём.
          } else {
            // ГОНКА (замер на проде 09.10.2026): PBX-строка создавалась в
            // 23:28:19.21, а строку Mango-вебхук заводил в 23:28:19.26 — на 50 мс
            // ПОЗЖЕ. Оба запроса вставки пришли раньше вебхука, поэтому слияние
            // снова не находило пару и появлялся дубль. Даём вебхуку короткое
            // окно и повторяем поиск ещё раз (важно для живого журнала: строку
            // без номера видно сразу, поэтому ждём немного).
            for (let i = 0; i < 4 && match.rowCount === 0; i += 1) {
              await new Promise((res) => setTimeout(res, 400));
              // ВАЖНО: номер может не прийти из dialplan (пустая переменная),
              // поэтому ретрай обязан работать и без него — иначе дубль всё равно
              // появится (проверено на проде: to_number = NULL у PBX-строк).
              const late = await client.query(
                outNumber
                  ? `UPDATE call_history SET
                       pbx_uid = $1, recording_url = $2, record_path = $3,
                       user_id = COALESCE(user_id, $5),
                       answered_by = COALESCE(answered_by, $5),
                       updated_at = NOW()
                     WHERE id = (
                       SELECT id FROM call_history
                        WHERE pbx_uid IS NULL
                          AND (recording_url IS NULL OR recording_url = '')
                          AND ${numCol} LIKE '%' || $4 || '%'
                          AND ABS(EXTRACT(EPOCH FROM (COALESCE(started_at, created_at) - NOW()))) < 600
                        ORDER BY COALESCE(started_at, created_at) DESC
                        LIMIT 1
                     )
                     RETURNING id`
                  : `UPDATE call_history SET
                       pbx_uid = $1, recording_url = $2, record_path = $3,
                       user_id = COALESCE(user_id, $4),
                       answered_by = COALESCE(answered_by, $4),
                       updated_at = NOW()
                     WHERE id = (
                       SELECT id FROM call_history
                        WHERE pbx_uid IS NULL
                          AND (recording_url IS NULL OR recording_url = '')
                          AND direction = COALESCE($5, direction)
                          AND ABS(EXTRACT(EPOCH FROM (COALESCE(started_at, created_at) - NOW()))) < 300
                        ORDER BY COALESCE(started_at, created_at) DESC
                        LIMIT 1
                     )
                     RETURNING id`,
                outNumber
                  ? [String(pbxUid), effRelUrl, effDestPath, outNumber, opUserId]
                  : [String(pbxUid), effRelUrl, effDestPath, opUserId, direction]
              );
              if (late.rowCount > 0) { match.rowCount = late.rowCount; break; }
            }
          }
          if (match.rowCount === 0) {
            await client.query(
              `INSERT INTO call_history (
                 call_id, pbx_uid, source, direction, call_type, status, outcome,
                 recording_url, record_path, user_id, answered_by,
                 from_number, to_number, started_at, timestamp, created_at, updated_at
               ) VALUES ($1, $2, 'pbx', $5, $6, 'completed', 'recorded',
                 $3, $4, $7, $7,
                 $8, $9, NOW(), NOW(), NOW(), NOW())
               ON CONFLICT (call_id) DO UPDATE SET
                 recording_url = EXCLUDED.recording_url,
                 record_path = EXCLUDED.record_path,
                 user_id = COALESCE(call_history.user_id, EXCLUDED.user_id),
                 answered_by = COALESCE(call_history.answered_by, EXCLUDED.answered_by),
                 updated_at = NOW()`,
              ['pbx_' + pbxUid, String(pbxUid), effRelUrl, effDestPath,
                direction || 'outbound', callType || 'outbound', opUserId,
                direction === 'outbound' ? null : outNumber,
                direction === 'outbound' ? outNumber : null]
            );
          }
        }
      }
      await client.query('SELECT pg_notify($1, $2)', [
        'pbx_recording_ready',
        JSON.stringify(payload),
      ]);
    } finally {
      client.release();
    }
  }

  return { destPath: effDestPath, relUrl: effRelUrl };
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
