'use strict';

/**
 * Очередь и пайплайн протокола Тинга.
 * Запрет: import call-analyzer.
 */

const fs = require('fs');
const path = require('path');
const { buildThingProtocolPrompt } = require('../prompts/thing-protocol-prompt');
const { createNotification } = require('./notify');

const PROTOCOL_STATUSES = [
  'skipped',
  'queued',
  'transcribing',
  'generating',
  'ready',
  'failed'
];

async function enqueueJob(db, { jobType, roomId = null, recordingId = null, payload = {} }) {
  const { rows } = await db.query(
    `INSERT INTO thing_jobs (job_type, room_id, recording_id, payload, status, scheduled_at)
     VALUES ($1, $2, $3, $4::jsonb, 'pending', NOW())
     RETURNING *`,
    [jobType, roomId, recordingId, JSON.stringify(payload)]
  );
  return rows[0];
}

async function setRecordingProtocolStatus(db, recordingId, status, errorText = null) {
  if (!PROTOCOL_STATUSES.includes(status)) {
    throw new Error(`Неизвестный protocol_status: ${status}`);
  }
  const { rows } = await db.query(
    `UPDATE thing_recordings
     SET protocol_status = $2,
         protocol_error = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [recordingId, status, errorText]
  );
  return rows[0];
}

async function onRecordingReady(db, rec) {
  const { rows: rooms } = await db.query('SELECT * FROM thing_rooms WHERE id = $1', [rec.room_id]);
  const room = rooms[0];
  if (!room) return { protocol: 'no_room' };
  if (!room.protocol_enabled) {
    await db.query(
      `UPDATE thing_recordings
       SET protocol_status = 'skipped', updated_at = NOW()
       WHERE id = $1 AND protocol_status NOT IN ('ready', 'failed')`,
      [rec.id]
    );
    return { protocol: 'skipped' };
  }
  if (rec.protocol_status === 'ready') {
    return { protocol: 'ready', recordingId: rec.id };
  }

  // Снимаем «зависшие» задачи прошлых попыток. Иначе воркер подхватит старую
  // запись (с прежним file_path) и перетрёт статус — классический баг, когда
  // запись висит в processing сутками.
  await db.query(
    `UPDATE thing_jobs
     SET status = 'failed', error = 'superseded by new protocol run', completed_at = NOW()
     WHERE recording_id = $1 AND status IN ('pending', 'retry', 'processing')`,
    [rec.id]
  );

  await setRecordingProtocolStatus(db, rec.id, 'queued');
  await enqueueJob(db, {
    jobType: 'thing_transcribe',
    roomId: room.id,
    recordingId: rec.id,
    payload: { meeting_id: room.meeting_id }
  });
  return { protocol: 'queued', recordingId: rec.id };
}

async function onRoomEnded(db, room) {
  const { rows: recs } = await db.query(
    `SELECT * FROM thing_recordings
     WHERE room_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [room.id]
  );
  const rec = recs[0];
  if (!rec) {
    // Записей не было: Tинг или без записи, или запись оборвалась до строки в БД
    if (!room.protocol_enabled) return { protocol: 'skipped' };
    return { protocol: 'no_recording' };
  }
  return onRecordingReady(db, rec);
}

function _parseProtocolJson(text) {
  if (!text) throw new Error('Пустой ответ ИИ');
  const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('ИИ не вернул JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function handleTranscribe(db, job, log) {
  const { getSpeechKitService } = require('./speechkit');
  const speech = getSpeechKitService();
  const recId = job.recording_id;
  const { rows } = await db.query('SELECT * FROM thing_recordings WHERE id = $1', [recId]);
  const rec = rows[0];
  if (!rec) throw new Error('recording not found');

  await setRecordingProtocolStatus(db, recId, 'transcribing');
  await db.query(
    `UPDATE thing_recordings SET transcript_status = 'processing', updated_at = NOW() WHERE id = $1`,
    [recId]
  );

  if (!speech.isConfigured()) {
    throw new Error('SpeechKit не настроен');
  }
  if (!rec.file_path || !fs.existsSync(rec.file_path)) {
    throw new Error('Файл записи ещё не готов: ' + (rec.file_path || 'null'));
  }

  const result = await speech.transcribeFile(rec.file_path, {
    enableSpeakerDiarization: true,
    maxSpeakers: 8,
    languageCode: 'ru-RU'
  });

  const segments = result.segments || result.chunks || [];
  await db.query(
    `UPDATE thing_recordings
     SET transcript_status = 'ready',
         transcript_segments = $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [recId, JSON.stringify(segments)]
  );

  await enqueueJob(db, {
    jobType: 'thing_protocol',
    roomId: job.room_id,
    recordingId: recId,
    payload: job.payload || {}
  });
  log.info?.('[thing-pipeline] transcribed recording', recId);
}

async function handleProtocol(db, job, log) {
  const ai = require('./ai-provider');
  const recId = job.recording_id;
  const { rows } = await db.query('SELECT * FROM thing_recordings WHERE id = $1', [recId]);
  const rec = rows[0];
  if (!rec) throw new Error('recording not found');

  const { rows: rooms } = await db.query('SELECT * FROM thing_rooms WHERE id = $1', [rec.room_id]);
  const room = rooms[0];
  if (!room) throw new Error('room not found');

  await setRecordingProtocolStatus(db, recId, 'generating');

  const { rows: parts } = await db.query(
    `SELECT display_name, role FROM thing_participants WHERE room_id = $1 ORDER BY id`,
    [room.id]
  );

  const prompt = buildThingProtocolPrompt({
    title: room.title,
    startedAt: room.started_at,
    endedAt: room.ended_at,
    segments: rec.transcript_segments || [],
    participants: parts
  });

  const { rows: [run] } = await db.query(
    `INSERT INTO thing_protocol_runs (recording_id, meeting_id, model, status, created_by)
     VALUES ($1, $2, $3, 'running', $4)
     RETURNING *`,
    [recId, room.meeting_id, 'thing-protocol', room.host_user_id]
  );

  const aiResult = await ai.complete({
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    maxTokens: 4000,
    temperature: 0.2,
    responseFormat: { type: 'json_object' }
  });

  const parsed = _parseProtocolJson(aiResult.text);

  // Пункты протокола собираем ВСЕГДА — UI читает их из raw_json, даже когда Тинг
  // не привязан к совещанию (иначе протокол выглядит пустым).
  const items = [];
  if (parsed.summary) items.push({ type: 'summary', content: parsed.summary });
  for (const d of parsed.decisions || []) items.push({ type: 'decision', content: String(d) });
  for (const a of parsed.assignments || []) {
    const obj = a && typeof a === 'object' ? a : { text: a };
    const text = String(obj.text || '').trim();
    if (!text) continue;
    const meta = [obj.responsible ? `→ ${obj.responsible}` : null,
      obj.deadline ? `(срок: ${obj.deadline})` : null].filter(Boolean).join(' ');
    items.push({
      type: 'assignment',
      content: [text, meta].filter(Boolean).join(' '),
      assignee: obj.responsible || null,
      due: obj.deadline || null,
      status: 'open'
    });
  }

  await db.query(
    `UPDATE thing_protocol_runs
     SET status = 'ready', raw_json = $2::jsonb, model = $3, completed_at = NOW()
     WHERE id = $1`,
    [run.id, JSON.stringify({ ...parsed, items, _usage: aiResult.usage || null }), aiResult.model || null]
  );

  if (room.meeting_id) {
    let order = 0;
    const { rows: maxRows } = await db.query(
      `SELECT COALESCE(MAX(item_order), 0) AS m FROM meeting_minutes WHERE meeting_id = $1`,
      [room.meeting_id]
    );
    order = Number(maxRows[0].m) || 0;

    for (const it of items) {
      order += 1;
      await db.query(
        `INSERT INTO meeting_minutes (meeting_id, item_order, item_type, content, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [room.meeting_id, order, it.type, it.content, room.host_user_id]
      );
    }

    if (parsed.summary) {
      try {
        await db.query(
          `UPDATE meetings SET minutes = $2, updated_at = NOW() WHERE id = $1`,
          [room.meeting_id, parsed.summary]
        );
      } catch (e) {
        console.warn('[thing-pipeline] meetings.minutes mirror failed', e && e.message);
      }
    }
  }

  await setRecordingProtocolStatus(db, recId, 'ready');

  try {
    await createNotification(db, {
      user_id: room.host_user_id,
      title: 'Протокол Тинга готов',
      message: room.title,
      type: 'thing',
      link: room.meeting_id ? `#/meetings/${room.meeting_id}` : `#/ting/${room.slug}`
    });
  } catch (e) {
    console.warn('[thing-pipeline] minutes mirror failed', e && e.message);
  }

  log.info?.('[thing-pipeline] protocol ready', recId);
}

function createThingWorker(db, log = console) {
  let timer = null;
  let busy = false;

  async function processJob(job) {
    try {
      if (job.job_type === 'thing_transcribe') {
        await handleTranscribe(db, job, log);
      } else if (job.job_type === 'thing_protocol') {
        await handleProtocol(db, job, log);
      } else {
        throw new Error('Unknown job_type: ' + job.job_type);
      }
      await db.query(
        `UPDATE thing_jobs SET status = 'done', completed_at = NOW(), error = NULL WHERE id = $1`,
        [job.id]
      );
    } catch (e) {
      const attempts = Number(job.attempts) || 1;
      const max = Number(job.max_attempts) || 3;
      const failStatus = attempts >= max ? 'failed' : 'retry';
      await db.query(
        `UPDATE thing_jobs
         SET status = $2,
             error = $3,
             scheduled_at = CASE WHEN $2 = 'retry' THEN NOW() + interval '30 seconds' ELSE scheduled_at END,
             completed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END
         WHERE id = $1`,
        [job.id, failStatus, String(e.message || e).slice(0, 2000)]
      );
      if (job.recording_id && failStatus === 'failed') {
        await setRecordingProtocolStatus(db, job.recording_id, 'failed', String(e.message || e).slice(0, 500));
      }
      log.error?.('[thing-pipeline] job failed', job.id, e.message);
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const { rows } = await db.query(
        `UPDATE thing_jobs
         SET status = 'processing', started_at = NOW(), attempts = attempts + 1
         WHERE id = (
           SELECT id FROM thing_jobs
           WHERE status IN ('pending', 'retry') AND scheduled_at <= NOW()
           ORDER BY id
           LIMIT 1
         )
         RETURNING *`
      );
      const job = rows[0];
      if (!job) return;
      await processJob(job);
    } catch (e) {
      log.error?.('[thing-pipeline]', e.message);
    } finally {
      busy = false;
    }
  }

  return {
    start(intervalMs = 5000) {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
      if (timer.unref) timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
    handleTranscribe,
    handleProtocol
  };
}

module.exports = {
  PROTOCOL_STATUSES,
  enqueueJob,
  setRecordingProtocolStatus,
  onRecordingReady,
  onRoomEnded,
  createThingWorker
};
